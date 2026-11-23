import { Router } from "express";
import { requireAuth } from "../auth.js";
import {
  devices, startCast, control, sessionView, streamHandler, subtitleHandler, dlnaEnabled,
} from "../dlna.js";

const router = Router();

function guard(req, res, next) {
  if (!dlnaEnabled()) return res.status(403).json({ error: "投屏已在服务端关闭（LITECLASS_DLNA=off）" });
  next();
}

const fail = (res, e, status = 502) => {
  console.error("[dlna]", e?.message || e);
  res.status(status).json({ error: e.message || String(e) });
};

// 电视直接拉取：不带 JWT，靠一次性 cast 令牌。
router.get("/dlna/stream", streamHandler);
router.head("/dlna/stream", streamHandler);
// 电视拉取的外挂字幕（<id>.srt），同样只认 cast 令牌。
router.get("/dlna/subtitle/:file", subtitleHandler);

router.get("/dlna/devices", requireAuth, guard, async (req, res) => {
  try {
    const list = await devices(req.query.refresh === "1");
    res.json({ enabled: true, devices: list });
  } catch (e) { fail(res, e); }
});

router.post("/dlna/cast", requireAuth, guard, async (req, res) => {
  const body = req.body || {};
  try {
    const view = await startCast({
      req,
      udn: String(body.device || ""),
      materialId: Number(body.material_id),
      startSeconds: Number(body.start_seconds) || 0,
      transcode: String(body.transcode || "auto"),
      burn: body.burn === true || body.burn === "on",
      subtitle: String(body.subtitle || "auto"),
      duration: Number(body.duration) || 0,
      userId: req.user.id,
    });
    res.json({ success: true, ...view });
  } catch (e) { fail(res, e, 400); }
});

router.post("/dlna/control", requireAuth, guard, async (req, res) => {
  const body = req.body || {};
  try {
    const view = await control({
      req,
      action: String(body.action || ""),
      position: Number(body.position) || 0,
      subtitle: String(body.subtitle || "auto"),
    });
    res.json({ success: true, ...view });
  } catch (e) { fail(res, e, 400); }
});

router.get("/dlna/session", requireAuth, guard, (_req, res) => res.json(sessionView()));

export default router;
