import { isUtf8 } from "node:buffer";

// Windows-1252 与 Latin-1 在 0xA0-0xFF 上一致；0x80-0x9F 是不同的符号。
const CP1252 = {
  0x80: "\u20ac", 0x82: "\u201a", 0x83: "\u0192", 0x84: "\u201e",
  0x85: "\u2026", 0x86: "\u2020", 0x87: "\u2021", 0x88: "\u02c6",
  0x89: "\u2030", 0x8a: "\u0160", 0x8b: "\u2039", 0x8c: "\u0152",
  0x8e: "\u017d", 0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201c",
  0x94: "\u201d", 0x95: "\u2022", 0x96: "\u2013", 0x97: "\u2014",
  0x98: "\u02dc", 0x99: "\u2122", 0x9a: "\u0161", 0x9b: "\u203a",
  0x9c: "\u0153", 0x9e: "\u017e", 0x9f: "\u0178",
};

export function decodeCP1252(buffer) {
  let out = "";
  for (const byte of buffer) out += CP1252[byte] || String.fromCharCode(byte);
  return out;
}

/** 去掉 BOM、统一换行 */
export function normalizeNewlines(text) {
  return String(text)
    .replace(/^\ufeff/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/** 文本文件解码：UTF-8 优先，非法字节退回 Windows-1252 */
export function decodeText(buffer) {
  const data = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;
  if (isUtf8(data)) return data.toString("utf8");
  return decodeCP1252(data);
}
