import zlib from "node:zlib";

// 极简 ZIP 读取器：只解析中央目录并按需解压条目（.docx 就是 ZIP + XML）。
// 没有第三方依赖，Node 自带 zlib 足够。
export function readZip(buffer) {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;
  const LOC = 0x04034b50;
  const minEocd = 22;
  let eocd = -1;
  const stop = Math.max(0, buffer.length - 65558);
  for (let i = buffer.length - minEocd; i >= stop; i--) {
    if (buffer.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const count = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cdOffset >= buffer.length) return null;

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count && p + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(p) !== CEN) break;
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const uncompSize = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.slice(p + 46, p + 46 + nameLen).toString("utf8").replace(/\\/g, "/");
    entries.push({ name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.length) return null;

  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));

  return {
    names: entries.map((e) => e.name),
    has(name) { return byName.has(String(name).toLowerCase()); },
    read(name) {
      const entry = byName.get(String(name).toLowerCase());
      if (!entry) return null;
      const lp = entry.localOffset;
      if (lp + 30 > buffer.length || buffer.readUInt32LE(lp) !== LOC) return null;
      const nameLen = buffer.readUInt16LE(lp + 26);
      const extraLen = buffer.readUInt16LE(lp + 28);
      const start = lp + 30 + nameLen + extraLen;
      const end = Math.min(start + (entry.compSize || entry.uncompSize), buffer.length);
      const raw = buffer.slice(start, end);
      if (entry.method === 0) return raw;
      if (entry.method === 8) {
        try { return zlib.inflateRawSync(raw); } catch { return null; }
      }
      return null;
    },
  };
}
