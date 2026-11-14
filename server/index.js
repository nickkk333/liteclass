import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ROOT, DATA_DIR, UPLOAD_DIR, MEDIA_DIR } from "./db.js";
import authRoutes from "./routes/auth.js";
import courseRoutes from "./routes/courses.js";
import userRoutes from "./routes/user.js";
import adminRoutes from "./routes/admin.js";
import examRoutes from "./routes/exams.js";
import roomRoutes, { attachRooms } from "./routes/rooms.js";
import fsRoutes from "./routes/fs.js";
import streamRoutes from "./stream.js";
import mediaRoutes from "./routes/media.js";
import dlnaRoutes from "./routes/dlna.js";
import sourcesRoutes from "./routes/sources.js";
import { binaries } from "./ffmpeg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", true);
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 8081;

app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1h" }));
app.use("/media", express.static(MEDIA_DIR, { maxAge: "1h" }));

app.use("/api", authRoutes);
app.use("/api", courseRoutes);
app.use("/api", userRoutes);
app.use("/api", adminRoutes);
app.use("/api", fsRoutes);
app.use("/api", examRoutes);
app.use("/api", roomRoutes);
app.use("/api", streamRoutes);
app.use("/api", mediaRoutes);
app.use("/api", dlnaRoutes);
app.use("/api", sourcesRoutes);

app.get("/api/ping", (req, res) => res.json({ ok: true, name: "轻课堂 Lite Class" }));

const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

attachRooms(server);
server.listen(PORT, () => {
  console.log(`轻课堂 Lite Class running at http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  const { ffmpeg, ffprobe } = binaries();
  console.log(`ffmpeg: ${ffmpeg || "未找到（视频转码不可用）"}`);
  console.log(`ffprobe: ${ffprobe || "未找到（将退回 ffmpeg -i 探测）"}`);
});
