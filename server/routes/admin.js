import { Router } from "express";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
// 版本号由 publicSettings() 统一返回（来自 package.json）。
import { all, get, run, now, publicSettings, setSetting } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { ffmpegAvailable } from "../ffmpeg.js";

const router = Router();

router.get("/settings", requireAuth, requireAdmin, (req, res) =>
  res.json({ ...publicSettings(), ffmpeg_available: ffmpegAvailable() }));

router.put("/settings", requireAuth, requireAdmin, (req, res) => {
  const allowed = ["allow_registration", "allow_course_creation",
    "enable_transcoding", "show_watch_ranking_on_home"];
  for (const key of allowed) {
    if (req.body && key in req.body) {
      const v = req.body[key];
      setSetting(key, typeof v === "boolean" ? String(v) : v);
    }
  }
  res.json({ ok: true });
});

router.get("/categories", (req, res) => {
  const rows = all(
    `SELECT c.*, (SELECT COUNT(*) FROM courses co WHERE co.category_id = c.id) AS course_count
     FROM categories c ORDER BY c.sort_order ASC, c.id ASC`
  );
  res.json(rows);
});

router.post("/categories", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "请输入分类名称" });
  const max = get("SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories").m;
  const r = run("INSERT INTO categories (name,sort_order) VALUES (?,?)", name, max + 1);
  res.json(get("SELECT * FROM categories WHERE id = ?", r.lastInsertRowid));
});

router.put("/categories/:id", requireAuth, (req, res) => {
  const cat = get("SELECT * FROM categories WHERE id = ?", Number(req.params.id));
  if (!cat) return res.status(404).json({ error: "分类不存在" });
  run("UPDATE categories SET name = ? WHERE id = ?", req.body?.name ?? cat.name, cat.id);
  res.json({ ok: true });
});

router.delete("/categories/:id", requireAuth, (req, res) => {
  const cat = get("SELECT * FROM categories WHERE id = ?", Number(req.params.id));
  if (!cat) return res.status(404).json({ error: "分类不存在" });
  const fallback = get("SELECT id FROM categories WHERE name = '未分类'") || get("SELECT id FROM categories ORDER BY id LIMIT 1");
  run("UPDATE courses SET category_id = ? WHERE category_id = ?", fallback?.id ?? null, cat.id);
  run("DELETE FROM categories WHERE id = ?", cat.id);
  res.json({ ok: true });
});

router.post("/categories/sort", requireAuth, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  ids.forEach((id, i) => run("UPDATE categories SET sort_order = ? WHERE id = ?", i, Number(id)));
  res.json({ ok: true });
});

router.get("/levels", (req, res) => res.json(all("SELECT * FROM levels ORDER BY min_minutes ASC")));

router.get("/admin/levels", requireAuth, requireAdmin, (req, res) => res.json(all("SELECT * FROM levels ORDER BY min_minutes ASC")));
router.post("/admin/levels", requireAuth, requireAdmin, (req, res) => {
  const { name, min_minutes = 0, max_minutes = 0, text_color = "#6B7280", is_default = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: "请输入等级名称" });
  if (is_default) run("UPDATE levels SET is_default = 0");
  const r = run("INSERT INTO levels (name,min_minutes,max_minutes,text_color,is_default) VALUES (?,?,?,?,?)",
    name, Number(min_minutes), Number(max_minutes), text_color, is_default ? 1 : 0);
  res.json(get("SELECT * FROM levels WHERE id = ?", r.lastInsertRowid));
});
router.put("/admin/levels/:id", requireAuth, requireAdmin, (req, res) => {
  const lv = get("SELECT * FROM levels WHERE id = ?", Number(req.params.id));
  if (!lv) return res.status(404).json({ error: "等级不存在" });
  const { name, min_minutes, max_minutes, text_color, is_default } = req.body || {};
  if (is_default) run("UPDATE levels SET is_default = 0");
  run("UPDATE levels SET name = ?, min_minutes = ?, max_minutes = ?, text_color = ?, is_default = ? WHERE id = ?",
    name ?? lv.name, min_minutes ?? lv.min_minutes, max_minutes ?? lv.max_minutes,
    text_color ?? lv.text_color, is_default === undefined ? lv.is_default : (is_default ? 1 : 0), lv.id);
  res.json({ ok: true });
});
router.delete("/admin/levels/:id", requireAuth, requireAdmin, (req, res) => {
  run("DELETE FROM levels WHERE id = ?", Number(req.params.id));
  res.json({ ok: true });
});

