import dgram from "node:dgram";
import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { get, all, run, now } from "./db.js";
import { resolveMaterialFile } from "./files.js";
import { extOf, mimeOf, previewMode, VIDEO_EXTS } from "./media.js";
import { probe, ffmpegAvailable, castPlan, formatClock } from "./ffmpeg.js";
import { castStream } from "./transcode.js";

// 与 OfflineU 的 dlna.go / castsession.go 对应：SSDP 发现 → SOAP 控制 →
// 单会话看门狗（进度回写、播完自动下一节）→ 设备拉取的 ffmpeg 实时流。
// 浏览器只负责选设备与显示状态，全部逻辑在服务端。

const SSDP_HOST = "239.255.255.250";
const AVTRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
const asArray = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
const xmlEscape = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export const dlnaEnabled = () => process.env.LITECLASS_DLNA !== "off" && process.env.LITECLASS_DLNA !== "0";

// ---------------- 设备发现 ----------------

let cache = { at: 0, devices: [] };

async function fetchDevice(location) {
  try {
    const res = await fetch(location, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const root = parser.parse(await res.text())?.root;
    if (!root?.device) return null;
    const base = String(root.URLBase || location);
    let found = null;
    const walk = (device) => {
      if (!device || found) return;
      const service = asArray(device.serviceList?.service)
        .find((s) => String(s.serviceType || "").toLowerCase().includes("avtransport"));
      if (service) {
        try {
          const control = new URL(String(service.controlURL || ""), base).href;
          found = {
            udn: String(device.UDN || root.device.UDN || location),
            name: String(device.friendlyName || root.device.friendlyName || "未知设备"),
            manufacturer: String(device.manufacturer || ""),
            model: String(device.modelName || ""),
            address: new URL(control).hostname,
            location,
            control_url: control,
            service_type: String(service.serviceType || AVTRANSPORT),
          };
        } catch {}
      }
      for (const child of asArray(device.deviceList?.device)) walk(child);
    };
    walk(root.device);
    return found;
  } catch { return null; }
}

function ssdpDiscover() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const locations = new Set();
    socket.on("error", () => {});
    socket.on("message", (message) => {
      for (const line of message.toString("latin1").split(/\r?\n/)) {
        const match = /^location\s*:\s*(.+)$/i.exec(line.trim());
        if (match) locations.add(match[1].trim());
      }
    });
    const packet = (st) => Buffer.from(
      `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_HOST}:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`
    );
    try {
      socket.bind(0, () => {
        for (const st of ["urn:schemas-upnp-org:device:MediaRenderer:1", "ssdp:all"]) {
          socket.send(packet(st), 1900, SSDP_HOST);
        }
      });
    } catch { resolve([]); return; }
    setTimeout(async () => {
      try { socket.close(); } catch {}
      const devices = (await Promise.all([...locations].slice(0, 32).map(fetchDevice))).filter(Boolean);
      resolve(devices.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
    }, 2500);
  });
}

export async function devices(force = false) {
  if (!force && Date.now() - cache.at < 30 * 1000) return cache.devices;
  const found = await ssdpDiscover();
  // 一次没扫到但有历史设备时保留旧列表，避免网络抖动让菜单变空
  cache = { at: Date.now(), devices: found.length || !cache.devices.length ? found : cache.devices };
  return cache.devices;
}

export async function lookupDevice(udn) {
  let device = (await devices()).find((d) => d.udn === udn);
  if (!device) device = (await devices(true)).find((d) => d.udn === udn);
  if (!device) throw new Error("投屏设备已不可达，请刷新设备列表");
  return device;
}

// ---------------- SOAP ----------------

