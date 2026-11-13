import { parseOLE, oleStream } from "./ole.js";
import { decodeCP1252 } from "../encoding.js";

// Word 97-2003 (.doc) 的正文按“分片表”存储：每个分片说明字符范围、
// 在 WordDocument 流中的偏移，以及是单字节（Windows-1252）还是 UTF-16LE。
// 读不到索引时退回 OfflineU 的逐字节猜测算法。

const SIGNATURE = 0xa5ec;
const FLAGS_OFFSET = 0x0a;
const NFIB_OFFSET = 0x02;
const FC_CLX_OFFSET = 0x1a2;
const CCP_TEXT_OFFSET = 0x4c;
const CB_RGFCLCB_OFFSET = 0x98;
const FC_MIN_OFFSET = 0x18;
const FC_MAC_OFFSET = 0x1c;
const FIB_MIN_LEN = 0x1aa;
const WORD97_NFIB = 0x00c1;
const FLAG_ENCRYPTED = 0x0100;
const FLAG_WHICH_TABLE = 0x0200;
const PROPERTY_MARKER = 0x01;
const PIECE_TABLE_MARKER = 0x02;
const MAX_PIECES = 1 << 16;

/** 返回 .doc 的可读正文；无法解析时用启发式扫描，保证总有内容可看。 */
export function docToText(buffer) {
  const text = structuredDocText(buffer);
  if (text) return text;
  return guessedDocText(buffer);
}

function structuredDocText(buffer) {
  const container = parseOLE(buffer);
  if (!container) return "";
  const word = oleStream(container, "WordDocument");
  if (!word || word.length < FIB_MIN_LEN) return "";
  if (word.readUInt16LE(0) !== SIGNATURE) return "";
  const flags = word.readUInt16LE(FLAGS_OFFSET);
  if (flags & FLAG_ENCRYPTED) return "";
  const ccpText = word.readUInt32LE(CCP_TEXT_OFFSET);
  if (!ccpText) return "";

  const pieceText = pieceTableText(container, word, flags, ccpText);
  if (pieceText) return cleanDocText(pieceText);
  const flat = flatText(word, ccpText);
  return flat ? cleanDocText(flat) : "";
}

function pieceTableText(container, word, flags, ccpText) {
  if (word.readUInt16LE(CB_RGFCLCB_OFFSET) <= 33) return "";
  const fcClx = word.readUInt32LE(FC_CLX_OFFSET);
  const lcbClx = word.readUInt32LE(FC_CLX_OFFSET + 4);
  if (!lcbClx) return "";
  const table = oleStream(container, flags & FLAG_WHICH_TABLE ? "1Table" : "0Table");
  if (!table || fcClx + lcbClx > table.length) return "";
  const clx = table.subarray(fcClx, fcClx + lcbClx);

  const pieces = parsePieceTable(clx);
  if (!pieces) return "";
  const parts = [];
  let remaining = ccpText;
  for (const piece of pieces) {
    if (!remaining) break;
    const count = Math.min(piece.cpEnd - piece.cpStart, remaining);
    remaining -= count;
    parts.push(pieceText(word, piece, count));
  }
  return parts.join("");
}

function parsePieceTable(clx) {
  let offset = 0;
  while (offset < clx.length) {
    if (clx[offset] === PROPERTY_MARKER) {
      if (offset + 3 > clx.length) return null;
      offset += 3 + clx.readUInt16LE(offset + 1);
    } else if (clx[offset] === PIECE_TABLE_MARKER) {
      if (offset + 5 > clx.length) return null;
      const length = clx.readUInt32LE(offset + 1);
      if (length < 4 || offset + 5 + length > clx.length) return null;
      return parsePcdTable(clx.subarray(offset + 5, offset + 5 + length));
    } else {
      return null;
    }
  }
  return null;
}

function parsePcdTable(plc) {
  if (plc.length < 12 || (plc.length - 4) % 12 !== 0) return null;
  const count = (plc.length - 4) / 12;
  if (count > MAX_PIECES) return null;
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const cpStart = plc.readUInt32LE(4 * i);
    const cpEnd = plc.readUInt32LE(4 * (i + 1));
    if (cpEnd < cpStart) return null;
    const field = plc.readUInt32LE(4 * (count + 1) + 8 * i + 2);
    let offset = field & 0x3fffffff;
    const compressed = (field & 0x40000000) !== 0;
    if (compressed) offset = Math.floor(offset / 2);
    pieces.push({ cpStart, cpEnd, offset, compressed });
  }
  return pieces.length ? pieces : null;
}

