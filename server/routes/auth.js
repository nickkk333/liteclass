import { Router } from "express";
import bcrypt from "bcryptjs";
import { get, run, now, publicSettings, setting } from "../db.js";
import { sign, requireAuth, publicUser, currentUser } from "../auth.js";

const router = Router();

router.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "请输入用户名和密码" });
  const user = get("SELECT * FROM users WHERE username = ?", String(username).trim());
  if (!user || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }
  run("UPDATE users SET last_ping_at = ? WHERE id = ?", now(), user.id);
  res.json({ token: sign(user), user: publicUser(user) });
});

router.post("/auth/register", (req, res) => {
  if (setting("allow_registration", "false") !== "true") return res.status(403).json({ error: "暂未开放注册" });
  const { username, password, nickname } = req.body || {};
  if (!username || String(username).length < 2) return res.status(400).json({ error: "用户名至少 2 个字符" });
  if (!password || String(password).length < 6) return res.status(400).json({ error: "密码至少 6 个字符" });
  if (get("SELECT id FROM users WHERE username = ?", username)) return res.status(409).json({ error: "用户名已存在" });
  const level = get("SELECT * FROM levels WHERE is_default = 1") || get("SELECT * FROM levels ORDER BY id LIMIT 1");
  const r = run(
    "INSERT INTO users (username,password,nickname,role,level_id,greeting_message,created_at,last_ping_at) VALUES (?,?,?,?,?,?,?,?)",
    username, bcrypt.hashSync(String(password), 10), nickname || username, "user", level?.id ?? null,
    "你好，今天又是新的一天！", now(), now()
  );
  const user = get("SELECT * FROM users WHERE id = ?", r.lastInsertRowid);
  res.json({ token: sign(user), user: publicUser(user) });
});

router.post("/auth/logout", requireAuth, (req, res) => res.json({ ok: true }));
router.get("/auth/verify", requireAuth, (req, res) => res.json({ valid: true, user: publicUser(req.user) }));
router.get("/settings/public", (req, res) => res.json(publicSettings()));
router.get("/about", (req, res) => {
  res.json({
    appName: "轻课堂",
    description: "专为 NAS 用户打造的轻量级、多用户私有云学习管理系统。",
    author: "落地长安",
    version: publicSettings().version,
  });
});

router.post("/ping", (req, res) => {
  const user = currentUser(req);
  if (user) run("UPDATE users SET last_ping_at = ? WHERE id = ?", now(), user.id);
  res.json({ ok: true, serverTime: now() });
});

export default router;
