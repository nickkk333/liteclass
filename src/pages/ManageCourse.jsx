import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Plus, GripVertical, Music, Video, FileText, Pencil, Trash2, UploadCloud,
  CheckSquare, Square, Settings2, X, FolderOpen, Image as ImageIcon,
} from "lucide-react";
import { api, fmtDuration } from "../api.js";
import { useToast, Modal, Confirm, Empty, Spinner } from "../components/ui.jsx";
import CourseForm from "../components/CourseForm.jsx";

const TYPE_LABELS = {
  video: "视频", audio: "音频", image: "图片", pdf: "PDF", html: "网页",
  text: "文本", markdown: "Markdown", office: "Office 文档", other: "文件",
};
const modeOf = (m) => m.preview_mode || m.file_type || "other";
const isTimed = (m) => modeOf(m) === "video" || modeOf(m) === "audio";

export default function ManageCourse() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [course, setCourse] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState(null);
  const [remove, setRemove] = useState(null);
  const [editCourse, setEditCourse] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [upload, setUpload] = useState({ file: null, title: "", duration: 0, busy: false });
  const fileRef = useRef(null);

  const load = async () => {
    try { setCourse(await api(`/courses/${id}`)); }
    catch (e) { toast(e.message, "error"); navigate("/courses"); }
  };
  useEffect(() => { load(); api("/categories").then(setCategories).catch(() => {}); }, [id]);

  const pickFile = (file) => {
    if (!file) return;
    const clean = file.name.replace(/\.[^.]+$/, "");
    setUpload((u) => ({ ...u, file, title: u.title || clean, duration: 0 }));
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith("video/");
    const el = document.createElement(isVideo ? "video" : "audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      setUpload((u) => ({ ...u, duration: Math.round(el.duration || 0) }));
      URL.revokeObjectURL(url);
    };
    el.src = url;
  };

  const doUpload = async () => {
    if (!upload.file) return toast("请选择文件", "error");
    if (!upload.title.trim()) return toast("请输入章节名称", "error");
    setUpload((u) => ({ ...u, busy: true }));
    const fd = new FormData();
    fd.append("file", upload.file);
    fd.append("title", upload.title.trim());
    fd.append("duration", String(upload.duration || 0));
    try {
      await api(`/courses/${id}/materials`, { method: "POST", form: fd });
      toast("章节已添加", "ok");
      setAdd(false);
      setUpload({ file: null, title: "", duration: 0, busy: false });
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e) { toast(e.message, "error"); setUpload((u) => ({ ...u, busy: false })); }
  };

  const doRename = async () => {
    if (!edit?.title?.trim()) return;
    try {
      await api(`/materials/${edit.id}`, { method: "PUT", body: { title: edit.title } });
      setEdit(null);
      toast("已修改", "ok");
      load();
    } catch (e) { toast(e.message, "error"); }
  };

  const doDelete = async (target) => {
    try {
      if (target === "batch") {
        for (const mid of selected) await api(`/materials/${mid}`, { method: "DELETE" });
        setSelected([]); setSelecting(false);
        toast("已删除所选章节", "ok");
      } else {
        await api(`/materials/${target.id}`, { method: "DELETE" });
        toast("已删除", "ok");
      }
      setRemove(null);
      load();
    } catch (e) { toast(e.message, "error"); }
  };

  const rescan = async () => {
    setScanning(true);
    try {
      const r = await api(`/courses/${id}/scan`, { method: "POST" });
      toast(`扫描完成：新增 ${r.added} 个，移除 ${r.removed} 个，共 ${r.total} 个章节`, "ok");
      load();
    } catch (e) { toast(e.message, "error"); }
    setScanning(false);
  };

  if (!course) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <>
      <header className="app-header">
        <div className="head-side"><button className="icon-btn" onClick={() => navigate(`/course/${id}`)}><ArrowLeft size={19} /></button></div>
        <div className="head-title">章节管理</div>
        <div className="head-actions">
          <button className="link small" onClick={() => { setSelecting((s) => !s); setSelected([]); }}>{selecting ? "取消" : "选择"}</button>
        </div>
      </header>

      <div className="page-plain" style={{ paddingBottom: 100 }}>
        <div className="manage-head-card">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="grow">
              <h1 style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.45 }}>{course.title}</h1>
              <p className="muted small" style={{ marginTop: 6 }}>{course.materials.length} 个章节 · {course.category_name}</p>
            </div>
            <button className="icon-btn" onClick={() => setEditCourse(true)} title="课程信息"><Settings2 size={17} /></button>
          </div>
          {course.folder_path && (
            <div className="mount-path-row">
              <FolderOpen size={14} />
              <span className="ellipsis" title={course.folder_path}>{course.folder_path}</span>
              <button className="link small" disabled={scanning} onClick={rescan}>
                {scanning ? "扫描中..." : "重新扫描"}
              </button>
            </div>
          )}
        </div>

        {selecting && (
          <div className="row" style={{ marginBottom: 10, padding: "0 4px" }}>
            <button className="link small" onClick={() => setSelected(selected.length === course.materials.length ? [] : course.materials.map((m) => m.id))}>
              {selected.length === course.materials.length ? "取消全选" : "全选"}
            </button>
            <div className="grow" />
            <span className="muted small">已选 {selected.length}</span>
            <button className="btn btn-sm btn-danger" disabled={!selected.length} onClick={() => setRemove("batch")}>删除</button>
          </div>
        )}

        {course.materials.length === 0 ? <Empty icon={<FileText size={26} />} text="还没有章节，点击右下角添加" /> : course.materials.map((m, idx) => (
          <div className="manage-item" key={m.id} onClick={() => {
            if (!selecting) return;
            setSelected((s) => s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]);
          }}>
            {selecting ? (
              selected.includes(m.id) ? <CheckSquare size={18} color="var(--primary)" /> : <Square size={18} color="var(--muted)" />
            ) : <GripVertical size={16} className="handle" />}
            <div className="material-thumb" style={{ width: 34, height: 34 }}>
              {modeOf(m) === "video" ? <Video size={15} /> : modeOf(m) === "audio" ? <Music size={15} /> : modeOf(m) === "image" ? <ImageIcon size={15} /> : <FileText size={15} />}
            </div>
            <div className="grow">
              <div className="mtitle ellipsis">{m.title}{m.file_ext ? <span className="file-ext">{m.file_ext}</span> : null}</div>
              <div className="dur">
                {isTimed(m) ? (Number(m.duration) > 0 ? fmtDuration(m.duration) : "时长未知") : TYPE_LABELS[modeOf(m)] || "文件"}
                {` · ${TYPE_LABELS[modeOf(m)] || "文件"}`}
                {isTimed(m) && m.position ? ` · 已观看 ${fmtDuration(m.position)}` : ""}
                {m.has_subtitle ? " · 含字幕" : ""}
              </div>
            </div>
            {!selecting && (
              <>
                <button className="icon-btn primary" onClick={(e) => { e.stopPropagation(); setEdit(m); }}><Pencil size={15} /></button>
                <button className="icon-btn" style={{ color: "var(--danger)" }} onClick={(e) => { e.stopPropagation(); setRemove(m); }}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        ))}
      </div>

      <button className="float-add" onClick={() => setAdd(true)}><Plus size={24} /></button>

      {add && (
        <Modal title="添加章节" onClose={() => setAdd(false)} footer={<>
          <button className="btn" onClick={() => setAdd(false)}>取消</button>
          <button className="btn btn-primary" onClick={doUpload} disabled={upload.busy}>{upload.busy ? "上传中..." : "添加"}</button>
        </>}>
          <label className="cover-upload" style={{ cursor: "pointer", border: "1px dashed var(--border)", borderRadius: 12, padding: 16, justifyContent: "center" }}>
            <UploadCloud size={24} color="var(--muted)" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{upload.file ? upload.file.name : "点击选择音视频 / 文档文件"}</div>
              <div className="muted small">{upload.file ? `${(upload.file.size / 1024 / 1024).toFixed(1)} MB` : "支持 MP4、MP3、WAV、PDF 等格式"}</div>
            </div>
            <input ref={fileRef} type="file" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>
          <div className="field"><label>章节名称</label><input className="input" value={upload.title} onChange={(e) => setUpload({ ...upload, title: e.target.value })} /></div>
          <div className="field"><label>时长（秒）</label><input className="input" type="number" value={upload.duration} onChange={(e) => setUpload({ ...upload, duration: Number(e.target.value) })} /></div>
        </Modal>
      )}

      {edit && (
        <Modal title="重命名章节" onClose={() => setEdit(null)} footer={<>
          <button className="btn" onClick={() => setEdit(null)}>取消</button>
          <button className="btn btn-primary" onClick={doRename}>保存</button>
        </>}>
          <input className="input" autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <p className="muted small">时长 {fmtDuration(edit.duration)}</p>
        </Modal>
      )}

      {remove && (
        <Confirm
          title={remove === "batch" ? "删除所选章节" : "删除章节"}
          text={remove === "batch" ? `确定删除所选的 ${selected.length} 个章节吗？` : `确定删除「${remove.title}」吗？`}
          onClose={() => setRemove(null)}
          onOk={() => doDelete(remove)}
        />
      )}

      {editCourse && (
        <CourseForm course={course} categories={categories} onClose={() => setEditCourse(false)} onSaved={load} />
      )}
    </>
  );
}
