import fs from "node:fs";
import path from "node:path";
import { ROOT, DATA_DIR } from "./db.js";
import { SCAN_EXTS, kindOf } from "./media.js";

const isWin = process.platform === "win32";

// fnOS 会把用户授权的目录写入该文件（由 cmd/main 与 cmd/config_* 维护），
// 授权变更后无需重启服务即可刷新。
const ROOTS_FILE = path.join(DATA_DIR, "mount-roots.txt");

function splitList(raw) {
  return String(raw || "")
    .split(isWin ? ";" : ":")
    .map((s) => s.trim())
    .filter(Boolean);
}

function envRoots() {
  return splitList(process.env.LITECLASS_MOUNT_ROOTS);
}

function readRootsFile() {
  try {
    const paths = fs.readFileSync(ROOTS_FILE, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { exists: true, paths };
  } catch {
    return { exists: false, paths: [] };
  }
}

/** fnOS 应用设置里授权的目录（TRIM_DATA_ACCESSIBLE_PATHS / 持久化文件） */
function authorizedPaths() {
  const file = readRootsFile();
  const raw = file.exists
    ? file.paths
    : [
        ...splitList(process.env.LITECLASS_AUTHORIZED_PATHS),
        ...splitList(process.env.TRIM_DATA_ACCESSIBLE_PATHS),
      ];

  const out = [];
  for (const entry of raw) {
    if (!path.isAbsolute(entry)) continue;
    const resolved = path.resolve(entry);
    if (out.includes(resolved)) continue;
    try {
      if (!fs.statSync(resolved).isDirectory()) continue;
    } catch {
      continue; // 目录被移除 / 未挂载时忽略
    }
    out.push(resolved);
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
  // 飞牛 fnOS / 群晖等 NAS 通常把存储空间挂载在 /vol1 ... /vol9
  const vols = [];
  for (let i = 1; i <= 9; i++) {
    const p = `/vol${i}`;
    try { if (fs.statSync(p).isDirectory()) vols.push(p); } catch {}
  }
  return vols.length ? vols : ["/"];
}

/** 允许挂载/浏览的根目录：已授权目录优先，其后是存储空间；可用 LITECLASS_MOUNT_ROOTS 覆盖 */
function computeRoots() {
  const env = envRoots();
  const base = env.length ? env : detectedRoots();
  const authorized = authorizedPaths();
  const roots = [];
  for (const entry of [...authorized, ...base]) {
    const resolved = path.resolve(entry);
    if (!roots.includes(resolved)) roots.push(resolved);
  }
  return { roots, authorized, key: rootsKey() };
}

let cache = { key: null, roots: [], authorized: [] };

function rootsKey() {
  let stamp = "none";
  try {
    stamp = String(fs.statSync(ROOTS_FILE).mtimeMs);
  } catch {}
  return [
    stamp,
    process.env.LITECLASS_MOUNT_ROOTS || "",
    process.env.LITECLASS_AUTHORIZED_PATHS || "",
    process.env.TRIM_DATA_ACCESSIBLE_PATHS || "",
  ].join("|");
}

/** 当前生效的挂载根目录（授权目录排在最前） */
export function mountRoots() {
  const key = rootsKey();
  if (key !== cache.key) cache = computeRoots();
  return cache.roots;
}

/** 当前已授权目录 */
export function authorizedRoots() {
  const key = rootsKey();
  if (key !== cache.key) cache = computeRoots();
  return cache.authorized;
}

function rootFor(target) {
  return mountRoots().find((root) => {
    const base = root.endsWith(path.sep) ? root : root + path.sep;
    return target === root || target.startsWith(base);
  });
}

/** 校验并规范化挂载路径，不在允许根目录内返回 null */
export function normalizeMountPath(input) {
  if (typeof input !== "string" || !input.trim() || input.includes("\0")) return null;
  let resolved;
  try { resolved = path.resolve(input.trim()); } catch { return null; }
  if (!rootFor(resolved)) return null;
  return resolved;
}

export function isMountedFile(filePath) {
  return typeof filePath === "string" && path.isAbsolute(filePath) && !!normalizeMountPath(filePath);
}

const SKIP_NAMES = new Set([
  "$RECYCLE.BIN", "System Volume Information", "@eaDir", "#recycle", "#snapshot",
  "lost+found", "node_modules",
]);
const skipName = (name) => !name || name.startsWith(".") || name.startsWith("@") || name.startsWith("#") || SKIP_NAMES.has(name);

const natural = (a, b) => a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });

/** 浏览某个挂载目录下的子文件夹 */
export function listDirs(dir) {
  const roots = mountRoots();
  const authorized = authorizedRoots();
  const authorizedSet = new Set(authorized);

  if (!dir) {
    return {
      path: "",
      parent: null,
      roots,
      authorized,
      entries: roots.map((p) => ({ name: p, path: p, authorized: authorizedSet.has(p) })),
    };
  }

  const target = normalizeMountPath(dir);
  if (!target) return { error: "路径不在允许的挂载目录内", roots, authorized, entries: [] };

  const root = rootFor(target);
  const parent = target === root ? null : path.dirname(target);
  const context = { path: target, parent, roots, authorized, entries: [] };

  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return { ...context, error: "目录不存在或未挂载" };
  }
  if (!stat.isDirectory()) return { ...context, error: "该路径不是文件夹" };

  let dirents = [];
  try {
    dirents = fs.readdirSync(target, { withFileTypes: true })
      .filter((e) => {
        if (!e.isDirectory() || skipName(e.name)) return false;
        return true;
      })
      .map((e) => {
        const full = path.join(target, e.name);
        return { name: e.name, path: full, authorized: authorizedSet.has(full) };
      })
      .sort((a, b) => natural(a.name, b.name))
      .slice(0, 500);
  } catch {
    return {
      ...context,
      error: "无法读取该目录：当前应用用户没有权限。请在「应用中心 → 轻课堂 → 设置 → 授权目录」中授权该目录后重试。",
    };
  }

  return { ...context, entries: dirents };
}

/** 递归扫描挂载目录中的课程文件（音视频 / 文档），按文件名自然排序 */
export function scanFolder(dir, { maxFiles = 2000, maxDepth = 6 } = {}) {
  const target = normalizeMountPath(dir);
  if (!target) return [];
  const files = [];

  const walk = (current, depth) => {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let dirents;
    try { dirents = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    dirents.sort((a, b) => natural(a.name, b.name));
    for (const entry of dirents) {
      if (files.length >= maxFiles) break;
      if (skipName(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full, depth + 1); continue; }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCAN_EXTS.has(ext)) continue;
      const [fileType, mimeType] = kindOf(entry.name);
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      files.push({
        path: full,
        title: entry.name.slice(0, entry.name.length - path.extname(entry.name).length),
        file_type: fileType,
        mime_type: mimeType,
        size,
      });
    }
  };

  walk(target, 0);
  return files;
}