router.get("/admin/users", requireAuth, requireAdmin, (req, res) => {
  const rows = all("SELECT * FROM users ORDER BY id ASC");
  res.json(rows.map((u) => ({
    id: u.id, username: u.username, nickname: u.nickname, role: u.role,
    created_at: u.created_at, avatar: u.avatar, last_ping_at: u.last_ping_at,
    current_learning_context: null,
    lifetime_watch_seconds: u.lifetime_watch_seconds,
    current_seconds: null,
    total_watch_seconds: u.total_watch_seconds,
    level_id: u.level_id,
  })));
});

router.post("/admin/users", requireAuth, requireAdmin, (req, res) => {
  const { username, password, nickname, role = "user", level_id = null } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "用户名和密码不能为空" });
  if (get("SELECT id FROM users WHERE username = ?", username)) return res.status(409).json({ error: "用户名已存在" });
  const r = run("INSERT INTO users (username,password,nickname,role,level_id,greeting_message,created_at,last_ping_at) VALUES (?,?,?,?,?,?,?,?)",
    username, bcrypt.hashSync(String(password), 10), nickname || username, role, level_id,
    "你好，今天又是新的一天！", now(), now());
  res.json({ id: r.lastInsertRowid, ok: true });
});

router.put("/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const u = get("SELECT * FROM users WHERE id = ?", Number(req.params.id));
  if (!u) return res.status(404).json({ error: "用户不存在" });
  const { nickname, role, level_id, password } = req.body || {};
  run("UPDATE users SET nickname = ?, role = ?, level_id = ? WHERE id = ?",
    nickname ?? u.nickname, role ?? u.role, level_id ?? u.level_id, u.id);
  if (password) run("UPDATE users SET password = ? WHERE id = ?", bcrypt.hashSync(String(password), 10), u.id);
  res.json({ ok: true });
});

router.delete("/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "不能删除当前登录用户" });
  run("DELETE FROM users WHERE id = ?", id);
  res.json({ ok: true });
});

router.get("/admin/course-groups", requireAuth, requireAdmin, (req, res) => {
  res.json(all("SELECT * FROM course_groups ORDER BY id ASC").map((g) => ({
    ...g,
    permissions: all("SELECT * FROM group_permissions WHERE group_id = ?", g.id),
  })));
});

router.get("/admin/course-groups/:id", requireAuth, requireAdmin, (req, res) => {
  const g = get("SELECT * FROM course_groups WHERE id = ?", Number(req.params.id));
  if (!g) return res.status(404).json({ error: "课程组不存在" });
  res.json({ ...g, permissions: all("SELECT * FROM group_permissions WHERE group_id = ?", g.id) });
});

router.post("/admin/course-groups", requireAuth, requireAdmin, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "请输入名称" });
  const r = run("INSERT INTO course_groups (name,description) VALUES (?,?)", name, req.body?.description || "");
  res.json(get("SELECT * FROM course_groups WHERE id = ?", r.lastInsertRowid));
});

router.put("/admin/course-groups/:id", requireAuth, requireAdmin, (req, res) => {
  const g = get("SELECT * FROM course_groups WHERE id = ?", Number(req.params.id));
  if (!g) return res.status(404).json({ error: "课程组不存在" });
  run("UPDATE course_groups SET name = ?, description = ? WHERE id = ?",
    req.body?.name ?? g.name, req.body?.description ?? g.description, g.id);
  res.json({ ok: true });
});

router.delete("/admin/course-groups/:id", requireAuth, requireAdmin, (req, res) => {
  run("DELETE FROM course_groups WHERE id = ?", Number(req.params.id));
  run("DELETE FROM group_permissions WHERE group_id = ?", Number(req.params.id));
  res.json({ ok: true });
});

router.post("/admin/course-groups/:id/permissions", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  run("DELETE FROM group_permissions WHERE group_id = ?", id);
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  for (const p of paths) run("INSERT INTO group_permissions (group_id,path) VALUES (?,?)", id, p);
  res.json({ ok: true });
});

router.get("/admin/accessible-paths/browse", requireAuth, requireAdmin, (req, res) => {
  const base = String(req.query.path || "/");
  const items = [];
  try {
    for (const name of fs.readdirSync(base)) {
      const full = path.join(base, name);
      if (name.startsWith(".")) continue;
      try {
        items.push({ name, path: full, isDirectory: fs.statSync(full).isDirectory() });
      } catch {}
    }
  } catch (e) {
    return res.status(400).json({ error: "无法读取该路径" });
  }
  res.json({ path: base, items });
});

export default router;