async function soap(device, action, params = {}) {
  const inner = Object.entries(params).map(([key, value]) => `<${key}>${xmlEscape(value)}</${key}>`).join("");
  const body = `<?xml version="1.0" encoding="utf-8"?>`
    + `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">`
    + `<s:Body><u:${action} xmlns:u="${device.service_type}">${inner}</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(device.control_url, {
    method: "POST",
    headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPACTION: `"${device.service_type}#${action}"` },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  const fault = /<errorDescription>([\s\S]*?)<\/errorDescription>/i.exec(text);
  if (fault) throw new Error(`${fault[1]} (UPnP 错误)`);
  if (/<UPnPError>/i.test(text)) throw new Error("设备返回 UPnP 错误");
  if (!res.ok) throw new Error(`SOAP ${action} 失败 (HTTP ${res.status})`);
  return text;
}

const clockToSeconds = (value) => {
  const parts = String(value || "").split(":").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

async function positionInfo(device) {
  const text = await soap(device, "GetPositionInfo", { InstanceID: 0 });
  const info = parser.parse(text)?.Envelope?.Body?.GetPositionInfoResponse;
  if (!info) return null;
  return {
    position: clockToSeconds(info.RelTime),
    duration: clockToSeconds(info.TrackDuration),
    state: String(info.TransportState || "").toUpperCase(),
  };
}

function didlLite(title, url, mime, video) {
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" `
    + `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">`
    + `<item id="liteclass-0" parentID="-1" restricted="1">`
    + `<dc:title>${xmlEscape(title)}</dc:title>`
    + `<upnp:class>object.item.${video ? "videoItem" : "audioItem.musicTrack"}</upnp:class>`
    + `<res protocolInfo="http-get:*:${mime}:*">${xmlEscape(url)}</res></item></DIDL-Lite>`;
}

// ---------------- 投屏地址与令牌 ----------------

const castTokens = new Map();
function issueCastToken(materialId, userId) {
  const token = crypto.randomBytes(12).toString("hex");
  castTokens.set(token, { materialId, userId, expires: Date.now() + 6 * 3600 * 1000 });
  return token;
}
export function validCastToken(token, materialId) {
  const entry = castTokens.get(String(token || ""));
  if (!entry || entry.expires < Date.now()) return false;
  return Number(entry.materialId) === Number(materialId);
}

