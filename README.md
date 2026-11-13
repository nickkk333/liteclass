# 轻课堂 Lite Class

轻量级私有云课堂的全栈实现：移动优先的课程学习、在线考试、一起看/一起听放映厅、观看统计与管理后台。

前端 React 18 + Vite + React Router，后端 Express + SQLite（Node 内置 `node:sqlite`）+ JWT + WebSocket。无需任何原生编译依赖，数据与上传文件全部保存在本地 `data/` 目录。

## 功能

- 账号登录 / 注册开关，JWT 会话保持
- 首页学习日历、当日学习记录、观看排行榜
- 课程列表：全部 / 收藏 / 我的上传 / 放映大厅 / 考试中心
- 课程详情：音视频播放、播放进度记忆、倍速/循环/音量、章节目录、笔记（带时间点跳转）、资料下载、讨论与回复
- **文件支持**（与 OfflineU 对齐）：视频 `mp4/mkv/avi/mov/webm/m4v/flv/wmv/ts/m2ts/mts`、音频 `mp3/wav/m4a/aac/ogg/flac`、图片 `png/jpg/jpeg/gif/webp/bmp/svg/ico/avif`、文档 `txt/md/html/htm/pdf/docx/doc/rtf/mhtml/mht`；`.txt` 纯文本、`.md` 排版渲染、`.pdf`/`.html` 内嵌、Office 与网页存档由服务端转成无脚本 HTML 后内联预览，图片直接显示，`.epub` 等其它格式可下载
- **字幕**：与音视频同名的 `srt/vtt/ass/ssa/sub/sbv` 自动挂载，服务端统一转成 WebVTT
- **ffmpeg HLS / remux 转码**（复制自 OfflineU）：`/api/media/status` 按真实容器与编码判定 `direct / hls / remux / raw`；视频按 6 秒关键帧切 MPEG-TS 分片，用 `hls.js` 播放（Safari 原生），失败自动回退；纯音频或缺少 ffprobe 时后台重封装 / 转码成 MP4，就绪后自动替换原文件；结果缓存在 `data/cache`，按容量清理
- **DLNA 投屏**：SSDP 发现电视、SOAP 推送/播放/暂停/跳转/停止，服务端单会话看门狗回写进度并自动连播下一节，兼容模式提供 ffmpeg 实时 MPEG-TS 流；全局投屏条可跨页面控制
- **课程来源**：本地目录 / WebDAV / SMB 共享，密码只写不读，虚拟路径 `/__liteclass_sources__/<id>/...`，可测试连接并直接作为课程打开
- 播放结束按「顺序播放 / 单曲循环 / 播完暂停」处理，顺序模式自动续播下一章；已学完章节在目录中显示对勾
- 收藏、课程隐藏、课程组授权、分类与等级
- **挂载路径 / 课程来源**：新增课程时可直接选择 NAS 上已挂载的目录或已配置的课程来源，自动导入其中的音视频、图片与文档，支持重新扫描
- 考试中心：单选 / 多选 / 判断 / 填空 / 简答，限时答题、自动判分、成绩详情、成绩统计、考试编辑
- 放映厅：房间口令加入、房主同步播放/暂停/拖动、实时聊天、在线人数
- 管理后台：系统设置、分类管理、课程组管理、用户管理、观看统计、课程管理、历史数据、关于应用
- 深色模式（跟随本地设置持久化）
- 离线可用：内置 100 首歌曲的占位音频由服务端实时合成，无需外网

## 环境要求

- Node.js **24 或更高**（使用内置 `node:sqlite`；Node 22.5+ 也可，但需自行加 `--experimental-sqlite`）
- npm

## 快速开始

```bash
npm install
npm run seed        # 首次初始化数据库与演示数据
npm run build       # 构建前端到 dist/
npm start           # 启动服务，访问 http://localhost:3000
```

打开 <http://localhost:3000>，使用演示账号登录：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `admin333` | 管理员 |
| `student` | `123456` | 普通学员 |

