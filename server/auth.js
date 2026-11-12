import jwt from "jsonwebtoken";
import { get } from "./db.js";

export const JWT_SECRET = process.env.LITECLASS_SECRET || "liteclass-dev-secret-change-me";

export function sign(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}

export function readToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

export function currentUser(req) {
  const token = readToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return get("SELECT * FROM users WHERE id = ?", payload.id) || null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  next();
}

export function optionalAuth(req, res, next) {
  req.user = currentUser(req);
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    role: u.role,
    avatar: u.avatar || null,
    greeting_message: u.greeting_message,
    level_id: u.level_id,
    total_watch_seconds: u.total_watch_seconds,
    lifetime_watch_seconds: u.lifetime_watch_seconds,
  };
}
