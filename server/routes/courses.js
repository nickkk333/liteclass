import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { all, get, run, now, today, UPLOAD_DIR } from "../db.js";
import { requireAuth, optionalAuth } from "../auth.js";
import { kindOf, previewMode, extOf } from "../media.js";
import { scanFolder, attachSubtitles, isMountedFile } from "../mounts.js";
import { normalizeAnyPath, isVirtualPath } from "../paths.js";
import { repo } from "../sources.js";

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
export const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 * 1024 } });

function levelFor(seconds) {
  const minutes = Math.floor(seconds / 60);
  return get("SELECT * FROM levels WHERE min_minutes <= ? AND max_minutes >= ? ORDER BY min_minutes DESC LIMIT 1", minutes, minutes);
}

function courseRow(c, user) {
  const counts = get(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) AS finished,
      SUM(CASE WHEN p.position > 0 THEN 1 ELSE 0 END) AS started
     FROM materials m LEFT JOIN progress p ON p.material_id = m.id AND p.user_id = ?
     WHERE m.course_id = ?`,
    user?.id ?? 0, c.id
  );
  const creator = get("SELECT username, nickname, role FROM users WHERE id = ?", c.creator_id);
  return {
    ...c,
    is_hidden: c.is_hidden ? 1 : 0,
    is_shared: c.is_shared ? 1 : 0,
    uploader_name: creator?.nickname || creator?.username || "未知",
    uploader_role: creator?.role || "user",
    materials_count: counts.total || 0,
    finished_count: counts.finished || 0,
    started_count: counts.started || 0,
    is_favorited: user ? (get("SELECT 1 AS x FROM favorites WHERE user_id = ? AND course_id = ?", user.id, c.id) ? 1 : 0) : 0,
  };
}

function canManage(course, user) {
  return !!user && (user.role === "admin" || course.creator_id === user.id);
}

async function validateFolder(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { folder: "", error: null };
  const folder = normalizeAnyPath(raw);
  if (!folder) return { folder: "", error: "挂载路径无效，或不在允许的挂载目录内" };
  let stat;
  try { stat = await repo.stat(folder); } catch { return { folder: "", error: "挂载路径不存在或无法访问" }; }
  if (!stat.isDir) return { folder: "", error: "挂载路径必须是一个文件夹" };
  return { folder, error: null };
}

/** 虚拟路径保持原样，本地路径统一解析后作为去重键。 */
const pathKey = (p) => isVirtualPath(p) ? String(p) : path.resolve(p);

/** 将课程目录中的文件同步为课程章节：新增缺失文件、移除已删除文件、按文件名重排 */
async function scanCourseFolder(course, folder) {
  const { files, subtitles } = await scanFolder(folder);
  const subtitleByPath = attachSubtitles(files, subtitles);
  const existing = all("SELECT * FROM materials WHERE course_id = ?", course.id);
  const mounted = existing.filter((m) => m.file_path && isMountedFile(m.file_path));
  const byPath = new Map(mounted.map((m) => [pathKey(m.file_path), m]));
  const seen = new Set();
  let added = 0;
  let order = 0;

  for (const file of files) {
    const key = pathKey(file.path);
    seen.add(key);
    const subtitle = subtitleByPath.get(file.path) || "";
    const current = byPath.get(key);
    if (current) {
      run("UPDATE materials SET sort_order = ?, subtitle_path = ? WHERE id = ?", order, subtitle, current.id);
    } else {
      run(
        "INSERT INTO materials (course_id,title,file_path,file_type,mime_type,duration,size,sort_order,subtitle_path,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        course.id, file.title, file.path, file.file_type, file.mime_type, 0, file.size, order, subtitle, now()
      );
      added++;
    }
    order++;
  }

  let removed = 0;
  for (const material of mounted) {
    if (seen.has(pathKey(material.file_path))) continue;
    run("DELETE FROM materials WHERE id = ?", material.id);
    run("DELETE FROM progress WHERE material_id = ?", material.id);
    run("DELETE FROM notes WHERE material_id = ?", material.id);
    removed++;
  }

  run("UPDATE courses SET scan_status = ? WHERE id = ?", "done", course.id);
  return { added, removed, total: files.length };
}

/** 课程来源「直接作为课程打开」：复用同路径课程，不重复建课。 */
export async function createCourseFromFolder(user, title, folder) {
  const normalized = normalizeAnyPath(folder);
  if (!normalized) throw new Error("课程来源路径无效");
  let course = get("SELECT * FROM courses WHERE creator_id = ? AND folder_path = ?", user.id, normalized);
  if (!course) {
    const r = run(
      `INSERT INTO courses (title,description,cover_image,category_id,type,folder_path,creator_id,group_id,is_materials_shared,scan_status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      title || "课程来源", "", "", null, "folder", normalized, user.id, null, 1, "scanning", now()
    );
    course = get("SELECT * FROM courses WHERE id = ?", r.lastInsertRowid);
  }
  const scan = await scanCourseFolder(course, normalized);
  return { id: course.id, title: course.title, folder_path: normalized, imported: scan.total };
}

