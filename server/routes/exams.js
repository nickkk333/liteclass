import { Router } from "express";
import { all, get, run, now } from "../db.js";
import { requireAuth } from "../auth.js";

const router = Router();

function questionRow(q, reveal) {
  const opts = (() => { try { return JSON.parse(q.options || "[]"); } catch { return []; } })();
  return {
    id: q.id, exam_id: q.exam_id, type: q.type, content: q.content, options: opts,
    score: q.score, image: q.image, sort_order: q.sort_order,
    ...(reveal ? { answer: q.answer } : {}),
  };
}

function normalize(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim().toLowerCase()).sort().join(",");
  return String(v ?? "").trim().toLowerCase();
}

function grade(examId, answers) {
  const questions = all("SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY sort_order", examId);
  let score = 0;
  let needsManual = false;
  for (const q of questions) {
    const given = answers[q.id];
    if (q.type === "essay") { if (given) needsManual = true; continue; }
    if (given === undefined || given === null || given === "") continue;
    if (q.type === "fill") {
      const accepted = String(q.answer || "").split("|").map((s) => s.trim().toLowerCase());
      if (accepted.includes(String(given).trim().toLowerCase())) score += q.score;
    } else {
      if (normalize(given) === normalize(q.answer)) score += q.score;
    }
  }
  return { score, needsManual };
}

function examMeta(e) {
  const qs = get("SELECT COUNT(*) AS c, COALESCE(SUM(score),0) AS s FROM exam_questions WHERE exam_id = ?", e.id);
  const sub = get("SELECT COUNT(*) AS c FROM exam_submissions WHERE exam_id = ? AND status != 'ongoing'", e.id);
  return { ...e, question_count: qs.c, total_score: qs.s, submission_count: sub.c };
}

router.get("/exams", requireAuth, (req, res) => {
  const search = String(req.query.search || "");
  const where = req.user.role === "admin" ? "1=1" : "e.is_published = 1";
  const rows = all(
    `SELECT e.*, c.title AS course_title FROM exams e LEFT JOIN courses c ON c.id = e.course_id
     WHERE ${where} ${search ? "AND e.title LIKE ?" : ""} ORDER BY e.id DESC`,
    ...(search ? [`%${search}%`] : [])
  );
  res.json({ exams: rows.map((e) => {
    const sub = get("SELECT * FROM exam_submissions WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1", e.id, req.user.id);
    return { ...examMeta(e), my_submission: sub ? { ...sub, answers: undefined } : null };
  }) });
});

router.get("/exams/ongoing", requireAuth, (req, res) => {
  const sub = get("SELECT * FROM exam_submissions WHERE user_id = ? AND status = 'ongoing' ORDER BY id DESC LIMIT 1", req.user.id);
  if (!sub) return res.json({ ongoingExam: null });
  const exam = get("SELECT * FROM exams WHERE id = ?", sub.exam_id);
  res.json({ ongoingExam: { ...sub, answers: JSON.parse(sub.answers || "{}"), exam } });
});

router.post("/exams", requireAuth, (req, res) => {
  const { title, description = "", course_id = null, duration_minutes = 30, is_published = 1, show_answers = 1, questions = [] } = req.body || {};
  if (!title) return res.status(400).json({ error: "请输入考试名称" });
  const r = run("INSERT INTO exams (course_id,title,description,duration_minutes,is_published,show_answers,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)",
    course_id ? Number(course_id) : null, title, description, Number(duration_minutes), is_published ? 1 : 0, show_answers ? 1 : 0, req.user.id, now());
  const examId = Number(r.lastInsertRowid);
  questions.forEach((q, i) => {
    run("INSERT INTO exam_questions (exam_id,type,content,options,answer,score,sort_order,image) VALUES (?,?,?,?,?,?,?,?)",
      examId, q.type || "single", q.content || "", JSON.stringify(q.options || []), q.answer || "", Number(q.score) || 5, i, q.image || null);
  });
  res.json({ id: examId });
});

