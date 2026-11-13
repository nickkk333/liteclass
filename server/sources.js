import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { XMLParser } from "fast-xml-parser";
import { DATA_DIR } from "./db.js";
import {
  isVirtualPath, parseVirtual, virtualPath, sourceRoot, normalizeAnyPath,
  normalizeLocalPath, pJoin, pDirname, pBasename, mountRoots,
} from "./paths.js";

// 与 OfflineU 的 sources.go 对应：可插拔课程来源（本地 / WebDAV / SMB）、
// 密码只写不读、虚拟路径命名空间，以及给扫描 / 流式播放用的统一文件门面。

const SOURCES_FILE = path.join(DATA_DIR, "sources.json");
const SOURCES_TMP = SOURCES_FILE + ".tmp";
const PROPFIND_BODY = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>'
  + "<d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:displayname/>"
  + "</d:prop></d:propfind>";

let sources = [];
try {
  const parsed = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  if (Array.isArray(parsed.sources)) sources = parsed.sources;
} catch {}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SOURCES_TMP, JSON.stringify({ version: 1, sources }, null, 2), { mode: 0o600 });
  fs.renameSync(SOURCES_TMP, SOURCES_FILE);
  try { fs.chmodSync(SOURCES_FILE, 0o600); } catch {}
}

const trim = (v) => String(v ?? "").trim();
const lower = (v) => trim(v).toLowerCase();
const asArray = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
const natural = (a, b) => String(a).localeCompare(String(b), "zh-CN", { numeric: true, sensitivity: "base" });

function defaultName(s) {
  if (s.kind === "webdav") {
    try { return decodeURIComponent(new URL(s.url).pathname.split("/").filter(Boolean).pop() || new URL(s.url).hostname); }
    catch { return "WebDAV"; }
  }
  if (s.kind === "smb") return s.base_path ? s.base_path.split("/").filter(Boolean).pop() : (s.share || s.host || "SMB");
  return path.basename(s.path || "") || "本地目录";
}

export function cleanSource(input) {
  const src = { ...input };
  src.kind = lower(src.kind);
  for (const key of ["name", "url", "path", "host", "share", "base_path", "domain", "username", "password"]) {
    if (typeof src[key] === "string") src[key] = src[key].trim();
    else if (src[key] == null) src[key] = "";
  }
  if (src.url) src.url = src.url.replace(/\/+$/, "");
  if (src.share) src.share = src.share.replace(/^[\\/]+|[\\/]+$/g, "");
  if (src.base_path) src.base_path = src.base_path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (src.path) src.path = path.resolve(src.path);
  const port = Number(src.port || 0);
  src.port = Number.isInteger(port) && port > 0 && port < 65536 ? port : 0;
  src.insecure_tls = !!src.insecure_tls;
  if (!src.name) src.name = defaultName(src);
  return src;
}

export function validateSource(s) {
  if (!["local", "webdav", "smb"].includes(s.kind)) return "未知的课程来源类型";
  if (s.kind === "local") {
    if (!s.path) return "请填写本地目录路径";
    try { if (!fs.statSync(s.path).isDirectory()) return "路径不是文件夹"; } catch { return "本地目录不存在或无法访问"; }
    return null;
  }
  if (s.kind === "webdav") {
    try {
      const u = new URL(s.url);
      if (!["http:", "https:"].includes(u.protocol) || !u.hostname) return "WebDAV 地址必须是 http/https URL";
    } catch { return "WebDAV 地址格式不正确"; }
    return null;
  }
  if (s.kind === "smb") {
    if (s.path) {
      try { if (!fs.statSync(s.path).isDirectory()) return "SMB 挂载路径不是文件夹"; } catch { return "SMB 挂载路径不存在（Windows 可用 UNC，Linux 请先 mount -t cifs）"; }
      return null;
    }
    if (!s.host || !s.share) return "请填写 SMB 主机与共享名，或已挂载的本地路径";
    return null;
  }
  return null;
}

const publicInfo = (s) => ({
  id: s.id, name: s.name, kind: s.kind, root: sourceRoot(s.id),
  path: s.path || "", url: s.url || "", host: s.host || "", port: s.port || 0,
  share: s.share || "", base_path: s.base_path || "", username: s.username || "",
  insecure_tls: !!s.insecure_tls, has_password: !!s.password,
});

