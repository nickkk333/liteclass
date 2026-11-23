import { useEffect, useState } from "react";
import { Cast } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./ui.jsx";

/**
 * 课程详情页的投屏入口。
 * 1) 系统投屏：AirPlay（Safari / iPhone / iPad）、Chromecast / Miracast 等由浏览器与系统面板提供；
 * 2) 局域网电视：服务端 SSDP 发现 DLNA 设备后直接推送。
 */
export default function CastMenu({ material, mode, mediaRef, onCasted, onCastSource, transcode = "auto", subtitleTrack = "auto", compact = false }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState([]);
  const [plan, setPlan] = useState(null);
  // 默认不烧录：DLNA 直接推送外挂字幕，投屏可以拖动、切换字幕也只需重新推送一次；
  // 电视不认外挂字幕（或走 AirPlay / Cast 接力投屏）时，再勾选烧录。
  const [burn, setBurn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [native, setNative] = useState({ airplay: false, remote: false, state: "disconnected" });

  const mediaEl = () => {
    const ref = mediaRef?.current;
    if (ref) return ref;
    return document.querySelector(".player-stage video") || document.querySelector("audio");
  };

  const detectNative = () => {
    const el = mediaEl();
    setNative({
      airplay: typeof el?.webkitShowPlaybackTargetPicker === "function",
      remote: Boolean(el?.remote),
      state: el?.remote?.state || "disconnected",
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    detectNative();
    const remote = mediaEl()?.remote;
    if (!remote?.addEventListener) return undefined;
    const sync = () => setNative((prev) => ({ ...prev, state: remote.state }));
    remote.addEventListener("connect", sync);
    remote.addEventListener("disconnect", sync);
    return () => {
      remote.removeEventListener("connect", sync);
      remote.removeEventListener("disconnect", sync);
    };
  }, [open]);

  if (!material || !["video", "audio"].includes(mode)) return null;

  const load = async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const [list, mediaPlan] = await Promise.all([
        api(`/dlna/devices${refresh ? "?refresh=1" : ""}`),
        api(`/media/plan/${material.id}`).catch(() => null),
      ]);
      setDevices(list.devices || []);
      setPlan(mediaPlan);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  /** AirPlay / Cast / Miracast：交给浏览器或系统的投屏面板。 */
  const castNative = async (kind = "auto") => {
    const el = mediaEl();
    setError("");
    if (!el) { setError("当前章节暂不支持系统投屏"); return; }
    const canAirplay = typeof el.webkitShowPlaybackTargetPicker === "function";
    const canRemote = Boolean(el.remote?.prompt);
    if (kind === "airplay" && !canAirplay) { setError("当前浏览器不支持 AirPlay，请用 Safari / iPhone / iPad 播放后投屏。"); return; }
    if (kind === "remote" && !canRemote) { setError("当前浏览器不支持系统投屏；Miracast 请用系统投屏面板（Windows 按 Win+K）。"); return; }
    let burned = false;
    try {
      // 勾了烧录字幕：先把播放源换成服务端烧好字幕的转码流，设备接力拉流时才有字幕。
      if (wantBurn) {
        if (!onCastSource) throw new Error("当前页面不支持烧录投屏");
        if (plan?.ffmpeg_available === false) throw new Error("服务端未安装 ffmpeg，无法烧录字幕");
        setBusy("burn");
        const info = await api("/cast/burn", {
          method: "POST",
          body: { material_id: material.id, start_seconds: Number(material.position) || 0, subtitle: subtitleTrack },
        });
        await onCastSource(info.url);
        burned = true;
        setBusy("");
      }
      if (canAirplay && kind !== "remote") {
        el.webkitShowPlaybackTargetPicker();
        return;
      }
      if (canRemote) {
        await el.remote.prompt();
        return;
      }
      setError("当前浏览器不支持系统投屏；Miracast 请用系统投屏面板（Windows 按 Win+K）。");
    } catch (e) {
      if (burned) onCastSource?.("");
      if (e?.name === "NotAllowedError") {
        setError("没有可用的投屏设备，或浏览器拦截了投屏面板。");
      } else if (e?.name === "NotSupportedError") {
        setError("未检测到投屏设备；Miracast 请用系统投屏面板（Windows 按 Win+K）。");
      } else if (e?.name !== "AbortError") {
        setError(e?.message || "调起系统投屏失败");
      }
    } finally {
      setBusy("");
    }
  };

  const cast = async (device) => {
    setBusy(device.udn);
    setError("");
    try {
      await api("/dlna/cast", {
        method: "POST",
        body: {
          device: device.udn,
          material_id: material.id,
          start_seconds: Number(material.position) || 0,
          duration: Number(material.duration) || 0,
          transcode,
          burn: wantBurn,
          subtitle: subtitleTrack,
        },
      });
      toast(`已投屏到 ${device.name}`);
      setOpen(false);
      onCasted?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };

  const nativeLabel = "系统投屏";
  const hasSubtitle = Boolean(material?.has_subtitle || plan?.has_subtitle);
  // 播放器里关掉字幕时不烧录，其余情况默认按当前选中的字幕轨烧制。
  const wantBurn = burn && hasSubtitle && subtitleTrack !== "off";

  return (
    <div className="cast-menu-wrap">
      {compact ? (
        <button type="button" className={`icon-btn ${open ? "primary" : ""}`} onClick={toggle} title="投屏" aria-label="投屏" aria-expanded={open}>
          <Cast size={16} />
        </button>
      ) : (
        <button type="button" className="btn ghost" onClick={toggle} aria-expanded={open}>
          投屏
        </button>
      )}
      {open ? (
        <div className={`cast-menu card ${compact ? "up" : ""}`}>
          <div className="cast-menu-head">
            <strong>投屏</strong>
            <button type="button" className="btn tiny ghost" onClick={() => { detectNative(); load(true); }} disabled={loading}>
              {loading ? "搜索中…" : "刷新"}
            </button>
          </div>

          <div className="cast-native">
            <div className="cast-native-head">
              <strong>{nativeLabel}</strong>
              {native.state === "connected" ? <span className="tag tiny">已连接</span> : null}
            </div>
            {hasSubtitle && subtitleTrack !== "off" ? (
              <label className="check-row small">
                <input
                  type="checkbox"
                  checked={burn}
                  onChange={(e) => setBurn(e.target.checked)}
                  disabled={plan?.ffmpeg_available === false}
                />
                烧录字幕（电视不显示外挂字幕、或接力投屏时使用，需 ffmpeg）
              </label>
            ) : null}
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {native.airplay ? (
                <button type="button" className="btn btn-sm" onClick={() => castNative("airplay")} disabled={busy === "burn"}>
                  {busy === "burn" ? "正在准备烧录流…" : "AirPlay 投屏"}
                </button>
              ) : null}
              {native.remote ? (
                <button type="button" className="btn btn-sm" onClick={() => castNative("remote")} disabled={busy === "burn"}>
                  {busy === "burn" ? "正在准备烧录流…" : "系统投屏（Cast / Miracast）"}
                </button>
              ) : null}
              {!native.airplay && !native.remote ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setError("当前浏览器不支持系统投屏；Miracast 请用系统投屏面板（Windows 按 Win+K），或使用下方 DLNA 电视。")}
                >
                  系统投屏（Cast / Miracast）
                </button>
              ) : null}
            </div>
          </div>

          <div className="cast-divider">局域网电视（DLNA）</div>
          {plan?.dlna_enabled === false ? (
            <div className="muted small">服务端已关闭 DLNA 投屏（LITECLASS_DLNA=off）。</div>
          ) : null}
          {plan?.needs_transcode && plan?.ffmpeg_available === false ? (
            <div className="hint small">服务端未找到 ffmpeg，无法转码，请在播放器右上角改用原码播放。</div>
          ) : null}
          {error ? <div className="hint small">{error}</div> : null}
          <div className="cast-devices">
            {devices.length ? devices.map((device) => (
              <button
                type="button" key={device.udn} className="cast-device"
                disabled={!!busy || plan?.dlna_enabled === false}
                onClick={() => cast(device)}
              >
                <span className="cast-device-name">{busy === device.udn ? "推送中…" : device.name}</span>
                <span className="muted tiny">{device.address}{device.model ? ` · ${device.model}` : ""}</span>
              </button>
            )) : (
              <div className="muted small">{loading ? "正在搜索设备…" : "未发现 DLNA 设备，请确认电视与 NAS 在同一局域网后刷新。"}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
