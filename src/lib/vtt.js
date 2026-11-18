// WebVTT 解析与当前字幕选择：给画面内自绘字幕（SubtitleOverlay）用。
// 只处理投屏/播放需要的部分：时间轴 + 文本，行内标签直接去掉。

const TIMING = /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

function toSeconds(value) {
  const parts = String(value).replace(",", ".").split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [hours, minutes, seconds] = parts.slice(-3);
  if (![hours, minutes, seconds].every(Number.isFinite)) return 0;
  return hours * 3600 + minutes * 60 + seconds;
}

/** WebVTT → [{start, end, text}]（按 start 升序） */
export function parseVTT(text) {
  const cues = [];
  let block = [];
  const flush = () => {
    if (!block.length) return;
    const lines = block;
    block = [];
    const index = lines.findIndex((line) => TIMING.test(line));
    if (index < 0) return;
    const match = TIMING.exec(lines[index]);
    const body = lines.slice(index + 1).join("\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .trim();
    if (!body) return;
    const start = toSeconds(match[1]);
    const end = toSeconds(match[2]);
    if (!(end > start)) return;
    cues.push({ start, end, text: body });
  };
  for (const line of String(text || "").replace(/\r/g, "").split("\n")) {
    if (line.trim()) block.push(line);
    else flush();
  }
  flush();
  return cues.sort((a, b) => a.start - b.start);
}

/** 某一时刻要显示的字幕文本（多条同屏时按顺序换行拼接）。 */
export function activeSubtitleText(cues, time) {
  if (!cues?.length) return "";
  const lines = [];
  for (const cue of cues) {
    if (cue.start > time) break;
    if (time < cue.end) lines.push(cue.text);
  }
  return lines.join("\n");
}
