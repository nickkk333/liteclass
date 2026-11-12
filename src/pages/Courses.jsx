import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Plus, BookOpen, Star } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";
import CourseCard from "../components/CourseCard.jsx";
import CourseForm from "../components/CourseForm.jsx";
import ExamCenter from "../components/ExamCenter.jsx";
import Rooms from "../components/Rooms.jsx";
import { Empty, Spinner } from "../components/ui.jsx";

const TABS = [
  ["all", "全部课程"], ["favorites", "我的收藏"], ["uploads", "我的上传"], ["rooms", "放映大厅"], ["exams", "考试中心"],
];

export default function Courses() {
  const { user, isAdmin, settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab");
  const tab = TABS.some(([k]) => k === rawTab) ? rawTab : "all";
  const setTab = (key) => { setCategory(0); setParams(key === "all" ? {} : { tab: key }, { replace: true }); };
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(0);
  const [categories, setCategories] = useState([]);
  const [courses, setCourses] = useState(null);
  const [create, setCreate] = useState(false);

  useEffect(() => { api("/categories").then(setCategories).catch(() => {}); }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (tab === "favorites" || tab === "uploads") q.set("filter", tab);
    if (category) q.set("category_id", String(category));
    if (search.trim()) q.set("search", search.trim());
    const s = q.toString();
    return s ? `?${s}` : "";
  }, [tab, category, search]);

  const load = () => {
    if (tab === "rooms" || tab === "exams") return;
    setCourses(null);
    api(`/courses${query}`).then(setCourses).catch(() => setCourses([]));
  };

  useEffect(() => { load(); }, [query, tab]);

  useEffect(() => {
    const t = setTimeout(() => { if (courses !== null) load(); }, 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { if (tab === "all") load(); }, [user?.id]);

  const catName = (id) => categories.find((c) => c.id === id)?.name || "未分类";
  const catCount = (id) => {
    if (!courses) return 0;
    return id ? courses.filter((c) => c.category_id === id).length : courses.length;
  };

  const canCreate = isAdmin || settings.allow_course_creation;

  return (
    <div className="page">
      <div className="tab-pills">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setCategory(0); }}>{label}</button>
        ))}
      </div>

      {tab !== "rooms" && tab !== "exams" && (
        <>
          <div className="search-bar">
            <Search size={18} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索课程..." />
          </div>

          <div className="cat-chips">
            <button className={category === 0 ? "active" : ""} onClick={() => setCategory(0)}>全部 ({catCount(0)})</button>
            {categories.map((c) => (
              <button key={c.id} className={category === c.id ? "active" : ""} onClick={() => setCategory(c.id)}>
                {c.name} ({catCount(c.id)})
              </button>
            ))}
          </div>

          {!courses ? (
            <div className="row" style={{ justifyContent: "center", padding: 60 }}><Spinner /></div>
          ) : courses.length === 0 ? (
            <Empty
              icon={tab === "favorites" ? <Star size={28} /> : <BookOpen size={28} />}
              text={tab === "favorites" ? "还没有收藏的课程" : tab === "uploads" ? "你还没有上传课程" : "暂无课程"}
            >
              {canCreate && tab !== "favorites" && (
                <button className="btn btn-primary btn-sm" onClick={() => setCreate(true)}><Plus size={14} /> 新建课程</button>
              )}
            </Empty>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <span className="muted small">共 {courses.length} 门课程</span>
                <div className="grow" />
                {canCreate && <button className="btn btn-sm btn-primary" onClick={() => setCreate(true)}><Plus size={14} /> 新建课程</button>}
              </div>
              <div className="course-grid">
                {courses.map((c) => <CourseCard key={c.id} course={c} categoryName={catName(c.category_id)} />)}
              </div>
            </>
          )}
        </>
      )}

      {tab === "rooms" && <Rooms />}
      {tab === "exams" && <ExamCenter />}

      {create && (
        <CourseForm
          categories={categories}
          onClose={() => setCreate(false)}
          onSaved={() => { setTab("uploads"); load(); }}
        />
      )}
    </div>
  );
}
