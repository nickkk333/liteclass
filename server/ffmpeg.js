import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./db.js";

// 与 OfflineU 的 transcode.go 对应：ffmpeg/ffprobe 解析、媒体探测、
// 浏览器/电视可播判定以及 remux / HLS 分片 / 投屏流的命令构造。
// fpk 安装包内置 Linux 静态 ffmpeg / ffprobe（runtime/bin）；两者都找不到时才降级为原始流。

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

const EXE = process.platform === "win32" ? ".exe" : "";
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
// fpk 会把 ffmpeg / ffprobe 和 Node 一起放在 runtime/bin；
// 方括号里再兜底一些 fnOS / 常见发行版预装的路径。
const BUNDLED_DIRS = [
  path.dirname(process.execPath),
  path.resolve(SERVER_DIR, "..", "runtime", "bin"),
];
const KNOWN_DIRS = process.platform === "linux"
  ? [
      "/usr/trim/lib/mediasrv", // fnOS 媒体服务自带的 ffmpeg
      "/usr/trim/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/opt/bin",
    ]
  : [];

function firstExisting(candidates) {
  for (const file of candidates) {
    if (!file) continue;
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return "";
}

function findBinary(name, override = "") {
  if (override && fs.existsSync(override)) return override;
  const exe = name + EXE;
  return firstExisting([
    ...BUNDLED_DIRS.map((dir) => path.join(dir, exe)),
    lookPath(name),
    ...KNOWN_DIRS.map((dir) => path.join(dir, exe)),
  ]);
}

let cachedBinaries = null;
export function binaries() {
  if (cachedBinaries) return cachedBinaries;
  let ffmpeg = findBinary("ffmpeg", process.env.LITECLASS_FFMPEG || "");
  let ffprobe = findBinary("ffprobe", process.env.LITECLASS_FFPROBE || "");
  // 只有 ffmpeg 时尝试同目录与常见目录里的 ffprobe；探测会退回 ffmpeg -i。
  if (!ffprobe && ffmpeg) {
    ffprobe = firstExisting([
      path.join(path.dirname(ffmpeg), `ffprobe${EXE}`),
      ...KNOWN_DIRS.map((dir) => path.join(dir, `ffprobe${EXE}`)),
    ]);
  }
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
  // 只有 ffmpeg（没有 ffprobe）时，从 ffmpeg -i 的 stderr 里读取轨道信息。
  if (!facts && ffmpegAvailable()) facts = await probeWithFfmpeg(file);
  if (probeCache.size > 1000) probeCache.clear();
  probeCache.set(key, facts);
  return facts;
}

async function probeWithFfmpeg(file) {
  const { ffmpeg } = binaries();
  if (!ffmpeg) return null;
  let stderr = "";
  try {
    await execFileAsync(ffmpeg, ["-hide_banner", "-i", file], {
      timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
  } catch (e) {
    stderr = String(e?.stderr || "");
  }
  return parseFfmpegProbe(stderr);
}

/** 从 `ffmpeg -i` 的 stderr 解析媒体信息（没有 ffprobe 时的兜底）。 */
export function parseFfmpegProbe(stderr) {
  if (!stderr) return null;
  const input = /Input #0,\s*([^,]+)/.exec(stderr);
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const vline = /(Stream #\S+.*?:\s*Video:\s*([A-Za-z0-9_]+).*)/.exec(stderr);
  const aline = /(Stream #\S+.*?:\s*Audio:\s*([A-Za-z0-9_]+).*)/.exec(stderr);
  if (!vline && !aline) return null;
  const dim = vline ? /(\d{2,5})x(\d{2,5})/.exec(vline[1]) : null;
  return {
    container: input ? String(input[1]).trim().toLowerCase() : "",
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    video: vline ? { codec: String(vline[2]).toLowerCase(), height: dim ? Number(dim[2]) || 0 : 0 } : null,
    audio: aline ? { codec: String(aline[2]).toLowerCase() } : null,
  };
}

const DIRECT_FAMILIES = [
  { names: ["mp4", "mov", "m4v", "quicktime", "3gp", "mj2"], video: ["h264", "av1"], audio: ["aac", "mp3", "opus", "flac", "alac"], mime: "video/mp4" },
  { names: ["matroska", "webm"], video: ["vp8", "vp9", "av1"], audio: ["opus", "vorbis"], mime: "video/webm" },
  { names: ["ogg"], video: ["theora", "vp8"], audio: ["vorbis", "opus", "flac"], mime: "video/ogg" },
  // 纯音频容器：浏览器原生可播，不需要绕转码。
  { names: ["mp3"], video: [], audio: ["mp3"], mime: "audio/mpeg" },
  { names: ["flac"], video: [], audio: ["flac"], mime: "audio/flac" },
  { names: ["wav"], video: [], audio: ["pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8"], mime: "audio/wav" },
  { names: ["aac"], video: [], audio: ["aac"], mime: "audio/aac" },
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
// 浏览器 MSE / <video> 只稳定支持 AAC 与 MP3；AC3/EAC3/FLAC 必须重编码，否则会出现「有画面没声音」。
export const HLS_AUDIO_CODECS = new Set(["aac", "mp3"]);
export const BROWSER_VIDEO_CODECS = new Set(["h264"]);
export const BROWSER_AUDIO_CODECS = new Set(["aac", "mp3"]);
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

function audioEncodeArgs() { return ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]; }

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
  if (!facts) {
    // 探测失败但 ffmpeg 可用：按「有视频+音频」尽量重编码，可选 map 兼容纯音频文件。
    args.push("-map", "0:v:0?", "-map", "0:a:0?",
      ...videoEncodeArgs(null), ...audioEncodeArgs());
  } else if (!facts.video) {
    args.push(...(copyAudio(facts, BROWSER_AUDIO_CODECS) ? ["-c:a", "copy"] : audioEncodeArgs()));
  } else {
    args.push(...(copyVideo(facts, BROWSER_VIDEO_CODECS) ? ["-c:v", "copy"] : videoEncodeArgs(facts)));
    if (facts.audio) {
      if (copyAudio(facts, BROWSER_AUDIO_CODECS)) {
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
