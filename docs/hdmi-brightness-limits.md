# HDMI brightness limits

`TIKPAL_DDC_BRIGHTNESS_MIN` and `TIKPAL_DDC_BRIGHTNESS_MAX` set inclusive integer
DDC control bounds, defaulting to 0 and 100. Configure these in the device's
`.env.kiosk` (loaded by the API and physical display helper). Invalid, empty,
out-of-range or reversed bounds refuse brightness writes and log an error.
TURZX brightness and volume do not use these limits.

The API applies bounds immediately before DDC writes, including room-mode and
night-schedule actions. Display snapshots expose optional `minBrightnessPercent`
and `maxBrightnessPercent`; the UI uses them for drag/wheel input and shows the
returned control value rather than the original request. Older servers default
to 0–100 in the UI. This is a control percentage, not measured panel luminance.

For the RTK HDMI panel currently attached to 192.168.10.207, use:

```dotenv
TIKPAL_DDC_BRIGHTNESS_MIN=10
TIKPAL_DDC_BRIGHTNESS_MAX=45
TIKPAL_PHYSICAL_DISPLAY_SAFE_BRIGHTNESS=45
```

The observed 10 → 30 → 45 sequence became progressively brighter, but 48 became
dimmer. The previous maximum of 48 was therefore reduced to 45 and the control
restored to 45. These are provisional limits based on that field observation,
not a certified thermal limit or a correction to the panel's transfer curve.
Do not copy this profile onto other displays without validation. The physical
display helper also clamps its startup and soft-wake brightness to these bounds.
Direct manual `ddcutil` commands or monitor buttons are outside this protection.

Run `node scripts/brightness-limits-smoke.mjs`, `npm run typecheck`,
`npm run build`, and `npm run test:kiosk`. Back up device env, server, helper
and frontend before scoped deployment. Verify actual DDC readback at 45, then
test only 10, 30, 45 and restore 45 with a person watching the panel. Do not
repeat the failed 48 test. Stop if the
panel blacks out or brightness is non-monotonic. For subsequent cold boots:
the panel must light without a remote browser selecting a scene, and remain
within bounds after startup, gestures, and room changes.

## 2026-09-09：207 现场排查与结论

本节记录已完成的这一次现场验收；时间均为 Asia/Shanghai。设备为
`gentoo-nvme-207`（`192.168.10.207`），内核为
`6.18.43-gentoo-dist-bin`，显示输出为 Radeon `HDMI-0`，对应 DRM
`card0-HDMI-A-1`。现场 EDID 标识为 `RTK FHD HDR` / `demoset-1`，
DDC 为 Display 1、`/dev/i2c-4`。这些编号可能随硬件变化而改变，不能直接
复制到其他设备。此屏与此前连接过的 Corsair/TURZX 不应混为同一型号。

### 证据与排除范围

- 当前 EDID 声明的首选模式就是 `2560×720@60`，不是此前其他屏幕的
  `1920×1080`。没有以旧屏幕记录为依据更改当前分辨率。
- 黑屏时曾观察到 HDMI `connected`、`enabled`、`link-status=Good`，
  DDC 亮度可读写，输入源 `0x11`，电源模式 `0x01`；X11 的 DPMS 和屏保
  已关闭。以上只证明软件状态和控制通道，不能证明面板实际发光或 HDMI
  像素传输完整，更不能单凭这些状态断言背光/供电故障。
- X11 抓帧统计显示非黑像素，但未形成面板实际显示证据，不能把该统计
  当作显卡至面板整条链路的验收。
- 触控 `27c0:0859` 曾在 USB `2-14.1` 反复重置并报 `-71`，后续换到
  `1-5.1`。拔掉数据线后屏幕仍黑；USB 异常本身不能确立黑屏因果，
  也不能证明供电或温度异常。
