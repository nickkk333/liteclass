import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { X } from "lucide-react";
import { initial } from "../api.js";

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = "info") => {
    const id = Math.random();
    setItems((list) => [...list, { id, message, type }]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? "wide" : ""}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange }) {
  return <button type="button" className={`switch ${checked ? "on" : ""}`} onClick={() => onChange?.(!checked)} aria-pressed={checked} />;
}

export function Avatar({ user, size = 40, className = "" }) {
  const name = user?.nickname || user?.username || user?.name || "?";
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {user?.avatar ? <img src={user.avatar} alt="" /> : initial(name)}
    </span>
  );
}

export function Empty({ icon, text, children }) {
  return (
    <div className="empty">
      {icon}
      <span>{text}</span>
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="loading-screen"><div className="spinner" /></div>;
}

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size, borderWidth: 2 }} />;
}

export function Confirm({ title, text, confirmText = "确定", danger = true, onOk, onClose }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onOk}>{confirmText}</button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.7 }}>{text}</p>
    </Modal>
  );
}

export function Section({ title, desc, action, children }) {
  return (
    <section>
      {(title || action) && (
        <div className="section-head">
          <div>
            {title && <h2>{title}</h2>}
            {desc && <p>{desc}</p>}
          </div>
          <div className="spacer" />
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
