# 207 可迁移基线 v1

状态：迁移准备基线。目标平台固定为 **RK3576（ARM64）+ Debian 12 Bookworm**。此文档定义 207 分支中哪些内容可以带到该目标，哪些内容必须在目标平台重新建立。

## 已归档的可迁移资产

| 资产 | 仓库位置 | 用途与校验 |
| --- | --- | --- |
| 应用源码与测试 | 本分支根目录 | Vite、React、Node API 和部署脚本的共同基线。|
| 场景视频与环境音 | `public/assets/scenes/` | Git LFS 管理；视频、音频、缩略图与清单必须一起取得。`_metadata/scene_videos.json` 保存文件 SHA-256、场景音量和版本化音频文件名；`scene_audio_sources.json` 保存来源和归属。|
| 电台种子数据库 | `deploy/moode/data/tikpal-radio-36.sqlite3` | 207 于 2026-09-13 导出的 Tikpal 专用 SQLite 快照：16 KiB、`cfg_radio` 表、36 个预设、12 个类别。SHA-256 记录在相邻 `.sha256` 文件。|
| 电台目录规则 | `deploy/moode/tikpal-radio-presets-sync.sh` | 数据库 schema、36 条预设和冲突保护的可读来源；可用 `check` 验证已复制的种子。|
| 电台 logo 包 | `public/assets/radio-logos/` | 本地静态资源和其 manifest，避免目标设备在运行时下载第三方图标。|

电台快照只含电台元数据和流 URL，不含账号、Cookie、设备输出、播放队列或用户媒体。它是一个**初始种子**，不是将来设备的可写运行目录。

## 克隆与资产恢复

在新开发机或目标构建机上，从 207 分支取得完整仓库及 LFS 对象：

```bash
git clone --branch 207 https://github.com/jiayouchongmingniao/tikpal.git
cd tikpal
git lfs install
git lfs pull
git lfs fsck
npm ci
npm run typecheck
npm run build
```

不要复制 207 的 `node_modules`、`dist`、PID/XID/锁文件、Chromium profile、Provider 登录态、`.env` 或 `.env.kiosk`。它们要么与 CPU/操作系统绑定，要么包含设备私有配置或凭据。

## 安装电台种子

新平台应把仓库中的只读种子安装到自己的受保护运行路径，而不是让服务写入 Git 工作树。以下以 systemd 服务用户组 `moode` 为例；其他平台按实际服务组替换。

```bash
cd tikpal
(cd deploy/moode/data && sha256sum -c tikpal-radio-36.sqlite3.sha256)
sqlite3 deploy/moode/data/tikpal-radio-36.sqlite3 'PRAGMA integrity_check;'

install -d -o root -g moode -m 0750 /var/lib/tikpal
install -o root -g moode -m 0640 \
  deploy/moode/data/tikpal-radio-36.sqlite3 \
  /var/lib/tikpal/radio.sqlite3

TIKPAL_RADIO_SQLITE_DB=/var/lib/tikpal/radio.sqlite3 \
  deploy/moode/tikpal-radio-presets-sync.sh check
```

配置目标平台的私有环境文件时，只写入该运行副本：

```conf
TIKPAL_RADIO_SQLITE_DB=/var/lib/tikpal/radio.sqlite3
TIKPAL_RADIO_LOGO_DIR=/path/to/tikpal/public/assets/radio-logos
```

`bootstrap` 仍用于从脚本创建空的新种子；它拒绝覆盖已有 DB。已有运行库的目录更新应先执行 `check`，仅在确认无 ID 冲突后执行 `apply`。不要用新种子覆盖包含用户维护电台的目标数据库。

## 平台迁移边界

以下内容可以复用：应用逻辑、前端静态资源、场景清单、环境音、SQLite 种子、电台 logo、API/交互测试和源代码中的服务契约。

以下内容必须在目标平台重新探测或实现：

- CPU 架构对应的 Chromium、Widevine 和任何 native helper；不得沿用 207 的 x86 路径。
- 显示、触控、GPU 视频解码、DDC、ALSA 卡名/设备号、Loopback 与 USB DAC 配置。
- systemd unit 的用户、文件路径、权限、启动依赖和网络接口。
- Explore 的窗口管理。首个 ARM 平台继续使用 KDE/X11，验证 X11 窗口控制与 Helper 后才考虑 Wayland。
- 所有 Provider 登录态、代理配置、NAS 凭据、本地音乐与用户偏好。

207 保持为迁移期间的可回退参照。RK3576 的 Debian 12 Bookworm 安装应先验证准确镜像校验值与 `aarch64` 架构，再按显示/触控/网络/音频、ARM64 Chromium 与 DRM、单一 Provider、X11 窗口生命周期、MPD 与外部输入的顺序推进；不要把 Node/React 构建成功视为硬件验收。

第一阶段维持 KDE/X11，原因是现有 Explore 依赖 X11 窗口 ID、`xdotool` 和 X11 Helper。只有在该路径的 2560×720 显示、触控、GPU 视频解码、Widevine/受保护播放和单 Provider 生命周期均通过后，才单独评估 Wayland。目标机的最低识别检查为：

```bash
uname -m                 # aarch64
. /etc/os-release
printf '%s %s\n' "$ID" "$VERSION_ID"  # debian 12
```

## 发布前检查

每次更新场景或电台资产后，在推送前执行：

```bash
git diff --check
git lfs ls-files
git lfs fsck
(cd deploy/moode/data && sha256sum -c tikpal-radio-36.sqlite3.sha256)
sqlite3 deploy/moode/data/tikpal-radio-36.sqlite3 'PRAGMA integrity_check;'
TIKPAL_RADIO_SQLITE_DB="$PWD/deploy/moode/data/tikpal-radio-36.sqlite3" \
  deploy/moode/tikpal-radio-presets-sync.sh check
npm run typecheck
npm run build
```

场景音频替换必须同时更新 `scene_videos.json` 中的 `audioFilename`、`audioSha256` 和 `audioGainDb`，并在 `scene_audio_sources.json` 记录来源。音频路径使用长缓存时，改用带内容版本的新文件名，避免已打开浏览器继续命中旧缓存。

### 2026-09-13 Midnight Library 环境音修订

`midnight-library` 当前默认使用 `audio/midnight-library-night-ambience.ogg`：Pixabay 上 cclaretc（Freesound）的 *Night Ambience*，以 0.8 秒尾首交叉淡化渲染为 15 分钟、48 kHz、立体声 Opus。`scene_videos.json` 的 `audioSha256` 为 `c73212dec3c550f04f83b278d3bde31a46007cd6200d4d23ee9f3227a5463d5f`，`audioGainDb` 为 `0`；提交或 OTA 安装前必须同实际文件核对。

`audio/midnight-library-soft.ogg` 与 `audio/midnight-library-night.ogg` 同样作为 15 分钟候选素材保留在 Git LFS，供后续主观听感复核，但没有被场景清单引用，不会被运行时加载。运行时始终以 `scene_videos.json` 的版本化文件名为准；MP4 仅承担视觉循环，永久静音，独立 Ogg 在暂停、继续、视频切换和静态视频降级期间保持自己的连续播放时间线。
