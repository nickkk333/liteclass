import React, { useEffect, useState } from "react";
import { Pencil, Trash2, Eye, EyeOff, BookOpen } from "lucide-react";
import { api } from "../../api.js";
import { useToast, Confirm, Empty, Spinner } from "../../components/ui.jsx";
import SubHeader from "../../components/SubHeader.jsx";
import CourseForm from "../../components/CourseForm.jsx";

export default function AdminCoursesView({ onBack }) {
  const toast = useToast();
  const [courses, setCourses] = useState(null);
  const [categories, setCategories] = useState([]);
  const [edit, setEdit] = useState(null);
  const [create, setCreate] = useState(false);
  const [remove, setRemove] = useState(null);

  const load = async () => {
    try {
      const [c, cats] = await Promise.all([api("/courses"), api("/categories")]);
      setCourses(c); setCategories(cats);
    } catch (e) { toast(e.message, "error"); setCourses([]); }
  };
  useEffect(() => { load(); }, []);

  const catName = (id) => categories.find((c) => c.id === id)?.name || "未分类";

  return (
    <>
      <SubHeader title="课程列表" onBack={onBack} action={<button className="link small" onClick={() => setCreate(true)}>新增</button>} />
      <div className="page-plain">
        {!courses ? <div className="loading-screen"><Spinner /></div> : courses.length === 0 ? <Empty icon={<BookOpen size={26} />} text="暂无课程" /> : (
          <div className="list-card">
            {courses.map((c) => (
              <div className="list-row" key={c.id}>
                <div className="material-thumb" style={{ width: 44, height: 44, borderRadius: 10 }}>
                  {c.cover_image ? <img src={c.cover_image} alt="" /> : <BookOpen size={18} />}
                </div>
                <div className="grow">
                  <div className="t clamp-2" style={{ lineHeight: 1.4 }}>{c.title}</div>
                  <div className="m">{catName(c.category_id)} · {c.materials_count} 课时 · {c.uploader_name} {c.is_hidden ? "· 已隐藏" : ""}{c.folder_path ? " · 挂载目录" : ""}</div>
                </div>
                <div className="ops">
                  <button className="icon-btn" title={c.is_hidden ? "取消隐藏" : "隐藏"} onClick={async () => {
                    try { await api(`/courses/${c.id}/visibility`, { method: "POST", body: { is_hidden: !c.is_hidden } }); load(); }
                    catch (e) { toast(e.message, "error"); }
                  }}>{c.is_hidden ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                  <button className="icon-btn" onClick={() => setEdit(c)}><Pencil size={15} /></button>
                  <button className="icon-btn" style={{ color: "var(--danger)" }} onClick={() => setRemove(c)}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(edit || create) && (
        <CourseForm
          course={edit}
          categories={categories}
          onClose={() => { setEdit(null); setCreate(false); }}
          onSaved={load}
        />
      )}

      {remove && <Confirm title="删除课程" text={`确定删除「${remove.title}」及其所有章节吗？`} onClose={() => setRemove(null)} onOk={async () => {
        try { await api(`/courses/${remove.id}`, { method: "DELETE" }); toast("已删除", "ok"); setRemove(null); load(); }
        catch (e) { toast(e.message, "error"); }
      }} />}
    </>
  );
}
