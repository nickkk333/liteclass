// OLE2（Compound File Binary）只读解析：Word 97-2003 的 .doc 把正文放在
// "WordDocument" 流里，把文本分片索引放在 "0Table"/"1Table" 流里。
// 只实现读取侧（与 OfflineU 的 ole.go 对应），任何异常都返回 null，
// 让调用方退回逐字节猜测的兜底方案。

const SIGNATURE = 0xe011cfd0;
const HEADER_LEN = 512;
const DIR_LEN = 128;
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const ROOT_KIND = 5;

export function parseOLE(buffer) {
  try {
    if (buffer.length < HEADER_LEN || buffer.readUInt32LE(0) !== SIGNATURE) return null;
    if (buffer.readUInt16LE(0x1c) !== 0xfffe) return null;
    const shift = buffer.readUInt16LE(0x1e);
    if (shift < 7 || shift > 20) return null;

    const file = {
      data: buffer,
      sectorSize: 1 << shift,
      miniSize: 64,
      miniCutoff: 4096,
      fat: [],
      miniFat: null,
      entries: [],
    };
    const miniShift = buffer.readUInt16LE(0x20);
    if (miniShift >= 4 && miniShift <= shift) file.miniSize = 1 << miniShift;
    const cutoff = buffer.readUInt32LE(0x38);
    if (cutoff > 0) file.miniCutoff = cutoff;

    if (!loadFAT(file)) return null;
    if (!loadDirectory(file)) return null;
    return file;
  } catch {
    return null;
  }
}

function sector(file, index) {
  const offset = (index + 1) * file.sectorSize;
  if (offset >= file.data.length) return null;
  return file.data.slice(offset, Math.min(offset + file.sectorSize, file.data.length));
}

function loadFAT(file) {
  const data = file.data;
  const wanted = data.readUInt32LE(0x2c);
  const sectors = [];
  for (let i = 0; i < 109 && sectors.length < wanted; i++) {
    const at = 0x4c + 4 * i;
    if (at + 4 > data.length) break;
    const value = data.readUInt32LE(at);
    if (value === FREE_SECTOR || value === END_OF_CHAIN) break;
    sectors.push(value);
  }
  let next = data.readUInt32LE(0x44);
  for (let guard = 0; guard < 1 << 16 && sectors.length < wanted; guard++) {
    if (next === END_OF_CHAIN || next === FREE_SECTOR) break;
    const chunk = sector(file, next);
    if (!chunk || chunk.length < 4) break;
    const entries = Math.floor(chunk.length / 4) - 1;
    for (let i = 0; i < entries && sectors.length < wanted; i++) {
      const value = chunk.readUInt32LE(4 * i);
      if (value === FREE_SECTOR || value === END_OF_CHAIN) continue;
      sectors.push(value);
    }
    next = chunk.readUInt32LE(4 * entries);
  }
  if (!sectors.length) return false;
  for (const index of sectors) {
    const chunk = sector(file, index);
    if (!chunk) return false;
    for (let i = 0; i + 4 <= chunk.length; i += 4) file.fat.push(chunk.readUInt32LE(i));
  }
  return true;
}

function chain(file, start, limit) {
  const out = [];
  let length = 0;
  let index = start;
  for (let seen = 0; index !== END_OF_CHAIN && index !== FREE_SECTOR; seen++) {
    if (seen > file.fat.length || index >= file.fat.length) break;
    const chunk = sector(file, index);
    if (!chunk) break;
    out.push(chunk);
    length += chunk.length;
    if (limit > 0 && length >= limit) break;
    index = file.fat[index];
  }
  return Buffer.concat(out);
}

function chainBytes(file, start, size) {
  const data = chain(file, start, size);
  return data.length > size ? data.subarray(0, size) : data;
}

function loadDirectory(file) {
  const start = file.data.readUInt32LE(0x30);
  const raw = chain(file, start, 0);
  if (raw.length < DIR_LEN) return false;
  for (let offset = 0; offset + DIR_LEN <= raw.length; offset += DIR_LEN) {
    const entry = parseDirEntry(raw.subarray(offset, offset + DIR_LEN));
    if (!entry.kind) continue;
    file.entries.push(entry);
  }
  return file.entries.length > 0;
}

function parseDirEntry(raw) {
  let nameLen = raw.readUInt16LE(0x40);
  if (nameLen > 64) nameLen = 64;
  const name = raw.subarray(0, Math.max(0, nameLen - 2)).toString("utf16le");
  return {
    name,
    kind: raw[0x42],
    start: raw.readUInt32LE(0x74),
    size: raw.readUInt32LE(0x78),
  };
}

function find(file, name) {
  const lowered = name.toLowerCase();
  return file.entries.find((entry) => entry.name.toLowerCase() === lowered) || null;
}

function miniAllocation(file) {
  if (file.miniFat) return file.miniFat;
  const start = file.data.readUInt32LE(0x3c);
  if (start === END_OF_CHAIN || start === FREE_SECTOR) return null;
  const count = file.data.readUInt32LE(0x40);
  const raw = chainBytes(file, start, count * file.sectorSize);
  if (!raw.length) return null;
  file.miniFat = [];
  for (let i = 0; i + 4 <= raw.length; i += 4) file.miniFat.push(raw.readUInt32LE(i));
  return file.miniFat;
}

function miniStream(file, entry) {
  const root = find(file, "Root Entry");
  if (!root) return null;
  const source = chainBytes(file, root.start, root.size);
  const links = miniAllocation(file);
  if (!links) return null;
  const out = [];
  let length = 0;
  let index = entry.start;
  for (let seen = 0; seen <= links.length; seen++) {
    if (index === END_OF_CHAIN || index === FREE_SECTOR || index >= links.length) break;
    const offset = index * file.miniSize;
    if (offset >= source.length) break;
    const chunk = source.subarray(offset, Math.min(offset + file.miniSize, source.length));
    out.push(chunk);
    length += chunk.length;
    if (length >= entry.size) break;
    index = links[index];
  }
  const data = Buffer.concat(out);
  return data.length > entry.size ? data.subarray(0, entry.size) : data;
}

/** 读取命名流；不存在或损坏返回 null。 */
export function oleStream(file, name) {
  const entry = find(file, name);
  if (!entry) return null;
  if (!entry.size && entry.kind !== ROOT_KIND) return Buffer.alloc(0);
  if (entry.kind !== ROOT_KIND && entry.size < file.miniCutoff) return miniStream(file, entry);
  return chainBytes(file, entry.start, entry.size);
}
