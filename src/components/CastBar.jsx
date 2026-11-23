import { useEffect, useMemo, useState } from "react";
import { Ban, Check, Subtitles } from "lucide-react";
import { api, fmtDuration, getToken, subtitleTracks } from "../api.js";

/** 全局投屏条：与 OfflineU 的 CastBar 对应，轮询单会话并接管播放控制。 */
export default function CastBar() {
  const [session, setSession] = useState(null);
  const [seek, setSeek] = useState(0);
  const [error, setError] = useState("");
  const [subMenu, setSubMenu] = useState(false);
  const [tracks, setTracks] = useState(null);
  const [loadingTracks, setLoadingTracks] = useState(false);

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

  const materialId = session?.material_id;

  // 每次打开菜单或切到下一节时重新取一次字幕轨。
  useEffect(() => {
    if (!subMenu || !materialId) return undefined;
    let alive = true;
    setLoadingTracks(true);
    subtitleTracks(materialId)
      .then((data) => { if (alive) setTracks(data || { external: null, embedded: [] }); })
      .catch(() => { if (alive) setTracks({ external: null, embedded: [] }); })
      .finally(() => { if (alive) setLoadingTracks(false); });
    return () => { alive = false; };
  }, [subMenu, materialId]);

  const subtitleOptions = useMemo(() => {
    const list = [];
    if (!tracks) return list;
    if (tracks.external) list.push({ key: "external", label: "外挂字幕", hint: tracks.external.name || "" });
    (tracks.embedded || []).forEach((track, i) => {
      list.push({
        key: `e${track.index}`,
        label: track.title || track.lang || `内嵌字幕 ${i + 1}`,
        hint: track.text ? (track.forced ? "强制" : "") : "图形字幕，暂不支持",
        disabled: !track.text,
      });
    });
    return list;
  }, [tracks]);

  if (!session?.active) return null;

  const act = async (action, position = 0, extra = null) => {
    setError("");
    try {
      const view = await api("/dlna/control", { method: "POST", body: { action, position, ...(extra || {}) } });
      setSession(view);
    } catch (e) { setError(e.message); }
  };

  const duration = Number(session.duration) || 0;
  const position = Number(session.position) || 0;
  const selectedSubtitle = session.subtitle || "auto";
  const pickSubtitle = (key) => {
    setSubMenu(false);
    act("subtitle", 0, { subtitle: key });
  };

  return (
    <div className="cast-bar">
      <div className="cast-bar-main">
        <span className="cast-bar-icon" aria-hidden="true">▣</span>
        <div className="cast-bar-info">
          <div className="cast-bar-title">
            {session.lesson_title}
            {session.state === "paused" ? <span className="tag tiny">已暂停</span> : null}
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
          <div className="mode-wrap">
            <button
              type="button"
              className="btn tiny ghost"
              onClick={() => setSubMenu((open) => !open)}
              title="选择字幕"
              aria-haspopup="menu"
              aria-expanded={subMenu}
            >
              <Subtitles size={13} /> 字幕
            </button>
            {subMenu ? (
              <>
                <div className="mode-backdrop" onClick={() => setSubMenu(false)} />
                <div className="mode-menu subtitle-menu" role="menu" aria-label="投屏字幕">
                  <button
                    type="button" role="menuitemradio" aria-checked={selectedSubtitle === "auto"}
                    className={selectedSubtitle === "auto" ? "active" : ""}
                    onClick={() => pickSubtitle("auto")}
                  >
                    <span>跟随默认</span>
                    {selectedSubtitle === "auto" && <Check size={14} />}
                  </button>
                  <button
                    type="button" role="menuitemradio" aria-checked={selectedSubtitle === "off"}
                    className={selectedSubtitle === "off" ? "active" : ""}
                    disabled={Boolean(session.burned)}
                    title={session.burned ? "烧录字幕模式下不能关闭字幕" : ""}
                    onClick={() => pickSubtitle("off")}
                  >
                    <Ban size={15} />
                    <span>关闭字幕</span>
                    {selectedSubtitle === "off" && <Check size={14} />}
                  </button>
                  {loadingTracks ? <div className="muted small" style={{ padding: "6px 9px" }}>正在读取字幕…</div> : null}
                  {!loadingTracks && !subtitleOptions.length ? (
                    <div className="muted small" style={{ padding: "6px 9px" }}>该章节没有可用字幕</div>
                  ) : null}
                  {subtitleOptions.map((o) => (
                    <button
                      key={o.key} type="button" role="menuitemradio" aria-checked={selectedSubtitle === o.key}
                      className={selectedSubtitle === o.key ? "active" : ""}
                      disabled={o.disabled}
                      title={o.hint || ""}
                      onClick={() => pickSubtitle(o.key)}
                    >
                      <span className="sub-item">
                        <span className="sub-label">{o.label}</span>
                        {o.hint ? <span className="sub-hint">{o.hint}</span> : null}
                      </span>
                      {selectedSubtitle === o.key && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
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
