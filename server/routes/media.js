import { Router } from "express";
import { get } from "../db.js";
import { currentUser } from "../auth.js";
import { resolveMaterialFile } from "../files.js";
import { mediaStatus, hlsPlaylist, hlsSegment, castPlanFor } from "../transcode.js";
import { ffmpegAvailable } from "../ffmpeg.js";

const router = Router();

function auth(req, res) {
  if (!currentUser(req)) { res.status(401).json({ error: "Unauthorized" }); return false; }
  return true;
}

function materialOf(req) {
  return get("SELECT * FROM materials WHERE id = ?", Number(req.params.id || req.query.id));
}

function tokenOf(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7) : String(req.query.token || "");
}

router.get("/media/status/:id", async (req, res) => {
  if (!auth(req, res)) return;
  const material = materialOf(req);
  if (!material) return res.status(404).json({ error: "章节不存在" });
  const target = resolveMaterialFile(material);
  if (!target) return res.status(404).json({ error: "文件不存在" });
  try {
    const status = await mediaStatus(target, {
      materialId: material.id, token: tokenOf(req), hls: req.query.hls !== "0",
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/media/plan/:id", async (req, res) => {
  if (!auth(req, res)) return;
  const material = materialOf(req);
  if (!material) return res.status(404).json({ error: "章节不存在" });
  try {
    const externalSubtitle = !!(material.subtitle_path && resolveMaterialFile({ file_path: material.subtitle_path }));
    const plan = await castPlanFor(resolveMaterialFile(material), externalSubtitle);
    res.json({ ...plan, ffmpeg_available: ffmpegAvailable(), dlna_enabled: process.env.LITECLASS_DLNA !== "off" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/hls/playlist.m3u8", async (req, res) => {
  if (!auth(req, res)) return;
  const material = materialOf(req);
  const target = material && resolveMaterialFile(material);
  if (!target) return res.status(404).json({ error: "章节不存在" });
  try {
    const text = await hlsPlaylist(target, material.id, tokenOf(req));
    if (!text) {
      res.setHeader("Retry-After", "2");
      return res.status(503).type("text/plain").send("分片索引准备中");
    }
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(text);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/hls/segment", async (req, res) => {
  if (!auth(req, res)) return;
  const material = materialOf(req);
  const target = material && resolveMaterialFile(material);
  if (!target) return res.status(404).json({ error: "章节不存在" });
  const index = Number(req.query.i);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: "分片序号无效" });
  if (target.remote) return res.status(501).json({ error: "远程来源不支持转码" });
  try {
    const result = await hlsSegment(target, index);
    if (result.status === "pending") {
      res.setHeader("Retry-After", "2");
      return res.status(503).type("text/plain").send("分片准备中");
    }
    if (result.status === "error") return res.status(500).type("text/plain").send(result.message);
    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Content-Length", result.size);
    res.setHeader("Cache-Control", "private, max-age=300");
    result.stream.pipe(res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
