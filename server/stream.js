import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { get, UPLOAD_DIR } from "./db.js";
import { currentUser } from "./auth.js";
import { isMountedFile } from "./mounts.js";

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

router.get("/stream/:id", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const material = get("SELECT * FROM materials WHERE id = ?", Number(req.params.id));
  if (!material) return res.status(404).json({ error: "章节不存在" });

  if (material.file_path) {
    const mounted = isMountedFile(material.file_path);
    const file = mounted ? material.file_path : path.join(UPLOAD_DIR, material.file_path);
    if (mounted && !fs.existsSync(file)) {
      return res.status(404).json({ error: "文件不存在，挂载目录可能已断开" });
    }
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      const range = req.headers.range;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", material.mime_type || "application/octet-stream");
      if (req.query.download) {
        const name = mounted ? material.title + path.extname(file) : material.title;
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      }
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end >= stat.size) end = stat.size - 1;
        if (start > end) {
          res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
          return res.end();
        }
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        res.setHeader("Content-Length", end - start + 1);
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.setHeader("Content-Length", stat.size);
      return fs.createReadStream(file).pipe(res);
    }
  }

  const buf = synth(material);
  const total = buf.length;
  const range = req.headers.range;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "audio/wav");
  if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(material.title + ".wav")}`);
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", end - start + 1);
    return res.end(buf.subarray(start, end + 1));
  }
  res.setHeader("Content-Length", total);
  return res.end(buf);
});

export default router;
