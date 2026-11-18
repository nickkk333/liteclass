import path from "node:path";
import { decodeText, normalizeNewlines } from "./encoding.js";

// 浏览器 <track> 只认 WebVTT，这里把常见的字幕格式统一转换
// （与 OfflineU 的 subtitles.go 对应）。

const timestampPattern = /(\d{1,3}:\d{2}:\d{2}),(\d{3})/g;
const indexLinePattern = /^\s*\d+\s*$/;

export function convertSRTToVTT(input) {
  const text = normalizeNewlines(input);
  const lines = [];
  for (const line of text.split("\n")) {
    if (indexLinePattern.test(line)) continue;
    lines.push(line.replace(timestampPattern, "$1.$2"));
  }
  const body = lines.join("\n").replace(/^\n+|\n+$/g, "");
  return body ? `WEBVTT\n\n${body}\n` : "WEBVTT\n";
}

const ensureVTTHeader = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return "WEBVTT\n";
  if (trimmed.startsWith("WEBVTT")) return text;
  return `WEBVTT\n\n${text.replace(/^\n+|\n+$/g, "")}\n`;
};

const vttDocument = (cues) => {
  const body = cues.join("\n\n").trim();
  return body ? `WEBVTT\n\n${body}\n` : "WEBVTT\n";
};

