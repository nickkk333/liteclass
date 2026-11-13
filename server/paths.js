import fs from "node:fs";
import path from "node:path";
import { ROOT, DATA_DIR } from "./db.js";

// 与 OfflineU 的 config.go / sources.go 对应：本地根目录白名单 + 远程来源的虚拟路径命名空间。
// 课程、章节、字幕、进度都只保存"规范化后的路径"，物理位置由 sources.js 的后端解析。

const isWin = process.platform === "win32";
export const SOURCE_PREFIX = "/__liteclass_sources__";
const ROOTS_FILE = path.join(DATA_DIR, "mount-roots.txt");

function splitList(raw) {
  return String(raw || "").split(isWin ? ";" : ":").map((s) => s.trim()).filter(Boolean);
}

function readRootsFile() {
  try {
    const paths = fs.readFileSync(ROOTS_FILE, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return { exists: true, paths };
  } catch { return { exists: false, paths: [] }; }
}

function authorizedPaths() {
  const file = readRootsFile();
  const raw = file.exists ? file.paths : [
    ...splitList(process.env.LITECLASS_AUTHORIZED_PATHS),
    ...splitList(process.env.TRIM_DATA_ACCESSIBLE_PATHS),
  ];
  const out = [];
  for (const entry of raw) {
    if (!path.isAbsolute(entry)) continue;
    const resolved = path.resolve(entry);
    if (out.includes(resolved)) continue;
    try { if (fs.statSync(resolved).isDirectory()) out.push(resolved); } catch {}
  }
  return out;
}

function detectedRoots() {
  if (isWin) {
    const roots = [];
    for (let code = 67; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:\\`;
      try { if (fs.statSync(drive).isDirectory()) roots.push(drive); } catch {}
    }
    return roots.length ? roots : [path.parse(ROOT).root];
  }
  const vols = [];
  for (let i = 1; i <= 9; i++) {
    try { if (fs.statSync(`/vol${i}`).isDirectory()) vols.push(`/vol${i}`); } catch {}
  }
  return vols.length ? vols : ["/"];
}

function rootsKey() {
  let stamp = "none";
  try { stamp = String(fs.statSync(ROOTS_FILE).mtimeMs); } catch {}
  return [stamp, process.env.LITECLASS_MOUNT_ROOTS || "", process.env.LITECLASS_AUTHORIZED_PATHS || "",
    process.env.TRIM_DATA_ACCESSIBLE_PATHS || ""].join("|");
}

let cache = { key: null, roots: [], authorized: [] };
function computeRoots() {
  const env = splitList(process.env.LITECLASS_MOUNT_ROOTS);
  const base = env.length ? env.map((p) => path.resolve(p)) : detectedRoots();
  const roots = [];
  for (const entry of [...authorizedPaths(), ...base]) {
    const resolved = path.resolve(entry);
    if (!roots.includes(resolved)) roots.push(resolved);
  }
  return { roots, authorized: authorizedPaths() };
}
function ensureRoots() {
  const key = rootsKey();
  if (key !== cache.key) cache = { key, ...computeRoots() };
  return cache;
}

export const mountRoots = () => ensureRoots().roots;
export const authorizedRoots = () => ensureRoots().authorized;

export function rootFor(target) {
  return mountRoots().find((root) => {
    const base = root.endsWith(path.sep) ? root : root + path.sep;
    return target === root || target.startsWith(base);
  });
}

/** 本地路径：必须落在允许的挂载根目录内（保留原有授权目录语义）。 */
export function normalizeLocalPath(input) {
  if (typeof input !== "string" || !input.trim() || input.includes("\0")) return null;
  let resolved;
  try { resolved = path.resolve(input.trim()); } catch { return null; }
  return rootFor(resolved) ? resolved : null;
}

export function isVirtualPath(value) {
  return typeof value === "string" && value.replace(/\\/g, "/").toLowerCase().startsWith(SOURCE_PREFIX + "/");
}

/** 解析虚拟路径；拒绝 .. / NUL 等穿越片段。 */
export function parseVirtual(value) {
  if (!isVirtualPath(value)) return null;
  const raw = value.replace(/\\/g, "/").slice(SOURCE_PREFIX.length).replace(/^\/+/, "");
  const parts = raw.split("/").filter(Boolean);
  const id = parts.shift() || "";
  if (!/^[a-f0-9]{8,32}$/i.test(id)) return null;
  const rel = parts.join("/");
  if (rel.includes("\0") || parts.some((p) => p === "." || p === "..")) return null;
  return { id, rel };
}

export const sourceRoot = (id) => `${SOURCE_PREFIX}/${id}`;

export function virtualPath(id, rel = "") {
  return `${SOURCE_PREFIX}/${id}${rel ? "/" + String(rel).replace(/\\/g, "/").replace(/^\/+/, "") : ""}`;
}

/** 课程来源（虚拟路径）与本地挂载路径统一规范化。 */
export function normalizeAnyPath(input) {
  const raw = String(input ?? "").trim();
  if (!raw || raw.includes("\0")) return null;
  if (isVirtualPath(raw)) {
    const parsed = parseVirtual(raw);
    return parsed ? virtualPath(parsed.id, parsed.rel) : null;
  }
  return normalizeLocalPath(raw);
}

export const isRemotePath = (p) => isVirtualPath(p);
export const pJoin = (parent, name) => isVirtualPath(parent)
  ? `${String(parent).replace(/\/$/, "")}/${String(name).replace(/^\/+/, "")}`
  : path.join(parent, name);
export const pDirname = (p) => isVirtualPath(p) ? p.slice(0, p.lastIndexOf("/")) || SOURCE_PREFIX : path.dirname(p);
export const pBasename = (p) => isVirtualPath(p) ? p.slice(p.lastIndexOf("/") + 1) : path.basename(p);
export const pExtname = (p) => path.extname(pBasename(p)).toLowerCase();
export const pIsAbsolute = (p) => isVirtualPath(p) || path.isAbsolute(String(p || ""));
