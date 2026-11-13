import fs from "node:fs";
import path from "node:path";
import { mimeOf } from "../media.js";

// HTML 预览会把同目录下的图片 / 样式表内联成 data: URL。
// 原因：预览 iframe 通过 ?token= 鉴权，而页面里的相对地址不会带上 token，
// 直接请求会被 401 拦下；内联后既保留了图片，又不需要放宽鉴权。

const MAX_ASSET = 4 * 1024 * 1024;
const MAX_TOTAL = 12 * 1024 * 1024;

const isRemote = (ref) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(String(ref).trim());

function resolveLocal(baseDir, ref) {
  const clean = String(ref || "").trim();
  if (!clean || isRemote(clean)) return null;
  let decoded;
  try { decoded = decodeURIComponent(clean.split(/[?#]/)[0]); } catch { return null; }
  if (!decoded) return null;
  const root = path.resolve(baseDir);
  const full = path.resolve(root, decoded.replace(/^[/\\]+/, ""));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function assetReader(baseDir) {
  let total = 0;
  const cache = new Map();
  return (ref) => {
    const full = resolveLocal(baseDir, ref);
    if (!full) return null;
    if (cache.has(full)) return cache.get(full);
    let url = null;
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.size <= MAX_ASSET && total + stat.size <= MAX_TOTAL) {
        const buffer = fs.readFileSync(full);
        total += buffer.length;
        url = `data:${mimeOf(full, "application/octet-stream")};base64,${buffer.toString("base64")}`;
      }
    } catch {}
    cache.set(full, url);
    return url;
  };
}

function rewriteCss(css, read) {
  return String(css).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (all, quote, ref) => {
    const url = read(ref);
    return url ? `url("${url}")` : all;
  });
}

/**
 * 把 HTML 中引用的同目录资源内联。返回处理后的 HTML。
 * 远程地址、data: 地址和目录外文件保持原样。
 */
export function inlineLocalAssets(html, baseDir) {
  const read = assetReader(baseDir);
  let out = String(html);

  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
    (all, attrs, css) => `<style${attrs}>${rewriteCss(css, read)}</style>`);

  out = out.replace(/<link\b([^>]*?)\/?>/gi, (all, attrs) => {
    if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(attrs)) return all;
    const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const href = match ? (match[1] ?? match[2] ?? match[3]) : "";
    if (!href) return all;
    const full = resolveLocal(baseDir, href);
    if (!full) return all;
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > MAX_ASSET) return all;
      const css = rewriteCss(fs.readFileSync(full, "utf8"), read);
      return `<style>${css}</style>`;
    } catch {
      return all;
    }
  });

  out = out.replace(/\b(src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (all, attr, dq, sq, bare) => {
      const ref = dq ?? sq ?? bare ?? "";
      const url = read(ref);
      return url ? `${attr}="${url}"` : all;
    });

  return out;
}
