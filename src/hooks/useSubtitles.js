import { useEffect, useMemo, useState } from "react";
import { embeddedSubtitleUrl, subtitleTracks, subtitleUrl } from "../api.js";

// 字幕轨：同名外挂字幕（服务端转 VTT）+ 视频内嵌字幕轨（ffmpeg 转 VTT）。
// 浏览器 <track> 的顺序与 textTracks 一一对应，切换时只改 mode，不重新加载视频。

const LANG_NAMES = {
  zh: "中文", chi: "中文", zho: "中文", cmn: "中文",
  en: "英语", eng: "英语",
  ja: "日语", jpn: "日语",
  ko: "韩语", kor: "韩语",
  fr: "法语", fra: "法语", fre: "法语",
  de: "德语", deu: "德语", ger: "德语",
  es: "西班牙语", spa: "西班牙语",
  ru: "俄语", rus: "俄语",
  it: "意大利语", ita: "意大利语",
  pt: "葡萄牙语", por: "葡萄牙语",
  ar: "阿拉伯语", ara: "阿拉伯语",
  th: "泰语", tha: "泰语",
  vi: "越南语", vie: "越南语",
  id: "印尼语", ind: "印尼语",
  ms: "马来语", msa: "马来语", may: "马来语",
  tr: "土耳其语", tur: "土耳其语",
  hi: "印地语", hin: "印地语",
};

const LANG_TAGS = {
  chi: "zh", zho: "zh", cmn: "zh",
  eng: "en", jpn: "ja", kor: "ko",
  fra: "fr", fre: "fr", deu: "de", ger: "de",
  spa: "es", rus: "ru", ita: "it", por: "pt",
  ara: "ar", tha: "th", vie: "vi", ind: "id",
  msa: "ms", may: "ms", tur: "tr", hin: "hi",
};

const langName = (code) => LANG_NAMES[String(code || "").toLowerCase()] || "";
const langTag = (code) => {
  const c = String(code || "").toLowerCase();
  if (!c || c === "und") return "und";
  return LANG_TAGS[c] || c;
};

const EMPTY = { external: null, embedded: [], reason: "" };

function buildOptions(data, materialId) {
  const list = [];
  if (data.external) {
    list.push({
      key: "external",
      label: "外挂字幕",
      hint: data.external.name || "",
      lang: "zh",
      url: subtitleUrl(materialId),
    });
  }
  (data.embedded || []).forEach((track, i) => {
    const label = track.title || langName(track.lang) || `内嵌字幕 ${i + 1}`;
    const detail = [langName(track.lang), track.forced ? "强制" : "", track.text ? "" : "图形字幕"]
      .filter(Boolean).join(" · ");
    list.push({
      key: `e${track.index}`,
      label,
      hint: detail,
      lang: langTag(track.lang),
      url: track.text ? embeddedSubtitleUrl(materialId, track.index) : "",
      unsupported: !track.text,
      isDefault: !!track.default,
      forced: !!track.forced,
    });
  });
  return list;
}

function pickDefault(options) {
  const external = options.find((o) => o.key === "external");
  if (external) return external.key;
  const usable = options.filter((o) => o.url);
  const preferred = usable.find((o) => o.isDefault && !o.forced)
    || usable.find((o) => o.isDefault)
    || usable.find((o) => !o.forced)
    || usable[0];
  return preferred ? preferred.key : "off";
}

export default function useSubtitles({ materialId, enabled = true, mediaRef, elementKey }) {
  const [data, setData] = useState(EMPTY);
  const [selected, setSelected] = useState("off");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(EMPTY);
    setSelected("off");
    if (!enabled || !materialId) {
      setLoading(false);
      return () => { alive = false; };
    }
    setLoading(true);
    subtitleTracks(materialId)
      .then((d) => {
        if (!alive) return;
        const next = {
          external: d?.external || null,
          embedded: Array.isArray(d?.embedded) ? d.embedded : [],
          reason: d?.reason || "",
        };
        setData(next);
        setSelected(pickDefault(buildOptions(next, materialId)));
      })
      .catch(() => { if (alive) setData(EMPTY); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [materialId, enabled]);

  const options = useMemo(() => buildOptions(data, materialId), [data, materialId]);
  const playable = useMemo(() => options.filter((o) => o.url), [options]);

  // 按 selected 打开/关闭 textTrack。track 元素与媒体元素一起挂载，
  // HLS 切换会重建 <video>，所以 elementKey 变化时也要重新应用。
  useEffect(() => {
    const el = mediaRef?.current;
    if (!el) return undefined;
    const apply = () => {
      const tracks = el.textTracks;
      if (!tracks) return;
      for (let i = 0; i < tracks.length; i += 1) {
        const wanted = playable[i]?.key === selected ? "showing" : "disabled";
        if (tracks[i].mode !== wanted) {
          try { tracks[i].mode = wanted; } catch {}
        }
      }
    };
    apply();
    el.addEventListener("loadedmetadata", apply);
    el.addEventListener("loadeddata", apply);
    // <track> 的加载是异步的，稍后再兜底一次。
    const timer = window.setTimeout(apply, 600);
    return () => {
      el.removeEventListener("loadedmetadata", apply);
      el.removeEventListener("loadeddata", apply);
      window.clearTimeout(timer);
    };
  }, [playable, selected, elementKey, mediaRef]);

  const active = options.find((o) => o.key === selected) || null;
  return {
    options,
    playable,
    selected,
    active,
    setSelected,
    loading,
    reason: data.reason,
    hasSubtitles: playable.length > 0,
  };
}
