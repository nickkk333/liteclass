import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Heart, Settings2, Play, Pause, SkipBack, SkipForward, SquarePlay,
  Volume2, VolumeX, Repeat1, Maximize, ListVideo, StickyNote, FolderOpen, MessageCircle,
  Music, FileText, Video, Trash2, Send, Clock, Download, Pencil, CornerDownRight,
  PanelRight, X, ListMusic, PauseCircle, CheckCircle2, Minimize, Check,
  Image as ImageIcon, ExternalLink,
} from "lucide-react";
import { api, fmtDuration, fmtDateTime, streamUrl, previewUrl, subtitleUrl } from "../api.js";
import { useAuth } from "../App.jsx";
import { useToast, Empty, Avatar, Modal, Confirm, Spinner } from "../components/ui.jsx";
import usePlaybackSource from "../hooks/usePlaybackSource.js";
import CastMenu from "../components/CastMenu.jsx";

const TABS = [
  ["list", "目录", ListVideo],
  ["notes", "笔记", StickyNote],
  ["files", "资料", FolderOpen],
  ["chat", "讨论", MessageCircle],
];

const PLAY_MODES = [
  ["sequence", "顺序播放", ListMusic],
  ["loop", "单曲循环", Repeat1],
  ["single", "播完暂停", PauseCircle],
];
const PLAY_MODE_KEY = "liteclass.playMode";

const TIMED_MODES = new Set(["video", "audio"]);
const DOC_MODES = new Set(["pdf", "html", "text", "markdown", "office"]);
const MODE_LABELS = {
  video: "视频", audio: "音频", image: "图片", pdf: "PDF",
  html: "网页", text: "文本", markdown: "Markdown", office: "Office 文档", other: "文件",
};

/** 章节的展示方式，服务端已按扩展名算好（preview_mode） */
const mediaModeOf = (m) => {
  if (!m) return "other";
  if (m.preview_mode) return m.preview_mode;
  if (TIMED_MODES.has(m.file_type) || DOC_MODES.has(m.file_type)) return m.file_type;
  return "other";
};

function FileIcon({ type, size = 16 }) {
  if (type === "video") return <Video size={size} />;
  if (type === "audio") return <Music size={size} />;
  if (type === "image") return <ImageIcon size={size} />;
  return <FileText size={size} />;
}

