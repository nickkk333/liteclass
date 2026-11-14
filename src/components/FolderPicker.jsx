import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Folder, HardDrive, ShieldCheck } from "lucide-react";
import { api } from "../api.js";
import { Modal, Spinner } from "./ui.jsx";

export default function FolderPicker({ initial = "", onClose, onPick }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState(initial || "");

  const load = async (target) => {
    setLoading(true);
    setError("");
    try {
      const res = await api(`/fs/dirs${target ? `?path=${encodeURIComponent(target)}` : ""}`);
      setData(res);
      setTyped(res.path || "");
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      if (!initial) return load("");
      setLoading(true);
      try {
        const res = await api(`/fs/dirs?path=${encodeURIComponent(initial)}`);
        setData(res);
        setTyped(res.path || "");
        if (res.error) setError(res.error);
      } catch {
        // 之前保存的路径可能已不在授权范围内，回退到根目录列表
        await load("");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current = data?.path || "";
  const entries = data?.entries || [];
  const authorized = data?.authorized || [];

  const jump = (event) => {
    event?.preventDefault();
    load(typed.trim());
  };

  const renderRoot = (root, isAuthorized) => (
    <button className={`picker-root ${isAuthorized ? "authorized" : ""}`} key={root} onClick={() => load(root)}>
      {isAuthorized ? <ShieldCheck size={13} /> : <HardDrive size={13} />} {root}
    </button>
  );

  return (
    <Modal
      title="选择文件夹"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={!current || loading} onClick={() => { onPick(current); onClose(); }}>
          选择此文件夹
        </button>
      </>}
    >
      <p className="muted small" style={{ marginTop: -4 }}>
        选择 NAS 上已授权给本应用的课程目录，创建后会导入其中的音视频与文档。
      </p>

      <div className="picker-path">
        <HardDrive size={14} />
        <span title={current}>{current || "请选择挂载目录"}</span>
        {data?.parent && (
          <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => load(data.parent)} title="上一级">
            <ChevronLeft size={15} />
          </button>
        )}
      </div>

      {!!(data?.sources || []).length && (
        <div className="picker-section">
          <div className="picker-label"><HardDrive size={12} /> 课程来源（WebDAV / SMB / 本地）</div>
          <div className="picker-roots">
            {(data?.sources || []).map((source) => (
              <button className="picker-root authorized" key={source.path} onClick={() => load(source.path)}>
                <HardDrive size={13} /> {source.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!!authorized.length && (
        <div className="picker-section">
          <div className="picker-label"><ShieldCheck size={12} /> 已授权目录</div>
          <div className="picker-roots">{authorized.map((root) => renderRoot(root, true))}</div>
        </div>
      )}

      <form className="picker-jump" onSubmit={jump}>
        <input
          className="input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="手动输入路径，例如 /vol1/1000/课程"
          spellCheck={false}
        />
        <button className="btn" type="submit" disabled={loading}>跳转</button>
      </form>

      {(error || data?.error) && <p className="picker-error">{error || data?.error}</p>}

      {loading ? (
        <div className="row" style={{ justifyContent: "center", padding: 26 }}><Spinner /></div>
      ) : (
        <div className="picker-list">
          {data?.parent && (
            <button className="picker-item" onClick={() => load(data.parent)}>
              <ChevronLeft size={16} />
              <span className="grow">返回上一级</span>
            </button>
          )}
          {entries.map((entry) => (
            <button className="picker-item" key={entry.path} onClick={() => load(entry.path)}>
              <Folder size={16} color="var(--primary)" />
              <span className="grow ellipsis" title={entry.name}>{entry.name}</span>
              {entry.authorized && <span className="picker-badge">已授权</span>}
              <ChevronRight size={15} color="var(--muted)" />
            </button>
          ))}
          {current && entries.length === 0 && !loading && !data?.error && (
            <div className="picker-empty">该目录下没有子文件夹</div>
          )}
          {current && entries.length === 0 && data?.error && (
            <div className="picker-empty">可点击上方「已授权目录」直接进入，或手动输入完整路径后跳转。</div>
          )}
        </div>
      )}
    </Modal>
  );
}
