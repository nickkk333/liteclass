import { useEffect, useState } from "react";
import { api, fmtDuration, getToken } from "../api.js";

/** 全局投屏条：与 OfflineU 的 CastBar 对应，轮询单会话并接管播放控制。 */
export default function CastBar() {
  const [session, setSession] = useState(null);
  const [seek, setSeek] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) { setSession(null); return undefined; }
    let alive = true;
    let timer = null;
    const poll = async () => {
      try {
        const view = await api("/dlna/session");
        if (!alive) return;
        setSession(view);
        setSeek((current) => Number(view.position) || current || 0);
      } catch (e) { if (e.status === 401 && timer) clearInterval(timer); }
    };
    poll();
    timer = setInterval(poll, 1500);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  if (!session?.active) return null;

  const act = async (action, position = 0) => {
    setError("");
    try {
      const view = await api("/dlna/control", { method: "POST", body: { action, position } });
      setSession(view);
    } catch (e) { setError(e.message); }
  };

  const duration = Number(session.duration) || 0;
  const position = Number(session.position) || 0;

  return (
    <div className="cast-bar">
      <div className="cast-bar-main">
        <span className="cast-bar-icon" aria-hidden="true">▣</span>
        <div className="cast-bar-info">
          <div className="cast-bar-title">
            {session.lesson_title}
            <span className="tag tiny">{session.state === "paused" ? "已暂停" : session.converted ? "兼容转码" : "直接播放"}</span>
          </div>
          <div className="muted tiny">
            {session.device} · {fmtDuration(position)}{duration ? ` / ${fmtDuration(duration)}` : ""}
            {session.next_title ? ` · 下一节：${session.next_title}` : ""}
          </div>
        </div>
        <input
          className="cast-bar-seek" type="range" min="0" max={Math.max(duration, 1)} value={Math.min(seek, Math.max(duration, 1))}
          onChange={(e) => setSeek(Number(e.target.value))}
          onPointerUp={() => act("seek", seek)}
          onKeyUp={() => act("seek", seek)}
          disabled={!duration}
          aria-label="投屏进度"
        />
        <div className="cast-bar-actions">
          <button type="button" className="btn tiny ghost" onClick={() => act(session.state === "playing" ? "pause" : "play")}>
            {session.state === "playing" ? "暂停" : "播放"}
          </button>
          {session.next_material_id ? (
            <button type="button" className="btn tiny ghost" onClick={() => act("next")}>下一节</button>
          ) : null}
          <button type="button" className="btn tiny ghost" onClick={() => act("stop")}>停止</button>
        </div>
      </div>
      {error ? <div className="hint tiny">{error}</div> : null}
    </div>
  );
}
