import { Router } from "express";
import bcrypt from "bcryptjs";
import { all, get, run, now } from "../db.js";
import { requireAuth } from "../auth.js";

const router = Router();

function levelOf(user) {
  const minutes = Math.floor((user.lifetime_watch_seconds || 0) / 60);
  return get("SELECT * FROM levels WHERE min_minutes <= ? AND max_minutes >= ? ORDER BY min_minutes DESC LIMIT 1", minutes, minutes)
    || get("SELECT * FROM levels ORDER BY min_minutes ASC LIMIT 1");
}

router.get("/user/profile", requireAuth, (req, res) => {
  const level = levelOf(req.user);
  res.json({
    ...req.user,
    password: undefined,
    level_name: level?.name || "一级学员",
    level_color: level?.text_color || "#6B7280",
    total_watch_seconds: req.user.total_watch_seconds || 0,
    lifetime_watch_seconds: req.user.lifetime_watch_seconds || 0,
  });
});

router.put("/user/profile", requireAuth, (req, res) => {
  const { nickname, greeting_message, avatar } = req.body || {};
  run("UPDATE users SET nickname = ?, greeting_message = ?, avatar = ? WHERE id = ?",
    nickname ?? req.user.nickname, greeting_message ?? req.user.greeting_message,
    avatar ?? req.user.avatar, req.user.id);
  res.json({ ok: true });
});

router.post("/user/password", requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!bcrypt.compareSync(String(oldPassword || ""), req.user.password)) return res.status(400).json({ error: "原密码不正确" });
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: "新密码至少 6 位" });
  run("UPDATE users SET password = ? WHERE id = ?", bcrypt.hashSync(String(newPassword), 10), req.user.id);
  res.json({ ok: true });
});

router.get("/notes", requireAuth, (req, res) => {
  const { course_id, material_id } = req.query;
  let sql = `SELECT n.*, u.nickname AS user_name, m.title AS material_title, c.title AS course_title
    FROM notes n LEFT JOIN users u ON u.id = n.user_id
    LEFT JOIN materials m ON m.id = n.material_id
    LEFT JOIN courses c ON c.id = n.course_id WHERE n.user_id = ?`;
  const args = [req.user.id];
  if (course_id) { sql += " AND n.course_id = ?"; args.push(Number(course_id)); }
  if (material_id) { sql += " AND n.material_id = ?"; args.push(Number(material_id)); }
  sql += " ORDER BY n.updated_at DESC, n.id DESC";
  res.json(all(sql, ...args));
});

router.post("/notes", requireAuth, (req, res) => {
  const { course_id, material_id = null, content = "", timestamp_seconds = null } = req.body || {};
  if (!course_id) return res.status(400).json({ error: "缺少课程" });
  const r = run(
    "INSERT INTO notes (user_id,course_id,material_id,content,timestamp_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    req.user.id, Number(course_id), material_id ? Number(material_id) : null, String(content), timestamp_seconds, now(), now()
  );
  res.json(get(`SELECT n.*, m.title AS material_title FROM notes n LEFT JOIN materials m ON m.id = n.material_id WHERE n.id = ?`, r.lastInsertRowid));
});

router.put("/notes/:id", requireAuth, (req, res) => {
  const note = get("SELECT * FROM notes WHERE id = ?", Number(req.params.id));
  if (!note || note.user_id !== req.user.id) return res.status(403).json({ error: "无权限" });
  run("UPDATE notes SET content = ?, timestamp_seconds = ?, updated_at = ? WHERE id = ?",
    req.body?.content ?? note.content, req.body?.timestamp_seconds ?? note.timestamp_seconds, now(), note.id);
  res.json({ ok: true });
});

router.delete("/notes/:id", requireAuth, (req, res) => {
  const note = get("SELECT * FROM notes WHERE id = ?", Number(req.params.id));
  if (!note || (note.user_id !== req.user.id && req.user.role !== "admin")) return res.status(403).json({ error: "无权限" });
  run("DELETE FROM notes WHERE id = ?", note.id);
  res.json({ ok: true });
});

router.get("/courses/:id/discussions", requireAuth, (req, res) => {
  res.json(all(
    `SELECT d.*, u.nickname AS user_name, u.username, u.avatar, u.role
     FROM discussions d JOIN users u ON u.id = d.user_id
     WHERE d.course_id = ? ORDER BY d.created_at ASC, d.id ASC`,
    Number(req.params.id)
  ));
});

router.post("/courses/:id/discussions", requireAuth, (req, res) => {
  const content = String(req.body?.content || "").trim();
  if (!content) return res.status(400).json({ error: "请输入内容" });
  const course = get("SELECT id FROM courses WHERE id = ?", Number(req.params.id));
  if (!course) return res.status(404).json({ error: "课程不存在" });
  const r = run("INSERT INTO discussions (course_id,user_id,content,parent_id,created_at) VALUES (?,?,?,?,?)",
    course.id, req.user.id, content, req.body?.parent_id ?? null, now());
  res.json(get(`SELECT d.*, u.nickname AS user_name FROM discussions d JOIN users u ON u.id = d.user_id WHERE d.id = ?`, r.lastInsertRowid));
});

