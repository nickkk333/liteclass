import path from "node:path";

export const MEDIA_EXT = {
  ".mp4": ["video", "video/mp4"], ".webm": ["video", "video/webm"], ".mov": ["video", "video/quicktime"],
  ".mkv": ["video", "video/x-matroska"], ".m4v": ["video", "video/mp4"],
  ".mp3": ["audio", "audio/mpeg"], ".wav": ["audio", "audio/wav"], ".m4a": ["audio", "audio/mp4"],
  ".aac": ["audio", "audio/aac"], ".flac": ["audio", "audio/flac"], ".ogg": ["audio", "audio/ogg"],
  ".pdf": ["pdf", "application/pdf"], ".epub": ["doc", "application/epub+zip"],
  ".md": ["doc", "text/markdown"], ".txt": ["doc", "text/plain"],
  ".png": ["image", "image/png"], ".jpg": ["image", "image/jpeg"], ".jpeg": ["image", "image/jpeg"],
  ".gif": ["image", "image/gif"], ".webp": ["image", "image/webp"],
};

/** 挂载目录扫描时识别的文件类型（不包含封面类图片） */
export const SCAN_EXTS = new Set(
  Object.keys(MEDIA_EXT).filter((ext) => !MEDIA_EXT[ext][0].startsWith("image"))
);

export function kindOf(name, mime = "") {
  const ext = path.extname(name || "").toLowerCase();
  if (MEDIA_EXT[ext]) return MEDIA_EXT[ext];
  if (mime.startsWith("video/")) return ["video", mime];
  if (mime.startsWith("audio/")) return ["audio", mime];
  if (mime.startsWith("image/")) return ["image", mime];
  if (mime === "application/pdf") return ["pdf", mime];
  return ["doc", mime || "application/octet-stream"];
}
