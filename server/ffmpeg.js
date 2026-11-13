import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR } from "./db.js";

// 与 OfflineU 的 transcode.go 对应：ffmpeg/ffprobe 解析、媒体探测、
// 浏览器/电视可播判定以及 remux / HLS 分片 / 投屏流的命令构造。
// 不自动下载 ffmpeg（轻课堂的 fpk 运行时是纯 Node），找不到时全部降级为原始流。

const execFileAsync = promisify(execFile);

export const CACHE_DIR = process.env.LITECLASS_CACHE_DIR || path.join(DATA_DIR, "cache");
export const HLS_SEGMENT_SECONDS = 6;
export const CACHE_LIMIT_GB = Number(process.env.LITECLASS_CACHE_LIMIT_GB) || 20;
export const TRANSCODE_HEIGHT = Number(process.env.LITECLASS_TRANSCODE_HEIGHT ?? 720);
export const TRANSCODE_PRESET = process.env.LITECLASS_TRANSCODE_PRESET || "veryfast";
export const TRANSCODE_CRF = process.env.LITECLASS_TRANSCODE_CRF || "23";

function lookPath(name) {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    for (const suffix of suffixes) {
      try {
        const file = path.join(dir, name + suffix);
        if (fs.statSync(file).isFile()) return file;
      } catch {}
    }
  }
  return "";
}

let cachedBinaries = null;
export function binaries() {
  if (cachedBinaries) return cachedBinaries;
  let ffmpeg = process.env.LITECLASS_FFMPEG || lookPath("ffmpeg");
  let ffprobe = process.env.LITECLASS_FFPROBE || lookPath("ffprobe");
  if (ffmpeg && !fs.existsSync(ffmpeg)) ffmpeg = "";
  if (!ffprobe && ffmpeg) {
    const sibling = path.join(path.dirname(ffmpeg), `ffprobe${process.platform === "win32" ? ".exe" : ""}`);
    if (fs.existsSync(sibling)) ffprobe = sibling;
  }
  if (ffprobe && !fs.existsSync(ffprobe)) ffprobe = "";
  cachedBinaries = { ffmpeg, ffprobe };
  return cachedBinaries;
}

export const ffmpegAvailable = () => !!binaries().ffmpeg;

// 探测缓存：路径 + size + mtime；失败结果也缓存，避免拖动进度条时反复 ffprobe。
const probeCache = new Map();
export async function probe(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const key = `${path.resolve(file)}|${stat.size}|${stat.mtimeMs}`;
  if (probeCache.has(key)) return probeCache.get(key);
  let facts = null;
  const { ffprobe } = binaries();
  if (ffprobe) {
    try {
      const { stdout } = await execFileAsync(
        ffprobe,
        ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file],
        { timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
      );
      const data = JSON.parse(stdout);
      const streams = Array.isArray(data.streams) ? data.streams : [];
      const v = streams.find((s) => s.codec_type === "video");
      const a = streams.find((s) => s.codec_type === "audio");
      if (v || a) {
        facts = {
          container: String(data.format?.format_name || "").split(",")[0].toLowerCase(),
          duration: Number(data.format?.duration) || 0,
          video: v ? { codec: String(v.codec_name || "").toLowerCase(), height: Number(v.height) || 0 } : null,
          audio: a ? { codec: String(a.codec_name || "").toLowerCase() } : null,
        };
      }
    } catch {}
  }
  if (probeCache.size > 1000) probeCache.clear();
  probeCache.set(key, facts);
  return facts;
}

const DIRECT_FAMILIES = [
  { names: ["mp4", "mov", "m4v", "quicktime", "3gp", "mj2"], video: ["h264", "av1"], audio: ["aac", "mp3", "opus", "flac", "alac"], mime: "video/mp4" },
  { names: ["matroska", "webm"], video: ["vp8", "vp9", "av1"], audio: ["opus", "vorbis"], mime: "video/webm" },
  { names: ["ogg"], video: ["theora", "vp8"], audio: ["vorbis", "opus", "flac"], mime: "video/ogg" },
];

/** 返回浏览器原生可播时的真实 MIME，否则空串。按 ffprobe 的真实容器名判断，不看扩展名。 */
export function browserPlayable(facts) {
  if (!facts?.container) return "";
  const family = DIRECT_FAMILIES.find((f) => f.names.includes(facts.container));
  if (!family) return "";
  if (facts.video && !family.video.includes(facts.video.codec)) return "";
  if (facts.audio && !family.audio.includes(facts.audio.codec)) return "";
  return family.mime;
}