function pieceText(word, piece, count) {
  if (!count || piece.offset < 0) return "";
  if (piece.compressed) {
    const end = piece.offset + count;
    if (end > word.length) return "";
    return decodeCP1252(word.subarray(piece.offset, end));
  }
  const end = piece.offset + count * 2;
  if (end > word.length) return "";
  return word.subarray(piece.offset, end).toString("utf16le");
}

function flatText(word, ccpText) {
  if (word.readUInt16LE(NFIB_OFFSET) >= WORD97_NFIB) return "";
  if (word.length < FC_MAC_OFFSET + 4) return "";
  const fcMin = word.readUInt32LE(FC_MIN_OFFSET);
  const fcMac = word.readUInt32LE(FC_MAC_OFFSET);
  if (fcMac <= fcMin || fcMac > word.length) return "";
  const run = word.subarray(fcMin, fcMac);
  if (ccpText * 2 === run.length) return run.toString("utf16le");
  if (ccpText <= run.length) return decodeCP1252(run.subarray(0, ccpText));
  return "";
}

/** Word 控制字符 → 读者期待的样子：段落/换行/分页转 \n，单元格转 \t，字段指令丢弃。 */
export function cleanDocText(text) {
  let out = "";
  let inField = false;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (inField) {
      if (code === 0x14 || code === 0x15) inField = false;
      continue;
    }
    switch (code) {
      case 0x0d: case 0x0a: case 0x0b: case 0x0c: out += "\n"; break;
      case 0x07: out += "\t"; break;
      case 0x09: out += "\t"; break;
      case 0x13: inField = true; break;
      case 0x1e: out += "-"; break;
      case 0x14: case 0x15: break;
      default: if (code >= 0x20) out += ch;
    }
  }
  return out;
}

// ---------- 兜底：逐字节猜测（Word 6/95、损坏或非标准文件） ----------

const CJK = (r) =>
  (r >= 0x4e00 && r <= 0x9fff) || (r >= 0x3400 && r <= 0x4dbf) ||
  (r >= 0x3040 && r <= 0x30ff) || (r >= 0xac00 && r <= 0xd7af) ||
  (r >= 0xff00 && r <= 0xffef);

const DOC_PUNCT = new Set([..."，。、；：？！「」『』（）《》—…·　“”‘’"]);

function looksLikeSingleByteProse(s) {
  if (s.length < 8) return false;
  let good = 0, hasSpace = false, hasLetter = false;
  for (const ch of s) {
    if (ch === " ") { good++; hasSpace = true; }
    else if (/[a-z]/i.test(ch)) { good++; hasLetter = true; }
    else if (/[0-9]/.test(ch)) good++;
  }
  return hasLetter && hasSpace && good * 4 >= s.length * 3;
}

export function guessedDocText(data) {
  const latin = data.toString("latin1");
  const spans = [];
  const asciiTexts = [];
  for (const match of latin.matchAll(/[\x20-\x7e]{8,}/g)) {
    const candidate = match[0];
    if (!looksLikeSingleByteProse(candidate)) continue;
    spans.push([match.index, match.index + candidate.length]);
    asciiTexts.push(candidate.trim());
  }
  const overlapsASCII = (i) => spans.some(([start, end]) => i < end && i + 1 >= start);

  const collect = (align) => {
    const found = [];
    let units = [];
    const flush = () => {
      if (units.length >= 8) {
        const text = units.map((unit) => String.fromCharCode(unit)).join("").trim();
        if (text) found.push(text);
      }
      units = [];
    };
    for (let i = align; i + 1 < data.length; i += 2) {
      if (overlapsASCII(i)) { flush(); continue; }
      const lo = data[i], hi = data[i + 1];
      const r = lo | (hi << 8);
      if (hi === 0 && lo >= 0x20 && lo < 0x7f) { units.push(r); continue; }
      if (CJK(r) || DOC_PUNCT.has(String.fromCharCode(r))) { units.push(r); continue; }
      flush();
    }
    flush();
    return found;
  };

  const score = (parts) => parts.reduce((sum, part) => sum + [...part].length, 0);
  let texts = collect(0);
  const other = collect(1);
  if (score(other) > score(texts)) texts = other;

  for (const s of asciiTexts) {
    if (!s) continue;
    if (/Microsoft|Word\.Document|ObjInfo|Root Entry/.test(s)) continue;
    if (texts.some((t) => t.includes(s) || s.includes(t))) continue;
    texts.push(s);
  }

  return splitParagraphs(texts.join("\n")).join("\n\n");
}

export function splitParagraphs(text) {
  const paragraphs = [];
  let current = [];
  const flush = () => {
    const p = current.join(" ").trim();
    current = [];
    if (p) paragraphs.push(p);
  };
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) { flush(); continue; }
    current.push(line.trim());
    if (current.join(" ").length > 600) flush();
  }
  flush();
  return paragraphs;
}
