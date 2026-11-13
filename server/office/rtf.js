// RTF 预览：只取正文与粗体/斜体/下划线、段落和换行，字体、颜色、
// 对象等一律忽略。与 OfflineU 的 rtfToHTML 对应。
const escapeHtml = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

export function rtfToHtml(buffer) {
  const text = buffer.toString("latin1");
  let out = '<div class="docpreview">';
  let para = "";
  let seg = "";
  let bold = 0, italic = 0, underline = 0;
  let depth = 0;
  let skipDepth = -1;
  const stack = [];

  const flushSeg = () => {
    if (!seg) return;
    let value = escapeHtml(seg);
    seg = "";
    if (underline > 0) value = `<u>${value}</u>`;
    if (italic > 0) value = `<em>${value}</em>`;
    if (bold > 0) value = `<strong>${value}</strong>`;
    para += value;
  };
  const flushPara = () => {
    flushSeg();
    const value = para.trim();
    para = "";
    if (value) out += `<p>${value}</p>`;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "{") {
      depth++;
      stack.push({ bold, italic, underline });
      const rest = text.slice(i + 1);
      if (/^\\(?:\*|fonttbl|colortbl|stylesheet|header|footer|pict|object|info)\b/.test(rest) ||
          rest.startsWith("\\*\\")) {
        skipDepth = depth;
      }
      i++;
    } else if (c === "}") {
      if (skipDepth === depth) skipDepth = -1;
      const state = stack.pop();
      if (state && (state.bold !== bold || state.italic !== italic || state.underline !== underline)) {
        flushSeg();
        bold = state.bold; italic = state.italic; underline = state.underline;
      }
      depth--;
      i++;
    } else if (c === "\\" && skipDepth < 0) {
      const j = i + 1;
      if (j >= text.length) { i++; continue; }
      const next = text[j];
      if (next === "\\" || next === "{" || next === "}") {
        seg += next;
        i += 2;
      } else if (next === "'") {
        const hex = text.slice(j + 1, j + 3);
        if (/^[0-9a-f]{2}$/i.test(hex)) {
          seg += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          i += 2;
        }
      } else if (next === "\n" || next === "\r") {
        i += 2;
      } else if (next === "*") {
        skipDepth = depth;
        i += 2;
      } else {
        let k = j;
        while (k < text.length && /[a-z]/i.test(text[k])) k++;
        const word = text.slice(j, k);
        let m = k;
        let negative = false;
        if (text[m] === "-") { negative = true; m++; }
        let num = 0;
        let hasNum = false;
        while (m < text.length && text[m] >= "0" && text[m] <= "9") {
          num = num * 10 + Number(text[m]);
          m++;
          hasNum = true;
        }
        if (negative) num = -num;
        if (text[m] === " ") m++;

        switch (word) {
          case "par": case "line": case "row": flushPara(); break;
          case "tab": seg += "    "; break;
          case "b":
            flushSeg();
            if (!hasNum || num !== 0) bold++; else bold = 0;
            break;
          case "i":
            flushSeg();
            if (!hasNum || num !== 0) italic++; else italic = 0;
            break;
          case "ul": case "ulw": case "uld":
            flushSeg();
            if (!hasNum || num !== 0) underline++; else underline = 0;
            break;
          case "ulnone": flushSeg(); underline = 0; break;
          case "plain": case "pard":
            flushSeg(); bold = 0; italic = 0; underline = 0;
            break;
          case "ldblquote": seg += "\u201c"; break;
          case "rdblquote": seg += "\u201d"; break;
          case "endash": seg += "\u2013"; break;
          case "emdash": seg += "\u2014"; break;
          case "bullet": seg += "\u2022 "; break;
          case "lquote": seg += "'"; break;
          case "rquote": seg += "'"; break;
          case "u":
            seg += String.fromCharCode(num);
            if (m < text.length) m++;
            break;
          case "fonttbl": case "colortbl": case "stylesheet": case "header":
          case "footer": case "pict": case "object": case "info":
            skipDepth = depth;
            break;
          default:
            break;
        }
        i = m;
      }
    } else if (skipDepth >= 0) {
      i++;
    } else if (c === "\r" || c === "\n") {
      i++;
    } else {
      seg += c;
      i++;
    }
  }
  flushPara();
  return out + "</div>";
}
