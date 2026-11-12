# 轻课堂 Lite Class

轻量级私有云课堂的全栈实现：移动优先的课程学习、在线考试、一起看/一起听放映厅、观看统计与管理后台。

前端 React 18 + Vite + React Router，后端 Express + SQLite（Node 内置 `node:sqlite`）+ JWT + WebSocket。无需任何原生编译依赖，数据与上传文件全部保存在本地 `data/` 目录。

## 功能

- 账号登录 / 注册开关，JWT 会话保持
- 首页学习日历、当日学习记录、观看排行榜
- 课程列表：全部 / 收藏 / 我的上传 / 放映大厅 / 考试中心
- 课程详情：音视频播放、播放进度记忆、倍速/循环/音量、章节目录、笔记（带时间点跳转）、资料下载、讨论与回复
- 收藏、课程隐藏、课程组授权、分类与等级
- **挂载路径**：新增课程时可直接选择 NAS 上已挂载的课程目录（如 `/vol1/videos/course1`），自动导入目录内的音视频与文档，支持重新扫描
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
release/liteclass_1.0.0_x86.fpk
```

### 安装

1. 打开 fnOS「应用中心 → 手动安装」，选择 `liteclass_1.0.0_x86.fpk`；
2. 或在 NAS 上执行：

   ```bash
   appcenter-cli install-fpk liteclass_1.0.0_x86.fpk
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

挂载路径模式需要读取 `/vol1` ~ `/vol9`。fnOS 默认不允许应用用户访问存储空间，请先在「应用中心 → 轻课堂 → 设置 → 授权目录」中添加对应目录（例如 `/vol1/1000/Media`），否则浏览/扫描挂载课程会提示无权限。

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
  stream.js         合成音频 / 文件 Range 流式播放
  routes/           认证、课程、用户、管理、考试、放映厅、上传
src/
  App.jsx           路由、登录态、底部导航
  pages/            首页、课程、课程详情、我的、考试、放映厅、排行榜
  components/       UI 组件、考试中心、播放器相关
  styles.css        设计系统与响应式布局
data/               运行时生成：liteclass.db、uploads/、media/
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

### 挂载 NAS 课程目录

在「我的 → 课程管理 → 新增」中把「课程存储路径」切换为「挂载路径」，即可：

1. 点击「选择」浏览 NAS 上已挂载到本机的目录（需先在 fnOS / Docker 中把存储空间映射进容器，例如 `/vol1`）；
2. 也可以直接填写路径，例如 `/vol1/1000/Media/课程/数据结构`；
3. 创建后会自动扫描该目录（含子目录）中的 `mp4 / mkv / mp3 / wav / pdf / epub` 等文件并生成章节，按文件名自然排序；
4. 在「章节管理」页可点击「重新扫描」同步目录变化（新增/删除的文件），亦可在课程信息中更换挂载路径。

挂载模式只读取原目录，不会复制文件；删除课程或章节也不会删除 NAS 上的原始文件。若使用 Docker 部署，请确保容器内路径与实际挂载路径一致，并用 `LITECLASS_MOUNT_ROOTS` 限定允许访问的根目录（默认 `/vol1` ~ `/vol9`、以及 Windows 盘符）。

上传大小限制、是否开放注册、是否允许普通用户建课、首页是否显示排行榜、视频转码开关等均可在「我的 → 系统设置」中调整。

## 说明

- 音视频播放支持 HTTP Range，可拖动进度条；上传的音视频保存在 `data/uploads/`。
- 数据库与上传目录均位于项目根目录 `data/`，备份该目录即可保留全部数据。
- 放映厅聊天为实时消息，不写入数据库；房间播放状态会持久化。
