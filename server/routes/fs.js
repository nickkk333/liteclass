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
  // 权限不足等错误仍返回当前上下文，方便前端继续从「授权目录」进入其他位置
  if (result.error && !result.path) return res.status(400).json({ error: result.error });
  res.json(result);
});

export default router;
