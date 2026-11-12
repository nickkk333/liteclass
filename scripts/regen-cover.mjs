import fs from "node:fs";
import path from "node:path";

const dir = path.join("data", "media", "covers");
fs.mkdirSync(dir, { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#1d4ed8"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>
  <rect width="640" height="640" fill="url(#g)"/>
  <circle cx="510" cy="130" r="150" fill="#ffffff" opacity="0.08"/>
  <circle cx="120" cy="540" r="190" fill="#000000" opacity="0.10"/>
  <text x="50%" y="53%" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="92" fill="#ffffff" opacity="0.92">PY</text>
</svg>`;
fs.writeFileSync(path.join(dir, "code.svg"), svg);
console.log("cover regenerated");
