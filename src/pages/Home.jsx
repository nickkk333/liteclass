import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, ChevronLeft, ChevronRight, Clock, Trash2, Play, Music, Trophy, Loader2 } from "lucide-react";
import { api, fmtDuration, todayStr } from "../api.js";
import { useAuth } from "../App.jsx";
import { useToast, Empty, Avatar } from "../components/ui.jsx";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export default function Home() {
  const { user, settings, refreshUser } = useAuth();
  const toast = useToast();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const [days, setDays] = useState([]);
  const [selected, setSelected] = useState(todayStr());
  const [records, setRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [ranking, setRanking] = useState([]);

  const loadCalendar = async (y, m) => {
    try { setDays(await api(`/history/calendar?year=${y}&month=${m}`)); } catch {}
  };
  const loadRecords = async (date) => {
    setLoadingRecords(true);
    try {
      const r = await api(`/history/by-date?date=${date}`);
      setRecords(r.items || []);
    } catch { setRecords([]); }
    setLoadingRecords(false);
  };

  useEffect(() => { refreshUser(); }, []);
  useEffect(() => { loadCalendar(cursor.y, cursor.m); }, [cursor]);
  useEffect(() => { loadRecords(selected); }, [selected]);
  useEffect(() => {
    if (settings.show_watch_ranking_on_home) api("/watch-ranking?limit=5&offset=0").then(setRanking).catch(() => {});
  }, [settings.show_watch_ranking_on_home]);

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m - 1, 1).getDay();
    const total = new Date(cursor.y, cursor.m, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push({ blank: true });
    for (let i = 1; i <= total; i++) cells.push({ d: i, other: false });
    while (cells.length % 7 !== 0) cells.push({ blank: true });
    return cells;
  }, [cursor]);

  const monthStr = `${cursor.y}年${cursor.m}月`;
  const today = todayStr();
  const isCurrentMonth = () => {
    const d = new Date();
    return d.getFullYear() === cursor.y && d.getMonth() + 1 === cursor.m;
  };

  const pickDay = (cell) => {
    if (cell.other) return;
    const date = `${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(cell.d).padStart(2, "0")}`;
    setSelected(date);
  };

  const clear = async () => {
    try {
      await api(`/history/all?date=${selected}`, { method: "DELETE" });
      toast("已清除记录", "ok");
      loadRecords(selected);
      loadCalendar(cursor.y, cursor.m);
    } catch (e) { toast(e.message, "error"); }
  };

  const dayHas = (day) => days.some((d) => d.date === `${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);

  return (
    <div className="page">
      <h1 className="greeting">{user?.greeting_message || "你好，今天又是新的一天！"}</h1>

      <div className="home-grid">
        <div className="card calendar-card">
          <div className="calendar-head">
            <div className="title"><Calendar size={17} /> 学习日历</div>
            <div className="calendar-nav">
              <button onClick={() => setCursor((c) => (c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 }))}><ChevronLeft size={15} /></button>
              <span style={{ minWidth: 68, textAlign: "center" }}>{monthStr}</span>
              <button onClick={() => setCursor((c) => (c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 }))}><ChevronRight size={15} /></button>
            </div>
          </div>
          <div className="calendar-grid">
            {WEEK.map((w) => <div key={w} className="wd">{w}</div>)}
            {grid.map((cell, i) => {
              if (cell.blank) return <div key={i} className="day other" />;
              const date = `${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(cell.d).padStart(2, "0")}`;
              const cls = ["day"];
              if (cell.other) cls.push("other");
              if (date === today) cls.push("today");
              if (!cell.other && dayHas(cell.d)) cls.push("has");
              if (!cell.other && date === selected && date !== today) cls.push("today");
              return <div key={i} className={cls.join(" ")} onClick={() => pickDay(cell)} style={{ cursor: cell.other ? "default" : "pointer" }}>{cell.d}</div>;
            })}
          </div>
        </div>

        <div className="card records-card">
          <div className="records-head">
            <div className="title"><Clock size={17} /> {selected} 的学习记录</div>
            {records.length > 0 && <button className="clear-link" onClick={clear}><Trash2 size={13} /> 清除记录</button>}
          </div>
          {loadingRecords ? (
            <div className="empty"><div className="spinner" /></div>
          ) : records.length === 0 ? (
            <Empty icon={<Clock size={26} />} text="这一天还没有学习记录" />
          ) : (
            records.map((r) => (
              <Link key={`${r.material_id}-${r.date}`} to={`/course/${r.course_id}`} className="record-item">
                <div className="record-thumb">{r.file_type === "audio" ? <Music size={18} /> : <Play size={18} fill="currentColor" />}</div>
                <div className="grow">
                  <div className="t ellipsis">{r.title}</div>
                  <div className="m ellipsis">{r.course_title}</div>
                  <div className="m">已看 {fmtDuration(r.position || r.seconds)}</div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {settings.show_watch_ranking_on_home && (
        <div className="card rank-spot">
          <h3><Trophy size={16} color="#f59e0b" /> 观看排行榜 <Link to="/watch-ranking" className="link small" style={{ marginLeft: "auto" }}>查看全部</Link></h3>
          {ranking.map((u) => (
            <div className="rank-row" key={u.id}>
              <span className={`no ${u.rank <= 3 ? "top" : ""}`}>{u.rank}</span>
              <Avatar user={u} size={26} />
              <span className="grow ellipsis">{u.nickname || u.username}</span>
              <span className="muted small">{fmtDuration(u.lifetime_watch_seconds)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
