import { useEffect, useState } from "react";
import { parseVTT, activeSubtitleText } from "../lib/vtt.js";

// 字幕画在画面里，而不是交给 <track> 原生渲染。
// 原因：镜像投屏（Miracast / AirCast / 浏览器标签页投射、AirPlay 镜像）
// 只把屏幕画面丢到电视上，原生字幕有时不会跟随；自己画进画面就不会丢。

export default function SubtitleOverlay({ url, mediaRef, elementKey }) {
  const [cues, setCues] = useState([]);
  const [text, setText] = useState("");

  useEffect(() => {
    setCues([]);
    setText("");
    if (!url) return undefined;
    let alive = true;
    fetch(url)
      .then((res) => (res.ok ? res.text() : ""))
      .then((body) => { if (alive) setCues(parseVTT(body)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [url]);

  useEffect(() => {
    if (!cues.length) { setText(""); return undefined; }
    const apply = () => {
      const next = activeSubtitleText(cues, mediaRef?.current?.currentTime || 0);
      setText((prev) => (prev === next ? prev : next));
    };
    const el = mediaRef?.current;
    // timeupdate 约 4 次/秒，够字幕用；播放时再用 rAF 追帧，暂停时不空转。
    const events = ["timeupdate", "seeked", "seeking", "loadedmetadata", "loadeddata", "ended"];
    events.forEach((name) => el?.addEventListener(name, apply));
    let frame = 0;
    const loop = () => {
      apply();
      frame = requestAnimationFrame(loop);
    };
    const start = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(loop); };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; apply(); };
    el?.addEventListener("play", start);
    el?.addEventListener("pause", stop);
    if (el && !el.paused) start();
    apply();
    return () => {
      events.forEach((name) => el?.removeEventListener(name, apply));
      el?.removeEventListener("play", start);
      el?.removeEventListener("pause", stop);
      cancelAnimationFrame(frame);
    };
  }, [cues, mediaRef, elementKey]);

  if (!text) return null;
  return (
    <div className="player-captions">
      <span>{text}</span>
    </div>
  );
}