- 用户曾反馈过热保护，但没有取得驱动板温度或保护状态读数。
  `x86_pkg_temp` 的 62–64°C 是主机 CPU 温度，不是面板温度；
  亮度限幅不宣称证实或修复了热保护。207 的 CPU 过热场景降级另见
  [Gentoo 207 constrained kiosk v1](06-deployment/gentoo-207-constrained-kiosk-v1.md#cpu-thermal-scene-guard)：它仅按已识别的 CPU
  传感器触发，绝不把 CPU 读数表述为主板或面板温度。
- 一次重启后，用户在电脑访问 `http://192.168.10.207:4173` 并选择
  模式/场景，本地屏才亮起。代码中的模式/场景动作会重新下发共享设备
  亮度，因此这是重要的写入触发线索，不能描述为“单纯打开网页即可修复”。

### 实体屏亮度测试

按顺序一次只设置一个值，DDC 回读后等待用户确认再推进：

| 设置值 | DDC 回读 | 用户看到的变化 | 处理 |
| --- | --- | --- | --- |
| 10 | 10/100 | 比 45 暗，画面可见 | 通过该点 |
| 30 | 30/100 | 比 10 亮 | 通过该点 |
| 45 | 45/100 | 比 30 更亮 | 通过该点 |
| 48 | 48/100 | 反而变暗 | 停止上探，拒绝原 48 上限 |
| 恢复 45 | 45/100 | 用户确认恢复此前亮度 | 最终保持值 |

最终策略为 **10–45，开机 45**。仅验证了表中离散值和这一次重启，
没有证明区间内每一个整数都线性，也没有证明长期热稳定。
不进行 46/47/49/100 的实体屏探索，不实现猜测的反向曲线。

### 写入链路与 UI 语义

1. 左侧拖动、滚轮、手势起始值、待发送队列使用服务器提供的范围，
   上下滑动触及边界后仍保持在 10/45；右侧音量使用原有 0–100 范围。
2. `POST /api/v1/system/actions` 的 `brightness_set` 仍接收 0–100
   的合法请求，后端在 DDC 写入之前裁剪。场景预设、夜间模式和恢复动作
   经由同一入口，无法通过这些入口越过上限。
3. `system.display` 返回可选的 `minBrightnessPercent` 和
   `maxBrightnessPercent`。缺少字段的旧接口前端仍按 0–100 处理。
   显示范围不改变 `brightnessPercent` 的单位：45 仍显示 45，绝不映射为 100。
4. 写入成功后 API 缓存记录裁剪后的控制值，UI 采用响应中的值而非原始请求。
   这不是光度计读数；驱动板回报数值一致也可能出现实际亮度反向变化。
5. `.env.kiosk` 由 API 与启动 helper 共用。仅改 `.env` 可能被后加载的
   `.env.kiosk` 覆盖。启动和软唤醒写亮度前再次执行同样的限幅。
6. 两个范围参数均须为 1–3 位十进制整数，满足 `0 <= min <= max <= 100`；
   空值、非整数、倒置或越界拒绝亮度写入并记录错误。默认不配置时为 0–100。
   TURZX 路由不使用这组 DDC 限幅。

### 部署、备份与恢复边界

现场部署前核对后端、仓库 helper、已安装 helper 与本地修改前版本的
SHA-256 一致。仅更新 API、显示 helper、新构建的 HTML/JS/CSS 和
设备亮度配置，保留旧哈希前端资源及其他媒体。未同步音频或 FT8201P 文件。

备份保存在设备 `/root/tikpal-brightness-207-20260909/`，包括原配置、
API、仓库/安装版 helper 与 HTML。48 收紧到 45 之前的配置另存于
`/home/moode/code/tikpal/.env.kiosk.before-cap45-20260909`。
备份含机器私有配置，只保留在设备上，不加入 Git。

部署时重启 API/Web，并通过现有 kiosk 页面 reload 加载新前端，未为此
重启 X11/kiosk。核验本地与设备部署文件哈希一致，页面加载新 JS。
将最大值收紧到 45 时仅更新设备配置并重启 API，前端从状态读取新上限。

恢复旧版本前先检查备份中的亮度值：历史备份可能含开机 100 或上限 48，
不能直接恢复整份配置并重启。保留当前 10–45/45 策略；若需退回不支持
限幅的旧代码，须另行安排人工亮度管控，不能宣称仍有软件限幅保护。

### 本次重启验收结果

用户自行重启后反馈“目前没问题”。22:11:29 只读核验结果：

- 系统启动时间：22:10:02；kiosk 启动 22:10:27，API 启动 22:10:23。
- kiosk/API 均为 `active`，`NRestarts=0`；HDMI `connected` 且 `enabled`。
- `.env.kiosk` 为 min=10、max=45、启动亮度=45。
- API 为 `brightnessPercent=45`、`transport=ddcci`，范围 10–45；
  独立 DDC 回读 `VCP 10 C 45 100`。

据用户现场反馈与服务/硬件回读，此次重启验收通过。后续若再次出现
启动黑屏或必须选择场景才亮，保留该次启动日志、动作时间和亮度回读，
作为新的启动显示故障继续诊断，不反复提高亮度或强制唤醒。

### 提交前软件验证

2026-09-09 的最终源码检查通过：

- `node scripts/brightness-limits-smoke.mjs`：真实函数提取后的模拟 DDC
  上下限写入、非法参数拒绝、场景预设/夜间入口、启动脚本、手势队列及
  反向拖动、响应数字、未配置设备和音量/TURZX 行为；补充了 207 上限 45
  时请求 48 仅写 45 的回归。测试中的超限请求只在模拟环境运行。
- `npm run build`：包含 `tsc -b` 类型检查及 Vite 构建。现有单个 JS chunk
  大于 500 kB 的提示仍存在，不影响本次构建通过。
- `npm run test:kiosk`：Provider 音频门控、kiosk package（包含辅助增益、
  系统 Widevine 来源 fixture）和 Explore lifecycle 检查通过。
- 显示/Web Mode/音频脚本 shell 语法、后端及 kiosk fixture 的 Node
  语法检查、`git diff --check` 均通过。

上述手势自动检查是提取实际函数后的事件/队列测试，不宣称完成了实体屏
连续手势全覆盖。未执行 FT8201P 内核编译/装载，也没有重跑整个 API 全量
测试或长期热稳定测试。源代码提交不会自动部署同批音频、Widevine 或
FT8201P 改动到现场设备。