// HLS 逐流 copy 白名单（与 OfflineU hls.go 一致）
export const HLS_VIDEO_CODECS = new Set(["h264"]);
export const HLS_AUDIO_CODECS = new Set(["aac", "mp3", "ac3"]);
// 重新封装 / 电视友好编码白名单（与 OfflineU transcode.go 一致）
export const SAFE_VIDEO_CODECS = new Set(["h264", "mpeg1video", "mpeg2video", "mpeg4", "msmpeg4v2", "msmpeg4v3", "wmv1", "wmv2"]);
export const SAFE_AUDIO_CODECS = new Set(["aac", "mp3", "mp2", "ac3", "flac"]);
export const FRIENDLY_CONTAINERS = new Set([".mp4", ".m4v", ".mov", ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg"]);

export function castPlan(facts, ext, available = ffmpegAvailable()) {
  const result = { needs_transcode: false, transcode_available: available, reason: "" };
  if (!facts) {
    result.needs_transcode = !FRIENDLY_CONTAINERS.has(String(ext).toLowerCase());
    result.reason = result.needs_transcode ? "container" : "";
    return result;
  }
  if (facts.video && !SAFE_VIDEO_CODECS.has(facts.video.codec)) { result.needs_transcode = true; result.reason = "video_codec"; return result; }
  if (facts.audio && !SAFE_AUDIO_CODECS.has(facts.audio.codec) && facts.audio.codec !== "aac") { result.needs_transcode = true; result.reason = "audio_codec"; return result; }
  if (!FRIENDLY_CONTAINERS.has(String(ext).toLowerCase())) { result.needs_transcode = true; result.reason = "container"; }
  return result;
}

const copyVideo = (facts, whitelist = HLS_VIDEO_CODECS) => !!facts?.video && whitelist.has(facts.video.codec);
const copyAudio = (facts, whitelist = HLS_AUDIO_CODECS) => !!facts?.audio && whitelist.has(facts.audio.codec);

function videoEncodeArgs(facts) {
  const scale = TRANSCODE_HEIGHT > 0 && (facts?.video?.height || 0) > TRANSCODE_HEIGHT
    ? ["-vf", `scale=-2:'min(${TRANSCODE_HEIGHT},ih)'`]
    : [];
  return [...scale, "-c:v", "libx264", "-preset", TRANSCODE_PRESET, "-crf", TRANSCODE_CRF, "-pix_fmt", "yuv420p"];
}

function audioEncodeArgs() { return ["-c:a", "aac", "-b:a", "192k"]; }

function commonInput(file, start = 0) {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  if (start > 0) args.push("-ss", formatClock(start));
  args.push("-i", file, "-sn", "-dn", "-map_metadata", "-1");
  return args;
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 后台把整个文件重新封装 / 转码成浏览器可播的 MP4。 */
export function remuxArgs(file, facts, output) {
  const args = [...commonInput(file), "-y"];
  if (!facts?.video) {
    args.push(...(copyAudio(facts, SAFE_AUDIO_CODECS) ? ["-c:a", "copy"] : audioEncodeArgs()));
  } else {
    args.push(...(copyVideo(facts, SAFE_VIDEO_CODECS) ? ["-c:v", "copy"] : videoEncodeArgs(facts)));
    if (facts.audio) {
      if (copyAudio(facts, SAFE_AUDIO_CODECS)) {
        args.push("-c:a", "copy");
        if (facts.audio.codec === "aac") args.push("-bsf:a", "aac_adtstoasc");
      } else args.push(...audioEncodeArgs());
    }
  }
  args.push("-f", "mp4", "-movflags", "+faststart", output);
  return args;
}

/** 生成单个 HLS MPEG-TS 分片（按索引里的关键帧或固定 6 秒网格切）。 */
export function segmentArgs(file, facts, segment, output) {
  const args = [
    ...commonInput(file, segment.start),
    "-t", Number(segment.duration).toFixed(3),
  ];
  if (facts?.video) {
    args.push(...(copyVideo(facts) ? ["-c:v", "copy"] : videoEncodeArgs(facts)));
    if (facts.audio) args.push(...(copyAudio(facts) ? ["-c:a", "copy"] : audioEncodeArgs()));
  } else {
    args.push(...(copyAudio(facts) ? ["-c:a", "copy"] : audioEncodeArgs()));
  }
  args.push("-avoid_negative_ts", "make_zero", "-f", "mpegts", "-muxdelay", "0", "-muxpreload", "0", "-y", output);
  return args;
}

/** 电视拉流：可 copy 则只换容器，否则 H.264 + AAC；纯音频输出 ADTS/MP3。 */
export function streamArgs(file, facts, start, ext) {
  const args = commonInput(file, start);
  if (!facts?.video) {
    const codec = facts?.audio?.codec || "";
    if (codec === "mp3") args.push("-c:a", "copy", "-f", "mp3");
    else if (codec === "aac") args.push("-c:a", "copy", "-f", "adts");
    else args.push(...audioEncodeArgs(), "-f", "adts");
  } else {
    args.push(...(copyVideo(facts, SAFE_VIDEO_CODECS) ? ["-c:v", "copy"] : videoEncodeArgs(facts)));
    if (facts.audio) args.push(...(copyAudio(facts, SAFE_AUDIO_CODECS) ? ["-c:a", "copy"] : audioEncodeArgs()));
    args.push("-f", "mpegts");
  }
  args.push("pipe:1");
  return { args, mime: facts?.video ? "video/mp2t" : (facts?.audio?.codec === "mp3" ? "audio/mpeg" : "audio/aac"), ext };
}

export function keyframeProbeArgs(file) {
  return ["-v", "quiet", "-select_streams", "v:0", "-skip_frame", "nokey",
    "-show_frames", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file];
}

/** 启动一次 ffmpeg，返回 child 与完成 Promise；流媒体场景可直接消费 stdout。 */
export function ffmpegProcess(args) {
  const { ffmpeg } = binaries();
  if (!ffmpeg) throw new Error("ffmpeg 不可用");
  const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (d) => { if (stderr.length < 4096) stderr += d; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}: ${stderr.slice(0, 400)}`)));
  });
  return { child, done };
}

export function ffmpegRun(args, timeout = 0) {
  const { child, done } = ffmpegProcess(args);
  if (!timeout) return done;
  let timer;
  return Promise.race([
    done.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error("ffmpeg 超时")); }, timeout); }),
  ]);
}