router.get("/courses", optionalAuth, (req, res) => {
  const user = req.user;
  const { filter, category_id, search } = req.query;
  let where = "1=1";
  const args = [];
  if (filter === "uploads") {
    if (!user) return res.json([]);
    where += " AND c.creator_id = ?";
    args.push(user.id);
  } else if (filter === "favorites") {
    if (!user) return res.json([]);
    where += " AND EXISTS (SELECT 1 FROM favorites f WHERE f.course_id = c.id AND f.user_id = ?)";
    args.push(user.id);
  }
  if (category_id && Number(category_id) > 0) {
    where += " AND c.category_id = ?";
    args.push(Number(category_id));
  }
  if (search) {
    where += " AND c.title LIKE ?";
    args.push(`%${search}%`);
  }
  if (!user || user.role !== "admin") {
    where += " AND (c.is_hidden = 0 OR c.creator_id = ?)";
    args.push(user?.id ?? -1);
  }
  const rows = all(`SELECT c.* FROM courses c WHERE ${where} ORDER BY c.created_at DESC, c.id DESC`, ...args);
  res.json(rows.map((c) => courseRow(c, user)));
});

router.post("/courses", requireAuth, async (req, res) => {
  const {
    title, description = "", category_id = null, cover_image = "",
    group_id = null, is_materials_shared = true, folder_path = "",
  } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "请输入课程名称" });

  const { folder, error } = await validateFolder(folder_path);
  if (error) return res.status(400).json({ error });
  if (folder && req.user.role !== "admin") return res.status(403).json({ error: "只有管理员可以挂载 NAS 存储路径" });

  const r = run(
    `INSERT INTO courses (title,description,cover_image,category_id,type,folder_path,creator_id,group_id,is_materials_shared,scan_status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    String(title).trim(), description, cover_image, category_id ? Number(category_id) : null,
    folder ? "folder" : "manual", folder, req.user.id,
    group_id ? Number(group_id) : null, is_materials_shared === false || is_materials_shared === 0 ? 0 : 1,
    folder ? "scanning" : "idle", now()
  );
  const course = get("SELECT * FROM courses WHERE id = ?", r.lastInsertRowid);
  const scan = folder ? await scanCourseFolder(course, folder) : null;
  const fresh = get("SELECT * FROM courses WHERE id = ?", course.id);
  res.json({ ...courseRow(fresh, req.user), imported: scan?.total ?? 0, scan });
});

router.get("/courses/:id", optionalAuth, (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course) return res.status(404).json({ error: "课程不存在" });
  const user = req.user;
  if (course.is_hidden && !canManage(course, user)) return res.status(403).json({ error: "无权访问该课程" });
  const category = course.category_id ? get("SELECT * FROM categories WHERE id = ?", course.category_id) : null;
  const materials = all(
    `SELECT m.*, COALESCE(p.position,0) AS position, COALESCE(p.duration,0) AS progress_duration,
       COALESCE(p.completed,0) AS completed
     FROM materials m LEFT JOIN progress p ON p.material_id = m.id AND p.user_id = ?
     WHERE m.course_id = ? ORDER BY m.sort_order ASC, m.id ASC`,
    user?.id ?? 0, course.id
  ).map((m) => {
    // 只从真实文件名取扩展名（标题中的「01.」不是后缀），且不向前端暴露挂载/虚拟路径
    const raw = m.file_path ? extOf(m.file_path) : "";
    const fileExt = /^\.[a-z0-9]{1,8}$/.test(raw)
      ? raw
      : (m.file_type === "audio" && !m.file_path ? ".wav" : ""); // 内置示例音频由服务端合成 WAV
    return {
      ...m,
      // 旧数据里标题可能自带扩展名，标题与后缀分开展示，避免重复
      title: fileExt && m.title?.toLowerCase().endsWith(fileExt) ? m.title.slice(0, -fileExt.length) : m.title,
      preview_mode: previewMode(m.file_path || m.title, m.file_type),
      has_subtitle: !!(m.subtitle_path && m.file_path),
      file_ext: fileExt,
      file_path: undefined,
      subtitle_path: undefined,
      tone: undefined,
    };
  });
  const creator = get("SELECT username, nickname, role FROM users WHERE id = ?", course.creator_id);
  res.json({
    ...course,
    is_hidden: course.is_hidden ? 1 : 0,
    is_shared: course.is_shared ? 1 : 0,
    category_name: category?.name || "未分类",
    uploader_name: creator?.nickname || creator?.username || "未知",
    uploader_role: creator?.role || "user",
    is_favorited: user ? (get("SELECT 1 AS x FROM favorites WHERE user_id = ? AND course_id = ?", user.id, course.id) ? 1 : 0) : 0,
    can_manage: canManage(course, user),
    materials,
    materials_count: materials.length,
  });
});

router.put("/courses/:id", requireAuth, async (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course) return res.status(404).json({ error: "课程不存在" });
  if (!canManage(course, req.user)) return res.status(403).json({ error: "无权修改该课程" });
  const body = req.body || {};
  const { title, description, category_id, cover_image, is_materials_shared, is_hidden, group_id } = body;

  let folder = course.folder_path || "";
  if (Object.prototype.hasOwnProperty.call(body, "folder_path")) {
    const { folder: next, error } = await validateFolder(body.folder_path);
    if (error) return res.status(400).json({ error });
    if (next && req.user.role !== "admin") return res.status(403).json({ error: "只有管理员可以挂载 NAS 存储路径" });
    folder = next;
  }

  run(
    `UPDATE courses SET title = ?, description = ?, category_id = ?, cover_image = ?,
       is_materials_shared = ?, is_hidden = ?, group_id = ?, folder_path = ?, type = ? WHERE id = ?`,
    title ?? course.title, description ?? course.description, category_id ?? course.category_id,
    cover_image ?? course.cover_image, is_materials_shared ?? course.is_materials_shared,
    is_hidden ?? course.is_hidden,
    group_id === undefined ? course.group_id : group_id ? Number(group_id) : null,
    folder, folder ? "folder" : "manual", course.id
  );

  const updated = get("SELECT * FROM courses WHERE id = ?", course.id);
  const scan = folder && folder !== (course.folder_path || "")
    ? await scanCourseFolder(updated, folder)
    : null;
  res.json({ ok: true, ...courseRow(updated, req.user), scan });
});

router.post("/courses/:id/scan", requireAuth, async (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course) return res.status(404).json({ error: "课程不存在" });
  if (!canManage(course, req.user)) return res.status(403).json({ error: "无权限" });
  const { folder, error } = await validateFolder(course.folder_path);
  if (error) return res.status(400).json({ error });
  if (!folder) return res.status(400).json({ error: "该课程未使用挂载路径" });
  const scan = await scanCourseFolder(course, folder);
  res.json({ ok: true, ...scan });
});

router.delete("/courses/:id", requireAuth, (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course) return res.status(404).json({ error: "课程不存在" });
  if (!canManage(course, req.user)) return res.status(403).json({ error: "无权删除该课程" });
  run("DELETE FROM materials WHERE course_id = ?", course.id);
  run("DELETE FROM discussions WHERE course_id = ?", course.id);
  run("DELETE FROM courses WHERE id = ?", course.id);
  res.json({ ok: true });
});

router.post("/courses/:id/visibility", requireAuth, (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course) return res.status(404).json({ error: "课程不存在" });
  if (!canManage(course, req.user)) return res.status(403).json({ error: "无权限" });
  const hidden = req.body?.is_hidden ? 1 : 0;
  run("UPDATE courses SET is_hidden = ? WHERE id = ?", hidden, course.id);
  res.json({ ok: true, is_hidden: hidden });
});

router.post("/courses/:id/favorite", requireAuth, (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course) return res.status(404).json({ error: "课程不存在" });
  const exists = get("SELECT 1 AS x FROM favorites WHERE user_id = ? AND course_id = ?", req.user.id, course.id);
  if (exists) {
    run("DELETE FROM favorites WHERE user_id = ? AND course_id = ?", req.user.id, course.id);
    return res.json({ is_favorited: 0 });
  }
  run("INSERT INTO favorites (user_id,course_id,created_at) VALUES (?,?,?)", req.user.id, course.id, now());
  res.json({ is_favorited: 1 });
});

router.post("/courses/:id/materials", requireAuth, upload.single("file"), (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course) return res.status(404).json({ error: "课程不存在" });
  if (!canManage(course, req.user)) return res.status(403).json({ error: "无权限" });
  const file = req.file;
  const title = (req.body.title || file?.originalname || "未命名章节").trim();
  const [type, mime] = kindOf(file?.originalname || title, file?.mimetype || "");
  const maxOrder = get("SELECT COALESCE(MAX(sort_order), -1) AS m FROM materials WHERE course_id = ?", course.id).m;
  const r = run(
    "INSERT INTO materials (course_id,title,file_path,file_type,mime_type,duration,size,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    course.id, title, file ? file.filename : "", type, mime,
    Number(req.body.duration || 0), file?.size || 0, maxOrder + 1, now()
  );
  res.json(get("SELECT id,course_id,title,file_type,mime_type,duration,size,sort_order FROM materials WHERE id = ?", r.lastInsertRowid));
});

router.put("/materials/:id", requireAuth, (req, res) => {
  const material = get("SELECT m.*, c.creator_id AS course_creator FROM materials m JOIN courses c ON c.id = m.course_id WHERE m.id = ?", Number(req.params.id));
  if (!material) return res.status(404).json({ error: "章节不存在" });
  if (req.user.role !== "admin" && material.course_creator !== req.user.id) return res.status(403).json({ error: "无权限" });
  const { title, duration } = req.body || {};
  run("UPDATE materials SET title = ?, duration = ? WHERE id = ?", title ?? material.title, duration ?? material.duration, material.id);
  res.json({ ok: true });
});

router.delete("/materials/:id", requireAuth, (req, res) => {
  const material = get("SELECT m.*, c.creator_id AS course_creator FROM materials m JOIN courses c ON c.id = m.course_id WHERE m.id = ?", Number(req.params.id));
  if (!material) return res.status(404).json({ error: "章节不存在" });
  if (req.user.role !== "admin" && material.course_creator !== req.user.id) return res.status(403).json({ error: "无权限" });
  if (material.file_path && !path.isAbsolute(material.file_path)) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, material.file_path)); } catch {}
  }
  run("DELETE FROM materials WHERE id = ?", material.id);
  run("DELETE FROM progress WHERE material_id = ?", material.id);
  run("DELETE FROM notes WHERE material_id = ?", material.id);
  res.json({ ok: true });
});

router.post("/courses/:id/materials/sort", requireAuth, (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course || !canManage(course, req.user)) return res.status(403).json({ error: "无权限" });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  ids.forEach((id, index) => run("UPDATE materials SET sort_order = ? WHERE id = ? AND course_id = ?", index, Number(id), course.id));
  res.json({ ok: true });
});

router.post("/courses/:id/materials/batch", requireAuth, (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course || !canManage(course, req.user)) return res.status(403).json({ error: "无权限" });
  const { ids = [], action } = req.body || {};
  if (action === "delete") {
    for (const id of ids) run("DELETE FROM materials WHERE id = ? AND course_id = ?", Number(id), course.id);
  }
  res.json({ ok: true });
});

router.delete("/courses/:id/materials", requireAuth, (req, res) => {
  const course = get("SELECT * FROM courses WHERE id = ?", Number(req.params.id));
  if (!course || !canManage(course, req.user)) return res.status(403).json({ error: "无权限" });
  run("DELETE FROM materials WHERE course_id = ?", course.id);
  res.json({ ok: true });
});

router.post("/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未选择文件" });
  res.json({ file_path: req.file.filename, size: req.file.size, title: req.file.originalname });
});

router.post("/upload/cover", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未选择文件" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

router.post("/upload/avatar", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未选择文件" });
  const url = `/uploads/${req.file.filename}`;
  run("UPDATE users SET avatar = ? WHERE id = ?", url, req.user.id);
  res.json({ url });
});

router.post("/upload/note-image", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未选择文件" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

router.post("/upload/exam-image", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未选择文件" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

router.post("/progress", requireAuth, (req, res) => {
  const { material_id, position = 0, duration = 0 } = req.body || {};
  const material = get("SELECT m.*, c.id AS course_id FROM materials m JOIN courses c ON c.id = m.course_id WHERE m.id = ?", Number(material_id));
  if (!material) return res.status(404).json({ error: "章节不存在" });
  const pos = Math.max(0, Number(position) || 0);
  const dur = Math.max(Number(duration) || material.duration || 0, Number(material.duration) || 0);
  if (!material.duration && dur > 0) run("UPDATE materials SET duration = ? WHERE id = ?", Math.round(dur), material.id);
  const prev = get("SELECT * FROM progress WHERE user_id = ? AND material_id = ?", req.user.id, material.id);
  let delta = prev ? Math.max(0, pos - prev.position) : pos;
  if (delta > 120) delta = 120;
  const completed = dur > 0 && pos >= dur * 0.95 ? 1 : (prev?.completed || 0);
  if (prev) {
    run("UPDATE progress SET position = ?, duration = ?, completed = ?, updated_at = ? WHERE id = ?",
      Math.max(pos, prev.position), dur, completed, now(), prev.id);
  } else {
    run("INSERT INTO progress (user_id,material_id,position,duration,completed,updated_at) VALUES (?,?,?,?,?,?)",
      req.user.id, material.id, pos, dur, completed, now());
  }
  const d = today();
  const log = get("SELECT * FROM watch_logs WHERE user_id = ? AND material_id = ? AND date = ?", req.user.id, material.id, d);
  if (log) {
    run("UPDATE watch_logs SET seconds = seconds + ?, course_id = ? WHERE id = ?", Math.round(delta), material.course_id, log.id);
  } else {
    run("INSERT INTO watch_logs (user_id,course_id,material_id,seconds,date,created_at) VALUES (?,?,?,?,?,?)",
      req.user.id, material.course_id, material.id, Math.round(delta), d, now());
  }
  const total = (req.user.total_watch_seconds || 0) + Math.round(delta);
  run("UPDATE users SET total_watch_seconds = ?, lifetime_watch_seconds = lifetime_watch_seconds + ? WHERE id = ?",
    total, Math.round(delta), req.user.id);
  const level = levelFor(total);
  if (level) run("UPDATE users SET level_id = ? WHERE id = ?", level.id, req.user.id);
  res.json({ ok: true, completed, total_watch_seconds: total, level_id: level?.id ?? req.user.level_id });
});

router.get("/progress", requireAuth, (req, res) => {
  const courseId = Number(req.query.course_id || 0);
  const rows = courseId
    ? all(`SELECT p.* FROM progress p JOIN materials m ON m.id = p.material_id WHERE p.user_id = ? AND m.course_id = ?`, req.user.id, courseId)
    : all("SELECT * FROM progress WHERE user_id = ?", req.user.id);
  res.json(rows);
});

export default router;