export default function CourseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const toast = useToast();

  const [course, setCourse] = useState(null);
  const [tab, setTab] = useState("list");
  const [currentId, setCurrentId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [mode, setMode] = useState(() => {
    const saved = localStorage.getItem(PLAY_MODE_KEY);
    return PLAY_MODES.some(([key]) => key === saved) ? saved : "sequence";
  });
  const [notes, setNotes] = useState([]);
  const [discussions, setDiscussions] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [chatText, setChatText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [showNoteCompose, setShowNoteCompose] = useState(false);
  const [withTimestamp, setWithTimestamp] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [fauxFull, setFauxFull] = useState(false);
  const [modeMenu, setModeMenu] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);

  const audioRef = useRef(null);
  const playerRef = useRef(null);
  const lastReport = useRef(0);
  const stateRef = useRef({ currentId, playing, time });
  const playingRef = useRef(false);
  playingRef.current = playing;

  const current = useMemo(() => course?.materials?.find((m) => m.id === currentId) || null, [course, currentId]);
  const currentIndex = useMemo(() => course?.materials?.findIndex((m) => m.id === currentId) ?? -1, [course, currentId]);
  const mediaMode = mediaModeOf(current);
  const timed = TIMED_MODES.has(mediaMode);
  const ModeIcon = PLAY_MODES.find(([key]) => key === mode)?.[2] || ListMusic;
  const modeLabel = PLAY_MODES.find(([key]) => key === mode)?.[1] || "顺序播放";
  const fullActive = isFull || fauxFull;
  const playback = usePlaybackSource({
    mediaRef: audioRef,
    materialId: current?.id,
    enabled: timed,
    streamUrl: current ? streamUrl(current.id) : "",
    autoPlayRef: playingRef,
  });

  const load = async () => {
    const c = await api(`/courses/${id}`);
    setCourse(c);
    if (!currentId) {
      const resume = c.materials.find((m) => m.position > 0 && !m.completed) || c.materials[0];
      setCurrentId(resume?.id ?? null);
    }
  };

  useEffect(() => {
    load().catch((e) => { toast(e.message, "error"); navigate("/courses"); });
    api(`/notes?course_id=${id}`).then(setNotes).catch(() => {});
    api(`/courses/${id}/discussions`).then(setDiscussions).catch(() => {});
  }, [id]);

  useEffect(() => {
    stateRef.current = { currentId, playing, time };
  }, [currentId, playing, time]);

  const report = (materialId, position, dur) => {
    if (!materialId) return;
    api("/progress", { method: "POST", body: { material_id: materialId, position, duration: dur } }).catch(() => {});
    setCourse((c) => c ? {
      ...c,
      materials: c.materials.map((m) => m.id === materialId ? { ...m, position: Math.max(m.position || 0, position), completed: dur > 0 && position >= dur * 0.95 ? 1 : m.completed } : m),
    } : c);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      const el = audioRef.current;
      const { currentId, playing } = stateRef.current;
      if (el && playing && currentId && el.currentTime > lastReport.current + 4) {
        lastReport.current = el.currentTime;
        report(currentId, el.currentTime, el.duration || 0);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onUnload = () => {
      const el = audioRef.current;
      const { currentId, playing } = stateRef.current;
      if (el && playing && currentId) report(currentId, el.currentTime, el.duration || 0);
    };
    window.addEventListener("pagehide", onUnload);
    return () => { window.removeEventListener("pagehide", onUnload); onUnload(); };
  }, []);

  // 全屏状态同步（含 Safari / WebView 前缀）
  useEffect(() => {
    const sync = () => {
      const native = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFull(native);
      if (native) setFauxFull(false);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  // 浏览器不支持全屏 API 时（iPhone / 部分 WebView）用 CSS 伪全屏兜底
  useEffect(() => {
    if (!fauxFull) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setFauxFull(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fauxFull]);

  const toggleFullscreen = async () => {
    const card = playerRef.current;
    const docFull = document.fullscreenElement || document.webkitFullscreenElement;
    if (docFull) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { await exit?.call(document); } catch {}
      return;
    }
    if (fauxFull) { setFauxFull(false); return; }

    // 1) 原生元素全屏（桌面浏览器）。部分环境返回的 Promise 会一直挂起，用超时兜底
    const request = card?.requestFullscreen || card?.webkitRequestFullscreen || card?.msRequestFullscreen;
    if (card && request) {
      try {
        const pending = request.call(card);
        if (pending && typeof pending.then === "function") {
          await Promise.race([
            pending.catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 800)),
          ]);
        }
      } catch {}
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
    }

    // 2) iPhone Safari：普通元素不支持全屏，退回视频原生全屏
    const video = card?.querySelector("video");
    if (video?.webkitEnterFullscreen) {
      try { video.webkitEnterFullscreen(); return; } catch {}
    }

    // 3) 最后的兜底：CSS 伪全屏，任何环境都能铺满屏幕
    setFauxFull(true);
  };

  // 自动播放被浏览器拦截时给出可感知的提示
  const safePlay = (el) => {
    if (!el) return;
    el.play().then(() => setPlaying(true)).catch(() => {
      setPlaying(false);
      toast("浏览器阻止了自动播放，请点击播放继续", "error");
    });
  };

  const selectMaterial = (m) => {
    if (!m) return;
    const el = audioRef.current;
    if (el && currentId && playing) report(currentId, el.currentTime, el.duration || 0);
    lastReport.current = 0;
    const nextMode = mediaModeOf(m);
    const isTimed = TIMED_MODES.has(nextMode);
    setCurrentId(m.id);
    setPlaying(isTimed);
    setTime(0);
    setDuration(isTimed ? (m.duration || 0) : 0);
    setMediaFailed(false);
    // 文档、图片、PDF 没有播放进度：打开即记录为已学完
    if (!isTimed) report(m.id, 1, 1);
  };

  const onLoadedMetadata = () => {
    const el = audioRef.current;
    if (!el || !current) return;
    setDuration(el.duration || current.duration || 0);
    const resume = current.position > 5 && (!el.duration || current.position < el.duration - 5) ? current.position : 0;
    if (resume) el.currentTime = resume;
    el.volume = volume;
    el.playbackRate = rate;
    el.loop = false;
    if (stateRef.current.playing) safePlay(el);
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el || !current) return;
    if (el.paused) { el.play().catch(() => {}); setPlaying(true); }
    else { el.pause(); setPlaying(false); if (current) report(current.id, el.currentTime, el.duration || 0); }
  };

  const seek = (value) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Number(value);
    setTime(Number(value));
  };

  const prev = () => { if (currentIndex > 0) selectMaterial(course.materials[currentIndex - 1]); };
  const next = () => { if (currentIndex < course.materials.length - 1) selectMaterial(course.materials[currentIndex + 1]); };

  const applyMode = (value) => {
    const [, label] = PLAY_MODES.find(([key]) => key === value) || PLAY_MODES[0];
    setMode(value);
    setModeMenu(false);
    localStorage.setItem(PLAY_MODE_KEY, value);
    if (audioRef.current) audioRef.current.loop = false;
    toast(`播放模式：${label}`, "ok");
  };

  // 播放结束：记录完成，并按当前播放模式续播 / 重播 / 停止
  const handleEnded = (el) => {
    setPlaying(false);
    lastReport.current = 0;
    if (!current) return;
    const total = Number(el?.duration) || Number(current.duration) || 0;
    report(current.id, total, total);

    if (mode === "loop") {
      if (el) {
        el.currentTime = 0;
        safePlay(el);
      } else {
        setPlaying(true);
      }
      return;
    }
    if (mode === "sequence" && currentIndex >= 0 && currentIndex < course.materials.length - 1) {
      next();
    }
  };

  const cycleRate = () => {
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const nextRate = rates[(rates.indexOf(rate) + 1) % rates.length];
    setRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  const toggleMute = () => {
    const el = audioRef.current;
    if (!el) return;
    const m = !muted;
    setMuted(m);
    el.muted = m;
  };

  const toggleFavorite = async () => {
    try {
      const r = await api(`/courses/${id}/favorite`, { method: "POST" });
      setCourse((c) => ({ ...c, is_favorited: r.is_favorited }));
      toast(r.is_favorited ? "已收藏" : "已取消收藏", "ok");
    } catch (e) { toast(e.message, "error"); }
  };

  const exportNotes = () => {
    if (!notes.length) { toast("还没有笔记可以导出", "error"); return; }
    const lines = [`# ${course.title} · 学习笔记`, ""];
    notes.forEach((n) => {
      const m = course.materials.find((x) => x.id === n.material_id);
      lines.push(`## ${n.content.slice(0, 40)}`);
      lines.push(`- 章节：${m?.title || "课程笔记"}`);
      if (n.timestamp_seconds != null) lines.push(`- 时间点：${fmtDuration(n.timestamp_seconds)}`);
      lines.push(`- 更新：${fmtDateTime(n.updated_at)}`);
      lines.push("", n.content, "");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${course.title}-笔记.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast("笔记已导出", "ok");
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    try {
      const n = await api("/notes", { method: "POST", body: {
        course_id: Number(id), material_id: current?.id, content: noteText,
        timestamp_seconds: withTimestamp && current ? Math.floor(time) : null,
      } });
      setNotes((list) => [n, ...list]);
      setNoteText("");
      setShowNoteCompose(false);
      toast("笔记已保存", "ok");
    } catch (e) { toast(e.message, "error"); }
  };

  const removeNote = async (noteId) => {
    try {
      await api(`/notes/${noteId}`, { method: "DELETE" });
      setNotes((list) => list.filter((n) => n.id !== noteId));
      toast("已删除", "ok");
    } catch (e) { toast(e.message, "error"); }
  };

  const sendMessage = async () => {
    if (!chatText.trim()) return;
    try {
      const d = await api(`/courses/${id}/discussions`, { method: "POST", body: { content: chatText, parent_id: replyTo?.id ?? null } });
      setDiscussions((list) => [...list, d]);
      setChatText("");
      setReplyTo(null);
    } catch (e) { toast(e.message, "error"); }
  };

  if (!course) return <div className="loading-screen"><div className="spinner" /></div>;

  const topNotes = discussions.filter((d) => !d.parent_id);
  const repliesOf = (pid) => discussions.filter((d) => d.parent_id === pid);

  return (
    <>
      <header className="app-header">
        <div className="head-side">
          <button className="icon-btn" onClick={() => navigate("/courses")}><ArrowLeft size={19} /></button>
        </div>
        <div className="head-title">{course.title}</div>
        <div className="head-actions">
          <button
            className={`icon-btn ${sideOpen ? "primary" : ""}`}
            title={sideOpen ? "隐藏侧栏" : "显示目录与讨论"}
            onClick={() => setSideOpen((v) => !v)}
          >
            <PanelRight size={17} />
          </button>
          <CastMenu material={current} mode={mediaMode} />
          <button className="icon-btn" title="发起一起看" onClick={() => navigate("/courses?tab=rooms")}><SquarePlay size={17} /></button>
          <button className="icon-btn" title="导出笔记" onClick={exportNotes}><Download size={17} /></button>
          <button className={`icon-btn ${course.is_favorited ? "primary" : ""}`} title="收藏" onClick={toggleFavorite}>
            <Heart size={17} fill={course.is_favorited ? "currentColor" : "none"} />
          </button>
          {course.can_manage && <button className="icon-btn" title="管理" onClick={() => navigate(`/course/${id}/manage`)}><Settings2 size={17} /></button>}
        </div>
      </header>

      <div className="page-plain">
        <div className={`course-layout ${sideOpen ? "side-open" : ""}`}>
          <div className={`player-card ${fauxFull ? "is-faux-full" : ""}`} ref={playerRef}>
            {mediaMode === "video" && current && (
              <div className="player-stage video">
                <video
                  key={playback.elementKey}
                  ref={audioRef}
                  src={playback.src}
                  controls
                  onLoadedMetadata={onLoadedMetadata}
                  onTimeUpdate={(e) => setTime(e.target.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={(e) => handleEnded(e.currentTarget)}
                  onError={() => setMediaFailed(true)}
                >
                  {current.has_subtitle ? (
                    <track kind="subtitles" src={subtitleUrl(current.id)} srcLang="zh" label="字幕" default />
                  ) : null}
                </video>
                {playback.preparing && (
                  <div className="media-preparing">
                    <Spinner /> 正在准备可播版本（{playback.mode === "hls" ? "HLS 分片" : "MP4 重封装"}）…
                  </div>
                )}
                {playback.error ? <div className="media-error">{playback.error}</div> : null}
                {mediaFailed && (
                  <div className="media-error">
                    <span>浏览器无法直接播放该格式，可下载后用本地播放器打开</span>
                    <a className="btn btn-sm" href={`${streamUrl(current.id)}&download=1`} download><Download size={14} /> 下载后播放</a>
                  </div>
                )}
                <button className="player-fullscreen" title={fullActive ? "退出全屏" : "全屏"} onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>
                  {fullActive ? <Minimize size={16} /> : <Maximize size={16} />}
                </button>
              </div>
            )}

            {mediaMode === "audio" && (
              <div className="player-stage" onClick={(e) => { if (!e.target.closest("button")) togglePlay(); }}>
                {course.cover_image
                  ? <div className="player-cover-wrap">
                    <img className="player-cover" src={course.cover_image} alt="" />
                    {playing ? <div className="player-bars">{[...Array(5)].map((_, c) => (
                      <span key={c} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {[...Array(9)].map((_, r) => <i key={r} style={{ animationDelay: `${(c * 7 + r * 3) % 12 / 10}s` }} />)}
                      </span>
                    ))}</div> : (
                      <button className="stage-play" onClick={togglePlay} aria-label="播放">
                        <Play size={28} fill="currentColor" style={{ marginLeft: 3 }} />
                      </button>
                    )}
                  </div>
                  : <div className="player-fallback"><Music size={52} /></div>}
                <div className="player-meta">
                  <h2>{current.title.replace(/\.(wav|mp3|m4a|flac|aac|ogg)$/i, "")}{current.file_ext ? <span className="file-ext">{current.file_ext}</span> : null}</h2>
                  <p>{course.uploader_name} · {fmtDuration(duration || current.duration)}</p>
                </div>
                {playback.preparing ? <div className="subtitle-hint small muted">正在准备可播音源…</div> : null}
                {playback.error ? <div className="subtitle-hint small">{playback.error}</div> : null}
                {(mediaFailed || current.has_subtitle) && (
                  <div className="subtitle-hint small muted">
                    <FileText size={13} /> {mediaFailed ? "浏览器无法播放该音频，可下载后播放" : "本音频包含字幕"}
                  </div>
                )}
                <button className="player-fullscreen" title={fullActive ? "退出全屏" : "全屏"} onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>
                  {fullActive ? <Minimize size={16} /> : <Maximize size={16} />}
                </button>
              </div>
            )}

            {mediaMode === "image" && current && (
              <div className="player-stage image">
                <a className="player-image-wrap" href={streamUrl(current.id)} target="_blank" rel="noreferrer" title="查看原图">
                  <img className="player-image" src={streamUrl(current.id)} alt={current.title} />
                </a>
                <div className="player-meta">
                  <h2>{current.title}</h2>
                  <p>{course.uploader_name} · {MODE_LABELS.image}</p>
                </div>
                <button className="player-fullscreen" title={fullActive ? "退出全屏" : "全屏"} onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>
                  {fullActive ? <Minimize size={16} /> : <Maximize size={16} />}
                </button>
              </div>
            )}

            {DOC_MODES.has(mediaMode) && current && (
              <div className="doc-stage">
                <iframe
                  key={`${current.id}-${mediaMode}`}
                  className="doc-iframe"
                  src={mediaMode === "pdf" ? streamUrl(current.id) : previewUrl(current.id)}
                  title={current.title}
                  sandbox={mediaMode === "pdf" ? undefined : "allow-same-origin"}
                />
                <div className="doc-stage-bar">
                  <span className="kind-tag">{MODE_LABELS[mediaMode]}</span>
                  <a className="doc-open" href={mediaMode === "pdf" ? streamUrl(current.id) : previewUrl(current.id)} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> 新窗口打开
                  </a>
                </div>
              </div>
            )}

            {mediaMode === "other" && (
              <div className="player-stage doc-fallback">
                <FileText size={46} />
                <div className="player-meta">
                  <h2>{current?.title || "该课程还没有章节"}</h2>
                  {current && <p className="small muted">该格式暂不支持在线预览，可下载后查看</p>}
                </div>
                {current && (
                  <a className="btn btn-sm" href={`${streamUrl(current.id)}&download=1`} download>
                    <Download size={14} /> 下载原文件
                  </a>
                )}
                {current && (
                  <button className="player-fullscreen" title={fullActive ? "退出全屏" : "全屏"} onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>
                    {fullActive ? <Minimize size={16} /> : <Maximize size={16} />}
                  </button>
                )}
              </div>
            )}

            {timed && (
            <div className="player-controls">
              <div className="player-toolbar">
                <div className="player-buttons">
                  <button className="icon-btn" onClick={prev} disabled={currentIndex <= 0}><SkipBack size={17} /></button>
                  <button className="play-main" onClick={togglePlay}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" style={{ marginLeft: 2 }} />}</button>
                  <button className="icon-btn" onClick={next} disabled={currentIndex >= course.materials.length - 1}><SkipForward size={17} /></button>
                </div>
                <div className="now ellipsis">{current?.title || "未选择章节"}</div>
              </div>
              <input
                className="seek-input"
                type="range"
                min={0}
                max={duration || current?.duration || 0}
                step={0.1}
                value={Math.min(time, duration || current?.duration || 0)}
                onChange={(e) => seek(e.target.value)}
              />
              <div className="player-toolbar">
                <div className="player-times" style={{ flex: 1, justifyContent: "flex-start" }}>
                  <span>{fmtDuration(time)} / {fmtDuration(duration || current?.duration || 0)}</span>
                </div>
                <div className="volume-group">
                  <button className="icon-btn" onClick={toggleMute}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
                  <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => {
                    const v = Number(e.target.value); setVolume(v); if (audioRef.current) audioRef.current.volume = v; if (v > 0 && muted) { setMuted(false); if (audioRef.current) audioRef.current.muted = false; }
                  }} />
                  <button className="rate-btn" onClick={cycleRate}>{rate}x</button>
                  <div className="mode-wrap">
                    <button
                      type="button"
                      className={`mode-btn ${mode !== "sequence" ? "active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); setModeMenu((v) => !v); }}
                      title="选择播放结束后的行为"
                      aria-label={`播放模式：${modeLabel}`}
                      aria-expanded={modeMenu}
                    >
                      <ModeIcon size={14} />
                      <span className="mode-label">{modeLabel}</span>
                    </button>
                    {modeMenu && (
                      <>
                        <div className="mode-backdrop" onClick={() => setModeMenu(false)} />
                        <div className="mode-menu" role="menu">
                          {PLAY_MODES.map(([key, label, Icon]) => (
                            <button
                              key={key}
                              type="button"
                              role="menuitemradio"
                              aria-checked={key === mode}
                              className={key === mode ? "active" : ""}
                              onClick={(e) => { e.stopPropagation(); applyMode(key); }}
                            >
                              <Icon size={15} />
                              <span>{label}</span>
                              {key === mode && <Check size={14} />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            )}

            {!timed && current && (
              <div className="player-controls doc-controls">
                <div className="player-toolbar">
                  <div className="player-buttons">
                    <button className="icon-btn" onClick={prev} disabled={currentIndex <= 0} title="上一章"><SkipBack size={17} /></button>
                    <button className="icon-btn" onClick={next} disabled={currentIndex >= course.materials.length - 1} title="下一章"><SkipForward size={17} /></button>
                  </div>
                  <div className="now ellipsis">{current.title}</div>
                  <div className="player-buttons">
                    <a className="icon-btn" href={`${streamUrl(current.id)}&download=1`} download title="下载原文件"><Download size={16} /></a>
                    <button className="icon-btn" onClick={toggleFullscreen} title={fullActive ? "退出全屏" : "全屏"}>
                      {fullActive ? <Minimize size={16} /> : <Maximize size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mediaMode === "audio" && current && (
              <audio
                key={playback.elementKey}
                ref={audioRef}
                src={playback.src}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={(e) => setTime(e.target.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => {
                  setPlaying(false);
                  const el = audioRef.current;
                  if (el) report(current.id, el.currentTime, el.duration || 0);
                }}
                onEnded={() => handleEnded(audioRef.current)}
                onError={() => setMediaFailed(true)}
              >
                {current.has_subtitle ? (
                  <track kind="subtitles" src={subtitleUrl(current.id)} srcLang="zh" label="字幕" default />
                ) : null}
              </audio>
            )}
          </div>

          {sideOpen && (
          <div className="side-panel">
            <div className="panel-tabs">
              {TABS.map(([key, label, Icon]) => (
                <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon size={13} /> {label}</button>
              ))}
              <button className="panel-close" title="隐藏侧栏" onClick={() => setSideOpen(false)}><X size={14} /></button>
            </div>

            <div className="panel-body">
              {tab === "list" && (
                course.materials.length === 0
                  ? <Empty icon={<ListVideo size={26} />} text="暂无章节" />
                  : course.materials.map((m, idx) => (
                    <div key={m.id} className={`material-row ${m.id === currentId ? "active" : ""}`} onClick={() => selectMaterial(m)}>
                      <div className="material-thumb"><FileIcon type={mediaModeOf(m)} /></div>
                      <div className="material-info">
                        <div className="t clamp-2">{m.title}{m.file_ext ? <span className="file-ext">{m.file_ext}</span> : null}</div>
                        <div className="m">
                          {MODE_LABELS[mediaModeOf(m)] || "文件"}
                          {TIMED_MODES.has(mediaModeOf(m)) && ` · 时长 ${Number(m.duration) > 0 ? fmtDuration(m.duration) : "未知"}`}
                          {TIMED_MODES.has(mediaModeOf(m)) && m.position > 0 ? ` · 已观看 ${fmtDuration(m.position)}` : ""}
                          {m.has_subtitle ? " · 含字幕" : ""}
                        </div>
                      </div>
                      {m.completed
                        ? <CheckCircle2 size={17} color="var(--success)" title="已完成" />
                        : <span className="kind">{String(idx + 1).padStart(3, "0")}</span>}
                    </div>
                  ))
              )}

              {tab === "notes" && (
                <>
                  <div className="note-compose">
                    {showNoteCompose ? (
                      <>
                        <textarea autoFocus placeholder="记点什么…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                        <div className="actions">
                          <label className="small muted row" style={{ gap: 5 }}>
                            <input type="checkbox" checked={withTimestamp} onChange={(e) => setWithTimestamp(e.target.checked)} />
                            记录当前时间 {current ? fmtDuration(time) : ""}
                          </label>
                          <button className="btn btn-sm" onClick={() => { setShowNoteCompose(false); setNoteText(""); }}>取消</button>
                          <button className="btn btn-sm btn-primary" onClick={saveNote}>保存</button>
                        </div>
                      </>
                    ) : (
                      <button className="row" style={{ width: "100%", gap: 8, color: "var(--muted)", fontSize: 13 }} onClick={() => setShowNoteCompose(true)}>
                        <Pencil size={14} /> 添加笔记{current ? `（${fmtDuration(time)}）` : ""}…
                      </button>
                    )}
                  </div>
                  {notes.length === 0 ? <Empty icon={<StickyNote size={24} />} text="还没有笔记" /> : notes.map((n) => (
                    <div className="note-item" key={n.id}>
                      <div className="who">
                        <Avatar user={{ name: n.user_name || user?.nickname }} size={20} />
                        <span>{n.user_name || user?.nickname}</span>
                        {n.timestamp_seconds != null && (
                          <button className="time-chip" onClick={() => { const m = course.materials.find((x) => x.id === n.material_id); if (m) selectMaterial(m); setTimeout(() => seek(n.timestamp_seconds), 400); }}>
                            {fmtDuration(n.timestamp_seconds)}
                          </button>
                        )}
                        <span style={{ marginLeft: "auto" }}>{fmtDateTime(n.updated_at)}</span>
                      </div>
                      <div className="content">{n.content}</div>
                      {n.user_id === user?.id && <div className="ops"><button onClick={() => removeNote(n.id)}>删除</button></div>}
                    </div>
                  ))}
                </>
              )}

              {tab === "files" && (
                <>
                  <div className="doc-toolbar"><FileText size={14} /><span className="small muted">共 {course.materials.length} 个文件</span></div>
                  {course.materials.length === 0 ? <Empty icon={<FolderOpen size={24} />} text="暂无资料" /> : course.materials.map((m) => (
                    <div className="material-row" key={m.id} onClick={() => selectMaterial(m)}>
                      <div className="material-thumb"><FileIcon type={mediaModeOf(m)} /></div>
                      <div className="material-info">
                        <div className="t clamp-2">{m.title}{m.file_ext ? <span className="file-ext">{m.file_ext}</span> : null}</div>
                        <div className="m">
                          {MODE_LABELS[mediaModeOf(m)] || "文件"}
                          {TIMED_MODES.has(mediaModeOf(m)) && ` · 时长 ${Number(m.duration) > 0 ? fmtDuration(m.duration) : "未知"}`}
                          {TIMED_MODES.has(mediaModeOf(m)) && m.position ? ` · 已观看 ${fmtDuration(m.position)}` : ""}
                        </div>
                      </div>
                      <a className="icon-btn" href={`${streamUrl(m.id)}&download=1`} download onClick={(e) => e.stopPropagation()}><Download size={15} /></a>
                    </div>
                  ))}
                </>
              )}

              {tab === "chat" && (
                <>
                  <div className="note-compose">
                    {replyTo && <div className="small muted" style={{ marginBottom: 4 }}>回复 @{replyTo.user_name}<button className="link" style={{ marginLeft: 8 }} onClick={() => setReplyTo(null)}>取消</button></div>}
                    <textarea placeholder="说点什么…" value={chatText} onChange={(e) => setChatText(e.target.value)} />
                    <div className="actions"><span className="hint" /><button className="btn btn-sm btn-primary" onClick={sendMessage}><Send size={13} /> 发送</button></div>
                  </div>
                  {topNotes.length === 0 ? <Empty icon={<MessageCircle size={24} />} text="还没有讨论，来抢沙发" /> : topNotes.map((d) => (
                    <React.Fragment key={d.id}>
                      <div className="discussion-item">
                        <Avatar user={d} size={30} />
                        <div className="bubble">
                          <div className="meta">
                            <span className="name">{d.user_name || d.username}</span>
                            {d.role === "admin" && <span className="badge badge-purple" style={{ padding: "0 5px" }}>管理员</span>}
                            <span className="time">{fmtDateTime(d.created_at)}</span>
                          </div>
                          <div className="text">{d.content}</div>
                          <div className="ops">
                            <button onClick={() => setReplyTo(d)}>回复</button>
                            {(d.user_id === user?.id || isAdmin) && <button onClick={() => setConfirmDelete(d)}>删除</button>}
                          </div>
                        </div>
                      </div>
                      {repliesOf(d.id).map((r) => (
                        <div className="discussion-item reply" key={r.id}>
                          <CornerDownRight size={14} style={{ color: "var(--muted)", marginTop: 6 }} />
                          <Avatar user={r} size={24} />
                          <div className="bubble">
                            <div className="meta"><span className="name">{r.user_name}</span><span className="time">{fmtDateTime(r.created_at)}</span></div>
                            <div className="text">{r.content}</div>
                            {(r.user_id === user?.id || isAdmin) && <div className="ops"><button onClick={() => setConfirmDelete(r)}>删除</button></div>}
                          </div>
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                </>
              )}
            </div>
          </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <Confirm title="删除讨论" text="确定删除这条讨论吗？" onClose={() => setConfirmDelete(null)} onOk={async () => {
          try {
            await api(`/discussions/${confirmDelete.id}`, { method: "DELETE" });
            setDiscussions((list) => list.filter((x) => x.id !== confirmDelete.id && x.parent_id !== confirmDelete.id));
            setConfirmDelete(null);
          } catch (e) { toast(e.message, "error"); }
        }} />
      )}
    </>
  );
}
