import { Router } from "express";
import { requireAuth } from "../auth.js";
import { get } from "../db.js";
import { resolveMaterialFile } from "../files.js";
import { probe, ffmpegAvailable } from "../ffmpeg.js";
import { burnStream, subtitleBurnFile } from "../transcode.js";
import { issueCastToken, validCastToken, absoluteURL } from "../dlna.js";

// 「投屏时烧录字幕」给浏览器 / 接力投屏（AirPlay 视频接力、Chromecast 媒体投屏）用：
// 服务端用 ffmpeg 把字幕烧进画面，输出 fMP4 实时流——设备自己拉流也能看到字幕。
// DLNA 电视的烧录走 /api/dlna/stream?burn=1（MPEG-TS）。

const router = Router();

async function burnable(material) {
  const target = material && resolveMaterialFile(material);
  if (!target) return { error: ["章节不存在", 404] };
  if (target.remote) return { error: ["远程来源不支持烧录字幕", 501] };
  if (!ffmpegAvailable()) return { error: ["服务端未安装 ffmpeg，无法烧录字幕", 501] };
  const facts = await probe(target.path);
  if (!facts?.video) return { error: ["只有视频章节需要烧录字幕", 400] };
  const subtitleFile = await subtitleBurnFile(material);
  if (!subtitleFile) return { error: ["该章节没有可用字幕", 400] };
  return { target, facts, subtitleFile };
}

router.get("/cast/burn/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!validCastToken(req.query.cast, id)) return res.status(401).type("text/plain").send("投屏令牌无效");
  const material = get("SELECT * FROM materials WHERE id = ?", id);
  try {
    const result = await burnable(material);
    if (result.error) return res.status(result.error[1]).type("text/plain").send(result.error[0]);
    burnStream(result.target, result.facts, Number(req.query.start) || 0, req, res, result.subtitleFile, "mp4");
  } catch (e) {
    if (!res.headersSent) res.status(500).type("text/plain").send(`烧录流启动失败：${e.message || e}`);
    else res.end();
  }
});

router.post("/cast/burn", requireAuth, async (req, res) => {
  const body = req.body || {};
  const material = get("SELECT * FROM materials WHERE id = ?", Number(body.material_id));
  try {
    const result = await burnable(material);
    if (result.error) return res.status(result.error[1]).json({ error: result.error[0] });
    const token = issueCastToken(material.id, req.user.id);
    const start = Math.max(0, Math.floor(Number(body.start_seconds) || 0));
    res.json({
      success: true,
      burned: true,
      start,
      url: `${absoluteURL(req)}/api/cast/burn/${material.id}?cast=${token}&start=${start}`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

export default router;
