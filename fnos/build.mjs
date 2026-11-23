/**
 * 构建飞牛 fnOS 安装包（.fpk）
 *
 * 用法：node fnos/build.mjs
 *
 * 产物：release/liteclass_<version>_<platform>.fpk
 *
 * 说明：
 * - fpk 本质是 tar.gz：外层包含 manifest / app.tgz / cmd / config / wizard / 图标
 * - app.tgz 是应用运行目录，解压后对应 /var/apps/liteclass/target
 * - 内置 Linux x64 Node 运行时，安装后无需在 NAS 上另装 Node
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SKELETON = path.join(__dirname, "package");
const CACHE = path.join(__dirname, ".cache");
const BUILD = path.join(__dirname, ".build");
const APP_DIR = path.join(BUILD, "liteclass", "app");
const RELEASE = path.join(ROOT, "release");

const NODE_VERSION = "24.20.0";
const NODE_TARBALL = path.join(CACHE, `node-v${NODE_VERSION}-linux-x64.tar.xz`);
const NODE_EXTRACTED = path.join(CACHE, "node-linux", "bin", "node");
const NODE_LICENSE = path.join(CACHE, "node-linux", "LICENSE");

// 静态 ffmpeg / ffprobe：用于 MKV、E-AC3、DTS 等浏览器不支持的音视频转码。
const FFMPEG_TARBALL = path.join(CACHE, "ffmpeg-release-amd64-static.tar.xz");
const FFMPEG_EXTRACTED = path.join(CACHE, "ffmpeg-linux");
const FFMPEG_URL = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";

const BLOCK = 512;

function log(msg) {
  console.log(`[fpk] ${msg}`);
}

function readManifest() {
  const text = fs.readFileSync(path.join(SKELETON, "manifest"), "utf8");
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) fields[m[1]] = m[2];
  }
  for (const key of ["appname", "version", "platform"]) {
    if (!fields[key]) throw new Error(`manifest 缺少字段：${key}`);
  }
  return fields;
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !/[\\/](\.DS_Store|Thumbs\.db)$/.test(src),
  });
}

function run(command, args, cwd) {
  const res = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) throw new Error(`命令执行失败：${command} ${args.join(" ")}`);
}

// ---------- 极简 tar 写入器（可精确控制权限位，Windows 下也可靠） ----------

function octal(value, length) {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function tarHeader({ name, mode, size = 0, type = "0", mtime }) {
  const buf = Buffer.alloc(BLOCK, 0);
  buf.write(name, 0, 100, "utf8");
  buf.write(octal(mode & 0o7777, 8), 100, 8, "ascii");
  buf.write(octal(0, 8), 108, 8, "ascii");
  buf.write(octal(0, 8), 116, 8, "ascii");
  buf.write(octal(size, 12), 124, 12, "ascii");
  buf.write(octal(mtime, 12), 136, 12, "ascii");
  buf.write("        ", 148, 8, "ascii");
  buf.write(type, 156, 1, "ascii");
  buf.write("ustar", 257, 5, "ascii");
  buf[262] = 0;
  buf.write("00", 263, 2, "ascii");
  buf.write("root", 265, 32, "ascii");
  buf.write("root", 297, 32, "ascii");
  buf.write("0000000", 329, 7, "ascii");
  buf.write("0000000", 337, 7, "ascii");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return buf;
}

function padded(data) {
  const rem = data.length % BLOCK;
  return rem === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - rem, 0);
}

function tarEntry({ name, mode, data = Buffer.alloc(0), type = "0", mtime }) {
  const chunks = [];
  const longName = Buffer.byteLength(name, "utf8") > 100 ? Buffer.from(name + "\0", "utf8") : null;
  if (longName) {
    chunks.push(tarHeader({ name: "././@LongLink", mode: 0o644, size: longName.length, type: "L", mtime }));
    chunks.push(longName, padded(longName));
  }
  const shortName = longName ? name.slice(0, 100) : name;
  chunks.push(tarHeader({ name: shortName, mode, size: data.length, type, mtime }));
  if (data.length) chunks.push(data, padded(data));
  return Buffer.concat(chunks);
}

function tarGz(entries) {
  const mtime = Math.floor(Date.now() / 1000);
  const parts = entries.map((entry) => tarEntry({ ...entry, mtime }));
  parts.push(Buffer.alloc(BLOCK * 2, 0), Buffer.alloc(BLOCK * 2, 0));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      out.push({ name: `${rel}/`, type: "5", mode: 0o755 });
      out.push(...walkFiles(full, base));
    } else if (entry.isFile()) {
      out.push({ name: rel, type: "0", mode: 0o644, file: full });
    }
  }
  return out;
}

// ---------- 构建步骤 ----------

function ensureNodeRuntime() {
  if (!fs.existsSync(NODE_EXTRACTED)) {
    if (!fs.existsSync(NODE_TARBALL)) {
      log(`未找到 ${NODE_TARBALL}，请先下载：`);
      log(`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz`);
      process.exit(1);
    }
    log("解压 Linux Node 运行时 ...");
    const tmp = path.join(CACHE, "node-linux");
    rmrf(tmp);
    fs.mkdirSync(tmp, { recursive: true });
    run("tar", [
      "-xf", NODE_TARBALL, "-C", tmp, "--strip-components=1",
      `node-v${NODE_VERSION}-linux-x64/bin/node`,
      `node-v${NODE_VERSION}-linux-x64/LICENSE`,
    ]);
  }
  const header = fs.readFileSync(NODE_EXTRACTED).subarray(0, 4);
  if (header.toString("latin1") !== "\x7fELF") {
    throw new Error("Node 运行时不是 Linux ELF 可执行文件");
  }
}

function ensureFfmpegRuntime() {
  const ffmpeg = path.join(FFMPEG_EXTRACTED, "ffmpeg");
  const ffprobe = path.join(FFMPEG_EXTRACTED, "ffprobe");
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) {
    if (!fs.existsSync(FFMPEG_TARBALL)) {
      log(`未找到 ${FFMPEG_TARBALL}，请先下载：`);
      log(FFMPEG_URL);
      process.exit(1);
    }
    log("解压 ffmpeg / ffprobe ...");
    const tmp = path.join(CACHE, "ffmpeg-extract");
    rmrf(tmp);
    fs.mkdirSync(tmp, { recursive: true });
    run("tar", ["-xf", FFMPEG_TARBALL, "-C", tmp]);
    const root = fs.readdirSync(tmp)
      .map((name) => path.join(tmp, name))
      .find((full) => { try { return fs.statSync(full).isDirectory(); } catch { return false; } });
    if (!root) throw new Error("ffmpeg 压缩包结构异常");
    rmrf(FFMPEG_EXTRACTED);
    fs.mkdirSync(FFMPEG_EXTRACTED, { recursive: true });
    for (const name of ["ffmpeg", "ffprobe", "GPLv3.txt", "README.txt"]) {
      const src = path.join(root, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(FFMPEG_EXTRACTED, name));
    }
    rmrf(tmp);
  }
  for (const name of ["ffmpeg", "ffprobe"]) {
    const file = path.join(FFMPEG_EXTRACTED, name);
    if (!fs.existsSync(file)) throw new Error(`缺少 ffmpeg 运行时：${name}`);
    const header = fs.readFileSync(file).subarray(0, 4);
    if (header.toString("latin1") !== "\x7fELF") {
      throw new Error(`${name} 不是 Linux ELF 可执行文件`);
    }
  }
}

function main() {
  const manifest = readManifest();
  // 版本号以 package.json 为准，避免 manifest 忘记改版本导致安装包名与应用内版本号不变。
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  if (pkg.version) manifest.version = pkg.version;
  log(`打包 ${manifest.appname} ${manifest.version} (${manifest.platform})`);

  log("构建前端 ...");
  run("npm", ["run", "build"], ROOT);

  log("准备应用目录 ...");
  rmrf(path.join(BUILD, "liteclass"));
  fs.mkdirSync(APP_DIR, { recursive: true });
  copyDir(SKELETON, path.join(BUILD, "liteclass"));
  const manifestPath = path.join(BUILD, "liteclass", "manifest");
  fs.writeFileSync(
    manifestPath,
    fs.readFileSync(manifestPath, "utf8").replace(/^(\s*version\s*=\s*).*$/m, (_line, prefix) => `${prefix}${manifest.version}`),
  );

  for (const dir of ["app/www", "app/server"]) {
    fs.rmSync(path.join(BUILD, "liteclass", dir), { recursive: true, force: true });
  }
  fs.rmSync(path.join(BUILD, "liteclass", "wizard", ".gitkeep"), { force: true });

  copyDir(path.join(ROOT, "dist"), path.join(APP_DIR, "dist"));
  copyDir(path.join(ROOT, "server"), path.join(APP_DIR, "server"));
  for (const file of ["package.json", "package-lock.json", "README.md", "LICENSE"]) {
    fs.copyFileSync(path.join(ROOT, file), path.join(APP_DIR, file));
  }

  log("安装生产依赖 ...");
  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], APP_DIR);

  log("写入 Node 运行时 ...");
  ensureNodeRuntime();
  fs.mkdirSync(path.join(APP_DIR, "runtime", "bin"), { recursive: true });
  fs.copyFileSync(NODE_EXTRACTED, path.join(APP_DIR, "runtime", "bin", "node"));
  fs.copyFileSync(NODE_LICENSE, path.join(APP_DIR, "runtime", "LICENSE"));

  log("写入 ffmpeg / ffprobe ...");
  ensureFfmpegRuntime();
  for (const name of ["ffmpeg", "ffprobe"]) {
    fs.copyFileSync(path.join(FFMPEG_EXTRACTED, name), path.join(APP_DIR, "runtime", "bin", name));
  }
  for (const name of ["GPLv3.txt", "README.txt"]) {
    const src = path.join(FFMPEG_EXTRACTED, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(APP_DIR, "runtime", `FFMPEG-${name}`));
  }

  log("生成 app.tgz ...");
  const appEntries = walkFiles(APP_DIR);
  for (const entry of appEntries) {
    if (entry.type === "0") {
      entry.data = fs.readFileSync(entry.file);
      delete entry.file;
      if (entry.name.startsWith("runtime/bin/")) entry.mode = 0o755;
    }
  }
  const appTgz = tarGz(appEntries);
  fs.writeFileSync(path.join(BUILD, "liteclass", "app.tgz"), appTgz);
  const checksum = crypto.createHash("md5").update(appTgz).digest("hex");
  log(`app.tgz ${(appTgz.length / 1024 / 1024).toFixed(1)} MB, md5=${checksum}`);

  log("写入 manifest checksum ...");
  fs.appendFileSync(path.join(BUILD, "liteclass", "manifest"), `\nchecksum              = ${checksum}\n`);

  log("生成 fpk ...");
  const pkgDir = path.join(BUILD, "liteclass");
  const outer = [];
  const addFile = (rel, mode = 0o644, name = rel) => {
    outer.push({ name, type: "0", mode, data: fs.readFileSync(path.join(pkgDir, rel)) });
  };
  const addDir = (name) => outer.push({ name, type: "5", mode: 0o755 });

  addDir("cmd/");
  for (const file of fs.readdirSync(path.join(pkgDir, "cmd")).sort()) {
    addFile(`cmd/${file}`, 0o755, `cmd/${file}`);
  }
  addDir("config/");
  for (const file of fs.readdirSync(path.join(pkgDir, "config")).sort()) {
    addFile(`config/${file}`, 0o644, `config/${file}`);
  }
  addDir("wizard/");
  addFile("ICON.PNG");
  addFile("ICON_256.PNG");
  addFile("manifest");
  addFile("app.tgz");

  const fpk = tarGz(outer);
  fs.mkdirSync(RELEASE, { recursive: true });
  const outFile = path.join(RELEASE, `${manifest.appname}_${manifest.version}_${manifest.platform}.fpk`);
  fs.writeFileSync(outFile, fpk);

  log(`完成：${outFile}`);
  log(`大小：${(fpk.length / 1024 / 1024).toFixed(1)} MB`);
}

main();
