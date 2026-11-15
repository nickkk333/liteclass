import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileStat, openRange } from "./files.js";
import { extOf, VIDEO_EXTS } from "./media.js";
import { setting } from "./db.js";
import {
  probe, browserPlayable, ffmpegRun, ffmpegProcess, ffmpegAvailable, binaries,
  remuxArgs, segmentArgs, streamArgs, keyframeProbeArgs, castPlan,
  HLS_SEGMENT_SECONDS, CACHE_DIR, CACHE_LIMIT_GB, HLS_VIDEO_CODECS,
} from "./ffmpeg.js";

// 与 OfflineU 的 transcode.go / hls.go / cache.go 对应：
// /api/media/status 决策 → HLS 分片或后台 remux → /files 命中缓存 MP4 → 投屏实时流。
// 远程来源（WebDAV/SMB）恒为 raw：不 ffprobe、不转码、不投屏流。

const execFileAsync = promisify(execFile);
const BROWSER_DIR = path.join(CACHE_DIR, "browser");
const HLS_DIR = path.join(CACHE_DIR, "hls");
const jobs = new Map();
const failures = new Map();

function runJob(key, fn) {
  if (jobs.has(key)) return jobs.get(key);
  const task = Promise.resolve().then(fn)
    .catch((e) => { failures.set(key, e.message || String(e)); throw e; })
    .finally(() => jobs.delete(key));
  jobs.set(key, task);
  return task;
}

const sha = (text) => crypto.createHash("sha1").update(text).digest("hex");
const cacheKey = (target, stat) => sha(`${path.resolve(target.path)}|${stat.size}|${stat.mtimeMs}`);
const browserFile = (key) => path.join(BROWSER_DIR, `${key}.mp4`);
// 分片格式版本：改动 segmentArgs（时间戳/切片方式）后必须 +1，
// 让旧格式的 index.json 与已缓存分片全部失效（目录带版本号）。
const HLS_INDEX_VERSION = 3;
const hlsDir = (key) => path.join(HLS_DIR, `${key}-v${HLS_INDEX_VERSION}`);
const indexFile = (key) => path.join(hlsDir(key), "index.json");
const segmentFile = (key, i) => path.join(hlsDir(key), `seg_${String(i).padStart(5, "0")}.ts`);

async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function indexFor(key, stat) {
  try {
    const idx = JSON.parse(await fsp.readFile(indexFile(key), "utf8"));
    if (idx.version === HLS_INDEX_VERSION && idx.size === stat.size && idx.mtime === stat.mtimeMs && Array.isArray(idx.segments) && idx.segments.length) return idx;
  } catch {}
  return null;
}

function fixedGrid(duration) {
  const out = [];
  for (let start = 0; start < duration; start += HLS_SEGMENT_SECONDS) {
    out.push({ start, duration: Math.min(HLS_SEGMENT_SECONDS, duration - start) });
  }
  return out.filter((s) => s.duration > 0.01);
}