export function absoluteURL(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim()
    || (req.secure ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim() || req.headers.host;
  return `${proto}://${host}`;
}

async function castTarget({ baseURL, material, startSeconds = 0, transcode = "auto", userId }) {
  const target = resolveMaterialFile(material);
  if (!target) throw new Error("章节文件不存在");
  const remote = !!target.remote;
  const facts = !remote ? await probe(target.path) : null;
  const plan = remote
    ? { needs_transcode: false, transcode_available: false }
    : castPlan(facts, extOf(material.file_path || material.title), ffmpegAvailable());
  let converted = transcode === "on" ? true : transcode === "off" ? false : !!plan.needs_transcode;
  if (remote) converted = false;
  if (converted && !ffmpegAvailable()) throw new Error("需要 ffmpeg 才能使用兼容转码流");
  const token = issueCastToken(material.id, userId);
  const url = converted
    ? `${baseURL}/api/dlna/stream?id=${material.id}&start=${Math.max(0, Math.floor(startSeconds))}&cast=${token}`
    : `${baseURL}/api/stream/${material.id}?cast=${token}`;
  const mime = converted
    ? (facts?.video ? "video/mp2t" : "audio/aac")
    : (mimeOf(material.file_path || material.title, material.mime_type || "application/octet-stream"));
  return { url, mime, converted, target, facts, startSeconds, plan, remote };
}

async function pushToDevice(device, info, material) {
  await soap(device, "SetAVTransportURI", {
    InstanceID: 0,
    CurrentURI: info.url,
    CurrentURIMetaData: didlLite(material.title, info.url, info.mime, !!info.facts?.video),
  });
  await soap(device, "Play", { InstanceID: 0, Speed: 1 });
  if (!info.converted && info.startSeconds > 0) {
    await soap(device, "Seek", { InstanceID: 0, Unit: "REL_TIME", Target: formatClock(info.startSeconds) }).catch(() => {});
  }
}

// ---------------- 单会话与看门狗 ----------------

let session = null;
let watchdog = null;

function estimatePosition(s) {
  const nowMs = Date.now();
  if (s.reported && nowMs - s.realAt < 12000) {
    const elapsed = s.state === "playing" ? (nowMs - s.realAt) / 1000 : 0;
    return Math.max(0, s.realPosition + elapsed);
  }
  const elapsed = (nowMs - s.startedAt) / 1000 - (s.pausedFor || 0);
  const value = (s.startSeconds || 0) + Math.max(0, elapsed);
  return s.duration > 0 ? Math.min(value, s.duration) : value;
}

function saveProgress(s, position, completed) {
  const dur = Math.max(0, Number(s.duration) || 0);
  const pos = Math.max(0, Number(position) || 0);
  run(
    `INSERT INTO progress (user_id,material_id,position,duration,completed,updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id,material_id) DO UPDATE SET
       position = MAX(progress.position, excluded.position),
       duration = excluded.duration,
       completed = MAX(progress.completed, excluded.completed),
       updated_at = excluded.updated_at`,
    s.userId, s.materialId, pos, dur, completed ? 1 : 0, now()
  );
  s.lastSaved = pos;
}

function nextPlayable(courseId, materialId) {
  const materials = all("SELECT * FROM materials WHERE course_id = ? ORDER BY sort_order ASC, id ASC", courseId);
  const index = materials.findIndex((m) => m.id === materialId);
  const next = materials.slice(index + 1).find((m) => ["video", "audio"].includes(previewMode(m.file_path || m.title, m.file_type)));
  return { materials, next };
}

export function sessionView() {
  if (!session) return { active: false, dlna_enabled: dlnaEnabled(), ffmpeg_available: ffmpegAvailable() };
  const { next } = nextPlayable(session.courseId, session.materialId);
  return {
    active: true,
    udn: session.device.udn,
    device: session.device.name,
    material_id: session.materialId,
    lesson_title: session.title,
    course_id: session.courseId,
    position: Math.round(estimatePosition(session)),
    duration: Math.round(session.duration || 0),
    state: session.state,
    converted: session.converted,
    reported: session.reported,
    next_title: next?.title || "",
    next_material_id: next?.id || null,
    dlna_enabled: dlnaEnabled(),
    ffmpeg_available: ffmpegAvailable(),
  };
}

async function startNext(s) {
  const { next } = nextPlayable(s.courseId, s.materialId);
  if (!next) {
    s.state = "ended";
    await soap(s.device, "Stop", { InstanceID: 0 }).catch(() => {});
    return;
  }
  saveProgress(s, s.duration || estimatePosition(s), true);
  const info = await castTarget({ baseURL: s.baseURL, material: next, startSeconds: 0, transcode: "auto", userId: s.userId });
  await pushToDevice(s.device, info, next);
  Object.assign(s, {
    materialId: next.id, title: next.title, converted: info.converted,
    startSeconds: 0, duration: Number(next.duration) || 0, startedAt: Date.now(),
    pausedFor: 0, state: "playing", realPosition: 0, realAt: 0, reported: false,
    lastSaved: 0,
  });
}

async function tick() {
  const s = session;
  if (!s || s.busy || s.state === "ended") return;
  s.busy = true;
  try {
    let info = null;
    try { info = await positionInfo(s.device); } catch {}
    if (info) {
      s.realPosition = info.position;
      s.realAt = Date.now();
      s.reported = info.position > 0;
      if (info.duration > 0) s.duration = info.duration;
      if (info.state === "PLAYING") s.state = "playing";
      else if (info.state === "PAUSED_PLAYBACK") s.state = "paused";
    }
    const position = estimatePosition(s);
    if (position - s.lastSaved >= 15) saveProgress(s, position, false);
    const finished = (s.duration > 0 && position >= s.duration - 2)
      || (info?.state === "STOPPED" && Date.now() - s.startedAt > 5000);
    if (finished) {
      saveProgress(s, s.duration || position, true);
      await startNext(s);
    }
  } catch (e) {
    console.error("[dlna] 看门狗:", e.message);
  } finally { if (session === s) s.busy = false; }
}

function ensureWatchdog() {
  if (!watchdog) watchdog = setInterval(tick, 3000);
}

export async function startCast({ req, udn, materialId, startSeconds = 0, transcode = "auto", duration = 0, userId }) {
  if (!dlnaEnabled()) throw new Error("投屏已在服务端关闭");
  const material = get("SELECT * FROM materials WHERE id = ?", Number(materialId));
  if (!material) throw new Error("章节不存在");
  if (!["video", "audio"].includes(previewMode(material.file_path || material.title, material.file_type))) {
    throw new Error("该章节没有可投屏的音视频");
  }
  const device = await lookupDevice(udn);
  const info = await castTarget({
    baseURL: absoluteURL(req), material, startSeconds, transcode, userId,
  });
  await pushToDevice(device, info, material);
  session = {
    udn: device.udn, device, userId, courseId: material.course_id,
    materialId: material.id, title: material.title, baseURL: absoluteURL(req),
    converted: info.converted, startSeconds: info.startSeconds,
    duration: Number(duration) || info.facts?.duration || Number(material.duration) || 0,
    startedAt: Date.now(), pausedFor: 0, state: "playing",
    realPosition: 0, realAt: 0, reported: false, lastSaved: 0, busy: false,
  };
  ensureWatchdog();
  return sessionView();
}

export async function control({ req, action, position = 0 }) {
  if (!session) throw new Error("当前没有投屏会话");
  const s = session;
  const device = s.device;
  if (action === "play") { await soap(device, "Play", { InstanceID: 0, Speed: 1 }); s.state = "playing"; }
  else if (action === "pause") { await soap(device, "Pause", { InstanceID: 0 }); s.state = "paused"; }
  else if (action === "stop") {
    saveProgress(s, estimatePosition(s), false);
    await soap(device, "Stop", { InstanceID: 0 }).catch(() => {});
    session = null;
    if (watchdog) { clearInterval(watchdog); watchdog = null; }
  } else if (action === "next") {
    await startNext(s);
  } else if (action === "seek") {
    const seconds = Math.max(0, Number(position) || 0);
    if (s.converted) {
      const material = get("SELECT * FROM materials WHERE id = ?", s.materialId);
      const info = await castTarget({ baseURL: absoluteURL(req), material, startSeconds: seconds, transcode: "on", userId: s.userId });
      await pushToDevice(device, info, material);
      s.startSeconds = seconds;
      s.startedAt = Date.now();
      s.realPosition = seconds;
      s.realAt = Date.now();
      s.reported = true;
    } else {
      await soap(device, "Seek", { InstanceID: 0, Unit: "REL_TIME", Target: formatClock(seconds) });
      s.realPosition = seconds;
      s.realAt = Date.now();
      s.reported = true;
    }
  } else throw new Error("未知的投屏操作");
  return sessionView();
}

/** 电视拉取的转码流：靠一次性 cast 令牌鉴权，不依赖浏览器 JWT。 */
export async function streamHandler(req, res) {
  const id = Number(req.query.id);
  if (!validCastToken(req.query.cast, id)) return res.status(401).type("text/plain").send("投屏令牌无效");
  const material = get("SELECT * FROM materials WHERE id = ?", id);
  const target = material && resolveMaterialFile(material);
  if (!target) return res.status(404).type("text/plain").send("章节不存在");
  if (target.remote) return res.status(501).type("text/plain").send("远程来源不支持投屏转码流");
  if (!ffmpegAvailable()) return res.status(501).type("text/plain").send("服务端没有 ffmpeg");
  const facts = await probe(target.path) || {
    video: VIDEO_EXTS.has(extOf(target.path)) ? { codec: "unknown", height: 0 } : null,
    audio: { codec: "unknown" }, duration: 0,
  };
  if (req.method === "HEAD") {
    res.setHeader("Content-Type", facts.video ? "video/mp2t" : "audio/aac");
    return res.status(200).end();
  }
  castStream(target, facts, Number(req.query.start) || 0, req, res);
}
