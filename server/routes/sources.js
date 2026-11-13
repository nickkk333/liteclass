import { Router } from "express";
import { requireAuth } from "../auth.js";
import {
  listSources, addSource, updateSource, removeSource, testConnection, connectSource,
} from "../sources.js";
import { createCourseFromFolder } from "./courses.js";

const router = Router();

function admin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "只有管理员可以管理课程来源" });
  next();
}

const fail = (res, e, status = 400) => res.status(status).json({ error: e.message || String(e) });

// 密码永远不回传：列表里只有 has_password。
router.get("/sources", requireAuth, admin, (_req, res) => res.json({ sources: listSources() }));

router.post("/sources", requireAuth, admin, (req, res) => {
  try { res.json({ success: true, source: addSource(req.body || {}) }); }
  catch (e) { fail(res, e); }
});

router.put("/sources", requireAuth, admin, (req, res) => {
  try { res.json({ success: true, source: updateSource(req.body || {}) }); }
  catch (e) { fail(res, e); }
});

router.post("/sources/test", requireAuth, admin, async (req, res) => {
  try { res.json({ success: true, ...(await testConnection(req.body || {})) }); }
  catch (e) { fail(res, e, 502); }
});

// 连接页/login 语义：先实测连接再写盘，返回 created / updated / reused。
router.post("/sources/connect", requireAuth, admin, async (req, res) => {
  const body = req.body || {};
  try {
    const result = await connectSource(body);
    const payload = { success: true, ...result };
    if (body.load) {
      const course = await createCourseFromFolder(req.user, result.source.name, result.source.root);
      payload.course = course;
    }
    res.json(payload);
  } catch (e) { fail(res, e, e.validation ? 400 : 502); }
});

router.post("/sources/remove", requireAuth, admin, (req, res) => {
  try { res.json({ success: true, ...removeSource(req.body?.id) }); }
  catch (e) { fail(res, e); }
});

export default router;
