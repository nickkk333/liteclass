import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { get, UPLOAD_DIR } from "./db.js";
import { currentUser } from "./auth.js";
import { isMountedFile } from "./mounts.js";
import { pBasename, pDirname } from "./paths.js";
import { extOf, mimeOf } from "./media.js";
import { documentToHtml, previewPage } from "./office/index.js";
import { inlineLocalAssets } from "./office/html.js";
import { decodeText } from "./encoding.js";
import { convertSubtitleToVTT, subtitleText } from "./subtitles.js";
import { resolveMaterialFile, fileStat, openRange, readCappedFile, readSibling } from "./files.js";
import { serveBrowser } from "./transcode.js";
import { validCastToken } from "./dlna.js";

const router = Router();

const RATE = 16000;
const CACHE = new Map();

function wavHeader(dataLength) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function synth(material) {
  const key = `${material.id}:${material.duration}:${material.tone}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const seconds = Math.max(5, Number(material.duration) || 60);
  const total = RATE * seconds;
  const dataLength = total * 2;
  const buf = Buffer.allocUnsafe(44 + dataLength);
  wavHeader(dataLength).copy(buf, 0);
  const tone = Number(material.tone) || 220;
  let phase = 0;
  let phase2 = 0;
  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    const fade = Math.min(1, t / 1.5) * Math.min(1, (seconds - t) / 2);
    const swell = 0.55 + 0.45 * Math.sin((2 * Math.PI * t) / 7.3);
    const vibrato = 1 + 0.0035 * Math.sin(2 * Math.PI * 4.6 * t);
    phase += (2 * Math.PI * tone * vibrato) / RATE;
    phase2 += (2 * Math.PI * tone * 2.005) / RATE;
    let v = 0.34 * Math.sin(phase) + 0.12 * Math.sin(phase2) + 0.05 * Math.sin(phase * 0.5);
    v *= fade * swell;
    const s = Math.max(-1, Math.min(1, v));
    buf.writeInt16LE(Math.round(s * 32767 * 0.6), 44 + i * 2);
  }
  if (CACHE.size >= 6) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, buf);
  return buf;
}

function readRange(req, size) {
  const range = req.headers.range;
  if (!range) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
  if (isNaN(start) || start < 0) start = 0;
  if (isNaN(end) || end >= size) end = size - 1;
  return { start, end };
}

router.get("/stream/:id", async (req, res) => {
  const user = currentUser(req);
  const cast = validCastToken(req.query.cast, req.params.id);
  if (!user && !cast) return res.status(401).json({ error: "Unauthorized" });
  const material = get("SELECT * FROM materials WHERE id = ?", Number(req.params.id));
  if (!material) return res.status(404).json({ error: "章节不存在" });

  const target = resolveMaterialFile(material);
  if (target) {
    try {
      // 浏览器缓存 MP4 已生成时直接替换原始容器（电视的原文件投屏跳过此步）
      if (!cast && !req.query.download && await serveBrowser(target, req, res)) return;
      const stat = await fileStat(target);
      const range = readRange(req, stat.size);
      const ext = extOf(target.path);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", mimeOf(target.path, material.mime_type || "application/octet-stream"));
      if (ext === ".html" || ext === ".htm") {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self'");
      }
      if (req.query.download) {
        const name = isMountedFile(material.file_path) ? material.title + ext : material.title;
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      }
      const opened = await openRange(target, range?.start ?? 0, range?.end ?? Infinity);
      if (opened.unsatisfiable) {
        res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
        return res.end();
      }
      if (opened.partial) {
        res.status(206);
        res.setHeader("Content-Range", `bytes ${opened.start}-${opened.end}/${stat.size}`);
      }
      res.setHeader("Content-Length", Math.max(0, opened.end - opened.start + 1));
      return opened.stream.pipe(res);
    } catch (e) {
      if (!res.headersSent) return res.status(500).json({ error: e.message });
      return res.end();
    }
  }

  // 内置示例章节没有真实文件：合成一段可播放的音频。
  const buf = synth(material);
  const total = buf.length;
  const range = readRange(req, total);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "audio/wav");
  if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(material.title + ".wav")}`);
  if (range) {
    if (range.start > range.end) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`);
      return res.end();
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
    res.setHeader("Content-Length", range.end - range.start + 1);
    return res.end(buf.subarray(range.start, range.end + 1));
  }
  res.setHeader("Content-Length", total);
  return res.end(buf);
});

const GENERATED_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:";
const HTML_CSP = "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline' data:; font-src data:";
const REMOTE_HTML_CSP = "default-src 'none'; img-src 'self' http: https: data:; media-src 'self' http: https: data:; style-src 'unsafe-inline' 'self' http: https: data:; font-src 'self' data:";

/** 远程来源的 HTML 无法用 fs 内联资源：把相对资源指向本服务的 asset 路由（带 token）。 */
export function rewriteRemoteAssets(html, materialId, token = "") {
  const prefix = `/api/preview/${materialId}/`;
  return String(html).replace(/\b(src|href)\s*=\s*(["'])([^"']+)\2/gi, (match, attr, quote, raw) => {
    const value = raw.trim();
    if (!value || /^(https?:|data:|blob:|javascript:|\/\/|#|\/)/i.test(value)) return match;
    return `${attr}=${quote}${prefix}${encodeURI(value)}?token=${encodeURIComponent(token)}${quote}`;
  });
}

/**
 * 文档预览：本地 / 远程来源统一读取。
 *  - .html/.htm 原样输出（CSP 禁脚本，同目录资源内联或由 /preview/:id/<asset> 提供）；
 *  - .txt/.md/.docx/.doc/.rtf/.mhtml 在服务端转换成无脚本 HTML 页。
 */
async function previewHandler(req, res) {
  const user = currentUser(req);
  if (!user) return res.status(401).type("text/plain; charset=utf-8").send("Unauthorized");
  const material = get("SELECT * FROM materials WHERE id = ?", Number(req.params.id));
  if (!material) return res.status(404).type("text/plain; charset=utf-8").send("章节不存在");
  const target = resolveMaterialFile(material);
  if (!target) return res.status(404).type("text/plain; charset=utf-8").send("文件不存在，挂载目录或课程来源可能已断开");

  const ext = extOf(target.path);
  const asset = req.params.asset;

  if (ext === ".html" || ext === ".htm") {
    if (asset && asset !== "page") {
      const found = await readSibling(target, asset).catch(() => null);
      if (!found) return res.status(404).end();
      res.setHeader("Content-Type", mimeOf(found.name, "application/octet-stream"));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.end(found.buffer);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", target.remote ? REMOTE_HTML_CSP : HTML_CSP);
    res.setHeader("Cache-Control", "private, no-cache");
    let buffer;
    try { [buffer] = await readCappedFile(target); }
    catch { return res.status(500).type("text/plain; charset=utf-8").send("无法读取该文件"); }
    const html = target.remote
      ? rewriteRemoteAssets(decodeText(buffer), material.id, req.query.token)
      : inlineLocalAssets(decodeText(buffer), pDirname(target.path));
    return res.send(html);
  }

  if (asset && asset !== "page") return res.status(404).end();

  let buffer;
  let truncated = false;
  try { [buffer, truncated] = await readCappedFile(target); }
  catch { return res.status(500).type("text/plain; charset=utf-8").send("无法读取该文件"); }
  const converted = documentToHtml(target.path, buffer, truncated);
  if (!converted) {
    return res.status(415).type("text/plain; charset=utf-8").send("该格式不支持在线预览，请下载原文件");
  }
  const html = previewPage({
    title: material.title,
    filename: pBasename(target.path),
    body: converted.body,
    truncated: converted.truncated,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", GENERATED_CSP);
  res.setHeader("Cache-Control", "private, no-cache");
  return res.send(html);
}

router.get("/preview/:id/:asset(*)", previewHandler);
router.get("/preview/:id", previewHandler);

/** 字幕统一转成 WebVTT；浏览器 <track> 只认这一种格式。 */
router.get("/subtitles/:id", async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const material = get("SELECT * FROM materials WHERE id = ?", Number(req.params.id));
  if (!material) return res.status(404).json({ error: "章节不存在" });
  const target = resolveMaterialFile({ file_path: material.subtitle_path });
  if (!target) return res.status(404).type("text/plain; charset=utf-8").send("没有字幕");

  let buffer;
  try { [buffer] = await readCappedFile(target, 2 * 1024 * 1024); }
  catch { return res.status(404).type("text/plain; charset=utf-8").send("字幕文件无法读取"); }
  let text;
  try { text = convertSubtitleToVTT(target.path, subtitleText(buffer)); }
  catch { return res.status(500).type("text/plain; charset=utf-8").send("字幕转换失败"); }
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(text);
});

export default router;
