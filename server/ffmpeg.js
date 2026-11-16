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

// 浏览器 <track> 能用的文本字幕；PGS / DVD 等图形字幕无法转成 WebVTT。
export const TEXT_SUBTITLE_CODECS = new Set([
  "subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text", "sami",
  "microdvd", "subviewer", "subviewer1", "jacosub", "realtext", "lrc",
  "pjs", "mpl2", "vplayer", "stl",
]);

function subtitleTrack(stream) {
  const codec = String(stream.codec_name || "").toLowerCase();
  const tags = stream.tags || {};
  return {
    index: Number(stream.index),
    codec,
    lang: String(tags.language || "").toLowerCase(),
    title: String(tags.title || ""),
    default: !!stream.disposition?.default,
    forced: !!stream.disposition?.forced,
    text: TEXT_SUBTITLE_CODECS.has(codec),
  };
}

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
          subtitles: streams.filter((s) => s.codec_type === "subtitle").map(subtitleTrack),
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
  // 字幕轨：Stream #0:2(chi): Subtitle: subrip (srt) (default)
  const subtitles = [];
  const re = /Stream #\S*?:(\d+)(?:[\[(]([^\])]*)[\])])?[^:]*:\s*Subtitle:\s*([A-Za-z0-9_]+)(.*)/g;
  let m;
  while ((m = re.exec(stderr))) {
    const codec = String(m[3]).toLowerCase();
    subtitles.push({
      index: Number(m[1]),
      codec,
      lang: String(m[2] || "").toLowerCase(),
      title: "",
      default: /\(default\)/i.test(m[4]),
      forced: /\(forced\)/i.test(m[4]),
      text: TEXT_SUBTITLE_CODECS.has(codec),
    });
  }
  return {
    container: input ? String(input[1]).trim().toLowerCase() : "",
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    video: vline ? { codec: String(vline[2]).toLowerCase(), height: dim ? Number(dim[2]) || 0 : 0 } : null,
    audio: aline ? { codec: String(aline[2]).toLowerCase() } : null,
    subtitles,
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

/** 秒 → ffmpeg 时间参数，保留毫秒（HLS 分片必须精确到关键帧）。 */
export function formatOffset(seconds) {
  return Math.max(0, Number(seconds) || 0).toFixed(3);
}

/** 关键帧对齐的前置留量（秒）。见 segmentArgs 的说明。 */
const SEGMENT_SEEK_MARGIN = 0.5;

/** 生成单个 HLS MPEG-TS 分片（按索引里的关键帧或固定 6 秒网格切）。
 *
 * 这里每个细节都是踩坑换来的，改动前请先跑一遍真实影片验证：
 * 1. `-ss` 必须精确到毫秒。取整到秒会退到上一个关键帧，分片里混进上片内容。
 * 2. 流复制（`-c:v copy`）时 ffmpeg 只能从关键帧起播：`-ss` 会落到关键帧之前的簇，
 *    再由输出侧 `-ss 0` 把「起点之后」的帧保留下来。此时时间戳被重排到 0，
 *    关键帧自身的 DTS 会比 PTS 小一帧（B 帧），于是一刀切在关键帧上时该关键帧
 *    会被当成负时间戳丢掉，整片视频晚 1~2 秒 —— 音画就是这么错位的。
 *    因此输入 `-ss` 提前 0.5s，保证目标关键帧的 DTS 落在正区间，
 *    再把多出来的音轨用 atrim 裁掉。
 * 3. `-t` 要把留量算进去，否则每片尾部少 0.5s，播放到分片边界会卡顿/丢音。
 * 4. 每片都用 `-output_ts_offset <seek>` 还原绝对时间戳；否则每片都从 0 开始，
 *    Chrome 的 MSE 会报 CHUNK_DEMUXER_ERROR_APPEND_FAILED（DTS 不连续）。
 *    `-avoid_negative_ts make_zero` 会二次平移时间戳，音画错位，必须改成 disabled。
 * 5. 首片（start=0）不能用上面的 seek：文件开头的关键帧本身 DTS 就是负/缺失，
 *    加了 seek 反而丢掉前 2 秒，所以首片直接从头解，用 make_zero 归零即可。 */
export function segmentArgs(file, facts, segment, output) {
  const start = Math.max(0, Number(segment.start) || 0);
  const duration = Math.max(0.05, Number(segment.duration) || 0);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  let seek = 0;
  let margin = 0;
  if (start > 0.001) {
    seek = start;
    if (copyVideo(facts)) {
      margin = Math.min(SEGMENT_SEEK_MARGIN, Math.max(0.1, duration / 4));
      seek = Math.max(0, start - margin);
    }
    args.push("-ss", formatOffset(seek));
  }
  args.push("-i", file, "-sn", "-dn", "-map_metadata", "-1", "-map", "0:v:0?", "-map", "0:a:0?");
  if (margin > 0) {
    args.push("-ss", "0", "-t", formatOffset(duration + margin));
  } else {
    if (seek > 0) args.push("-ss", "0");
    args.push("-t", formatOffset(duration));
  }
  // atrim 需要编码，所以有留量时音轨统一转 AAC（HLS 只用于视频，代价可以忽略）。
  const reencodeAudio = margin > 0 || !copyAudio(facts);
  if (facts?.video) {
    args.push(...(copyVideo(facts) ? ["-c:v", "copy"] : videoEncodeArgs(facts)));
    if (facts.audio) {
      args.push(...(reencodeAudio ? audioEncodeArgs() : ["-c:a", "copy"]));
      if (margin > 0) args.push("-af", `atrim=start=${formatOffset(margin)},aresample=async=1`);
    }
  } else {
    args.push(...(reencodeAudio ? audioEncodeArgs() : ["-c:a", "copy"]));
  }
  if (seek > 0) {
    args.push("-avoid_negative_ts", "disabled", "-output_ts_offset", formatOffset(seek));
  } else {
    args.push("-avoid_negative_ts", "make_zero");
  }
  args.push("-f", "mpegts", "-muxdelay", "0", "-muxpreload", "0", "-y", output);
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
