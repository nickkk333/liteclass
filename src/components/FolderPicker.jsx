import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Folder, HardDrive } from "lucide-react";
import { api } from "../api.js";
import { Modal, Spinner } from "./ui.jsx";

export default function FolderPicker({ initial = "", onClose, onPick }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (target) => {
    setLoading(true);
    setError("");
    try {
      const res = await api(`/fs/dirs${target ? `?path=${encodeURIComponent(target)}` : ""}`);
      setData(res);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(initial); }, []);

  const current = data?.path || "";
  const entries = data?.entries || [];

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
        选择 NAS 上已挂载到本机的课程目录，创建后会导入其中的音视频与文档。
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

      {error && <p className="danger-text small">{error}</p>}

      {current && !!data?.roots?.length && (
        <div className="picker-roots">
          {data.roots.map((root) => (
            <button className="picker-root" key={root} onClick={() => load(root)}>
              <HardDrive size={13} /> {root}
            </button>
          ))}
        </div>
      )}

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
              <ChevronRight size={15} color="var(--muted)" />
            </button>
          ))}
          {current && entries.length === 0 && !loading && (
            <div className="picker-empty">该目录下没有子文件夹</div>
          )}
        </div>
      )}
    </Modal>
  );
}
