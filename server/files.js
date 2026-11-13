import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "./db.js";
import { isVirtualPath, normalizeAnyPath } from "./paths.js";
import { repo } from "./sources.js";

// 章节文件的统一入口：上传文件 / 本地挂载路径 / WebDAV / SMB 虚拟路径。
// 转码、文档预览、字幕、投屏都通过这里读字节，不直接碰 fs。

export function resolveMaterialFile(material) {
  if (!material?.file_path) return null;
  const raw = String(material.file_path);
  const normalized = normalizeAnyPath(raw);
  if (normalized) return { remote: isVirtualPath(raw), path: normalized, local: false };
  const file = path.join(UPLOAD_DIR, raw);
  try { if (fs.statSync(file).isFile()) return { remote: false, path: file, local: true }; } catch {}
  return null;
}

export async function fileStat(target) {
  if (!target) throw new Error("文件不存在");
  if (target.remote) return repo.stat(target.path);
  const st = await fsp.stat(target.path);
  return { size: st.size, isFile: st.isFile(), isDir: st.isDirectory(), mtimeMs: st.mtimeMs };
}

/** 返回 {stream, start, end, size, partial, unsatisfiable}，调用方负责设置响应头。 */
export async function openRange(target, start = 0, end = Infinity) {
  if (!target) throw new Error("文件不存在");
  if (target.remote) {
    const r = await repo.openRange(target.path, "", start, end);
    if (r.unsatisfiable) return { ...r, partial: false };
    return { ...r, partial: start > 0 || Number.isFinite(end) };
  }
  const stat = await fsp.stat(target.path);
  const size = stat.size;
  const from = Math.max(0, Math.min(start, size));
  const to = Math.min(Number.isFinite(end) ? end : size - 1, size - 1);
  if (from > to) return { stream: null, start: from, end: to, size, partial: false, unsatisfiable: true };
  return {
    stream: fs.createReadStream(target.path, { start: from, end: to }),
    start: from, end: to, size,
    partial: from > 0 || to < size - 1,
  };
}

export async function readCappedFile(target, limit = 8 * 1024 * 1024) {
  if (!target) throw new Error("文件不存在");
  if (target.remote) {
    const { buffer, size } = await repo.read(target.path, "", 0, limit);
    return [buffer, size > limit];
  }
  const handle = await fsp.open(target.path, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, limit);
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const read = await handle.read(buffer, offset, length - offset, offset);
      if (read.bytesRead <= 0) break;
      offset += read.bytesRead;
    }
    return [buffer.subarray(0, offset), stat.size > limit];
  } finally { await handle.close(); }
}

/** 读取同目录的相对资源（HTML 预览里的图片/样式），带路径越界防护。 */
export async function readSibling(target, relative, limit = 4 * 1024 * 1024) {
  const clean = String(relative || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("\0") || clean.split("/").some((p) => p === "..")) return null;
  const parent = repo.dirname(target.path);
  const name = repo.basename(target.path);
  if (target.remote) {
    const { buffer } = await repo.read(parent, clean, 0, limit);
    return { buffer, name: clean };
  }
  const full = path.resolve(parent, clean);
  if (!full.startsWith(path.resolve(parent) + path.sep)) return null;
  const stat = await fsp.stat(full).catch(() => null);
  if (!stat?.isFile() || stat.size > limit) return null;
  return { buffer: await fsp.readFile(full), name: clean };
}

export const isRemoteMaterial = (target) => !!target?.remote;