router.get("/exams/:id", requireAuth, (req, res) => {
  const exam = get("SELECT * FROM exams WHERE id = ?", Number(req.params.id));
  if (!exam) return res.status(404).json({ error: "考试不存在" });
  const submission = get("SELECT * FROM exam_submissions WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1", exam.id, req.user.id);
  const reveal = req.user.role === "admin" || (submission && submission.status !== "ongoing" && exam.show_answers);
  const questions = all("SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY sort_order, id", exam.id).map((q) => questionRow(q, reveal));
  res.json({
    ...examMeta(exam), questions,
    my_submission: submission ? { ...submission, answers: JSON.parse(submission.answers || "{}") } : null,
  });
});

router.post("/exams/:id/start", requireAuth, (req, res) => {
  const exam = get("SELECT * FROM exams WHERE id = ?", Number(req.params.id));
  if (!exam) return res.status(404).json({ error: "考试不存在" });
  if (!exam.is_published && req.user.role !== "admin") return res.status(403).json({ error: "考试未发布" });
  let submission = get("SELECT * FROM exam_submissions WHERE exam_id = ? AND user_id = ? AND status = 'ongoing' ORDER BY id DESC LIMIT 1", exam.id, req.user.id);
  if (!submission) {
    const r = run("INSERT INTO exam_submissions (exam_id,user_id,answers,score,status,started_at) VALUES (?,?,?,?,?,?)",
      exam.id, req.user.id, "{}", 0, "ongoing", now());
    submission = get("SELECT * FROM exam_submissions WHERE id = ?", r.lastInsertRowid);
  }
  const questions = all("SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY sort_order, id", exam.id).map((q) => questionRow(q, false));
  res.json({ submission: { ...submission, answers: JSON.parse(submission.answers || "{}") }, exam: examMeta(exam), questions });
});

router.post("/exams/:id/submit", requireAuth, (req, res) => {
  const exam = get("SELECT * FROM exams WHERE id = ?", Number(req.params.id));
  if (!exam) return res.status(404).json({ error: "考试不存在" });
  const answers = req.body?.answers || {};
  const { score, needsManual } = grade(exam.id, answers);
  let submission = get("SELECT * FROM exam_submissions WHERE exam_id = ? AND user_id = ? AND status = 'ongoing' ORDER BY id DESC LIMIT 1", exam.id, req.user.id);
  const submitted = now();
  if (submission) {
    run("UPDATE exam_submissions SET answers = ?, score = ?, status = ?, submitted_at = ? WHERE id = ?",
      JSON.stringify(answers), score, needsManual ? "submitted" : "graded", submitted, submission.id);
  } else {
    const r = run("INSERT INTO exam_submissions (exam_id,user_id,answers,score,status,started_at,submitted_at) VALUES (?,?,?,?,?,?,?)",
      exam.id, req.user.id, JSON.stringify(answers), score, needsManual ? "submitted" : "graded", submitted, submitted);
    submission = { id: Number(r.lastInsertRowid) };
  }
  res.json({ ok: true, score, status: needsManual ? "submitted" : "graded", submission_id: submission.id });
});

router.get("/exams/:id/submissions", requireAuth, (req, res) => {
  const rows = all(
    `SELECT s.*, u.nickname, u.username FROM exam_submissions s JOIN users u ON u.id = s.user_id
     WHERE s.exam_id = ? ORDER BY s.submitted_at DESC`, Number(req.params.id));
  res.json(rows.map((s) => ({ ...s, answers: JSON.parse(s.answers || "{}") })));
});