async function buildIndex(target, stat, facts, key) {
  const copyVideo = !!facts.video && HLS_VIDEO_CODECS.has(facts.video.codec);
  let segments;
  if (copyVideo) {
    const { ffprobe } = binaries();
    if (!ffprobe) throw new Error("缺少 ffprobe，无法建立关键帧索引");
    const { stdout } = await execFileAsync(ffprobe, keyframeProbeArgs(target.path),
      { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const frames = [...new Set(stdout.split(/\r?\n/).map((s) => Number(s.trim()))
      .filter((t) => Number.isFinite(t) && t > 0))].sort((a, b) => a - b);
    segments = [];
    let start = 0;
    for (const t of frames) {
      if (t >= start + HLS_SEGMENT_SECONDS && t > start + 0.25) {
        segments.push({ start, duration: t - start });
        start = t;
      }
    }
    const tail = facts.duration - start;
    if (tail > 0.25) segments.push({ start, duration: tail });
    else if (segments.length) segments[segments.length - 1].duration += Math.max(0, tail);
    if (!segments.length) throw new Error("未找到关键帧，无法按关键帧切片");
  } else {
    segments = fixedGrid(facts.duration);
  }
  await atomicWrite(indexFile(key), JSON.stringify({
    version: HLS_INDEX_VERSION, size: stat.size, mtime: stat.mtimeMs, duration: facts.duration,
    copy_video: copyVideo, segments,
  }));
}

function remuxReady(target, stat, key) {
  try {
    const file = browserFile(key);
    const st = fs.statSync(file);
    return st.size > 0 && st.mtimeMs >= stat.mtimeMs;
  } catch { return false; }
}

async function buildRemux(target, facts, key) {
  const output = browserFile(key);
  const tmp = `${output}.tmp`;
  await fsp.mkdir(BROWSER_DIR, { recursive: true });
  await ffmpegRun(remuxArgs(target.path, facts, tmp), 4 * 60 * 60 * 1000);
  await fsp.rename(tmp, output);
  trimCache();
}

async function trimCache() {
  if (!Number.isFinite(CACHE_LIMIT_GB) || CACHE_LIMIT_GB <= 0) return;
  const limit = CACHE_LIMIT_GB * 1024 ** 3;
  try {
    const files = [];
    for (const dir of [BROWSER_DIR, HLS_DIR]) {
      const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (!entry.name.endsWith(".tmp")) {
            try { const st = fs.statSync(full); files.push({ full, size: st.size, mtime: st.mtimeMs }); } catch {}
          }
        }
      };
      if (fs.existsSync(dir)) walk(dir);
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= limit) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const file of files) {
      if (total <= limit * 0.75) break;
      if (Date.now() - file.mtime < 2 * 60 * 1000) continue;
      try { fs.unlinkSync(file.full); total -= file.size; } catch {}
    }
  } catch {}
}

const canStreamHLS = (facts) => !!facts?.video && facts.duration > 0 && !!binaries().ffprobe;

/** /api/media/status：direct / hls / remux / raw。 */
export async function mediaStatus(target, { materialId, token = "", hls = true } = {}) {
  const base = { mode: "raw", ready: true, preparing: false, hls_ready: false, needs_reencode: false };
  if (!target || target.remote) return { ...base, remote: !!target?.remote };

  // 原生可播的文件始终直连，不受转码开关影响。
  const stat = await fileStat(target);
  const facts = await probe(target.path);
  const playable = browserPlayable(facts);
  if (playable) return { ...base, mode: "direct", mime: playable };
  const info = facts
    ? { duration: facts.duration, video_codec: facts.video?.codec || "", audio_codec: facts.audio?.codec || "", needs_transcode: true }
    : {};
  if (setting("enable_transcoding", "true") === "false") {
    return facts ? { ...base, ...info, transcoding_disabled: true } : base;
  }
  if (!ffmpegAvailable()) return facts ? { ...base, ...info, ffmpeg_missing: true } : base;
  if (!facts) return base;

  const key = cacheKey(target, stat);
  const needsReencode = !!facts.video && !HLS_VIDEO_CODECS.has(facts.video.codec);
  const common = { duration: facts.duration, video_codec: facts.video?.codec || "", needs_reencode: needsReencode };

  if (hls && canStreamHLS(facts)) {
    const idx = await indexFor(key, stat);
    const jobKey = `hls-index:${key}`;
    if (!idx && !jobs.has(jobKey)) runJob(jobKey, () => buildIndex(target, stat, facts, key)).catch(() => {});
    return {
      ...base, ...common, mode: "hls", hls_ready: !!idx,
      hls_url: `/api/hls/playlist.m3u8?id=${materialId}&token=${encodeURIComponent(token)}`,
      error: failures.get(jobKey) || "",
    };
  }

  const ready = remuxReady(target, stat, key);
  const jobKey = `remux:${key}`;
  if (!ready && !jobs.has(jobKey)) runJob(jobKey, () => buildRemux(target, facts, key)).catch(() => {});
  const error = failures.get(jobKey) || "";
  return { ...base, ...common, mode: "remux", ready, preparing: !ready && !error, error };
}

