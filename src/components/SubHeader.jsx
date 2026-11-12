import React from "react";
import { ArrowLeft } from "lucide-react";

export default function SubHeader({ title, onBack, action }) {
  return (
    <header className="app-header">
      <div className="head-side">
        <button className="icon-btn" onClick={onBack}><ArrowLeft size={19} /></button>
      </div>
      <div className="head-title">{title}</div>
      <div className="head-actions">{action}</div>
    </header>
  );
}
