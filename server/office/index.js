import fs from "node:fs";
import path from "node:path";
import { docxToHtml } from "./docx.js";
import { docToText, splitParagraphs } from "./doc.js";
import { rtfToHtml } from "./rtf.js";
import { mhtmlToHtml } from "./mhtml.js";
import { markdownToHtml } from "./markdown.js";
import { normalizeNewlines, decodeText } from "../encoding.js";

export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

const escapeHtml = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** 读取文件开头，最多 limit 字节；返回 [buffer, truncated] */
export function readCapped(filePath, limit = MAX_PREVIEW_BYTES) {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, limit);
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const read = fs.readSync(fd, buffer, offset, length - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    return [offset === length ? buffer : buffer.subarray(0, offset), size > limit];
  } finally {
    fs.closeSync(fd);
  }
}

function paragraphsToHtml(text) {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) return '<div class="docpreview"><p>（未能从这个文档中读取到可显示的文本）</p></div>';
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  return `<div class="docpreview">${body}</div>`;
}

/**
 * 把文档转换成 HTML 片段。返回 null 表示该扩展名不支持预览。
 * 支持：txt / md / docx / doc / rtf / mhtml。
 */
export function documentToHtml(filePath, buffer, truncated = false) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".txt":
      return {
        body: `<div class="docpreview"><pre class="plain">${escapeHtml(decodeText(buffer))}</pre></div>`,
        truncated,
      };
    case ".md":
      return { body: markdownToHtml(normalizeNewlines(decodeText(buffer))), truncated };
    case ".docx": {
      const converted = docxToHtml(buffer);
      if (converted) return { body: converted.body, truncated: truncated || converted.truncated };
      return { body: paragraphsToHtml(docToText(buffer)), truncated };
    }
    case ".doc":
      return { body: paragraphsToHtml(docToText(buffer)), truncated };
    case ".rtf":
      return { body: rtfToHtml(buffer), truncated };
    case ".mhtml":
    case ".mht": {
      const html = mhtmlToHtml(buffer);
      if (html === null) {
        return { body: '<div class="docpreview"><p>这个网页存档无法解析。</p></div>', truncated };
      }
      return { body: html, truncated };
    }
    default:
      return null;
  }
}

/** 生成独立预览页：内联 CSS、无脚本，供 iframe 显示。 */
export function previewPage({ title, filename, body, truncated }) {
  const css = `
body{margin:0;padding:20px 22px;font:15px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;background:#fff}
.docpreview{max-width:760px;margin:0 auto}
.docpreview h1{font-size:1.5rem;margin:.2em 0 .6em}
.docpreview h2{font-size:1.3rem;margin:1em 0 .5em}
.docpreview h3{font-size:1.15rem;margin:1em 0 .5em}
.docpreview p{margin:.55em 0}
.docpreview blockquote{margin:.8em 0;padding:6px 14px;border-left:3px solid #cbd5e1;color:#475569;background:#f8fafc}
.docpreview table{border-collapse:collapse;margin:.8em 0;max-width:100%}
.docpreview td,.docpreview th{border:1px solid #cbd5e1;padding:6px 10px;vertical-align:top}
.docpreview img{max-width:100%;height:auto;display:block;margin:.6em 0}
.docpreview ul,.docpreview ol{margin:.5em 0 .5em 1.4em}
.docpreview pre{background:#f1f5f9;border-radius:8px;padding:12px 14px;overflow:auto;font-size:13px;line-height:1.6}
.docpreview pre.plain{background:#fff;padding:0;font:14px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.docpreview code{background:#f1f5f9;border-radius:4px;padding:1px 5px;font-size:.92em}
.docpreview pre code{background:none;padding:0}
.docpreview a{color:#2563eb}
.docpreview hr{border:none;border-top:1px solid #e2e8f0;margin:1.2em 0}
.meta{max-width:760px;margin:0 auto 14px;color:#64748b;font-size:.82rem;border-bottom:1px solid #e2e8f0;padding-bottom:10px}
.trunc{max-width:760px;margin:0 auto 14px;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:8px 12px;font-size:.85rem}
`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${escapeHtml(title)}</title><style>${css}</style></head><body>`
    + `<div class="meta">${escapeHtml(filename)}</div>`
    + (truncated ? `<div class="trunc">文档较大，仅显示开头部分（预览上限 8 MB）。可下载原文件查看完整内容。</div>` : "")
    + body
    + `</body></html>`;
}