router.delete("/discussions/:id", requireAuth, (req, res) => {
  const d = get("SELECT * FROM discussions WHERE id = ?", Number(req.params.id));
  if (!d) return res.status(404).json({ error: "不存在" });
  if (d.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "无权限" });
  run("DELETE FROM discussions WHERE id = ?", d.id);
  run("DELETE FROM discussions WHERE parent_id = ?", d.id);
  res.json({ ok: true });
});

router.get("/history/calendar", requireAuth, (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const rows = all(
    `SELECT date, SUM(seconds) AS seconds, COUNT(DISTINCT material_id) AS count
     FROM watch_logs WHERE user_id = ? AND date LIKE ? GROUP BY date ORDER BY date`,
    req.user.id, `${prefix}%`
  );
  res.json(rows);
});

router.get("/history/by-date", requireAuth, (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const rows = all(
    `SELECT w.material_id, w.seconds, w.date, m.title, m.duration, m.file_type, c.id AS course_id, c.title AS course_title,
       COALESCE(p.position, 0) AS position
     FROM watch_logs w JOIN materials m ON m.id = w.material_id JOIN courses c ON c.id = m.course_id
     LEFT JOIN progress p ON p.material_id = w.material_id AND p.user_id = w.user_id
     WHERE w.user_id = ? AND w.date = ? ORDER BY w.id DESC`,
    req.user.id, date
  );
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  res.json({ date, items: rows, total_seconds: total });
});

router.delete("/history/item", requireAuth, (req, res) => {
  const materialId = Number(req.query.material_id || req.body?.material_id);
  const date = req.query.date || req.body?.date;
  if (!materialId) return res.status(400).json({ error: "缺少参数" });
  if (date) run("DELETE FROM watch_logs WHERE user_id = ? AND material_id = ? AND date = ?", req.user.id, materialId, date);
  else run("DELETE FROM watch_logs WHERE user_id = ? AND material_id = ?", req.user.id, materialId);
  run("DELETE FROM progress WHERE user_id = ? AND material_id = ?", req.user.id, materialId);
  res.json({ ok: true });
});

router.delete("/history/all", requireAuth, (req, res) => {
  const date = req.query.date;
  if (date) run("DELETE FROM watch_logs WHERE user_id = ? AND date = ?", req.user.id, date);
  else run("DELETE FROM watch_logs WHERE user_id = ?", req.user.id);
  res.json({ ok: true });
});

router.get("/user/history-courses", requireAuth, (req, res) => {
  const rows = all(
    `SELECT DISTINCT c.*, (SELECT COUNT(*) FROM materials m WHERE m.course_id = c.id) AS materials_count
     FROM courses c JOIN watch_logs w ON w.course_id = c.id WHERE w.user_id = ? ORDER BY c.id DESC`,
    req.user.id
  );
  res.json(rows);
});

router.get("/user/materials", requireAuth, (req, res) => {
  const rows = all(
    `SELECT m.*, c.title AS course_title FROM materials m JOIN courses c ON c.id = m.course_id
     WHERE c.creator_id = ? ORDER BY m.created_at DESC`,
    req.user.id
  );
  res.json(rows);
});

router.get("/user/orphaned-materials", requireAuth, (req, res) => {
  res.json(all("SELECT m.*, c.title AS course_title FROM materials m LEFT JOIN courses c ON c.id = m.course_id WHERE c.id IS NULL"));
});

router.get("/user/orphaned-notes", requireAuth, (req, res) => {
  res.json(all("SELECT * FROM notes WHERE user_id = ? AND course_id NOT IN (SELECT id FROM courses)", req.user.id));
});

router.delete("/user/materials/:id", requireAuth, (req, res) => {
  const m = get("SELECT m.*, c.creator_id FROM materials m JOIN courses c ON c.id = m.course_id WHERE m.id = ?", Number(req.params.id));
  if (!m || (m.creator_id !== req.user.id && req.user.role !== "admin")) return res.status(403).json({ error: "无权限" });
  run("DELETE FROM materials WHERE id = ?", m.id);
  res.json({ ok: true });
});

router.get("/watch-ranking", requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const rows = all(
    `SELECT u.id, u.username, u.nickname, u.avatar, u.total_watch_seconds, u.lifetime_watch_seconds
     FROM users u ORDER BY u.lifetime_watch_seconds DESC, u.id ASC LIMIT ? OFFSET ?`,
    limit, offset
  );
  res.json(rows.map((u, i) => {
    const level = get("SELECT * FROM levels WHERE min_minutes <= ? AND max_minutes >= ? ORDER BY min_minutes DESC LIMIT 1",
      Math.floor(u.lifetime_watch_seconds / 60), Math.floor(u.lifetime_watch_seconds / 60));
    return { ...u, rank: offset + i + 1, level_name: level?.name, level_color: level?.text_color };
  }));
});

router.get("/watch-ranking/users/:id", requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const rows = all(
    `SELECT w.date, w.seconds, m.title, c.title AS course_title, c.id AS course_id
     FROM watch_logs w JOIN materials m ON m.id = w.material_id JOIN courses c ON c.id = w.course_id
     WHERE w.user_id = ? ORDER BY w.date DESC, w.id DESC LIMIT ? OFFSET ?`,
    Number(req.params.id), limit, offset
  );
  res.json(rows);
});

router.post("/watch-ranking/reset", requireAuth, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "无权限" });
  run("UPDATE users SET total_watch_seconds = 0, lifetime_watch_seconds = 0");
  res.json({ ok: true });
});

export default router;
