import bcrypt from "bcryptjs";
import { db, run, get, now } from "./db.js";

const force = process.argv.includes("--force");

function seed() {
  const count = get("SELECT COUNT(*) AS c FROM users").c;
  if (count > 0 && !force) {
    console.log("Database already seeded. Use --force to reset.");
    return;
  }
  if (force) {
    for (const t of ["users", "levels", "categories", "course_groups", "group_permissions", "courses", "materials",
      "progress", "notes", "discussions", "favorites", "watch_logs", "exams", "exam_questions",
      "exam_submissions", "rooms", "settings"]) {
      db.exec(`DELETE FROM ${t}`);
      try { db.exec(`DELETE FROM sqlite_sequence WHERE name='${t}'`); } catch {}
    }
  }

  const t = now();
  const hash = (p) => bcrypt.hashSync(p, 10);

  const levels = [
    ["一级学员", 0, 10, "#6B7280", 1],
    ["二级学员", 10, 60, "#2563EB", 0],
    ["三级学员", 60, 300, "#8B5CF6", 0],
    ["四级学员", 300, 999999, "#F59E0B", 0],
  ];
  for (const l of levels) run("INSERT INTO levels (name,min_minutes,max_minutes,text_color,is_default) VALUES (?,?,?,?,?)", ...l);

  run("INSERT INTO users (username,password,nickname,role,greeting_message,level_id,total_watch_seconds,lifetime_watch_seconds,created_at,last_ping_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    "admin", hash("admin"), "admin", "admin", "你好，今天又是新的一天！", 1, 0, 0, t, t);

  // 分类、课程、章节、考试、放映房间等默认留空，由管理员按需创建。

  const settings = {
    allow_registration: "false", allow_course_creation: "true",
    enable_transcoding: "true", show_watch_ranking_on_home: "true", version: "1.1.6",
  };
  for (const [k, v] of Object.entries(settings)) {
    run("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, v);
  }

  console.log("Seeded database.");
}

seed();
