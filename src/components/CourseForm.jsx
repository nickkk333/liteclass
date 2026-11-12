import React, { useEffect, useState } from "react";
import { Camera, FolderOpen, HardDrive } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";
import { Modal, Spinner, useToast } from "./ui.jsx";
import FolderPicker from "./FolderPicker.jsx";

export default function CourseForm({ course, categories, onClose, onSaved }) {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [form, setForm] = useState({
    title: course?.title || "",
    description: course?.description || "",
    category_id: course?.category_id || categories[0]?.id || "",
    group_id: course?.group_id || "",
    cover_image: course?.cover_image || "",
    is_materials_shared: course ? course.is_materials_shared !== 0 : true,
    storage: course?.folder_path ? "mount" : "default",
    folder_path: course?.folder_path || "",
  });
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pick, setPick] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api("/admin/course-groups").then(setGroups).catch(() => setGroups([]));
  }, [isAdmin]);

  const uploadCover = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      const r = await api("/upload/cover", { method: "POST", form: fd });
      setForm((f) => ({ ...f, cover_image: r.url }));
    } catch (e) { toast(e.message, "error"); }
    setUploading(false);
  };

  const save = async () => {
    if (!form.title.trim()) return toast("请输入课程标题", "error");
    if (isAdmin && form.storage === "mount" && !form.folder_path.trim()) {
      return toast("请选择或填写挂载路径", "error");
    }
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description,
        category_id: form.category_id || null,
        group_id: form.group_id || null,
        cover_image: form.cover_image,
        is_materials_shared: form.is_materials_shared,
        folder_path: isAdmin && form.storage === "mount" ? form.folder_path.trim() : "",
      };
      const r = course
        ? await api(`/courses/${course.id}`, { method: "PUT", body: payload })
        : await api("/courses", { method: "POST", body: payload });
      const imported = r?.imported ?? r?.scan?.total ?? 0;
      if (course) toast("课程已更新", "ok");
      else toast(imported ? `课程已创建，已导入 ${imported} 个章节` : "课程已创建", "ok");
      onSaved?.();
      onClose();
    } catch (e) { toast(e.message, "error"); }
    setBusy(false);
  };

  return (
    <>
      <Modal
        title={
          <span className="course-form-tabs">
            {course ? "编辑课程" : "新增课程"}
            {!course && (
              <span className="sub" onClick={() => toast("批量导入即将开放", "info")}>批量导入</span>
            )}
          </span>
        }
        onClose={onClose}
        footer={
          <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
            {busy ? "保存中..." : course ? "保存修改" : "确认新增"}
          </button>
        }
      >
        <label className="course-cover-row">
          <div className="course-cover-box">
            {form.cover_image ? <img src={form.cover_image} alt="" /> : uploading ? <Spinner /> : <Camera size={24} />}
          </div>
          <div className="grow">
            <div className="course-cover-title">课程封面</div>
            <div className="muted small">{uploading ? "上传中..." : "点击上传封面图片"}</div>
          </div>
          <input type="file" accept="image/*" hidden onChange={(e) => uploadCover(e.target.files?.[0])} />
        </label>

        <input
          className="input"
          placeholder="课程标题"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />

        <textarea
          className="textarea"
          placeholder="课程简介"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />

        <div className="form-grid-2">
          <div className="field">
            <label>课程分类</label>
            <select className="select" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              {categories.map((c, i) => (
                <option key={c.id} value={c.id}>{c.name}{i === 0 ? "(默认)" : ""}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>课程组</label>
            <select className="select" value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
              <option value="">默认课程组</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={form.is_materials_shared}
            onChange={(e) => setForm({ ...form, is_materials_shared: e.target.checked })}
          />
          上传的资料其它用户是否可见
        </label>

        {isAdmin && (
          <div className="field">
            <label>课程存储路径</label>
            <div className="storage-row">
              <button type="button" className={`storage-card ${form.storage === "default" ? "active" : ""}`}
                onClick={() => setForm({ ...form, storage: "default" })}>
                <span className="radio-dot" /> <HardDrive size={15} /> 默认路径
              </button>
              <button type="button" className={`storage-card ${form.storage === "mount" ? "active" : ""}`}
                onClick={() => setForm({ ...form, storage: "mount" })}>
                <span className="radio-dot" /> <FolderOpen size={15} /> 挂载路径
              </button>
            </div>
            {form.storage === "mount" && (
              <>
                <div className="path-picker">
                  <input
                    className="input"
                    placeholder="例如：/vol1/videos/course1"
                    value={form.folder_path}
                    onChange={(e) => setForm({ ...form, folder_path: e.target.value })}
                  />
                  <button type="button" className="btn" onClick={() => setPick(true)}>
                    <FolderOpen size={15} /> 选择
                  </button>
                </div>
                <span className="hint">
                  从 NAS 挂载目录读取课程文件，{course ? "修改路径后会重新扫描" : "创建后会自动导入该目录下的音视频与文档"}。
                </span>
              </>
            )}
          </div>
        )}
      </Modal>

      {pick && (
        <FolderPicker
          initial={form.folder_path}
          onClose={() => setPick(false)}
          onPick={(path) => setForm((f) => ({ ...f, folder_path: path }))}
        />
      )}
    </>
  );
}
