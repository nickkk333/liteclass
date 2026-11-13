import React, { useEffect, useState } from "react";
import SourcesPanel from "../../components/SourcesPanel.jsx";
import { api } from "../../api.js";
import { useToast, Switch, Spinner } from "../../components/ui.jsx";
import SubHeader from "../../components/SubHeader.jsx";

export default function SettingsView({ onBack }) {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api("/settings").then(setSettings).catch((e) => toast(e.message, "error")); }, []);

  const update = async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    try {
      await api("/settings", { method: "PUT", body: patch });
    } catch (e) { toast(e.message, "error"); }
  };

  const saveNumber = async (key, value) => {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0) return;
    setBusy(true);
    try { await api("/settings", { method: "PUT", body: { [key]: v } }); toast("已保存", "ok"); }
    catch (e) { toast(e.message, "error"); }
    setBusy(false);
  };

  if (!settings) return <><SubHeader title="系统设置" onBack={onBack} /><div className="loading-screen"><Spinner /></div></>;

  return (
    <>
      <SubHeader title="系统设置" onBack={onBack} />
      <div className="page-plain">
        <div className="settings-group">
          <div className="settings-row">
            <div className="grow">
              <div className="label">开放注册</div>
              <div className="desc">允许新用户在登录页面注册账号</div>
            </div>
            <Switch checked={!!settings.allow_registration} onChange={(v) => update({ allow_registration: v })} />
          </div>
          <div className="settings-row">
            <div className="grow">
              <div className="label">允许用户新建课程</div>
              <div className="desc">关闭后，仅管理员可新建课程</div>
            </div>
            <Switch checked={!!settings.allow_course_creation} onChange={(v) => update({ allow_course_creation: v })} />
          </div>
          <div className="settings-row">
            <div className="grow">
              <div className="label">首页显示观看排行榜</div>
              <div className="desc">开启后，首页会展示观看时长排名前 5 的用户</div>
            </div>
            <Switch checked={!!settings.show_watch_ranking_on_home} onChange={(v) => update({ show_watch_ranking_on_home: v })} />
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-row" style={{ paddingBottom: 8 }}>
            <div className="grow">
              <div className="label">启用视频转码</div>
              <div className="desc">开启后，浏览器不支持的容器/编码由服务端转成 HLS 或 MP4；关闭则始终提供原始文件</div>
            </div>
            <Switch checked={!!settings.enable_transcoding} onChange={(v) => update({ enable_transcoding: v })} />
          </div>
          <div className="desc" style={{ padding: "0 14px 12px" }}>
            需要服务端安装 ffmpeg / ffprobe（或设置 <code>LITECLASS_FFMPEG</code>、<code>LITECLASS_FFPROBE</code>）；未找到时自动回退为原始流。
            转码缓存位于 <code>data/cache</code>，可用 <code>LITECLASS_CACHE_LIMIT_GB</code> 限制容量。
            DLNA 投屏可用 <code>LITECLASS_DLNA=off</code> 关闭。
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-row">
            <div className="grow">
              <div className="label">课程上传大小限制</div>
              <div className="desc">用户上传单节课程视频/音频的最大限制（不限管理员挂载路径）</div>
            </div>
            <div className="right">
              <input
                className="num-input"
                type="number"
                defaultValue={settings.max_course_size}
                onBlur={(e) => saveNumber("max_course_size", e.target.value)}
                disabled={busy}
              />
              <span className="unit">MB</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="grow">
              <div className="label">资料上传大小限制</div>
              <div className="desc">用户私有资料的最大上传大小（MB）</div>
            </div>
            <div className="right">
              <input
                className="num-input"
                type="number"
                defaultValue={settings.max_material_size}
                onBlur={(e) => saveNumber("max_material_size", e.target.value)}
                disabled={busy}
              />
              <span className="unit">MB</span>
            </div>
          </div>
        </div>

        <div className="settings-group">
          <SourcesPanel />
        </div>
      </div>
    </>
  );
}
