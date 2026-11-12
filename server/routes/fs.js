import { Router } from "express";
import { requireAuth } from "../auth.js";
import { listDirs } from "../mounts.js";

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "无权限" });
  next();
}

// 浏览 NAS 挂载目录（仅管理员），用于「挂载路径」选择器
router.get("/fs/dirs", requireAuth, requireAdmin, (req, res) => {
  const dir = req.query.path ? String(req.query.path) : "";
  const result = listDirs(dir);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

export default router;
