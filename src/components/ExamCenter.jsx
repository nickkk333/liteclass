import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, Clock, Trophy, Trash2, Pencil, BarChart3, ChevronRight, CheckCircle2 } from "lucide-react";
import { api, fmtDuration, fmtDateTime } from "../api.js";
import { useAuth } from "../App.jsx";
import { Modal, useToast, Empty, Confirm, Spinner } from "./ui.jsx";

const TYPE_LABEL = { single: "单选题", multiple: "多选题", judge: "判断题", fill: "填空题", essay: "简答题" };
const LETTERS = "ABCDEFGH";

function fmtAnswer(q, raw) {
  if (raw === undefined || raw === null || raw === "") return "未作答";
  const options = q.options || [];
  if (q.type === "multiple") {
    const arr = Array.isArray(raw) ? raw : String(raw).split(",");
    return arr.map((i) => {
      const n = Number(i);
      return options[n] != null ? `${LETTERS[n]}. ${options[n]}` : String(i);
    }).join("；");
  }
  if (q.type === "single") {
    const n = Number(raw);
    return options[n] != null ? `${LETTERS[n]}. ${options[n]}` : String(raw);
  }
  if (q.type === "judge") {
    const n = /^\d+$/.test(String(raw)) ? Number(raw) : raw === "正确" ? 0 : raw === "错误" ? 1 : null;
    if (n !== null && options[n] != null) return options[n];
  }
  return Array.isArray(raw) ? raw.join("；") : String(raw);
}

