import React from "react";
import { Subtitles, Check, Ban } from "lucide-react";

// 字幕菜单：关闭 / 外挂字幕 / 内嵌各轨。图形字幕（PGS/DVD）置灰提示。

export function SubtitleTrackList({ options, selected }) {
  if (!options?.length) return null;
  return (
    <>
      {options.map((o) => (
        <track
          key={o.key}
          kind="subtitles"
          src={o.url}
          srcLang={o.lang || "und"}
          label={o.label}
          default={o.key === selected}
        />
      ))}
    </>
  );
}

export function SubtitleMenu({ subtitle, open, setOpen }) {
  const { options, selected, setSelected } = subtitle || {};
  if (!options?.length) return null;
  return (
    <div className="mode-wrap subtitle-wrap">
      <button
        type="button"
        className={`mode-btn subtitle-btn ${selected !== "off" ? "active" : ""}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="选择字幕"
        aria-label="选择字幕"
        aria-expanded={open}
      >
        <Subtitles size={14} />
        <span className="mode-label">字幕</span>
      </button>
      {open && (
        <>
          <div className="mode-backdrop" onClick={() => setOpen(false)} />
          <div className="mode-menu subtitle-menu" role="menu" aria-label="字幕">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={selected === "off"}
              className={selected === "off" ? "active" : ""}
              onClick={() => { setSelected("off"); setOpen(false); }}
            >
              <Ban size={15} />
              <span>关闭字幕</span>
              {selected === "off" && <Check size={14} />}
            </button>
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                role="menuitemradio"
                aria-checked={o.key === selected}
                className={o.key === selected ? "active" : ""}
                disabled={!o.url}
                title={o.unsupported ? "图形字幕（PGS/DVD）暂不支持在网页显示" : o.hint}
                onClick={() => {
                  if (!o.url) return;
                  setSelected(o.key);
                  setOpen(false);
                }}
              >
                <span className="sub-item">
                  <span className="sub-label">{o.label}</span>
                  {o.hint ? <span className="sub-hint">{o.unsupported ? "图形字幕，暂不支持" : o.hint}</span> : null}
                </span>
                {o.key === selected && <Check size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
