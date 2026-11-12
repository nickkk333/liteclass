import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trophy, Eye, EyeOff, Trash2, ChevronRight } from "lucide-react";
import { api, fmtWatch, fmtDateTime } from "../api.js";
import { useAuth } from "../App.jsx";
import { useToast, Empty, Spinner, Avatar, Confirm } from "../components/ui.jsx";
import SubHeader from "../components/SubHeader.jsx";

export default function Ranking() {
  const { isAdmin, settings, setSettings } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [reset, setReset] = useState(false);

  const load = () => api("/watch-ranking?limit=50&offset=0").then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const hide = async () => {
    const next = !settings.show_watch_ranking_on_home;
    try {
      await api("/settings", { method: "PUT", body: { show_watch_ranking_on_home: next } });
      setSettings((s) => ({ ...s, show_watch_ranking_on_home: next }));
      toast(next ? "已显示在首页" : "已从首页隐藏", "ok");
    } catch (e) { toast(e.message, "error"); }
  };

  return (
    <>
      <SubHeader title="观看统计" onBack={() => navigate("/profile")} />
      <div className="page-plain">
        <div className="card" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <Trophy size={20} color="#f59e0b" />
          <span style={{ fontWeight: 700 }}>观看统计</span>
          <div className="grow" />
          {isAdmin && (
            <>
              <button className="btn btn-sm btn-ghost" onClick={hide}>
                {settings.show_watch_ranking_on_home ? <><EyeOff size={14} /> 隐藏</> : <><Eye size={14} /> 显示</>}
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => setReset(true)}><Trash2 size={14} /> 重置</button>
            </>
          )}
        </div>

        <div className="card" style={{ marginTop: 14, overflow: "hidden" }}>
          {!list ? <div className="row" style={{ justifyContent: "center", padding: 50 }}><Spinner /></div>
            : list.length === 0 ? <Empty icon={<Trophy size={28} />} text="暂无观看数据" />
              : (
                <div className="rank-list">
                  {list.map((u) => (
                    <div className="list-row" key={u.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/watch-ranking/user/${u.id}`)}>
                      <span className={`rank-no n${u.rank}`}>{u.rank}</span>
                      <Avatar user={u} size={38} className="rank-avatar" />
                      <div className="grow">
                        <div className="t" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {u.nickname || u.username}
                          {u.level_name && <span className="badge" style={{ color: u.level_color }}>{u.level_name}</span>}
                        </div>
                        <div className="m">总观看 {fmtWatch(u.lifetime_watch_seconds)}</div>
                      </div>
                      <span className="rank-time">{fmtWatch(u.lifetime_watch_seconds)}</span>
                      <ChevronRight size={16} color="var(--muted)" />
                    </div>
                  ))}
                </div>
              )}
        </div>
      </div>

      {reset && (
        <Confirm title="重置观看统计" text="确定将所有用户的观看时长清零吗？此操作不可撤销。" onClose={() => setReset(false)} onOk={async () => {
          try { await api("/watch-ranking/reset", { method: "POST" }); toast("已重置", "ok"); setReset(false); load(); }
          catch (e) { toast(e.message, "error"); }
        }} />
      )}
    </>
  );
}

export function RankingUser() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    api("/watch-ranking?limit=100&offset=0").then((list) => setUser(list.find((u) => u.id === Number(userId)) || null)).catch(() => {});
    api(`/watch-ranking/users/${userId}?limit=100&offset=0`).then(setLogs).catch(() => setLogs([]));
  }, [userId]);

  return (
    <>
      <SubHeader title="观看详情" onBack={() => navigate("/watch-ranking")} />
      <div className="page-plain">
        <div className="card profile-hero" style={{ cursor: "default" }}>
          <Avatar user={user} size={54} />
          <div className="grow">
            <div className="name-line"><h2 style={{ fontSize: 17 }}>{user?.nickname || user?.username || "用户"}</h2>
              {user?.level_name && <span className="badge" style={{ color: user.level_color }}>{user.level_name}</span>}
            </div>
            <div className="sub">累计观看 {fmtWatch(user?.lifetime_watch_seconds || 0)}</div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", fontWeight: 700, borderBottom: "1px solid var(--line)" }}>观看明细</div>
          {!logs ? <div className="row" style={{ justifyContent: "center", padding: 40 }}><Spinner /></div>
            : logs.length === 0 ? <Empty text="暂无观看记录" /> : logs.map((l, i) => (
              <div className="list-row" key={i}>
                <div className="grow">
                  <div className="t">{l.title}</div>
                  <div className="m">{l.course_title} · {l.date}</div>
                </div>
                <span className="muted small">{fmtWatch(l.seconds)}</span>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