function ExamCard({ exam, admin, onStart, onResult, onEdit, onDelete, onStats }) {
  const sub = exam.my_submission;
  return (
    <div className="exam-card">
      <div className="exam-icon"><FileText size={22} /></div>
      <div className="exam-body">
        <h3>{exam.title}</h3>
        {exam.description && <div className="m muted" style={{ fontSize: 12, marginTop: 4 }}>{exam.description}</div>}
        <div className="meta">
          <span><FileText size={12} /> {exam.question_count} 题</span>
          <span><Trophy size={12} /> {exam.total_score} 分</span>
          <span><Clock size={12} /> {exam.duration_minutes} 分钟</span>
          {exam.course_title && <span>{exam.course_title}</span>}
          {sub && sub.status !== "ongoing" && <span className="badge badge-green">得分 {sub.score}</span>}
          {sub && sub.status === "ongoing" && <span className="badge badge-blue">进行中</span>}
        </div>
      </div>
      <div className="exam-actions">
        {sub && sub.status !== "ongoing"
          ? <button className="btn btn-sm btn-soft" onClick={() => onResult(sub.id)}>查看成绩</button>
          : <button className="btn btn-sm btn-primary" onClick={() => onStart(exam)}>{sub ? "继续考试" : "开始考试"}</button>}
        {admin && (
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn" title="成绩统计" onClick={() => onStats(exam)}><BarChart3 size={15} /></button>
            <button className="icon-btn" title="编辑" onClick={() => onEdit(exam)}><Pencil size={15} /></button>
            <button className="icon-btn" title="删除" onClick={() => onDelete(exam)}><Trash2 size={15} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function ExamRunner({ examId, onClose, onDone }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    api(`/exams/${examId}/start`, { method: "POST" })
      .then((r) => {
        setData(r);
        setAnswers(r.submission.answers || {});
        const started = new Date(String(r.submission.started_at).replace(" ", "T")).getTime();
        const end = started + (r.exam.duration_minutes || 30) * 60000;
        setLeft(Math.max(0, Math.floor((end - Date.now()) / 1000)));
      })
      .catch((e) => setError(e.message));
  }, [examId]);

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const r = await api(`/exams/${examId}/submit`, { method: "POST", body: { answers } });
      toast("交卷成功", "ok");
      onDone?.(r);
      onClose();
    } catch (e) { toast(e.message, "error"); submitting.current = false; setBusy(false); }
  };

  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) { clearInterval(timer); submit(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [data]);

  const setAnswer = (qid, value) => setAnswers((a) => ({ ...a, [qid]: value }));

  return (
    <Modal
      title={data ? data.exam.title : "考试"}
      onClose={onClose}
      wide
      footer={data ? <>
        <button className="btn" onClick={onClose}>暂时离开</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "交卷中..." : "交卷"}</button>
      </> : null}
    >
      {error ? <p className="danger-text">{error}</p> : !data ? <div className="row" style={{ justifyContent: "center", padding: 30 }}><Spinner /></div> : (
        <div className="exam-runner">
          <div className="row" style={{ marginBottom: 14, justifyContent: "space-between" }}>
            <span className="muted small">共 {data.questions.length} 题 · 满分 {data.exam.total_score} 分</span>
            <span className="exam-timer"><Clock size={14} /> {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</span>
          </div>
          {data.questions.map((q, idx) => (
            <div className="question-card" key={q.id}>
              <div className="q-head">
                <span className="q-no">{idx + 1}</span>
                <div className="q-content">
                  {q.content}
                  <div className="badge" style={{ marginTop: 8 }}>{TYPE_LABEL[q.type] || q.type} · {q.score} 分</div>
                  {q.image && <img src={q.image} alt="" style={{ marginTop: 10, borderRadius: 10, maxWidth: 280 }} />}
                </div>
              </div>
              {q.type === "fill" ? (
                <input className="input" placeholder="请输入答案" value={answers[q.id] || ""} onChange={(e) => setAnswer(q.id, e.target.value)} />
              ) : q.type === "essay" ? (
                <textarea className="textarea" placeholder="请输入你的回答" value={answers[q.id] || ""} onChange={(e) => setAnswer(q.id, e.target.value)} />
              ) : (
                q.options.map((opt, i) => {
                  const val = q.type === "multiple" ? String(i) : (q.type === "judge" ? opt : String(i));
                  const cur = answers[q.id];
                  const sel = q.type === "multiple" ? Array.isArray(cur) && cur.includes(val) : cur === val;
                  return (
                    <div key={i} className={`option ${sel ? "sel" : ""}`} onClick={() => {
                      if (q.type === "multiple") {
                        const arr = Array.isArray(cur) ? [...cur] : [];
                        setAnswer(q.id, sel ? arr.filter((x) => x !== val) : [...arr, val]);
                      } else setAnswer(q.id, val);
                    }}>
                      <span className="mark">{LETTERS[i]}</span>
                      <span>{opt}</span>
                    </div>
                  );
                })
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ExamResult({ submissionId, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api(`/exams/submissions/${submissionId}`).then(setData).catch(() => setData(false)); }, [submissionId]);
  const pct = data ? Math.round((data.submission.score / (data.questions.reduce((s, q) => s + q.score, 0) || 1)) * 100) : 0;
  return (
    <Modal title="考试成绩" onClose={onClose} wide footer={<button className="btn btn-primary" onClick={onClose}>关闭</button>}>
      {!data ? <div className="row" style={{ justifyContent: "center", padding: 30 }}><Spinner /></div> : data === false ? <Empty text="无法加载成绩" /> : (
        <>
          <div className="result-score">
            <div className="num">{data.submission.score}<small> 分</small></div>
            <div className="txt">{data.exam.title} · {pct >= 60 ? "恭喜通过" : "继续加油"} · {fmtDateTime(data.submission.submitted_at)}</div>
          </div>
          {data.questions.map((q, idx) => {
            const correct = q.type === "multiple"
              ? Array.isArray(q.given) && [...q.given].sort().join(",") === String(q.answer).split(",").sort().join(",")
              : q.type === "fill"
                ? String(q.answer).toLowerCase().split("|").map((s) => s.trim()).includes(String(q.given || "").trim().toLowerCase())
                : String(q.given ?? "") === String(q.answer ?? "");
            return (
              <div className="question-card" key={q.id} style={{ padding: 14 }}>
                <div className="q-head" style={{ marginBottom: 6 }}>
                  <span className="q-no">{idx + 1}</span>
                  <div className="q-content" style={{ fontSize: 13.5 }}>{q.content}</div>
                  <span className={`badge ${correct ? "badge-green" : "badge-red"}`}>{correct ? `+${q.score}` : 0}</span>
                </div>
                <div className="answer-line">
                  我的答案：<b style={{ color: correct ? undefined : "var(--danger)" }}>{fmtAnswer(q, q.given)}</b>
                </div>
                {q.answer !== undefined && <div className="answer-line">正确答案：<b>{fmtAnswer(q, q.answer)}</b></div>}
              </div>
            );
          })}
        </>
      )}
    </Modal>
  );
}

function QuestionEditor({ q, index, onChange, onRemove }) {
  const set = (patch) => onChange({ ...q, ...patch });
  const options = q.options || [];
  return (
    <div className="card" style={{ padding: 14, boxShadow: "none", border: "1px solid var(--border)" }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="badge badge-blue">第 {index + 1} 题</span>
        <select className="select" style={{ width: 110, height: 32, padding: "4px 8px" }} value={q.type} onChange={(e) => set({ type: e.target.value, options: e.target.value === "judge" ? ["正确", "错误"] : e.target.value === "single" || e.target.value === "multiple" ? ["", "", "", ""] : [], answer: "" })}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="input" style={{ width: 80, height: 32, padding: "4px 8px" }} type="number" value={q.score} onChange={(e) => set({ score: Number(e.target.value) })} />
        <span className="muted small">分</span>
        <button className="icon-btn" onClick={onRemove}><Trash2 size={15} /></button>
      </div>
      <textarea className="textarea" style={{ minHeight: 60, marginBottom: 10 }} placeholder="题目内容" value={q.content} onChange={(e) => set({ content: e.target.value })} />
      {(q.type === "single" || q.type === "multiple") && (
        <div style={{ marginBottom: 10 }}>
          {options.map((o, i) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              <span className="badge">{LETTERS[i]}</span>
              <input className="input" style={{ height: 34, padding: "4px 10px" }} value={o} placeholder={`选项 ${LETTERS[i]}`} onChange={(e) => {
                const next = [...options]; next[i] = e.target.value; set({ options: next });
              }} />
            </div>
          ))}
          <div className="row">
            <button className="btn btn-sm" onClick={() => set({ options: [...options, ""] })}>添加选项</button>
            {options.length > 2 && <button className="btn btn-sm" onClick={() => set({ options: options.slice(0, -1) })}>删除末项</button>}
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>正确答案（{q.type === "multiple" ? "多个字母用逗号分隔，如 A,C" : "字母，如 A"}）</label>
            <input className="input" style={{ height: 34 }} value={Array.isArray(q.answer) ? q.answer.join(",") : (q.answer || "")} onChange={(e) => set({ answer: e.target.value })} placeholder={q.type === "multiple" ? "A,C" : "A"} />
          </div>
        </div>
      )}
      {q.type === "judge" && (
        <div className="field">
          <label>正确答案</label>
          <select className="select" value={q.answer} onChange={(e) => set({ answer: e.target.value })}>
            <option value="">请选择</option>
            <option value="正确">正确</option>
            <option value="错误">错误</option>
          </select>
        </div>
      )}
      {(q.type === "fill" || q.type === "essay") && (
        <div className="field">
          <label>参考答案（多个答案用 | 分隔）</label>
          <input className="input" style={{ height: 34 }} value={q.answer || ""} onChange={(e) => set({ answer: e.target.value })} />
        </div>
      )}
    </div>
  );
}

function ExamEditor({ exam, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: "", description: "", duration_minutes: 30, questions: [] });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(exam));

  useEffect(() => {
    if (!exam) return;
    api(`/exams/${exam.id}`).then((d) => {
      setForm({
        title: d.title, description: d.description, duration_minutes: d.duration_minutes,
        questions: d.questions.map((q) => ({ ...q, answer: q.answer ?? "" })),
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [exam]);

  const addQuestion = () => setForm((f) => ({ ...f, questions: [...f.questions, { type: "single", content: "", options: ["", "", "", ""], answer: "", score: 5 }] }));

  const save = async () => {
    if (!form.title.trim()) return toast("请输入考试名称", "error");
    if (!form.questions.length) return toast("请至少添加一道题", "error");
    const cleaned = form.questions.map((q) => {
      const toIndex = (s) => (/^[A-H]$/.test(s) ? String(s.charCodeAt(0) - 65) : s);
      const answer = ["single", "multiple"].includes(q.type)
        ? String(q.answer ?? "").split(",").map((s) => toIndex(s.trim().toUpperCase())).filter(Boolean).join(",")
        : String(q.answer ?? "");
      return {
        ...q,
        options: q.type === "judge" ? (q.options?.length ? q.options : ["正确", "错误"]) : (q.type === "fill" || q.type === "essay" ? [] : q.options),
        answer,
        score: Number(q.score) || 0,
      };
    });
    setBusy(true);
    try {
      if (exam) await api(`/exams/${exam.id}`, { method: "PUT", body: { ...form, questions: cleaned } });
      else await api("/exams", { method: "POST", body: { ...form, questions: cleaned } });
      toast("已保存", "ok");
      onSaved?.();
      onClose();
    } catch (e) { toast(e.message, "error"); }
    setBusy(false);
  };

  return (
    <Modal title={exam ? "编辑考试" : "新增考试"} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>取消</button><button className="btn btn-primary" onClick={save} disabled={busy || loading}>{busy ? "保存中..." : "保存考试"}</button></>}>
      {loading ? <div className="row" style={{ justifyContent: "center", padding: 30 }}><Spinner /></div> : (
        <>
          <div className="field"><label>考试名称</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field"><label>考试说明</label><textarea className="textarea" style={{ minHeight: 60 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="field"><label>考试时长（分钟）</label><input className="input" type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} /></div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label className="bold" style={{ fontSize: 13 }}>题目（{form.questions.length}）</label>
            <button className="btn btn-sm btn-soft" onClick={addQuestion}><Plus size={14} /> 添加题目</button>
          </div>
          {form.questions.map((q, i) => (
            <QuestionEditor key={i} q={q} index={i}
              onChange={(nq) => setForm((f) => ({ ...f, questions: f.questions.map((x, j) => j === i ? nq : x) }))}
              onRemove={() => setForm((f) => ({ ...f, questions: f.questions.filter((_, j) => j !== i) }))} />
          ))}
        </>
      )}
    </Modal>
  );
}

function ExamStats({ exam, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api(`/exams/${exam.id}/analytics`).then(setData).catch(() => setData(false)); }, [exam.id]);
  return (
    <Modal title={`${exam.title} · 成绩`} onClose={onClose} wide footer={<button className="btn" onClick={onClose}>关闭</button>}>
      {!data ? <div className="row" style={{ justifyContent: "center", padding: 30 }}><Spinner /></div> : data === false ? <Empty text="无法加载统计" /> : (
        <>
          <div className="row" style={{ gap: 20, justifyContent: "space-around", padding: "8px 0 16px" }}>
            {[["参考人数", data.count], ["平均分", data.count ? data.average.toFixed(1) : 0], ["最高分", data.max], ["最低分", data.min]].map(([k, v]) => (
              <div key={k} style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontWeight: 800 }}>{v}</div><div className="muted small">{k}</div></div>
            ))}
          </div>
          <table className="table">
            <thead><tr><th>用户</th><th>得分</th><th>状态</th><th>提交时间</th></tr></thead>
            <tbody>
              {data.submissions.map((s) => (
                <tr key={s.id}><td>{s.nickname || s.username || `用户 #${s.user_id}`}</td><td>{s.score} / {data.total_score}</td><td>{{ graded: "已批改", submitted: "待批改", ongoing: "进行中" }[s.status] || s.status}</td><td className="muted">{s.submitted_at}</td></tr>
              ))}
              {!data.submissions.length && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 20 }}>暂无提交</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

export default function ExamCenter() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [exams, setExams] = useState(null);
  const [runner, setRunner] = useState(null);
  const [resultId, setResultId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [stats, setStats] = useState(null);
  const [remove, setRemove] = useState(null);

  const load = () => api("/exams").then((r) => setExams(r.exams)).catch((e) => { toast(e.message, "error"); setExams([]); });
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="section-head" style={{ marginTop: 8 }}>
        <div>
          <h2>考试中心</h2>
          <p>参加课程考核测试、在线答题与成绩判定</p>
        </div>
        <div className="spacer" />
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setEditor("new")}><Plus size={15} /> 新增考试</button>}
      </div>

      {!exams ? <div className="row" style={{ justifyContent: "center", padding: 50 }}><Spinner /></div>
        : exams.length === 0 ? <Empty icon={<FileText size={28} />} text="暂无考试" />
          : exams.map((e) => (
            <ExamCard key={e.id} exam={e} admin={isAdmin}
              onStart={(ex) => setRunner(ex.id)}
              onResult={setResultId}
              onEdit={setEditor}
              onDelete={setRemove}
              onStats={setStats} />
          ))}

      {runner && <ExamRunner examId={runner} onClose={() => setRunner(null)} onDone={(r) => { setResultId(r.submission_id); load(); }} />}
      {resultId && <ExamResult submissionId={resultId} onClose={() => setResultId(null)} />}
      {editor && <ExamEditor exam={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={load} />}
      {stats && <ExamStats exam={stats} onClose={() => setStats(null)} />}
      {remove && <Confirm title="删除考试" text={`确定删除「${remove.title}」吗？相关的提交记录也会被删除。`} onClose={() => setRemove(null)} onOk={async () => {
        try { await api(`/exams/${remove.id}`, { method: "DELETE" }); toast("已删除", "ok"); setRemove(null); load(); }
        catch (e) { toast(e.message, "error"); }
      }} />}
    </div>
  );
}
