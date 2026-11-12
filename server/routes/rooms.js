import { Router } from "express";
import { WebSocketServer } from "ws";
import { all, get, run, now } from "../db.js";
import { requireAuth, currentUser } from "../auth.js";

const router = Router();

function roomRow(r) {
  const host = get("SELECT id,username,nickname,avatar FROM users WHERE id = ?", r.host_id);
  const course = r.course_id ? get("SELECT id,title,cover_image FROM courses WHERE id = ?", r.course_id) : null;
  const material = r.material_id ? get("SELECT id,title,duration,file_type FROM materials WHERE id = ?", r.material_id) : null;
  return { ...r, is_playing: r.is_playing ? 1 : 0, host, course, material, member_count: members.get(r.id)?.size || 0 };
}

const members = new Map();

router.get("/rooms", requireAuth, (req, res) => {
  const q = String(req.query.q || "");
  const rows = all("SELECT * FROM rooms " + (q ? "WHERE name LIKE ? OR code LIKE ?" : "") + " ORDER BY id DESC",
    ...(q ? [`%${q}%`, `%${q}%`] : []));
  res.json(rows.map(roomRow));
});

router.post("/rooms", requireAuth, (req, res) => {
  const { name, course_id = null, material_id = null } = req.body || {};
  if (!name) return res.status(400).json({ error: "请输入房间名称" });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  let matId = material_id ? Number(material_id) : null;
  if (!matId && course_id) {
    const first = get("SELECT id FROM materials WHERE course_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1", Number(course_id));
    matId = first?.id ?? null;
  }
  const r = run("INSERT INTO rooms (name,code,host_id,course_id,material_id,is_playing,position,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    name, code, req.user.id, course_id ? Number(course_id) : null, matId, 0, 0, now(), now());
  res.json(roomRow(get("SELECT * FROM rooms WHERE id = ?", r.lastInsertRowid)));
});

router.get("/rooms/:id", requireAuth, (req, res) => {
  const room = get("SELECT * FROM rooms WHERE id = ?", Number(req.params.id));
  if (!room) return res.status(404).json({ error: "房间不存在" });
  res.json(roomRow(room));
});

router.post("/rooms/:id/verify", requireAuth, (req, res) => {
  const room = get("SELECT * FROM rooms WHERE id = ?", Number(req.params.id));
  if (!room) return res.status(404).json({ error: "房间不存在" });
  if (String(req.body?.code || "") !== room.code) return res.status(403).json({ error: "房间口令错误" });
  res.json({ ok: true, room: roomRow(room) });
});

router.put("/rooms/:id", requireAuth, (req, res) => {
  const room = get("SELECT * FROM rooms WHERE id = ?", Number(req.params.id));
  if (!room) return res.status(404).json({ error: "房间不存在" });
  if (room.host_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "只有房主可以控制播放" });
  const { position, is_playing, material_id } = req.body || {};
  run("UPDATE rooms SET position = ?, is_playing = ?, material_id = ?, updated_at = ? WHERE id = ?",
    position ?? room.position, is_playing === undefined ? room.is_playing : (is_playing ? 1 : 0),
    material_id ?? room.material_id, now(), room.id);
  broadcast(room.id);
  res.json({ ok: true });
});

router.delete("/rooms/:id", requireAuth, (req, res) => {
  const room = get("SELECT * FROM rooms WHERE id = ?", Number(req.params.id));
  if (!room) return res.status(404).json({ error: "房间不存在" });
  if (room.host_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "无权限" });
  run("DELETE FROM rooms WHERE id = ?", room.id);
  res.json({ ok: true });
});

router.post("/rooms/:id/join", requireAuth, (req, res) => {
  const room = get("SELECT * FROM rooms WHERE id = ?", Number(req.params.id));
  if (!room) return res.status(404).json({ error: "房间不存在" });
  res.json(roomRow(room));
});

let wss = null;
const sockets = new Map();

function broadcast(roomId) {
  const room = get("SELECT * FROM rooms WHERE id = ?", Number(roomId));
  if (!room || !wss) return;
  const payload = JSON.stringify({ type: "state", room: roomRow(room) });
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.roomId === Number(roomId)) client.send(payload);
  }
}

export function attachRooms(server) {
  wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/ws/rooms/")) return ws.close(4004, "not found");
    const parts = url.pathname.split("/").filter(Boolean);
    const roomId = Number(parts[parts.length - 1]);
    const token = url.searchParams.get("token");
    const fakeReq = { headers: { authorization: "Bearer " + (token || "") }, query: {} };
    const user = currentUser(fakeReq);
    if (!user) return ws.close(4001, "unauthorized");
    const room = get("SELECT * FROM rooms WHERE id = ?", roomId);
    if (!room) return ws.close(4004, "not found");
    ws.user = user;
    ws.roomId = roomId;
    ws.isHost = room.host_id === user.id || user.role === "admin";
    if (!members.has(roomId)) members.set(roomId, new Set());
    members.get(roomId).add(user.id);
    sockets.set(ws, { roomId, userId: user.id });
    ws.send(JSON.stringify({ type: "state", room: roomRow(room) }));
    broadcast(roomId);

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      const current = get("SELECT * FROM rooms WHERE id = ?", roomId);
      if (!current) return;
      if (msg.type === "sync" && ws.isHost) {
        run("UPDATE rooms SET position = ?, is_playing = ?, material_id = ?, updated_at = ? WHERE id = ?",
          Number(msg.position) || 0, msg.playing ? 1 : 0, msg.materialId ? Number(msg.materialId) : current.material_id, now(), roomId);
        broadcast(roomId);
      } else if (msg.type === "chat") {
        const payload = JSON.stringify({ type: "chat", user: user.nickname || user.username, userId: user.id, content: String(msg.content || "").slice(0, 500), at: now() });
        for (const client of wss.clients) if (client.readyState === 1 && client.roomId === roomId) client.send(payload);
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", position: get("SELECT position,is_playing FROM rooms WHERE id = ?", roomId) }));
      }
    });

    ws.on("close", () => {
      members.get(roomId)?.delete(user.id);
      sockets.delete(ws);
      broadcast(roomId);
    });
  });
}

export default router;