### 开发模式

```bash
npm run dev
```

同时启动 API（`http://localhost:3000`）与 Vite 开发服务器（`http://localhost:5173`），Vite 会把 `/api`、`/uploads`、`/media` 代理到 API，并支持 WebSocket。

### 重置演示数据

```bash
npm run seed:force
```

会清空并重新生成用户、课程、考试、房间、设置等全部数据（包括上传记录与观看统计）。

## 飞牛 fnOS 安装包（.fpk）

仓库外提供已经打好的原生安装包（x86_64，内置 Linux x64 Node 24 运行时，NAS 上无需另装 Node / Docker）：

```
release/liteclass_1.0.3_x86.fpk
```

### 安装

1. 打开 fnOS「应用中心 → 手动安装」，选择 `liteclass_1.0.3_x86.fpk`；
2. 或在 NAS 上执行：

   ```bash
   appcenter-cli install-fpk liteclass_1.0.3_x86.fpk
   ```

3. 安装完成后桌面会出现「轻课堂」图标，也可直接访问 `http://<NAS-IP>:3000`（端口可在应用设置中修改）。

首次启动会自动初始化数据库并生成演示课程、音频与封面，账号与本地部署一致：`admin / admin333`、`student / 123456`。

### 数据目录

| 内容 | 路径 |
| --- | --- |
| 数据库 | `$TRIM_PKGVAR/data/liteclass.db` |
| 上传文件 | `$TRIM_PKGVAR/data/uploads/` |
| 合成音频与封面 | `$TRIM_PKGVAR/data/media/` |
| 运行日志 | `$TRIM_PKGVAR/liteclass.log` |

实际路径形如 `/var/apps/liteclass/var/data`，备份该目录即可保留全部数据。应用以 `package` 用户运行，数据目录由 `LITECLASS_DATA_DIR` 环境变量指定。

### 读取 NAS 上的课程目录

挂载路径模式需要读取 `/vol1` ~ `/vol9`。fnOS 默认不允许应用用户访问存储空间，请先在「应用中心 → 轻课堂 → 设置 → 授权目录」中添加对应目录（例如 `/vol1/1000/Media`）。

应用启动时会读取 fnOS 提供的 `TRIM_DATA_ACCESSIBLE_PATHS`，并把授权目录持久化到 `$TRIM_PKGVAR/data/mount-roots.txt`；授权变更后（`cmd/config_init` / `cmd/config_callback`）无需重启应用即可生效。因此：

- 「挂载路径 → 选择」弹窗顶部会列出 **已授权目录**，点击即可直接进入，不必从 `/vol1` 逐级向下浏览；
- 未授权的上级目录（如 `/vol1`）可能因权限不足而无法展开，此时使用「已授权目录」或手动输入完整路径；
- 若授权后仍看不到目录，请确认授权的是文件夹而非单个文件，并在应用设置中保存后再打开选择器。

### 重新打包

```bash
# 首次需要下载 Node 运行时到 fnos/.cache/（或由脚本提示手动下载）
node fnos/build.mjs
```

脚本会构建前端、安装生产依赖、注入 Linux x64 Node 运行时，并输出 `release/liteclass_<version>_<platform>.fpk`。安装包结构：外层 tar.gz 包含 `manifest`、`app.tgz`、`cmd/`、`config/`、`wizard/` 与图标；`app.tgz` 解压后即应用运行目录。`manifest` 中的 `checksum` 由 `app.tgz` 的 MD5 自动写入。

## 目录结构

