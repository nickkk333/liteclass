import path from "node:path";
import { readZip } from "./zip.js";

// 与 OfflineU 相同的上限：单张内嵌图片与整篇文档的读取量都有封顶，
// 避免一份超大文档拖垮小 NAS。
const MAX_INLINE_IMAGE = 512 * 1024;
const MAX_INLINE_TOTAL = 4 * 1024 * 1024;

const escapeHtml = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function decodeXml(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const imageMime = (name) => {
  switch (path.extname(name).toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".bmp": return "image/bmp";
    case ".svg": return "image/svg+xml";
    default: return "image/png";
  }
};

/**
 * .docx 是 ZIP + XML：读取 word/document.xml 并映射为段落、标题、
 * 列表、表格、超链接与内嵌图片。返回 null 表示不是有效的 ZIP。
 */
export function docxToHtml(buffer) {
  const zip = readZip(buffer);
  if (!zip) return null;
  const raw = zip.read("word/document.xml");
  if (!raw) {
    return { body: '<div class="docpreview"><p>无法读取该文档的正文。</p></div>', truncated: false };
  }

  const images = [];
  let total = 0;
  for (const name of zip.names) {
    if (!/^word\/media\//i.test(name)) continue;
    const data = zip.read(name);
    if (!data || data.length > MAX_INLINE_IMAGE || total + data.length > MAX_INLINE_TOTAL) continue;
    images.push({ name, data });
    total += data.length;
  }
  images.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  let imageIndex = 0;
  const nextImage = () => {
    const image = images[imageIndex++];
    if (!image) return "";
    return `<img src="data:${imageMime(image.name)};base64,${image.data.toString("base64")}" alt="" loading="lazy">`;
  };

  const xml = raw.toString("utf8");
  const html = renderBody(xml, nextImage);
  return { body: `<div class="docpreview">${html}</div>`, truncated: false };
}

function renderBody(xml, nextImage) {
  const out = [];
  let listOpen = "";
  const flushList = () => {
    if (listOpen) { out.push(`</${listOpen}>`); listOpen = ""; }
  };

  // 先把表格切出来，剩余部分按段落处理。
  const pieces = xml.split(/(<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>)/);
  for (const piece of pieces) {
    if (!piece) continue;
    if (/^<w:tbl/i.test(piece)) {
      flushList();
      out.push(renderTable(piece, nextImage));
      continue;
    }
    const paraRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
    let match;
    while ((match = paraRe.exec(piece))) {
      const inner = match[1];
      const style = (/<w:pStyle\s+w:val="([^"]+)"/.exec(inner) || [])[1] || "";
      const lowered = style.toLowerCase();
      const content = renderInline(inner, nextImage);
      if (!content || (!content.replace(/<[^>]*>/g, "").trim() && !content.includes("<img"))) continue;

      const isList = /^list/.test(lowered) || /<w:numPr[\s>]/.test(inner);
      const isOrdered = /number|ordered/.test(lowered);
      const heading = /^heading([1-6])$/.exec(lowered);
      if (heading) {
        flushList();
        const level = Number(heading[1]);
        out.push(`<h${level}>${content}</h${level}>`);
      } else if (lowered === "title") {
        flushList();
        out.push(`<h1>${content}</h1>`);
      } else if (lowered === "quote" || lowered === "intensequote") {
        flushList();
        out.push(`<blockquote>${content}</blockquote>`);
      } else if (isList) {
        const want = isOrdered ? "ol" : "ul";
        if (listOpen !== want) { flushList(); out.push(`<${want}>`); listOpen = want; }
        out.push(`<li>${content}</li>`);
      } else {
        flushList();
        out.push(`<p>${content}</p>`);
      }
    }
  }
  flushList();
  return out.join("");
}

function renderTable(tableXml, nextImage) {
  const rows = [];
  const rowRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
  let row;
  while ((row = rowRe.exec(tableXml))) {
    const cells = [];
    const cellRe = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
    let cell;
    while ((cell = cellRe.exec(row[1]))) {
      const paragraphs = [];
      const paraRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
      let para;
      while ((para = paraRe.exec(cell[1]))) {
        const content = renderInline(para[1], nextImage);
        if (content.replace(/<[^>]*>/g, "").trim() || content.includes("<img")) paragraphs.push(content);
      }
      cells.push(`<td>${paragraphs.join("<br>")}</td>`);
    }
    if (cells.length) rows.push(`<tr>${cells.join("")}</tr>`);
  }
  if (!rows.length) return "";
  return `<table>${rows.join("")}</table>`;
}

function renderInline(paragraphXml, nextImage) {
  let out = "";
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let run;
  while ((run = runRe.exec(paragraphXml))) out += renderRun(run[1], nextImage);
  return out;
}

function renderRun(runXml, nextImage) {
  const rpr = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(runXml) || [])[1] || "";
  const bold = /<w:b(?:\s+w:val="(?:0|false|off)")?\s*\/>/.test(rpr);
  const italic = /<w:i(?:\s+w:val="(?:0|false|off)")?\s*\/>/.test(rpr);
  const underline = /<w:u(?:\s+w:val="(?:0|false|none)")?[^>]*>/.test(rpr);
  const strike = /<w:strike(?:\s+w:val="(?:0|false|off)")?\s*\/>/.test(rpr);

  let content = "";
  const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let text;
  while ((text = textRe.exec(runXml))) content += escapeHtml(decodeXml(text[1]));
  if (/<w:tab\s*\/>/.test(runXml)) content += "    ";
  if (/<w:br\s*\/>|<w:cr\s*\/>/.test(runXml)) content += "<br>";
  if (/<w:drawing[\s>]|<w:pict[\s>]/.test(runXml)) content += nextImage();

  if (!content) return "";
  if (strike) content = `<s>${content}</s>`;
  if (underline) content = `<u>${content}</u>`;
  if (italic) content = `<em>${content}</em>`;
  if (bold) content = `<strong>${content}</strong>`;
  return content;
}
