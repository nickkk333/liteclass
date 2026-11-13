import fs from "node:fs";
import path from "node:path";

// 支持的媒体 / 文档格式（与 OfflineU 对齐，见 internal/offlineu/model.go）。
export const VIDEO_EXT = [
  ".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v", ".flv", ".wmv",
  ".ts", ".m2ts", ".mts",
];
export const AMBIGUOUS_VIDEO_EXT = [".ts", ".m2ts", ".mts"];
export const AUDIO_EXT = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];
export const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif"];
export const SUBTITLE_EXT = [".srt", ".vtt", ".ass", ".ssa", ".sub", ".sbv"];
export const TEXT_EXT = [".txt", ".md", ".html", ".htm", ".mhtml", ".mht", ".pdf", ".docx", ".doc", ".rtf"];
export const OFFICE_EXT = [".docx", ".doc", ".rtf"];
export const MHTML_EXT = [".mhtml", ".mht"];
// 本项目原有、OfflineU 没有的资料格式：只作为可下载章节，不做内联预览。
export const DOWNLOAD_EXT = [".epub"];
export const SKIP_EXT = [".log", ".tmp", ".bak", ".swp"];

const set = (list) => new Set(list);

export const VIDEO_EXTS = set(VIDEO_EXT);
export const AUDIO_EXTS = set(AUDIO_EXT);
export const IMAGE_EXTS = set(IMAGE_EXT);
export const SUBTITLE_EXTS = set(SUBTITLE_EXT);
export const TEXT_EXTS = set(TEXT_EXT);
export const OFFICE_EXTS = set(OFFICE_EXT);
export const MHTML_EXTS = set(MHTML_EXT);
export const SKIP_EXTS = set(SKIP_EXT);
export const AMBIGUOUS_VIDEO_EXTS = set(AMBIGUOUS_VIDEO_EXT);

// 浏览器与服务器都需要可渲染的 MIME：有些精简系统没有 mime.types，
// 缺少映射时浏览器会改成下载而不是直接播放 / 预览。
export const MIME_OVERRIDES = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".wmv": "video/x-ms-wmv",
  ".ts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".mts": "video/mp2t",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".mhtml": "multipart/related",
  ".mht": "multipart/related",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".rtf": "application/rtf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".epub": "application/epub+zip",
};

/** 旧接口：扩展名 -> [file_type, mime] */
export const MEDIA_EXT = {};
for (const ext of VIDEO_EXT) MEDIA_EXT[ext] = ["video", MIME_OVERRIDES[ext]];
for (const ext of AUDIO_EXT) MEDIA_EXT[ext] = ["audio", MIME_OVERRIDES[ext]];
for (const ext of IMAGE_EXT) MEDIA_EXT[ext] = ["image", MIME_OVERRIDES[ext]];
for (const ext of TEXT_EXT) MEDIA_EXT[ext] = [ext === ".pdf" ? "pdf" : "doc", MIME_OVERRIDES[ext]];
for (const ext of DOWNLOAD_EXT) MEDIA_EXT[ext] = ["doc", MIME_OVERRIDES[ext]];

/** 挂载目录扫描时识别的文件类型（字幕单独处理，不作为章节） */
export const SCAN_EXTS = new Set(
  [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT, ...TEXT_EXT, ...DOWNLOAD_EXT]
    .filter((ext) => !SKIP_EXTS.has(ext))
);

export function extOf(name) {
  return path.extname(String(name || "")).toLowerCase();
}

export function mimeOf(name, fallback = "") {
  return MIME_OVERRIDES[extOf(name)] || fallback;
}

/** 按扩展名判断章节类型；未知扩展按 MIME 兜底 */
export function kindOf(name, mime = "") {
  const ext = extOf(name);
  if (MEDIA_EXT[ext]) return MEDIA_EXT[ext];
  if (mime.startsWith("video/")) return ["video", mime];
  if (mime.startsWith("audio/")) return ["audio", mime];
  if (mime.startsWith("image/")) return ["image", mime];
  if (mime === "application/pdf") return ["pdf", mime];
  return ["doc", mime || "application/octet-stream"];
}

/**
 * 章节的展示方式，与 OfflineU 的 BuildTextResources 一致：
 * video / audio / image / pdf / html / text / markdown / office / other。
 */
export function previewMode(name, fileType = "") {
  const ext = extOf(name);
  if (VIDEO_EXTS.has(ext) || fileType === "video") return "video";
  if (AUDIO_EXTS.has(ext) || fileType === "audio") return "audio";
  if (IMAGE_EXTS.has(ext) || fileType === "image") return "image";
  if (ext === ".pdf" || fileType === "pdf") return "pdf";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".txt") return "text";
  if (ext === ".md") return "markdown";
  if (OFFICE_EXTS.has(ext) || MHTML_EXTS.has(ext)) return "office";
  return "other";
}

/** 文档类章节走服务端转换预览 */
export function isDocumentMode(mode) {
  return mode === "text" || mode === "markdown" || mode === "office";
}

const TS_PACKET_SIZES = [188, 192];
const TS_SYNC = 0x47;
const TS_SYNC_PACKETS = 3;

/**
 * 判断文件是否真的是 MPEG 传输流。`.ts` 既可能是视频也可能是 TypeScript
 * 源码，扫描时按内容确认（与 OfflineU 的 looksLikeMPEGTS 相同）。
 */
export function looksLikeMPEGTSBuffer(buffer) {
  const read = buffer.length;
  for (const size of TS_PACKET_SIZES) {
    const needed = size * TS_SYNC_PACKETS;
    if (read < needed) continue;
    for (let offset = 0; offset + needed <= read; offset++) {
      if (buffer[offset] !== TS_SYNC) continue;
      let aligned = true;
      for (let packet = 1; packet < TS_SYNC_PACKETS; packet++) {
        if (buffer[offset + packet * size] !== TS_SYNC) { aligned = false; break; }
      }
      if (aligned) return true;
    }
  }
  return false;
}

export function looksLikeMPEGTS(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const window = Math.max(...TS_PACKET_SIZES) * TS_SYNC_PACKETS + 1024;
    const buffer = Buffer.alloc(window);
    const read = fs.readSync(fd, buffer, 0, window, 0);
    return read > 0 && looksLikeMPEGTSBuffer(buffer.subarray(0, read));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

/** 视频扩展名是否可信：歧义扩展需要内容确认 */
export function isVideoFile(filePath) {
  const ext = extOf(filePath);
  if (!VIDEO_EXTS.has(ext)) return false;
  if (!AMBIGUOUS_VIDEO_EXTS.has(ext)) return true;
  return looksLikeMPEGTS(filePath);
}