```
server/
  index.js          Express 入口（静态资源 + API + WebSocket）
  db.js             SQLite 表结构、设置读写、路径常量
  seed.js           演示数据（课程、100 首曲目、考试、房间等）
  auth.js           JWT 签发与校验
  media.js           文件类型、MIME 与预览模式（与 OfflineU 对齐）
  stream.js          合成音频 / Range 流式播放 / 文档预览 / 字幕转 WebVTT
  office/            纯 Node 的 txt/md/docx/doc/rtf/mhtml → HTML 预览
  subtitles.js       SRT/VTT/ASS/SSA/SUB/SBV → WebVTT
  encoding.js        文本编码探测与统一解码
  paths.js           本地根目录白名单 + 课程来源虚拟路径
  sources.js         本地 / WebDAV / SMB 后端、来源仓库、统一文件门面
  files.js           章节文件读取（上传 / 挂载 / 远程）
  ffmpeg.js          ffmpeg/ffprobe 解析、探测、命令构造
  transcode.js       媒体状态决策、HLS 分片、remux 缓存、投屏流
  dlna.js            SSDP/SOAP、投屏会话与看门狗
  routes/           认证、课程、用户、管理、考试、放映厅、上传、媒体、投屏、来源
src/
  App.jsx           路由、登录态、底部导航、全局投屏条
  hooks/            usePlaybackSource（direct/hls/remux 状态机）
  pages/            首页、课程、课程详情、我的、考试、放映厅、排行榜
  components/       UI 组件、考试中心、投屏菜单/投屏条、课程来源管理
  styles.css        设计系统与响应式布局
data/               运行时生成：liteclass.db、uploads/、media/、cache/、sources.json
dist/               前端构建产物（由 Express 托管）
fnos/               飞牛 fnOS 安装包工程（package/ 模板 + build.mjs 打包脚本）
release/            打包产物（.fpk，已加入 .gitignore）
```

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `LITECLASS_SECRET` | 内置开发密钥 | JWT 签名密钥，生产环境请务必修改 |
| `LITECLASS_MOUNT_ROOTS` | 自动探测 | 允许挂载/浏览的根目录，多个用分隔符隔开（Windows 用 `;`，Linux/macOS 用 `:`） |
| `LITECLASS_DATA_DIR` | 项目内 `data/` | 数据目录覆盖；fpk 安装包会把它指向 `$TRIM_PKGVAR/data` |
| `LITECLASS_FFMPEG` / `LITECLASS_FFPROBE` | 自动查找 `PATH` | 显式指定可执行文件；找不到时转码/投屏流自动降级为原始流（不自动下载） |
| `LITECLASS_CACHE_DIR` | `data/cache` | HLS 分片与 remux MP4 缓存目录 |
| `LITECLASS_CACHE_LIMIT_GB` | `20` | 缓存上限；超过后删除最旧文件，最近 2 分钟内的文件受保护 |
| `LITECLASS_TRANSCODE_HEIGHT` / `_PRESET` / `_CRF` | `720` / `veryfast` / `23` | 重编码时的分辨率上限与 x264 参数 |
| `LITECLASS_DLNA` | 开启 | 设为 `off` 关闭 DLNA 投屏 |

### 挂载 NAS 课程目录

在「我的 → 课程管理 → 新增」中把「课程存储路径」切换为「挂载路径」，即可：

1. 点击「选择」浏览 NAS 上已挂载到本机的目录（需先在 fnOS / Docker 中把存储空间映射进容器，例如 `/vol1`）；
2. 也可以直接填写路径，例如 `/vol1/1000/Media/课程/数据结构`；
3. 创建后会自动扫描该目录（含子目录）中的音视频、图片与文档（见上文「文件支持」）并生成章节，按文件名自然排序；同名字幕会自动配对，`.ts` 会按内容确认是不是 MPEG 传输流，避免把 TypeScript 源码当视频；
4. 在「章节管理」页可点击「重新扫描」同步目录变化（新增/删除的文件），亦可在课程信息中更换挂载路径。

挂载模式只读取原目录，不会复制文件；删除课程或章节也不会删除 NAS 上的原始文件。若使用 Docker 部署，请确保容器内路径与实际挂载路径一致，并用 `LITECLASS_MOUNT_ROOTS` 限定允许访问的根目录（默认 `/vol1` ~ `/vol9`、以及 Windows 盘符）。

