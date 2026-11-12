import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { History as HistoryIcon, BookOpen, FileWarning } from "lucide-react";
import { api, fmtDateTime } from "../../api.js";
import { useToast, Empty, Spinner } from "../../components/ui.jsx";
import SubHeader from "../../components/SubHeader.jsx";

export default function HistoryView({ onBack }) {
  const toast = useToast();
  const [tab, setTab] = useState("courses");
  const [courses, setCourses] = useState(null);
  const [materials, setMaterials] = useState(null);
  const [notes, setNotes] = useState(null);

  useEffect(() => {
    api("/user/history-courses").then(setCourses).catch(() => setCourses([]));
    api("/user/orphaned-materials").then(setMaterials).catch(() => setMaterials([]));
    api("/user/orphaned-notes").then(setNotes).catch(() => setNotes([]));
  }, []);

  return (
    <>
      <SubHeader title="历史数据" onBack={onBack} />
      <div className="page-plain">
        <div className="sub-tabs">
          <button className={tab === "courses" ? "active" : ""} onClick={() => setTab("courses")}>历史课程</button>
          <button className={tab === "orphaned" ? "active" : ""} onClick={() => setTab("orphaned")}>残留数据</button>
        </div>

        {tab === "courses" ? (
          !courses ? <div className="loading-screen"><Spinner /></div> : courses.length === 0 ? (
            <Empty icon={<HistoryIcon size={26} />} text="暂无历史课程" />
          ) : (
            <div className="list-card">
              {courses.map((c) => (
                <Link className="list-row" key={c.id} to={`/course/${c.id}`}>
                  <div className="material-thumb" style={{ width: 44, height: 44, borderRadius: 10 }}>
                    {c.cover_image ? <img src={c.cover_image} alt="" /> : <BookOpen size={18} />}
                  </div>
                  <div className="grow"><div className="t clamp-2">{c.title}</div><div className="m">{c.materials_count} 课时</div></div>
                </Link>
              ))}
            </div>
          )
        ) : (
          <>
            <p className="muted small" style={{ marginBottom: 12 }}>课程已删除，但您的笔记和资料仍可查看</p>
            {!materials || !notes ? <div className="loading-screen"><Spinner /></div> : (materials.length + notes.length === 0) ? (
              <Empty icon={<FileWarning size={26} />} text="暂无残留数据" />
            ) : (
              <div className="list-card">
                {materials.map((m) => (
                  <div className="list-row" key={`m-${m.id}`}>
                    <div className="grow"><div className="t">{m.title}</div><div className="m">残留资料 · {m.course_title || "课程已删除"}</div></div>
                  </div>
                ))}
                {notes.map((n) => (
                  <div className="list-row" key={`n-${n.id}`}>
                    <div className="grow"><div className="t">{n.content?.slice(0, 40) || "笔记"}</div><div className="m">残留笔记 · {fmtDateTime(n.updated_at)}</div></div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