/** VOD 播放列表；索引未就绪返回 null（路由回 503）。 */
export async function hlsPlaylist(target, materialId, token = "") {
  const stat = await fileStat(target);
  const key = cacheKey(target, stat);
  const idx = await indexFor(key, stat);
  if (!idx) return null;
  const maxDuration = Math.max(...idx.segments.map((s) => s.duration));
  const lines = [
    "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-TARGETDURATION:${Math.ceil(maxDuration)}`,
  ];
  idx.segments.forEach((segment, i) => {
    lines.push(`#EXTINF:${Number(segment.duration).toFixed(3)},`);
    lines.push(`/api/hls/segment?id=${materialId}&i=${i}&token=${encodeURIComponent(token)}`);
  });
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

/** 返回 {status, stream, size}；status: ready / pending / error。 */
export async function hlsSegment(target, index) {
  const stat = await fileStat(target);
  const key = cacheKey(target, stat);
  const idx = await indexFor(key, stat);
  if (!idx) return { status: "pending" };
  const segment = idx.segments[index];
  if (!segment) return { status: "error", message: "分片序号越界" };
  const file = segmentFile(key, index);
  if (!fs.existsSync(file)) {
    const jobKey = `hls-segment:${key}:${index}`;
    if (jobs.has(jobKey)) return { status: "pending" };
    const facts = await probe(target.path);
    try {
      await runJob(jobKey, async () => {
        const tmp = `${file}.tmp`;
        await fsp.mkdir(hlsDir(key), { recursive: true });
        await ffmpegRun(segmentArgs(target.path, facts, segment, tmp), 5 * 60 * 1000);
        await fsp.rename(tmp, file);
        trimCache();
      });
    } catch (e) { return { status: "error", message: e.message }; }
  }
  const size = fs.statSync(file).size;
  return { status: "ready", stream: fs.createReadStream(file), size };
}

function parseRange(req, size) {
  const header = req.headers?.range;
  if (!header) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  let start = m?.[1] ? parseInt(m[1], 10) : 0;
  let end = m?.[2] ? parseInt(m[2], 10) : size - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(end) || end >= size) end = size - 1;
  return { start, end };
}

/** /api/stream/:id 命中已生成的浏览器 MP4 时替换原始文件（与 OfflineU ServeBrowser 一致）。 */
export async function serveBrowser(target, req, res) {
  if (!target || target.remote) return false;
  const facts = await probe(target.path);
  // 已经生成的缓存 MP4 与 ffmpeg 当前是否可用无关；探测失败时按扩展名兜底。
  if (facts && browserPlayable(facts)) return false;
  const stat = await fileStat(target);
  const key = cacheKey(target, stat);
  if (!remuxReady(target, stat, key)) return false;
  const cache = { remote: false, path: browserFile(key) };
  const total = (await fileStat(cache)).size;
  const range = parseRange(req, total);
  const opened = await openRange(cache, range?.start ?? 0, range?.end ?? Infinity);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", facts ? (facts.video ? "video/mp4" : "audio/mp4")
    : (VIDEO_EXTS.has(extOf(target.path)) ? "video/mp4" : "audio/mp4"));
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (opened.unsatisfiable) {
    res.status(416).setHeader("Content-Range", `bytes */${total}`);
    res.end();
    return true;
  }
  if (opened.partial) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${opened.start}-${opened.end}/${total}`);
  }
  res.setHeader("Content-Length", Math.max(0, opened.end - opened.start + 1));
  opened.stream.pipe(res);
  return true;
}

export async function castPlanFor(target) {
  if (!target || target.remote) return { needs_transcode: false, transcode_available: false, reason: "remote" };
  const facts = await probe(target.path);
  return castPlan(facts, extOf(target.path));
}

/** 投屏设备拉取的实时转码流；请求断开即杀掉 ffmpeg。 */
export function castStream(target, facts, start, req, res) {
  const { args, mime } = streamArgs(target.path, facts, start, extOf(target.path));
  const { child, done } = ffmpegProcess(args);
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-LiteClass-Stream", "ffmpeg");
  child.stdout.pipe(res);
  const stop = () => { if (!child.killed) child.kill(); };
  req.on("close", stop);
  res.on("close", stop);
  done.catch(() => { if (!res.headersSent) res.status(500).end("转码失败"); else res.end(); });
}