上传大小限制、是否开放注册、是否允许普通用户建课、首页是否显示排行榜、是否启用视频转码等均可在「我的 → 系统设置」中调整。

### ffmpeg 转码与播放

- 需要先在 NAS / 服务器上安装 `ffmpeg` 与 `ffprobe`，或用 `LITECLASS_FFMPEG`、`LITECLASS_FFPROBE` 指定路径。fpk 的 Node 运行时不含 ffmpeg，也不会自动下载；**找不到时所有功能自动降级为原始流**，不影响原有播放。
- 打开章节时先请求 `/api/media/status/:id`：浏览器原生可播 → `direct`；有视频且能用关键帧切片 → `hls`（前端按需加载 `hls.js`）；纯音频 / 无 ffprobe → 后台 `remux` 成 MP4，就绪后自动重载；远程来源或设置关闭转码 → `raw`。HLS 分片未就绪返回 `503`，前端每 2 秒重试；播放失败自动 `hls=0` 回退。
- 缓存按「路径 + 大小 + 修改时间」隔离，源文件变化即失效；HLS 索引与分片、remux MP4 都在 `data/cache`，由 `LITECLASS_CACHE_LIMIT_GB` 控制容量。

### DLNA 投屏

- 课程详情页点「投屏」→ 刷新设备（SSDP M-SEARCH）→ 选择电视；可勾选「兼容模式」强制服务端重编码为 H.264/AAC MPEG-TS 实时流，默认按 ffprobe 结果自动判断。
- 投屏后由服务端维护单一会话：每 3 秒读取设备位置、每 15 秒回写观看进度、播完自动推送下一节音视频；全局投屏条支持播放/暂停/拖动/停止，切换页面也不会中断。
- 电视通过带一次性 cast 令牌的 URL 拉流，无需浏览器 JWT；需要电视与 NAS 在同一局域网，反向代理场景请正确传递 `X-Forwarded-Host` / `X-Forwarded-Proto`。WebDAV/SMB 来源只提供原文件流，不做投屏转码。

### 课程来源（WebDAV / SMB / 本地）

- 在「我的 → 系统设置 → 课程来源」添加：本地目录填绝对路径；WebDAV 填 URL + 用户名/密码（可允许自签名证书）；SMB 填主机/共享/凭据，或直接填已挂载的 UNC / `mount -t cifs` 本地路径（后者更稳定）。
- 来源配置保存在 `data/sources.json`（权限 0600），接口只返回 `has_password`，编辑时密码留空表示沿用；可「测试连接」、按目标地址复用（`created / updated / reused`），或「连接并作为课程打开」直接建课扫描。
- 文件都以虚拟路径 `/__liteclass_sources__/<id>/...` 出现在章节与浏览接口中，服务端做 `..` 穿越防护、单次解码与根目录白名单；真实凭据不会下发到浏览器。WebDAV 通过 `PROPFIND` + `GET Range` 读取，SMB 通过内置 SMB2 客户端读取。
- 远程来源**恒为 raw**：不做 ffprobe、不生成 HLS/remux、不提供投屏转码流，但仍支持在线预览、字幕、Range 拖动与下载。

## 说明

- 音视频播放支持 HTTP Range，可拖动进度条；上传的音视频保存在 `data/uploads/`。浏览器无法解码的容器（如 `mkv / avi / flv / wmv`）由服务端 HLS/remux 转码（需 ffmpeg），没有 ffmpeg 时原样提供并可下载。
- `.txt / .md / .html / .pdf / .docx / .doc / .rtf / .mhtml` 在课程详情与放映厅内联预览：服务端把文档转成无脚本 HTML（单文件上限 8 MB）；本地 HTML 的同目录资源内联成 data URL，课程来源 HTML 的相对资源由服务端 asset 路由代理；PDF/HTML 由浏览器内嵌显示；其它格式可下载原文件。
- 数据库与上传目录均位于项目根目录 `data/`，备份该目录即可保留全部数据。
- 放映厅聊天为实时消息，不写入数据库；房间播放状态会持久化。
