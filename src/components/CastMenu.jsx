import { useEffect, useState } from "react";
import { Cast } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./ui.jsx";

/**
 * 课程详情页的投屏入口。
 * 1) 系统投屏：AirPlay（Safari / iPhone / iPad）、Chromecast / Miracast 等由浏览器与系统面板提供；
 * 2) 局域网电视：服务端 SSDP 发现 DLNA 设备后直接推送。
 */
export default function CastMenu({ material, mode, mediaRef, onCasted, compact = false }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState([]);
  const [plan, setPlan] = useState(null);
  const [compat, setCompat] = useState(false);
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
  const castNative = async () => {
    const el = mediaEl();
    setError("");
    if (!el) { setError("当前章节暂不支持系统投屏"); return; }
    try {
      if (typeof el.webkitShowPlaybackTargetPicker === "function") {
        el.webkitShowPlaybackTargetPicker();
        return;
      }
      if (el.remote?.prompt) {
        await el.remote.prompt();
        return;
      }
      setError("当前浏览器不支持系统投屏。AirPlay 请用 Safari / iPhone / iPad；Miracast 请使用系统投屏（Windows 按 Win+K）。");
    } catch (e) {
      if (e?.name === "NotAllowedError") {
        setError("浏览器没有打开投屏面板：可能没有可用的投屏设备，或需要直接点击投屏按钮。Miracast 请用系统投屏（Windows 按 Win+K），也可使用下方 DLNA 电视。");
      } else if (e?.name === "NotSupportedError") {
        setError("没有检测到可投屏设备。AirPlay 需与 Apple TV / 支持 AirPlay 的电视在同一 Wi-Fi；Miracast 请先打开系统投屏面板。");
      } else if (e?.name !== "AbortError") {
        setError(e?.message || "调起系统投屏失败");
      }
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
          transcode: compat ? "on" : "auto",
        },
      });
      toast(`已投屏到 ${device.name}`);
      setOpen(false);
      onCasted?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };

  const nativeLabel = native.airplay ? "AirPlay 投屏" : "系统投屏（Cast / Miracast）";

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
            <button
              type="button"
              className="btn btn-sm"
              onClick={castNative}
              disabled={!native.airplay && !native.remote}
            >
              {native.airplay ? "打开 AirPlay" : native.remote ? "打开系统投屏" : "系统投屏不可用"}
            </button>
            <div className="muted tiny">
              {native.airplay
                ? "通过 AirPlay 投到 Apple TV 或支持 AirPlay 的电视，需与电视处于同一 Wi-Fi。"
                : native.remote
                  ? "调用浏览器/系统的投屏面板，可使用 Chromecast、Miracast（Windows 按 Win+K）等设备。"
                  : "当前浏览器没有开放系统投屏接口，可改用下方局域网电视或换用 Safari / Chrome。"}
            </div>
          </div>

          <div className="cast-divider">局域网电视（DLNA）</div>
          {plan?.dlna_enabled === false ? (
            <div className="muted small">服务端已关闭 DLNA 投屏（LITECLASS_DLNA=off）。</div>
          ) : null}
          {plan?.needs_transcode ? (
            <div className="muted small">该文件编码可能不被电视直接支持，会自动使用兼容转码流。</div>
          ) : null}
          {plan?.needs_transcode && plan?.ffmpeg_available === false ? (
            <div className="hint small">服务端未找到 ffmpeg，兼容转码不可用，请改用直接播放。</div>
          ) : null}
          <label className="check-row small">
            <input type="checkbox" checked={compat} onChange={(e) => setCompat(e.target.checked)} />
            兼容模式（强制服务端转码，音画不同步/无法播放时勾选）
          </label>
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