export function clockFromMS(total) {
  let value = Math.max(0, Math.round(total));
  const hours = Math.floor(value / 3600000);
  value %= 3600000;
  const minutes = Math.floor(value / 60000);
  value %= 60000;
  const seconds = Math.floor(value / 1000);
  const ms = value % 1000;
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}`;
};

const fractionMs = (fraction) => {
  if (!fraction) return 0;
  const value = Number(fraction);
  if (Number.isNaN(value)) return 0;
  if (fraction.length === 1) return value * 100;
  if (fraction.length === 2) return value * 10;
  return value;
};

const hoursToMS = (h, m, s) => ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;

const intervalTimingPattern = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?\s*,\s*(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/;

function convertIntervalToVTT(input) {
  const cues = [];
  let current = [];
  const flush = () => {
    if (current.length) { cues.push(current.join("\n")); current = []; }
  };
  for (const line of normalizeNewlines(input).split("\n")) {
    const trimmed = line.trim();
    const match = intervalTimingPattern.exec(trimmed);
    if (match) {
      flush();
      const start = clockFromMS(hoursToMS(match[1], match[2], match[3]) + fractionMs(match[4]));
      const end = clockFromMS(hoursToMS(match[5], match[6], match[7]) + fractionMs(match[8]));
      current = [`${start} --> ${end}`];
      continue;
    }
    if (!trimmed) { flush(); continue; }
    if (!current.length) continue;
    current.push(line);
  }
  flush();
  return vttDocument(cues);
}

const assTimePattern = /^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/;
const assOverridePattern = /\{\\[^}]*\}/g;

function parseASSColumns(header) {
  let start = -1, end = -1, text = -1;
  header.split(",").forEach((name, index) => {
    switch (name.trim().toLowerCase()) {
      case "start": start = index; break;
      case "end": end = index; break;
      case "text": text = index; break;
    }
  });
  return { start, end, text, ok: start >= 0 && end >= 0 && text >= 0 };
}

function parseASSTime(value) {
  const match = assTimePattern.exec(String(value).trim());
  if (!match) return null;
  const ms = ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + fractionMs(match[4]);
  return clockFromMS(ms);
}

function convertASSToVTT(input) {
  const cues = [];
  let section = "";
  let startCol = 1, endCol = 2, textCol = 9;
  for (const line of normalizeNewlines(input).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      section = trimmed.toLowerCase();
      continue;
    }
    if (section && section !== "[events]") continue;
    if (trimmed.toLowerCase().startsWith("format:")) {
      const parsed = parseASSColumns(trimmed.slice("format:".length));
      if (parsed.ok) { startCol = parsed.start; endCol = parsed.end; textCol = parsed.text; }
      continue;
    }
    if (!trimmed.toLowerCase().startsWith("dialogue:")) continue;
    const fields = trimmed.slice("dialogue:".length).split(",", textCol + 1).map((part) => part.trim());
    if (fields.length <= textCol || fields.length <= startCol || fields.length <= endCol) continue;
    const start = parseASSTime(fields[startCol]);
    const end = parseASSTime(fields[endCol]);
    if (!start || !end) continue;
    const payload = fields[textCol]
      .replace(assOverridePattern, "")
      .replace(/\\N/g, "\n")
      .replace(/\\n/g, "\n")
      .trim();
    if (!payload) continue;
    cues.push(`${start} --> ${end}\n${payload}`);
  }
  return vttDocument(cues);
}

const microDVDPattern = /^\{(\d+)\}\{(\d+)\}(.*)$/;
const microDVDCodePattern = /\{[^}]*\}/g;

function looksLikeMicroDVD(input) {
  for (const line of normalizeNewlines(input).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return microDVDPattern.test(trimmed);
  }
  return false;
}

function convertMicroDVDToVTT(input) {
  const defaultFPS = 25;
  let fps = defaultFPS;
  const cues = [];
  let firstLine = true;
  for (const line of normalizeNewlines(input).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = microDVDPattern.exec(trimmed);
    if (!match) continue;
    const startFrame = Number(match[1]);
    const endFrame = Number(match[2]);
    let payload = match[3].trim();
    if (firstLine) {
      firstLine = false;
      if (startFrame === endFrame) {
        const declared = Number(payload);
        if (Number.isFinite(declared) && declared > 0) { fps = declared; continue; }
      }
    }
    payload = payload.replace(microDVDCodePattern, "").trim();
    if (!payload || endFrame < startFrame) continue;
    const start = clockFromMS((startFrame * 1000) / fps);
    const end = clockFromMS((endFrame * 1000) / fps);
    cues.push(`${start} --> ${end}\n${payload}`);
  }
  return vttDocument(cues);
}

/** 按扩展名把字幕文本转换为 WebVTT。 */
export function convertSubtitleToVTT(filePath, text) {
  switch (path.extname(String(filePath)).toLowerCase()) {
    case ".vtt":
      return ensureVTTHeader(normalizeNewlines(text));
    case ".sbv":
      return convertIntervalToVTT(text);
    case ".sub":
      return looksLikeMicroDVD(text) ? convertMicroDVDToVTT(text) : convertIntervalToVTT(text);
    case ".ass":
    case ".ssa":
      return convertASSToVTT(text);
    default:
      return convertSRTToVTT(text);
  }
}

/** 读取字幕文件并统一解码 */
export function subtitleText(buffer) {
  return decodeText(buffer);
}

const srtClock = (ms) => {
  const value = Math.max(0, Math.round(ms));
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return `${pad(Math.floor(value / 3600000))}:${pad(Math.floor((value % 3600000) / 60000))}:${pad(Math.floor((value % 60000) / 1000))},${pad(value % 1000, 3)}`;
};

/** VTT 时间（hh:mm:ss.mmm 或 mm:ss.mmm）→ 毫秒 */
function vttTimeToMS(value) {
  const parts = String(value || "").trim().replace(",", ".").split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [hours, minutes, seconds] = parts.slice(-3);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * WebVTT → SRT。电视（DLNA 渲染器）对外挂字幕基本只认 SRT，
 * 所以投屏统一转成 SRT；offsetSeconds 用于转码流从中间起播时对齐时间轴。
 */
export function vttToSRT(input, offsetSeconds = 0) {
  const offset = Math.max(0, Number(offsetSeconds) || 0) * 1000;
  const cues = [];
  let block = [];
  const flush = () => {
    if (!block.length) return;
    const lines = block;
    block = [];
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    // WEBVTT 头、NOTE / STYLE / REGION 块没有时间轴，直接丢掉
    if (timingIndex < 0) return;
    const [fromRaw, toRaw] = lines[timingIndex].split("-->");
    const start = vttTimeToMS(fromRaw);
    const end = vttTimeToMS(String(toRaw || "").trim().split(/\s+/)[0]);
    const body = lines.slice(timingIndex + 1).join("\n").trim();
    if (start == null || end == null || !body) return;
    const from = start - offset;
    const to = end - offset;
    if (to <= 0) return;
    cues.push(`${srtClock(Math.max(0, from))} --> ${srtClock(to)}\n${body}`);
  };
  for (const line of normalizeNewlines(input).split("\n")) {
    if (!line.trim()) flush();
    else block.push(line);
  }
  flush();
  if (!cues.length) return "";
  // SRT 传统上是 CRLF 换行，老的电视播放器解析更稳
  return `${cues.map((cue, index) => `${index + 1}\n${cue}`).join("\n\n")}\n`.replace(/\n/g, "\r\n");
}
