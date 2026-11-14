import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, run, get, now, today, MEDIA_DIR } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes("--force");
const tracks = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-tracks.json"), "utf8"));

function cover(name, colors, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
  <rect width="640" height="640" fill="url(#g)"/>
  <circle cx="510" cy="130" r="150" fill="#ffffff" opacity="0.08"/>
  <circle cx="120" cy="540" r="190" fill="#000000" opacity="0.10"/>
  <text x="50%" y="53%" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="92" fill="#ffffff" opacity="0.92">${label}</text>
</svg>`;
  const dir = path.join(MEDIA_DIR, "covers");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), svg);
  return `/media/covers/${name}`;
}

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
  const d = today();
  const hash = (p) => bcrypt.hashSync(p, 10);

  const levels = [
    ["一级学员", 0, 10, "#6B7280", 1],
    ["二级学员", 10, 60, "#2563EB", 0],
    ["三级学员", 60, 300, "#8B5CF6", 0],
    ["四级学员", 300, 999999, "#F59E0B", 0],
  ];
  for (const l of levels) run("INSERT INTO levels (name,min_minutes,max_minutes,text_color,is_default) VALUES (?,?,?,?,?)", ...l);

  run("INSERT INTO users (username,password,nickname,role,greeting_message,level_id,total_watch_seconds,lifetime_watch_seconds,created_at,last_ping_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    "admin", hash("admin"), "admin", "admin", "你好，今天又是新的一天！", 1, 7, 7, t, t);
  run("INSERT INTO users (username,password,nickname,role,greeting_message,level_id,total_watch_seconds,lifetime_watch_seconds,created_at,last_ping_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    "student", hash("123456"), "小明", "user", "今天也要好好学习呀！", 3, 3720, 3720, t, t);

  // 分类默认留空，由管理员在「分类管理」中自行创建。

  const covers = {
    1: cover("music.svg", ["#1e3a8a", "#312e81"], "♪"),
    2: cover("guide.svg", ["#0f766e", "#115e59"], "轻课堂"),
    3: cover("code.svg", ["#1d4ed8", "#0f172a"], "PY"),
    4: cover("english.svg", ["#7c3aed", "#4c1d95"], "EN"),
  };

  const courses = [
    [1, "【B站2024播放最高的100首歌】每一首都可以单曲循环一整天", "", null, "manual", 0, "idle", 1, 1, 0],
    [2, "轻课堂 · 新手指南", "5 分钟了解轻课堂的全部功能", null, "manual", 0, "idle", 1, 1, 0],
    [3, "Python 数据分析入门", "从零开始学习 numpy、pandas 与数据可视化", null, "manual", 0, "idle", 1, 1, 0],
    [4, "英语听力 · 每日一句", "每天十分钟，磨出英语耳朵", null, "manual", 0, "idle", 1, 1, 0],
  ];
  for (const [id, title, desc, cat, type, shared, scan, creator, sharedM, hidden] of courses) {
    run("INSERT INTO courses (id,title,description,cover_image,category_id,type,is_shared,scan_status,creator_id,is_materials_shared,is_hidden,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      id, title, desc, covers[id], cat, type, shared, scan, creator, sharedM, hidden, t);
  }

  for (const courseId of [1, 2, 3, 4]) {
    const list = tracks[courseId] || [];
    list.forEach((m, i) => {
      const title = String(m.title).replace(/\.wav$/i, "");
      run("INSERT INTO materials (course_id,title,file_path,file_type,mime_type,duration,size,sort_order,tone,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        courseId, title, "", "audio", "audio/wav", m.duration, m.duration * 8000, i, 180 + (i % 14) * 18, t);
    });
  }

  run("INSERT INTO favorites (user_id,course_id,created_at) VALUES (?,?,?)", 1, 1, t);
  run("INSERT INTO progress (user_id,material_id,position,duration,completed,updated_at) VALUES (?,?,?,?,?,?)", 1, 2, 7, 231, 0, t);
  run("INSERT INTO watch_logs (user_id,course_id,material_id,seconds,date,created_at) VALUES (?,?,?,?,?,?)", 1, 1, 2, 7, d, t);

  run("INSERT INTO notes (user_id,course_id,material_id,content,timestamp_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    1, 1, 2, "「离别开出花」的副歌旋律很抓耳，适合循环。", 42, t, t);
  run("INSERT INTO notes (user_id,course_id,material_id,content,timestamp_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    2, 3, 6, "numpy 的广播机制是重点，记得复习。", null, t, t);

  run("INSERT INTO discussions (course_id,user_id,content,parent_id,created_at) VALUES (?,?,?,?,?)", 1, 2, "这张歌单太棒了，已经收藏！", null, t);
  run("INSERT INTO discussions (course_id,user_id,content,parent_id,created_at) VALUES (?,?,?,?,?)", 1, 1, "谢谢支持，后续还会继续更新～", 1, t);

  const q1 = [
    ["single", "《离别开出花》的演唱者是？", ["就是南方凯", "周杰伦", "陈奕迅", "林俊杰"], "0", 20],
    ["single", "“每一首都可以单曲循环一整天”是哪张歌单的标题？", ["B站2024播放最高的100首歌", "华语经典老歌", "抖音热歌榜", "欧美流行精选"], "0", 20],
    ["judge", "轻课堂支持为课程添加笔记与讨论。", ["正确", "错误"], "正确", 20],
    ["multiple", "以下哪些属于轻课堂的功能？", ["课程管理", "在线考试", "一起观影", "视频转码"], "0,1,2,3", 20],
    ["fill", "轻课堂的英文名是 Lite ____。", [], "Class", 20],
  ];
  run("INSERT INTO exams (id,course_id,title,description,duration_minutes,is_published,show_answers,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    1, null, "轻课堂使用小测验", "检验一下你对轻课堂的了解程度，共 5 题，满分 100 分。", 20, 1, 1, 1, t);
  q1.forEach((q, i) => run("INSERT INTO exam_questions (exam_id,type,content,options,answer,score,sort_order) VALUES (?,?,?,?,?,?,?)",
    1, q[0], q[1], JSON.stringify(q[2]), q[3], q[4], i));

  const q2 = [
    ["single", "在 Python 中，导入 pandas 的正确写法是？", ["import pandas as pd", "include pandas", "using pandas", "require(pandas)"], "0", 25],
    ["single", "下列哪个方法用于查看 DataFrame 前 5 行？", ["df.head()", "df.first()", "df.top()", "df.show()"], "0", 25],
    ["judge", "numpy 中的数组要求所有元素类型一致。", ["正确", "错误"], "正确", 25],
    ["fill", "pandas 中读取 CSV 文件的函数是 pd.____()。", [], "read_csv", 25],
  ];
  run("INSERT INTO exams (id,course_id,title,description,duration_minutes,is_published,show_answers,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    2, 3, "Python 数据分析随堂测", "针对 numpy 与 pandas 基础知识的随堂测试。", 15, 1, 1, 1, t);
  q2.forEach((q, i) => run("INSERT INTO exam_questions (exam_id,type,content,options,answer,score,sort_order) VALUES (?,?,?,?,?,?,?)",
    2, q[0], q[1], JSON.stringify(q[2]), q[3], q[4], i));

  run("INSERT INTO rooms (name,code,host_id,course_id,material_id,is_playing,position,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    "一起听歌 · 华语金曲", "888888", 1, 1, 1, 0, 0, t, t);

  const settings = {
    allow_registration: "false", allow_course_creation: "true", max_material_size: "100",
    max_course_size: "1024", enable_transcoding: "true", show_watch_ranking_on_home: "true", version: "1.1.6",
  };
  for (const [k, v] of Object.entries(settings)) {
    run("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, v);
  }

  console.log("Seeded database.");
}

seed();
