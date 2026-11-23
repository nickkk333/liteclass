import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
// 应用版本以 package.json 为准，与 fpk 安装包 / 发布标签保持一致。
export const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || "0.0.0";
  } catch { return "0.0.0"; }
})();
export const DATA_DIR = process.env.LITECLASS_DATA_DIR
  ? path.resolve(process.env.LITECLASS_DATA_DIR)
  : path.join(ROOT, "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "liteclass.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  nickname TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  avatar TEXT,
  greeting_message TEXT DEFAULT '你好，今天又是新的一天！',
  level_id INTEGER,
  total_watch_seconds INTEGER DEFAULT 0,
  lifetime_watch_seconds INTEGER DEFAULT 0,
  created_at TEXT,
  last_ping_at TEXT
);

CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  min_minutes INTEGER DEFAULT 0,
  max_minutes INTEGER DEFAULT 0,
  text_color TEXT DEFAULT '#6B7280',
  is_default INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS course_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS group_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',
  category_id INTEGER,
  type TEXT DEFAULT 'manual',
  folder_path TEXT DEFAULT '',
  is_shared INTEGER DEFAULT 0,
  scan_status TEXT DEFAULT 'idle',
  creator_id INTEGER,
  group_id INTEGER,
  is_materials_shared INTEGER DEFAULT 1,
  is_hidden INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT DEFAULT '',
  file_type TEXT DEFAULT 'audio',
  mime_type TEXT DEFAULT '',
  duration INTEGER DEFAULT 0,
  size INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  tone INTEGER DEFAULT 220,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  position REAL DEFAULT 0,
  duration REAL DEFAULT 0,
  completed INTEGER DEFAULT 0,
  updated_at TEXT,
  UNIQUE(user_id, material_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  material_id INTEGER,
  content TEXT DEFAULT '',
  timestamp_seconds REAL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS discussions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  parent_id INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  created_at TEXT,
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS watch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  seconds INTEGER DEFAULT 0,
  date TEXT NOT NULL,
  created_at TEXT,
  UNIQUE(user_id, material_id, date)
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  duration_minutes INTEGER DEFAULT 30,
  start_at TEXT,
  end_at TEXT,
  is_published INTEGER DEFAULT 1,
  show_answers INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  type TEXT DEFAULT 'single',
  content TEXT NOT NULL,
  options TEXT DEFAULT '[]',
  answer TEXT DEFAULT '',
  score REAL DEFAULT 5,
  image TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exam_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  answers TEXT DEFAULT '{}',
  score REAL DEFAULT 0,
  status TEXT DEFAULT 'ongoing',
  started_at TEXT,
  submitted_at TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  host_id INTEGER NOT NULL,
  course_id INTEGER,
  material_id INTEGER,
  is_playing INTEGER DEFAULT 0,
  position REAL DEFAULT 0,
  updated_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// 既有数据库升级：字幕路径（旧库没有该列）
try {
  db.exec("ALTER TABLE materials ADD COLUMN subtitle_path TEXT DEFAULT ''");
} catch {}

export const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export const today = () => now().slice(0, 10);

export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);

export function setting(key, fallback = "") {
  const row = get("SELECT value FROM settings WHERE key = ?", key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    String(value)
  );
}

export function publicSettings() {
  return {
    allow_registration: setting("allow_registration", "false") === "true",
    allow_course_creation: setting("allow_course_creation", "true") === "true",
    enable_transcoding: setting("enable_transcoding", "true") === "true",
    show_watch_ranking_on_home: setting("show_watch_ranking_on_home", "false") === "true",
    version: APP_VERSION,
  };
}