router.get("/exams/:id/analytics", requireAuth, (req, res) => {
  const exam = get("SELECT * FROM exams WHERE id = ?", Number(req.params.id));
  if (!exam) return res.status(404).json({ error: "考试不存在" });
  const subs = all(
    `SELECT s.*, u.nickname, u.username FROM exam_submissions s JOIN users u ON u.id = s.user_id
     WHERE s.exam_id = ? AND s.status != 'ongoing' ORDER BY s.submitted_at DESC`, exam.id);
  const total = get("SELECT COALESCE(SUM(score),0) AS s FROM exam_questions WHERE exam_id = ?", exam.id).s;
  const scores = subs.map((s) => s.score);
  const buckets = [0, 0, 0, 0, 0];
  for (const s of scores) {
    const pct = total ? (s / total) * 100 : 0;
    buckets[Math.min(4, Math.floor(pct / 20))]++;
  }
  res.json({
    exam: examMeta(exam), total_score: total,
    count: subs.length,
    average: subs.length ? scores.reduce((a, b) => a + b, 0) / subs.length : 0,
    max: scores.length ? Math.max(...scores) : 0,
    min: scores.length ? Math.min(...scores) : 0,
    buckets,
    submissions: subs,
  });
});

router.get("/exams/submissions/:id", requireAuth, (req, res) => {
  const s = get("SELECT s.*, u.nickname FROM exam_submissions s JOIN users u ON u.id = s.user_id WHERE s.id = ?", Number(req.params.id));
  if (!s) return res.status(404).json({ error: "提交记录不存在" });
  if (s.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "无权限" });
  const exam = get("SELECT * FROM exams WHERE id = ?", s.exam_id);
  const questions = all("SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY sort_order", s.exam_id);
  res.json({
    submission: { ...s, answers: JSON.parse(s.answers || "{}") }, exam,
    questions: questions.map((q) => ({
      ...questionRow(q, true),
      given: JSON.parse(s.answers || "{}")[q.id] ?? null,
    })),
  });
});

router.post("/exams/submissions/:id/grade", requireAuth, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "无权限" });
  const s = get("SELECT * FROM exam_submissions WHERE id = ?", Number(req.params.id));
  if (!s) return res.status(404).json({ error: "不存在" });
  const scores = req.body?.scores || {};
  const examId = s.exam_id;
  const auto = grade(examId, JSON.parse(s.answers || "{}")).score;
  let essayScore = 0;
  for (const v of Object.values(scores)) essayScore += Number(v) || 0;
  run("UPDATE exam_submissions SET score = ?, status = 'graded' WHERE id = ?", auto + essayScore, s.id);
  res.json({ ok: true, score: auto + essayScore });
});

router.put("/exams/:id", requireAuth, (req, res) => {
  const exam = get("SELECT * FROM exams WHERE id = ?", Number(req.params.id));
  if (!exam) return res.status(404).json({ error: "考试不存在" });
  if (req.user.role !== "admin" && exam.created_by !== req.user.id) return res.status(403).json({ error: "无权限" });
  const { title, description, duration_minutes, is_published, show_answers, questions } = req.body || {};
  run("UPDATE exams SET title = ?, description = ?, duration_minutes = ?, is_published = ?, show_answers = ? WHERE id = ?",
    title ?? exam.title, description ?? exam.description, duration_minutes ?? exam.duration_minutes,
    is_published === undefined ? exam.is_published : (is_published ? 1 : 0),
    show_answers === undefined ? exam.show_answers : (show_answers ? 1 : 0), exam.id);
  if (Array.isArray(questions)) {
    run("DELETE FROM exam_questions WHERE exam_id = ?", exam.id);
    questions.forEach((q, i) => run("INSERT INTO exam_questions (exam_id,type,content,options,answer,score,sort_order,image) VALUES (?,?,?,?,?,?,?,?)",
      exam.id, q.type || "single", q.content || "", JSON.stringify(q.options || []), q.answer || "", Number(q.score) || 5, i, q.image || null));
  }
  res.json({ ok: true });
});

router.delete("/exams/:id", requireAuth, (req, res) => {
  const exam = get("SELECT * FROM exams WHERE id = ?", Number(req.params.id));
  if (!exam) return res.status(404).json({ error: "考试不存在" });
  if (req.user.role !== "admin" && exam.created_by !== req.user.id) return res.status(403).json({ error: "无权限" });
  run("DELETE FROM exam_questions WHERE exam_id = ?", exam.id);
  run("DELETE FROM exam_submissions WHERE exam_id = ?", exam.id);
  run("DELETE FROM exams WHERE id = ?", exam.id);
  res.json({ ok: true });
});

export default router;
