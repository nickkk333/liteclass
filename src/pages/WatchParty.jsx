import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play, Pause, Volume2, Music, Video, Send, Users, Radio, SkipForward, FileText } from "lucide-react";
import { api, fmtDuration, getToken, streamUrl, previewUrl } from "../api.js";
import { useAuth } from "../App.jsx";
import { useToast, Avatar, Empty, Spinner } from "../components/ui.jsx";
import usePlaybackSource from "../hooks/usePlaybackSource.js";
import useSubtitles from "../hooks/useSubtitles.js";
import { SubtitleTrackList } from "../components/SubtitleTracks.jsx";

export default function WatchParty() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [room, setRoom] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [messages, setMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [connected, setConnected] = useState(false);
  const [volume, setVolume] = useState(1);
  const audioRef = useRef(null);
  const wsRef = useRef(null);
  const isHost = room?.host_id === user?.id || user?.role === "admin";
  const hostRef = useRef(false);
  hostRef.current = isHost;

  const current = useMemo(() => materials.find((m) => m.id === currentId), [materials, currentId]);
  const mediaMode = current?.preview_mode || current?.file_type || "other";
  const timed = mediaMode === "video" || mediaMode === "audio";
  const playingRef = useRef(false);
  playingRef.current = playing;
  const playback = usePlaybackSource({
    mediaRef: audioRef,
    materialId: current?.id,
    enabled: timed,
    streamUrl: current ? streamUrl(current.id) : "",
    autoPlayRef: playingRef,
  });
  const subtitle = useSubtitles({
    materialId: current?.id,
    enabled: mediaMode === "video",
    mediaRef: audioRef,
    elementKey: playback.elementKey,
  });

  useEffect(() => {
    (async () => {
      try {
        const r = await api(`/rooms/${roomId}`);
        setRoom(r);
        setCurrentId(r.material_id);
        if (r.course_id) {
          const c = await api(`/courses/${r.course_id}`);
          setMaterials(c.materials || []);
          if (!r.material_id && c.materials?.[0]) setCurrentId(c.materials[0].id);
        }
        if (r.position > 0) setTime(r.position);
        setPlaying(!!r.is_playing);
      } catch (e) { toast(e.message, "error"); navigate("/courses?tab=rooms"); }
    })();
  }, [roomId]);

  useEffect(() => {
    if (!room) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/rooms/${roomId}?token=${encodeURIComponent(getToken())}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "state") {
        setRoom(msg.room);
        setCurrentId(msg.room.material_id);
        if (!hostRef.current) {
          setPlaying(!!msg.room.is_playing);
          const el = audioRef.current;
          if (el) {
            if (Math.abs(el.currentTime - msg.room.position) > 2) el.currentTime = msg.room.position;
            if (msg.room.is_playing) el.play().catch(() => {});
            else el.pause();
          }
        }
      } else if (msg.type === "chat") {
        setMessages((m) => [...m, msg]);
      }
    };
    return () => { ws.close(); wsRef.current = null; };
  }, [room?.id]);

  useEffect(() => {
    audioRef.current?.play?.().catch(() => {});
  }, [currentId]);

  const sendSync = (patch) => {
    const el = audioRef.current;
    const payload = {
      type: "sync",
      position: patch.position ?? el?.currentTime ?? time,
      playing: patch.playing ?? playing,
      materialId: patch.materialId ?? currentId,
    };
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(payload));
  };

  const toggle = () => {
    if (!isHost) return toast("只有房主可以控制播放", "error");
    const el = audioRef.current;
    if (!el) return;
    const nextPlaying = !playing;
    setPlaying(nextPlaying);
    if (nextPlaying) el.play().catch(() => {}); else el.pause();
    sendSync({ playing: nextPlaying, position: el.currentTime });
  };

  const seek = (v) => {
    if (!isHost) return;
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Number(v);
    setTime(Number(v));
    sendSync({ position: Number(v), playing });
  };

  const switchMaterial = (id) => {
    if (!isHost) return;
    setCurrentId(Number(id));
    setTime(0);
    setPlaying(true);
    sendSync({ materialId: Number(id), position: 0, playing: true });
  };

  const sendChat = () => {
    if (!chatText.trim()) return;
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "chat", content: chatText.trim() }));
      setChatText("");
    } else toast("连接已断开", "error");
  };

  const onLoadedMetadata = () => {
    const el = audioRef.current;
    if (!el) return;
    setDuration(el.duration || 0);
    if (!isHost && room?.position) el.currentTime = room.position;
    el.volume = volume;
    if (playing) el.play().catch(() => {});
  };

  if (!room) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <>
      <header className="app-header">
        <div className="head-side"><button className="icon-btn" onClick={() => navigate("/courses?tab=rooms")}><ArrowLeft size={19} /></button></div>
        <div className="head-title">{room.name}</div>
        <div className="head-actions">
          <span className={`badge ${connected ? "badge-green" : "badge-red"}`}>{connected ? "已连接" : "连接中"}</span>
        </div>
      </header>

      <div className="page-plain">
        <div className="party-wrap">
          <div>
            <div className="party-stage">
              {!current ? (
                <div className="audio-art" style={{ minHeight: 300 }}>
                  <Radio size={44} opacity={0.4} />
                  <p className="muted">房主还没有选择播放内容</p>
                </div>
              ) : mediaMode === "video" ? (
                <video
                  key={playback.elementKey}
                  ref={audioRef}
                  src={playback.src}
                  controls={isHost}
                  playsInline
                  x-webkit-airplay="allow"
                  onLoadedMetadata={onLoadedMetadata}
                  onTimeUpdate={(e) => setTime(e.target.currentTime)}
                  onPlay={() => { if (isHost) { setPlaying(true); sendSync({ playing: true }); } }}
                  onPause={() => { if (isHost) { setPlaying(false); sendSync({ playing: false }); } }}
                >
                  <SubtitleTrackList options={subtitle.playable} selected={subtitle.selected} />
                </video>
              ) : mediaMode === "audio" ? (
                <>
                  <audio
                    key={playback.elementKey}
                    ref={audioRef}
                    src={playback.src}
                    x-webkit-airplay="allow"
                    onLoadedMetadata={onLoadedMetadata}
                    onTimeUpdate={(e) => setTime(e.target.currentTime)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => {
                      if (!isHost) return;
                      const idx = materials.findIndex((m) => m.id === currentId);
                      if (idx >= 0 && idx < materials.length - 1) switchMaterial(materials[idx + 1].id);
                    }}
                  />
                  <div className="audio-art">
                    {room.course?.cover_image && <img src={room.course.cover_image} alt="" style={{ width: 150, height: 150, borderRadius: 16, objectFit: "cover", boxShadow: "0 18px 40px rgba(0,0,0,.45)" }} />}
                    <h2 style={{ fontSize: 19 }}>{current.title}{current.file_ext || ""}</h2>
                    <p className="small" style={{ color: "rgba(255,255,255,.55)" }}>{fmtDuration(time)} / {fmtDuration(duration || current.duration)}</p>
                  </div>
                </>
              ) : mediaMode === "image" ? (
                <a className="party-doc" href={streamUrl(current.id)} target="_blank" rel="noreferrer">
                  <img src={streamUrl(current.id)} alt={current.title} />
                </a>
              ) : mediaMode === "pdf" || mediaMode === "html" || mediaMode === "text" || mediaMode === "markdown" || mediaMode === "office" ? (
                <iframe
                  key={current.id}
                  className="party-doc party-doc-frame"
                  src={mediaMode === "pdf" ? streamUrl(current.id) : previewUrl(current.id)}
                  title={current.title}
                  sandbox={mediaMode === "pdf" ? undefined : "allow-same-origin"}
                />
              ) : (
                <div className="audio-art" style={{ minHeight: 300 }}>
                  <FileText size={44} opacity={0.4} />
                  <p className="muted">该章节暂不支持一起看，请下载后查看</p>
                </div>
              )}
              {timed && playback.preparing ? <div className="party-preparing">正在准备可播版本…</div> : null}
            </div>

            <div className="card" style={{ padding: 14, marginTop: 12 }}>
              {timed && (
              <div className="row" style={{ gap: 10 }}>
                <button className="play-main" onClick={toggle} disabled={!isHost} style={{ opacity: isHost ? 1 : 0.5 }}>
                  {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" style={{ marginLeft: 2 }} />}
                </button>
                <div className="grow">
                  <input className="seek-input" type="range" min={0} max={duration || current?.duration || 0} value={Math.min(time, duration || current?.duration || 0)} onChange={(e) => seek(e.target.value)} disabled={!isHost} />
                  <div className="player-times"><span>{fmtDuration(time)}</span><span>{fmtDuration(duration || current?.duration || 0)}</span></div>
                </div>
                <Volume2 size={16} color="var(--muted)" />
                <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => { const v = Number(e.target.value); setVolume(v); if (audioRef.current) audioRef.current.volume = v; }} style={{ width: 70, accentColor: "var(--primary)" }} />
              </div>
              )}
              <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
                <span className="muted small">
                  {isHost ? "你是房主，可以控制播放进度" : "跟随房主同步播放"}
                  {!connected && " · 连接中..."}
                </span>
                {isHost && materials.length > 0 && (
                  <select className="select" style={{ width: 210, height: 32, padding: "4px 8px" }} value={currentId || ""} onChange={(e) => switchMaterial(e.target.value)}>
                    {materials.map((m) => <option key={m.id} value={m.id}>{m.title}{m.file_ext || ""}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div className="row" style={{ marginTop: 12, gap: 10, color: "var(--muted)", fontSize: 12 }}>
              <Users size={14} /> {room.member_count || 1} 人在线 · 房间口令 <b style={{ color: "var(--text)" }}>{room.code || "—"}</b>
              {room.course && <span>· {room.course.title}</span>}
            </div>
          </div>

          <div className="chat-panel">
            <div className="chat-head"><Radio size={15} color="var(--primary)" /> 放映聊天室</div>
            <div className="chat-body">
              {messages.length === 0 && <p className="muted small" style={{ textAlign: "center", marginTop: 30 }}>还没有消息，打个招呼吧</p>}
              {messages.map((m, i) => (
                <div key={i} className={`chat-msg ${m.userId === user?.id ? "me" : ""}`}>
                  <div className="who">{m.user || m.userId} · {String(m.at || "").slice(11, 16)}</div>
                  <div className="txt">{m.content}</div>
                </div>
              ))}
            </div>
            <div className="chat-input">
              <input className="input" placeholder="发送消息…" value={chatText} onChange={(e) => setChatText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }} />
              <button className="btn btn-primary" onClick={sendChat}><Send size={15} /></button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