export const listSources = () => sources.map(publicInfo);
export const findSource = (id) => sources.find((s) => s.id === id) || null;
export const sourceShortcuts = () => listSources().map((s) => ({ path: s.root, label: s.name, kind: s.kind }));

function targetKey(s) {
  if (s.kind === "local") return `local|${lower(s.path)}`;
  if (s.kind === "webdav") return `webdav|${lower(s.url)}`;
  return `smb|${lower(s.host)}|${s.port || 445}|${lower(s.share)}|${lower(s.base_path)}|${lower(s.path)}`;
}

function newId() {
  for (let i = 0; i < 8; i++) {
    const id = crypto.randomBytes(6).toString("hex");
    if (!findSource(id)) return id;
  }
  return crypto.randomBytes(8).toString("hex");
}

export function addSource(input) {
  const s = cleanSource({ ...input, id: "" });
  const error = validateSource(s);
  if (error) throw new Error(error);
  s.id = newId();
  sources.push(s);
  try { persist(); } catch (e) { sources.pop(); throw e; }
  return publicInfo(s);
}

function mergeCredentials(next, prev) {
  for (const key of ["password", "username", "domain"]) if (!next[key]) next[key] = prev[key] || "";
  if (!next.insecure_tls) next.insecure_tls = !!prev.insecure_tls;
  if (!next.name || next.name === defaultName(next)) next.name = prev.name;
}

export function updateSource(input) {
  const id = trim(input.id);
  const index = sources.findIndex((s) => s.id === id);
  if (index < 0) throw new Error("课程来源不存在");
  const prev = sources[index];
  const next = cleanSource({ ...prev, ...input, id });
  mergeCredentials(next, prev);
  const error = validateSource(next);
  if (error) throw new Error(error);
  sources[index] = next;
  try { persist(); } catch (e) { sources[index] = prev; throw e; }
  return publicInfo(next);
}

export function removeSource(id) {
  const index = sources.findIndex((s) => s.id === String(id || "").trim());
  if (index < 0) throw new Error("课程来源不存在");
  const [removed] = sources.splice(index, 1);
  try { persist(); } catch (e) { sources.splice(index, 0, removed); throw e; }
  return { ok: true };
}

// ---------------- 后端：本地 / WebDAV / SMB ----------------

function localBackend(root) {
  const resolve = (rel) => {
    const full = path.resolve(root, String(rel || "").replace(/\\/g, "/"));
    if (full !== path.resolve(root) && !full.startsWith(path.resolve(root) + path.sep)) throw new Error("路径越界");
    return full;
  };
  return {
    async stat(rel) {
      const st = await fsp.stat(resolve(rel));
      return { size: st.size, isFile: st.isFile(), isDir: st.isDirectory(), mtimeMs: st.mtimeMs };
    },
    async readDir(rel) {
      const entries = await fsp.readdir(resolve(rel), { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile() }))
        .sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || natural(a.name, b.name));
    },
    async read(rel, start, length) {
      const file = resolve(rel);
      const handle = await fsp.open(file, "r");
      try {
        const size = (await handle.stat()).size;
        const count = Math.max(0, Math.min(Number.isFinite(length) ? length : size - start, size - start));
        const buffer = Buffer.alloc(count);
        await handle.read(buffer, 0, count, start);
        return { buffer, size };
      } finally { await handle.close(); }
    },
    openRange(rel, start, end) {
      const file = resolve(rel);
      const size = fs.statSync(file).size;
      const from = Math.max(0, Math.min(start, size));
      const to = Math.min(Number.isFinite(end) ? end : size - 1, size - 1);
      return { stream: fs.createReadStream(file, { start: from, end: to }), start: from, end: to, size };
    },
    async test() {
      const st = await fsp.stat(resolve(""));
      if (!st.isDirectory()) throw new Error("来源根目录不是文件夹");
    },
  };
}

