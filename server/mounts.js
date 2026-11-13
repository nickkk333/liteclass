import path from "node:path";
import {
  SCAN_EXTS, SUBTITLE_EXTS, VIDEO_EXTS, AMBIGUOUS_VIDEO_EXTS,
  kindOf, looksLikeMPEGTSBuffer,
} from "./media.js";
import {
  normalizeAnyPath, mountRoots, authorizedRoots, rootFor, isVirtualPath,
  sourceRoot, parseVirtual, pJoin, pDirname, pBasename, pExtname,
} from "./paths.js";
import { repo } from "./sources.js";

export { mountRoots, authorizedRoots };

// 目录白名单与虚拟路径命名空间都在 paths.js / sources.js 里实现，
// 这里只负责目录浏览与课程扫描（本地、WebDAV、SMB 统一走 repo 门面）。

export function normalizeMountPath(input) {
  return normalizeAnyPath(input);
}

export function isMountedFile(filePath) {
  if (typeof filePath !== "string" || !filePath) return false;
  if (isVirtualPath(filePath)) return !!normalizeAnyPath(filePath);
  return path.isAbsolute(filePath) && !!normalizeAnyPath(filePath);
}

const SKIP_NAMES = new Set([
  "$RECYCLE.BIN", "System Volume Information", "@eaDir", "#recycle", "#snapshot",
  "lost+found", "node_modules",
]);
const skipName = (name) => !name || name.startsWith(".") || name.startsWith("@") || name.startsWith("#") || SKIP_NAMES.has(name);
const natural = (a, b) => a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });

/** 浏览某个目录下的子文件夹；同时返回课程来源快捷入口。 */
export async function listDirs(dir) {
  const roots = mountRoots();
  const authorized = authorizedRoots();
  const sources = repo.shortcuts();
  const authorizedSet = new Set(authorized);

  if (!dir) {
    return {
      path: "", parent: null, roots, authorized, sources,
      entries: [
        ...sources.map((s) => ({ name: s.label, path: s.path, source: true })),
        ...roots.map((p) => ({ name: p, path: p, authorized: authorizedSet.has(p) })),
      ],
    };
  }

  const target = normalizeAnyPath(dir);
  if (!target) return { error: "路径不在允许的挂载目录内", roots, authorized, sources, entries: [] };
  const virtual = isVirtualPath(target);
  const parsed = virtual ? parseVirtual(target) : null;
  const root = virtual ? sourceRoot(parsed.id) : rootFor(target);
  const parent = target === root || (virtual && !parsed.rel)
    ? null
    : (virtual ? pDirname(target) : path.dirname(target));
  const context = { path: target, parent, roots, authorized, sources, entries: [] };

  let stat;
  try { stat = await repo.stat(target); } catch { return { ...context, error: "目录不存在或未挂载" }; }
  if (!stat.isDir) return { ...context, error: "该路径不是文件夹" };

  try {
    const items = await repo.readDir(target);
    return {
      ...context,
      entries: items
        .filter((e) => e.isDir && !skipName(e.name))
        .map((e) => {
          const full = pJoin(target, e.name);
          return { name: e.name, path: full, authorized: authorizedSet.has(full) };
        })
        .sort((a, b) => natural(a.name, b.name))
        .slice(0, 500),
    };
  } catch {
    return {
      ...context,
      error: "无法读取该目录：当前应用用户没有权限。请在「应用中心 → 轻课堂 → 设置 → 授权目录」中授权该目录后重试。",
    };
  }
}

/** 递归扫描课程目录中的文件；字幕单独返回用于配对。 */
export async function scanFolder(dir, { maxFiles = 2000, maxDepth = 6 } = {}) {
  const target = normalizeAnyPath(dir);
  if (!target) return { files: [], subtitles: [] };
  const files = [];
  const subtitles = [];
  const tsWindow = 192 * 3 + 1024;

  const walk = async (current, depth) => {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let items;
    try { items = await repo.readDir(current); } catch { return; }
    items.sort((a, b) => natural(a.name, b.name));
    for (const entry of items) {
      if (files.length >= maxFiles) break;
      if (skipName(entry.name)) continue;
      const full = pJoin(current, entry.name);
      if (entry.isDir) { await walk(full, depth + 1); continue; }
      if (!entry.isFile) continue;
      const ext = pExtname(entry.name);
      if (SUBTITLE_EXTS.has(ext)) {
        subtitles.push({
          path: full, name: entry.name,
          stem: entry.name.slice(0, entry.name.length - ext.length).toLowerCase(),
        });
        continue;
      }
      if (!SCAN_EXTS.has(ext)) continue;
      if (VIDEO_EXTS.has(ext) && AMBIGUOUS_VIDEO_EXTS.has(ext)) {
        let buffer = Buffer.alloc(0);
        try { ({ buffer } = await repo.read(current, entry.name, 0, tsWindow)); } catch {}
        if (!looksLikeMPEGTSBuffer(buffer)) continue;
      }
      const [fileType, mimeType] = kindOf(entry.name);
      let size = 0;
      try { size = (await repo.stat(current, entry.name)).size || 0; } catch {}
      files.push({
        path: full,
        title: entry.name.slice(0, entry.name.length - ext.length),
        file_type: fileType,
        mime_type: mimeType,
        size,
      });
    }
  };

  await walk(target, 0);
  return { files, subtitles };
}

/** 字幕按同目录同名 / 全局同名 / 唯一媒体文件配对。 */
export function attachSubtitles(files, subtitles) {
  const media = files.filter((f) => f.file_type === "video" || f.file_type === "audio");
  if (!media.length) return new Map();
  const pairs = new Map();
  const stemOf = (file) => {
    const name = pBasename(file.path);
    return name.slice(0, name.length - pExtname(name).length).toLowerCase();
  };
  for (const subtitle of subtitles) {
    const folder = pDirname(subtitle.path);
    const match = (f) => stemOf(f) === subtitle.stem;
    let target = media.find((f) => pDirname(f.path) === folder && match(f)) || media.find(match);
    if (!target && media.length === 1) target = media[0];
    if (!target || pairs.has(target.path)) continue;
    pairs.set(target.path, subtitle.path);
  }
  return pairs;
}
