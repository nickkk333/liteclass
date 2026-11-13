const TOKEN_KEY = "liteclass.token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, { method = "GET", body, headers = {}, form } = {}) {
  const opts = { method, headers: { ...headers } };
  const token = getToken();
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (form) {
    opts.body = form;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401) {
      setToken("");
      window.dispatchEvent(new Event("liteclass:unauthorized"));
    }
    const err = new Error((data && data.error) || `请求失败 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function streamUrl(materialId) {
  return `/api/stream/${materialId}?token=${encodeURIComponent(getToken())}`;
}

/** 文档 / 网页预览（服务端转成无脚本 HTML 或原样输出） */
export function previewUrl(materialId) {
  return `/api/preview/${materialId}/page?token=${encodeURIComponent(getToken())}`;
}

/** 字幕统一转好的 WebVTT */
export function subtitleUrl(materialId) {
  return `/api/subtitles/${materialId}?token=${encodeURIComponent(getToken())}`;
}

// 转码 / 投屏 / 课程来源
export const mediaStatus = (id, hls = true) => api(`/media/status/${id}${hls ? "" : "?hls=0"}`);
export const mediaPlan = (id) => api(`/media/plan/${id}`);
export const castDevices = (refresh = false) => api(`/dlna/devices${refresh ? "?refresh=1" : ""}`);
export const castTo = (body) => api("/dlna/cast", { method: "POST", body });
export const castControl = (body) => api("/dlna/control", { method: "POST", body });
export const castSession = () => api("/dlna/session");
export const sourcesList = () => api("/sources");
export const sourceSave = (body, edit = false) => api("/sources", { method: edit ? "PUT" : "POST", body });
export const sourceTest = (body) => api("/sources/test", { method: "POST", body });
export const sourceConnect = (body) => api("/sources/connect", { method: "POST", body });
export const sourceRemove = (id) => api("/sources/remove", { method: "POST", body: { id } });

export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtWatch(sec) {
  sec = Math.floor(Number(sec) || 0);
  if (sec < 60) return `${sec}秒`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m ? `${h}小时${m}分` : `${h}小时`;
  return `${m}分钟`;
}

export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n > 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n > 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDateTime(str) {
  if (!str) return "";
  const d = new Date(String(str).replace(" ", "T"));
  if (isNaN(d)) return str;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function initial(name) {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}