function urlRequest(urlString, { method = "GET", headers = {}, body, insecure = false, timeout = 60000, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlString); } catch (e) { return reject(e); }
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, { method, headers, rejectUnauthorized: !insecure, timeout }, (res) => {
      if (stream) return resolve({ status: res.statusCode, headers: res.headers, stream: res });
      const chunks = [];
      let total = 0;
      res.on("data", (chunk) => {
        if (total < 8 * 1024 * 1024) { chunks.push(chunk); total += chunk.length; }
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
const encodeRel = (rel) => String(rel || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
const keepSegment = (rel) => String(rel || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

function davProps(response) {
  for (const stat of asArray(response?.propstat)) {
    if (!String(stat?.status || "").includes(" 200 ")) continue;
    const prop = stat.prop || {};
    const collection = prop.resourcetype && Object.prototype.hasOwnProperty.call(prop.resourcetype, "collection");
    return {
      isDir: !!collection,
      size: Number(prop.getcontentlength || 0) || 0,
      name: prop.displayname ? String(prop.displayname) : "",
    };
  }
  return null;
}

function webdavBackend(s) {
  const base = new URL(s.url);
  const basePath = base.pathname.replace(/\/+$/, "");
  const auth = (s.username || s.password)
    ? "Basic " + Buffer.from(`${s.username || ""}:${s.password || ""}`).toString("base64")
    : "";
  const targetUrl = (rel) => {
    const u = new URL(base.href);
    u.pathname = `${basePath}/${encodeRel(rel)}`.replace(/\/{2,}/g, "/");
    return u.href;
  };
  const propfind = async (rel, depth) => {
    const headers = { Depth: String(depth), "Content-Type": "application/xml; charset=utf-8" };
    if (auth) headers.Authorization = auth;
    const res = await urlRequest(targetUrl(rel), {
      method: "PROPFIND", headers, body: PROPFIND_BODY, insecure: s.insecure_tls, timeout: 60000,
    });
    if (res.status === 404) return null;
    if (![200, 207].includes(res.status)) throw new Error(`WebDAV PROPFIND 失败 (${res.status})`);
    const parsed = parser.parse(res.body.toString("utf8"));
    return asArray(parsed?.multistatus?.response);
  };
  const relativeHref = (href) => {
    let p;
    try { p = decodeURIComponent(new URL(href, base).pathname); } catch { return ""; }
    if (!p.startsWith(basePath)) return "";
    return p.slice(basePath.length).replace(/^\/+|\/+$/g, "");
  };
  return {
    async stat(rel) {
      const responses = await propfind(rel, 0);
      if (!responses) return null;
      const wanted = keepSegment(rel).toLowerCase();
      const match = responses.find((r) => relativeHref(r.href || "")?.toLowerCase() === wanted) || responses[0];
      const props = match && davProps(match);
      if (!props) throw new Error("WebDAV 未返回文件属性（需要 getcontentlength）");
      return { size: props.size, isFile: !props.isDir, isDir: props.isDir, mtimeMs: 0 };
    },
    async readDir(rel) {
      const responses = await propfind(rel, 1);
      if (!responses) return [];
      const parent = keepSegment(rel).toLowerCase();
      const out = new Map();
      for (const response of responses) {
        const href = relativeHref(response.href || "");
        const clean = href.toLowerCase();
        if (!href || clean === parent) continue;
        const rest = parent ? href.slice(parent.length).replace(/^\/+/, "") : href;
        if (!rest || rest.includes("/")) continue;
        const props = davProps(response);
        if (!props) continue;
        out.set(rest, { name: props.name || rest, isDir: props.isDir, isFile: !props.isDir });
      }
      return [...out.values()].sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || natural(a.name, b.name));
    },
    async read(rel, start, length) {
      return this.readRange(rel, start, length);
    },
    async readRange(rel, start, length) {
      const headers = {};
      if (auth) headers.Authorization = auth;
      const end = Number.isFinite(length) ? start + Math.max(0, length) - 1 : "";
      if (start > 0 || end !== "") headers.Range = `bytes=${start}-${end}`;
      const res = await urlRequest(targetUrl(rel), { headers, insecure: s.insecure_tls, stream: true, timeout: 0 });
      if (res.status === 416) return { buffer: Buffer.alloc(0), size: start };
      if (![200, 206].includes(res.status)) { res.stream.resume(); throw new Error(`WebDAV GET 失败 (${res.status})`); }
      const total = Number(String(res.headers["content-range"] || "").split("/").pop()) || Number(res.headers["content-length"]) || 0;
      const skip = res.status === 200 ? start : 0;
      const chunks = [];
      let got = 0;
      for await (const chunk of sliceStream(res.stream, skip, Number.isFinite(length) ? length : Infinity)) {
        chunks.push(chunk); got += chunk.length;
      }
      return { buffer: Buffer.concat(chunks), size: res.status === 206 ? total : Math.max(total, start + got) };
    },
    async openRange(rel, start, end) {
      const info = await this.stat(rel);
      const total = info?.size || 0;
      const headers = {};
      if (auth) headers.Authorization = auth;
      if (start > 0 || Number.isFinite(end)) headers.Range = `bytes=${start}-${Number.isFinite(end) ? end : ""}`;
      const res = await urlRequest(targetUrl(rel), { headers, insecure: s.insecure_tls, stream: true, timeout: 0 });
      if (res.status === 416) return { stream: null, start, end: start - 1, size: total, unsatisfiable: true };
      if (![200, 206].includes(res.status)) { res.stream.resume(); throw new Error(`WebDAV GET 失败 (${res.status})`); }
      const skip = res.status === 200 ? start : 0;
      const stream = res.status === 200
        ? sliceStream(res.stream, skip, Number.isFinite(end) ? end - start + 1 : Infinity)
        : (Number.isFinite(end) ? sliceStream(res.stream, 0, end - start + 1) : res.stream);
      return { stream, start, end: Number.isFinite(end) ? Math.min(end, total - 1) : total - 1, size: total };
    },
    async test() {
      const responses = await propfind("", 0);
      if (!responses?.length) throw new Error("WebDAV 未响应目录属性");
      if (!davProps(responses[0])?.isDir) throw new Error("WebDAV 地址不是一个目录");
    },
  };
}

function sliceStream(stream, start, length) {
  let skipped = 0;
  let emitted = 0;
  const out = new Transform({
    transform(chunk, _enc, cb) {
      if (skipped < start) {
        const drop = Math.min(chunk.length, start - skipped);
        chunk = chunk.subarray(drop);
        skipped += drop;
      }
      if (chunk.length && Number.isFinite(length)) {
        chunk = chunk.subarray(0, Math.max(0, length - emitted));
        emitted += chunk.length;
      }
      if (chunk.length) this.push(chunk);
      cb();
    },
  });
  stream.on("error", (e) => out.destroy(e));
  stream.pipe(out);
  return out;
}

let smb2Module;
async function smb2Backend(s) {
  if (smb2Module === undefined) {
    try { smb2Module = (await import("smb2")).default; } catch (e) { smb2Module = null; }
  }
  if (!smb2Module) throw new Error("SMB2 客户端不可用，请在来源里填写已挂载的 UNC / 本地路径");
  const SMB2 = smb2Module;
  const share = new SMB2({
    share: `\\\\${s.host}\\${s.share}`,
    domain: s.domain || "",
    username: s.username || "Guest",
    password: s.password || "",
    autoCloseTimeout: 0,
  });
  const remotePath = (rel) => [s.base_path, keepSegment(rel)].filter(Boolean).join("/").replace(/\//g, "\\");
  const call = (method, ...args) => new Promise((resolve, reject) => {
    share[method](...args, (err, value) => err ? reject(err) : resolve(value));
  });
  return {
    async stat(rel) {
      const st = await call("stat", remotePath(rel));
      return { size: Number(st.size) || 0, isFile: st.isFile?.() ?? !st.isDirectory?.(), isDir: !!st.isDirectory?.(), mtimeMs: Number(st.mtime) || 0 };
    },
    async readDir(rel) {
      const names = await call("readdir", remotePath(rel));
      const out = [];
      for (const name of names) {
        try {
          const st = await this.stat(pJoin(rel, name));
          out.push({ name, isDir: st.isDir, isFile: !st.isDir });
        } catch {}
      }
      return out.sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || natural(a.name, b.name));
    },
    async read(rel, start, length) {
      const chunks = [];
      let got = 0;
      for await (const chunk of sliceStream(share.createReadStream(remotePath(rel)), start, Number.isFinite(length) ? length : Infinity)) {
        chunks.push(chunk); got += chunk.length;
      }
      const info = await this.stat(rel);
      return { buffer: Buffer.concat(chunks), size: info.size };
    },
    openRange(rel, start, end) {
      const stream = sliceStream(share.createReadStream(remotePath(rel)), start, Number.isFinite(end) ? end - start + 1 : Infinity);
      return { stream, start, end, size: 0 };
    },
    async test() {
      const st = await this.stat("");
      if (!st.isDir) throw new Error("SMB 共享路径不是文件夹");
    },
  };
}

function backendFor(s) {
  if (s.kind === "local") return localBackend(s.path);
  if (s.kind === "webdav") return webdavBackend(s);
  // SMB：填了已挂载路径就走本地文件系统，否则用内置 SMB2 客户端
  return s.path ? localBackend(s.path) : smb2Backend(s);
}

/** 把课程路径解析成后端 + 相对路径；本地路径仍受挂载白名单约束。 */
async function resolveTarget(p) {
  if (isVirtualPath(p)) {
    const parsed = parseVirtual(p);
    if (!parsed) throw new Error("课程来源路径无效");
    const source = findSource(parsed.id);
    if (!source) throw new Error("课程来源不存在或已被删除");
    return { backend: await backendFor(source), rel: parsed.rel, source, remote: true };
  }
  const local = normalizeLocalPath(p);
  if (!local) throw new Error("路径不在允许的挂载目录内");
  return { backend: localBackend(local), rel: "", source: null, remote: false, localPath: local };
}

async function withBackend(p, rel, fn) {
  if (isVirtualPath(p)) {
    const parsed = parseVirtual(p);
    const source = findSource(parsed?.id);
    if (!source) throw new Error("课程来源不存在或已被删除");
    const combined = [parsed.rel, rel].filter(Boolean).join("/");
    if (String(rel).split("/").some((x) => x === ".." || x === ".")) throw new Error("路径越界");
    return fn(await backendFor(source), combined);
  }
  const local = normalizeLocalPath(p);
  if (!local) throw new Error("路径不在允许的挂载目录内");
  if (String(rel).split(/[\\/]/).some((x) => x === "..")) throw new Error("路径越界");
  return fn(localBackend(local), rel);
}

export const repo = {
  isRemote: isVirtualPath,
  normalize: normalizeAnyPath,
  join: pJoin,
  dirname: pDirname,
  basename: pBasename,
  shortcuts: sourceShortcuts,
  display(p) {
    if (!isVirtualPath(p)) return p;
    const parsed = parseVirtual(p);
    const source = parsed && findSource(parsed.id);
    return [source?.name || "课程来源", parsed?.rel || ""].filter(Boolean).join("/");
  },
  async stat(p, rel = "") { return withBackend(p, rel, (b, r) => b.stat(r)); },
  async readDir(p, rel = "") { return withBackend(p, rel, (b, r) => b.readDir(r)); },
  async read(p, rel = "", start = 0, length = Infinity) { return withBackend(p, rel, (b, r) => b.read(r, start, length)); },
  async openRange(p, rel = "", start = 0, end = Infinity) { return withBackend(p, rel, (b, r) => b.openRange(r, start, end)); },
  async test(p) {
    const target = await resolveTarget(p);
    await target.backend.test();
    return true;
  },
};

/** 测试连接：只传 id 时复用已保存的凭据。 */
export async function testConnection(input = {}) {
  const id = trim(input.id);
  const base = id ? findSource(id) : null;
  if (id && !base) throw new Error("课程来源不存在");
  const candidate = cleanSource({ ...(base || {}), ...input, id: id || "" });
  if (base) mergeCredentials(candidate, base);
  const error = validateSource(candidate);
  if (error) throw new Error(error);
  const backend = await backendFor(candidate);
  await backend.test();
  return { ok: true };
}

/** 连接（登录）语义：先验证、后写盘；返回 created / updated / reused。 */
export async function connectSource(input = {}) {
  const candidate = cleanSource({ ...input, id: "" });
  const match = sources.find((s) => targetKey(s) === targetKey(candidate));
  if (match && !candidate.password) candidate.password = match.password;
  if (match && !candidate.username) candidate.username = match.username;
  if (match && !candidate.domain) candidate.domain = match.domain;
  if (match && !candidate.name) candidate.name = match.name;
  const error = validateSource(candidate);
  if (error) { const e = new Error(error); e.validation = true; throw e; }
  const backend = await backendFor(candidate);
  await backend.test();
  if (!match) return { action: "created", source: addSource(candidate) };
  const merged = cleanSource({ ...match, ...candidate, id: match.id });
  mergeCredentials(merged, match);
  const changed = ["name", "path", "url", "host", "port", "share", "base_path", "username", "password", "domain", "insecure_tls"]
    .some((key) => merged[key] !== match[key]);
  if (!changed) return { action: "reused", source: publicInfo(match) };
  return { action: "updated", source: updateSource(merged) };
}

export function sourceRootsForBrowse() {
  return { sources: listSources(), roots: mountRoots() };
}
