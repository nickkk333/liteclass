import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

// 与 OfflineU 的 prepareMedia / attachHls 状态机对应：
// direct / raw 直接播原文件；hls 用 hls.js（Safari 走原生）；remux 等后台缓存就绪后重载。

const HLS_RETRIES = 20;
const HLS_RETRY_DELAY = 5000;
const POLL_INTERVAL = 2000;

/**
 * sourceChoice："" 未决定（需要转码时弹窗询问）/ "server" 服务端转码 / "raw" 原码直连。
 * askChoice：视频类章节才询问，音频章节保持自动决策。
 */
export default function usePlaybackSource({
  mediaRef, materialId, enabled, streamUrl, autoPlayRef, overrideUrl = "",
  sourceChoice = "", askChoice = true,
}) {
  // state.for 记录这份判定属于哪个章节：换章节的第一帧还没跑新判定时，
  // 绝不能拿上一章的状态去拼 src（否则会先把原始大文件/旧转码流拉下来）。
  const [state, setState] = useState({ for: undefined, mode: "loading", preparing: true, error: "", notice: "" });
  const [needsTranscode, setNeedsTranscode] = useState(false);
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
    const setS = (next) => setState({ for: materialId, preparing: false, error: "", ...next });
    clearTimers();
    retryRef.current = 0;
    fallbackingRef.current = false;
    if (!enabled || !materialId) {
      setS({ mode: "direct" });
      setNeedsTranscode(false);
      return undefined;
    }
    // 投屏烧录流：直接当普通 <video src> 播（fMP4），不参与 HLS / remux 状态机。
    if (overrideUrl) {
      setS({ mode: "burn" });
      setNeedsTranscode(false);
      return undefined;
    }
    const alive = () => seq === seqRef.current;
    const status = (hls = true) => api(`/media/status/${materialId}${hls ? "" : "?hls=0"}`);
    // probe=1 只做判定，不启动 HLS 索引 / 重封装任务，避免用户还没选就白跑转码。
    const probe = () => api(`/media/status/${materialId}?probe=1`);

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
        setS({ mode: "hls" });
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
          setS({ mode: "hls" });
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
          setS({ mode: "hls" });
          attachHls(s.hls_url);
        } else {
          setS({ mode: "hls", preparing: true });
          if (!pollRef.current) {
            pollRef.current = setInterval(async () => {
              try {
                const next = await status();
                if (!alive()) return;
                if (next.mode !== "hls") { clearTimers(); fallback(); return; }
                if (next.error) { clearTimers(); fallback(); return; }
                if (next.hls_ready && next.hls_url) {
                  clearInterval(pollRef.current); pollRef.current = null;
                  setS({ mode: "hls" });
                  attachHls(next.hls_url);
                }
              } catch {}
            }, POLL_INTERVAL);
          }
        }
        return;
      }
      if (s.mode === "remux") {
        if (s.error) { setS({ mode: "remux", error: s.error }); return; }
        if (s.ready) {
          setS({ mode: "remux" });
          setReload((v) => v + 1);
          playIfNeeded();
        } else {
          setS({ mode: "remux", preparing: true });
          if (!pollRef.current) {
            pollRef.current = setInterval(async () => {
              try {
                const next = await status(false);
                if (!alive()) return;
                if (next.ready || next.error) {
                  clearInterval(pollRef.current); pollRef.current = null;
                  setS({ mode: "remux", error: next.error || "" });
                  if (next.ready) { setReload((v) => v + 1); playIfNeeded(); }
                }
              } catch {}
            }, POLL_INTERVAL);
          }
        }
        return;
      }
      setS({ mode: s.mode || "direct",
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
      catch { setS({ mode: "direct" }); }
    };
    fallbackRef.current = fallback;

    const decide = async () => {
      let s;
      try { s = await probe(); }
      catch { if (alive()) setS({ mode: "direct" }); return; }
      if (!alive()) return;
      const needs = s.mode === "hls" || s.mode === "remux";
      setNeedsTranscode(needs);
      if (!needs) { applyStatus(s); return; }
      // 需要服务端处理：还没选过就让用户选（原码直连 / 服务端转码）。
      if (!sourceChoice && askChoice) {
        setS({ mode: "choose", choose: {
          kind: s.mode,
          size: s.size || 0,
          duration: s.duration || 0,
          video_codec: s.video_codec || "",
          audio_codec: s.audio_codec || "",
          needs_reencode: !!s.needs_reencode,
        } });
        return;
      }
      if (sourceChoice === "raw") {
        setS({ mode: "raw" });
        return;
      }
      setS({ mode: "loading", preparing: true });
      try { await applyStatus(await status()); }
      catch { if (alive()) setS({ mode: "direct" }); }
    };

    setS({ mode: "loading", preparing: true });
    decide();
    return () => { clearTimers(); };
  }, [materialId, enabled, streamUrl, overrideUrl, sourceChoice, askChoice]);

  // 判定不属于当前章节（刚切章节的第一帧）时不给 src，等新判定落地。
  const decided = state.for === materialId;
  let src;
  if (!decided) src = undefined;
  else if (overrideUrl) src = overrideUrl;
  else if (state.preparing || state.mode === "hls" || state.mode === "choose") src = undefined;
  else if (state.mode === "remux") src = `${streamUrl}&remux=${reload}`;
  // 原码播放：跳过服务端重封装缓存，确保拿到的就是原始文件。
  else if (state.mode === "raw") src = `${streamUrl}&raw=1`;
  else src = streamUrl;

  return {
    src,
    elementKey: `${materialId}-${reload}-${overrideUrl ? "burn" : sourceChoice || "auto"}`,
    preparing: !decided || state.preparing,
    mode: decided ? state.mode : "loading",
    error: decided ? state.error : "",
    notice: decided ? (state.notice || "") : "",
    // 需要服务端转码时的选择信息（未决定时由页面弹窗询问）
    choose: decided ? (state.choose || null) : null,
    needsTranscode,
    // HLS 播放失败（MSE 追加失败 / 解码错误）时由页面调用：改走后端 MP4 重封装。
    fallback: () => fallbackRef.current(),
  };
}
