import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./db.js";
import { SCAN_EXTS, kindOf } from "./media.js";

const isWin = process.platform === "win32";

function envRoots() {
  const raw = process.env.LITECLASS_MOUNT_ROOTS || "";
  return raw.split(isWin ? ";" : ":").map((s) => s.trim()).filter(Boolean);
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

/** 允许挂载/浏览的根目录，可用 LITECLASS_MOUNT_ROOTS 覆盖（Windows 用 ; 分隔，类 Unix 用 : 分隔） */
export const MOUNT_ROOTS = (envRoots().length ? envRoots() : detectedRoots()).map((p) => path.resolve(p));

function rootFor(target) {
  return MOUNT_ROOTS.find((root) => {
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
  if (!dir) {
    return {
      path: "",
      parent: null,
      roots: MOUNT_ROOTS,
      entries: MOUNT_ROOTS.map((p) => ({ name: p, path: p })),
    };
  }
  const target = normalizeMountPath(dir);
  if (!target) return { error: "路径不在允许的挂载目录内" };
  let stat;
  try { stat = fs.statSync(target); } catch { return { error: "目录不存在或无法访问" }; }
  if (!stat.isDirectory()) return { error: "该路径不是文件夹" };

  let dirents = [];
  try {
    dirents = fs.readdirSync(target, { withFileTypes: true })
      .filter((e) => {
        if (!e.isDirectory() || skipName(e.name)) return false;
        return true;
      })
      .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
      .sort((a, b) => natural(a.name, b.name))
      .slice(0, 500);
  } catch {
    return { error: "目录无法读取，请检查权限" };
  }

  const root = rootFor(target);
  const parent = target === root ? null : path.dirname(target);
  return { path: target, parent, roots: MOUNT_ROOTS, entries: dirents };
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
