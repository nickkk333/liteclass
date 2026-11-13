import { useState } from "react";
import { api } from "../api.js";
import { useToast } from "./ui.jsx";

/** 课程详情页的投屏入口：设备发现、兼容模式、把当前章节推送到电视。 */
export default function CastMenu({ material, mode, onCasted }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState([]);
  const [plan, setPlan] = useState(null);
  const [compat, setCompat] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

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

  return (
    <div className="cast-menu-wrap">
      <button type="button" className="btn ghost" onClick={toggle} aria-expanded={open}>
        投屏
      </button>
      {open ? (
        <div className="cast-menu card">
          <div className="cast-menu-head">
            <strong>投屏到电视</strong>
            <button type="button" className="btn tiny ghost" onClick={() => load(true)} disabled={loading}>
              {loading ? "搜索中…" : "刷新"}
            </button>
          </div>
          {plan?.dlna_enabled === false ? (
            <div className="muted small">服务端已关闭投屏（LITECLASS_DLNA=off）。</div>
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
              <div className="muted small">{loading ? "正在搜索设备…" : "未发现投屏设备，请确认电视与 NAS 在同一局域网后刷新。"}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
