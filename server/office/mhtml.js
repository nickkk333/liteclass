// MHTML（单文件网页存档）预览：把 multipart/related 拆开，首个 text/html
// 作为正文，其余图片/样式表转成 data: URL 内联。与 OfflineU 的 mhtml.go 对应。
const CRLF_BLANK = Buffer.from("\r\n\r\n");
const LF_BLANK = Buffer.from("\n\n");

const fileNameOf = (location) => {
  const cut = Math.max(location.lastIndexOf("/"), location.lastIndexOf("\\"));
  return cut < 0 ? "" : location.slice(cut + 1);
};

const mediaTypeOf = (headers) => {
  const raw = headers["content-type"] || "";
  return (raw.split(";")[0] || "application/octet-stream").trim().toLowerCase();
};

const charsetOf = (headers) => {
  const raw = headers["content-type"] || "";
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(raw);
  return (match ? match[1] : "utf-8").toLowerCase();
};

function parseHeaders(text) {
  const headers = {};
  let last = "";
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && last) {
      headers[last] += " " + line.trim();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    last = line.slice(0, idx).trim().toLowerCase();
    headers[last] = line.slice(idx + 1).trim();
  }
  return headers;
}

function decodeQuotedPrintable(buffer) {
  const text = buffer.toString("latin1");
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "=") { out.push(text.charCodeAt(i)); continue; }
    if (text[i + 1] === "\r" && text[i + 2] === "\n") { i += 2; continue; }
    if (text[i + 1] === "\n") { i += 1; continue; }
    const hex = text.slice(i + 1, i + 3);
    if (/^[0-9a-f]{2}$/i.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      out.push(0x3d);
    }
  }
  return Buffer.from(out);
}

function readParts(buffer) {
  let headerEnd = buffer.indexOf(CRLF_BLANK);
  let separator = 4;
  if (headerEnd < 0) {
    headerEnd = buffer.indexOf(LF_BLANK);
    separator = 2;
  }
  if (headerEnd < 0) return null;
  const top = parseHeaders(buffer.subarray(0, headerEnd).toString("latin1"));
  const contentType = top["content-type"] || "";
  const folded = contentType.replace(/\r?\n[ \t]+/g, " ");
  const match = /boundary\s*=\s*"?([^";\s]+)"?/i.exec(folded);
  if (!match) return null;
  const boundary = match[1];
  return splitParts(buffer.subarray(headerEnd + separator), boundary);
}

function splitParts(body, boundary) {
  const marker = `--${boundary}`;
  const parts = [];
  let index = body.indexOf(marker);
  while (index >= 0) {
    let start = index + marker.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break; // closing boundary
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
    else if (body[start] === 0x0a) start += 1;

    const next = body.indexOf(marker, start);
    const end = next < 0 ? body.length : next;
    let chunk = body.subarray(start, end);
    if (chunk.length >= 2 && chunk[chunk.length - 2] === 0x0d && chunk[chunk.length - 1] === 0x0a) {
      chunk = chunk.subarray(0, chunk.length - 2);
    } else if (chunk.length >= 1 && chunk[chunk.length - 1] === 0x0a) {
      chunk = chunk.subarray(0, chunk.length - 1);
    }

    let headEnd = chunk.indexOf(CRLF_BLANK);
    let sep = 4;
    if (headEnd < 0) {
      headEnd = chunk.indexOf(LF_BLANK);
      sep = 2;
    }
    if (headEnd >= 0) {
      const headers = parseHeaders(chunk.subarray(0, headEnd).toString("latin1"));
      let payload = chunk.subarray(headEnd + sep);
      const encoding = (headers["content-transfer-encoding"] || "").trim().toLowerCase();
      if (encoding === "base64") {
        payload = Buffer.from(payload.toString("latin1").replace(/[\r\n\t ]/g, ""), "base64");
      } else if (encoding === "quoted-printable") {
        payload = decodeQuotedPrintable(payload);
      }
      parts.push({
        headers,
        mediaType: mediaTypeOf(headers),
        charset: charsetOf(headers),
        location: (headers["content-location"] || "").trim(),
        contentID: (headers["content-id"] || "").trim(),
        body: payload,
      });
    }
    if (next < 0) break;
    index = next;
  }
  return parts;
}

function bodyText(part) {
  const charset = part.charset;
  if (charset === "utf-8" || charset === "utf8") return part.body.toString("utf8");
  return part.body.toString("latin1");
}

function replaceReferences(document, assets) {
  const keys = [...assets.keys()].sort((a, b) => b.length - a.length);
  let out = document;
  for (const key of keys) out = out.split(key).join(assets.get(key));
  return out;
}

/** 返回 HTML 片段；无法解析时返回 null。 */
export function mhtmlToHtml(buffer) {
  const parts = readParts(buffer);
  if (!parts || !parts.length) return null;

  let root = null;
  const assets = new Map();
  const inlined = [];

  const register = (part, dataUrl) => {
    const id = part.contentID.trim().replace(/^<|>$/g, "");
    if (id) assets.set(`cid:${id}`, dataUrl);
    if (part.location) {
      assets.set(part.location, dataUrl);
      const name = fileNameOf(part.location);
      if (name) {
        assets.set(name, dataUrl);
        assets.set(`cid:${name}`, dataUrl);
      }
    }
  };

  for (const part of parts) {
    if (!root && part.mediaType.startsWith("text/html")) {
      root = bodyText(part);
      continue;
    }
    inlined.push(part);
    const dataUrl = `data:${part.mediaType};base64,${part.body.toString("base64")}`;
    register(part, dataUrl);
  }
  if (root === null) return null;

  for (const part of inlined) {
    if (!part.mediaType.startsWith("text/css")) continue;
    part.body = Buffer.from(replaceReferences(bodyText(part), assets), "utf8");
    register(part, `data:${part.mediaType};base64,${part.body.toString("base64")}`);
  }

  root = replaceReferences(root, assets);
  root = root.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  return root;
}
