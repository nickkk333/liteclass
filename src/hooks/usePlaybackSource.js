import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

// 与 OfflineU 的 prepareMedia / attachHls 状态机对应：
// direct / raw 直接播原文件；hls 用 hls.js（Safari 走原生）；remux 等后台缓存就绪后重载。

const HLS_RETRIES = 20;
const HLS_RETRY_DELAY = 5000;
const POLL_INTERVAL = 2000;

export default function usePlaybackSource({ mediaRef, materialId, enabled, streamUrl, autoPlayRef }) {
  const [state, setState] = useState({ mode: "direct", preparing: false, error: "", notice: "" });
  const [reload, setReload] = useState(0);
  const hlsRef = useRef(null);
  const pollRef = useRef(null);
  const retryRef = useRef(0);
  const timerRef = useRef(null);
  const seqRef = useRef(0);
  const fallbackRef = useRef(() => {});
  const fallbackingRef = useRef(false);

  const clearTimers = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
  };

  useEffect(() => {
    const seq = ++seqRef.current;
    clearTimers();
    retryRef.current = 0;
    fallbackingRef.current = false;
    if (!enabled || !materialId) {
      setState({ mode: "direct", preparing: false, error: "" });
      return undefined;
    }
    const alive = () => seq === seqRef.current;
    const status = (hls = true) => api(`/media/status/${materialId}${hls ? "" : "?hls=0"}`);

    const playIfNeeded = () => {
      const el = mediaRef?.current;
      if (el && autoPlayRef?.current) el.play().catch(() => {});
    };

    const attachHls = async (url) => {
      if (!alive()) return;
      const el = mediaRef?.current;
      if (!el) return;
      if (el.canPlayType && el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = url;
        setState({ mode: "hls", preparing: false, error: "" });
        playIfNeeded();
        return;
      }
      try {
        const Hls = (await import("hls.js")).default;
        if (!alive()) return;
        if (!Hls.isSupported()) throw new Error("浏览器不支持 MSE");
        if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} }
        const player = new Hls({
          enableWorker: true, maxBufferLength: 30, maxMaxBufferLength: 60,
          manifestLoadTimeOut: 120000,
        });
        hlsRef.current = player;
        player.loadSource(url);
        player.attachMedia(el);
        player.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!alive()) return;
          setState({ mode: "hls", preparing: false, error: "" });
          playIfNeeded();
        });
        player.on(Hls.Events.ERROR, (_event, data) => {
          if (!data?.fatal || !alive()) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryRef.current < HLS_RETRIES) {
            retryRef.current += 1;
            timerRef.current = setTimeout(() => attachHls(url), HLS_RETRY_DELAY);
          } else {
            fallback();
          }
        });
      } catch { fallback(); }
    };

    const applyStatus = async (s, hls = true) => {
      if (!alive()) return;
      if (hls && s.mode === "hls") {
        if (s.error) { fallback(); return; }
        if (s.hls_ready && s.hls_url) {
          setState({ mode: "hls", preparing: false, error: "" });
          attachHls(s.hls_url);
        } else {
          setState({ mode: "hls", preparing: true, error: "" });
          if (!pollRef.current) {
            pollRef.current = setInterval(async () => {
              try {
                const next = await status();
                if (!alive()) return;
                if (next.mode !== "hls") { clearTimers(); fallback(); return; }
                if (next.error) { clearTimers(); fallback(); return; }
                if (next.hls_ready && next.hls_url) {
                  clearInterval(pollRef.current); pollRef.current = null;
                  setState({ mode: "hls", preparing: false, error: "" });
                  attachHls(next.hls_url);
                }
              } catch {}
            }, POLL_INTERVAL);
          }
        }
        return;
      }
      if (s.mode === "remux") {
        if (s.error) { setState({ mode: "remux", preparing: false, error: s.error }); return; }
        if (s.ready) {
          setState({ mode: "remux", preparing: false, error: "" });
          setReload((v) => v + 1);
          playIfNeeded();
        } else {
          setState({ mode: "remux", preparing: true, error: "" });
          if (!pollRef.current) {
            pollRef.current = setInterval(async () => {
              try {
                const next = await status(false);
                if (!alive()) return;
                if (next.ready || next.error) {
                  clearInterval(pollRef.current); pollRef.current = null;
                  setState({ mode: "remux", preparing: false, error: next.error || "" });
                  if (next.ready) { setReload((v) => v + 1); playIfNeeded(); }
                }
              } catch {}
            }, POLL_INTERVAL);
          }
        }
        return;
      }
      setState({ mode: s.mode || "direct", preparing: false, error: "",
        notice: s.transcoding_disabled
          ? "该文件的音轨/容器浏览器无法直接播放，请到「管理 → 设置」开启视频转码。"
          : s.ffmpeg_missing
            ? "服务端未找到 ffmpeg，无法转换该视频的音轨（可能出现有画面无声音）。"
            : "" });
    };

    const fallback = async () => {
      if (!alive() || fallbackingRef.current) return;
      fallbackingRef.current = true;
      clearTimers();
      if (!alive()) return;
      try { await applyStatus(await status(false), false); }
      catch { setState({ mode: "direct", preparing: false, error: "" }); }
    };
    fallbackRef.current = fallback;

    setState({ mode: "loading", preparing: true, error: "" });
    status().then((s) => applyStatus(s)).catch(() => setState({ mode: "direct", preparing: false, error: "" }));
    return () => { clearTimers(); };
  }, [materialId, enabled, streamUrl]);

  let src = streamUrl;
  if (state.preparing || state.mode === "hls") src = undefined;
  else if (state.mode === "remux") src = `${streamUrl}&remux=${reload}`;

  return {
    src,
    elementKey: `${materialId}-${reload}`,
    preparing: state.preparing,
    mode: state.mode,
    error: state.error,
    notice: state.notice || "",
    // HLS 播放失败（MSE 追加失败 / 解码错误）时由页面调用：改走后端 MP4 重封装。
    fallback: () => fallbackRef.current(),
  };
}
