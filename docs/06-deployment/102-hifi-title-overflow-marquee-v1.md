# 102 Hi-Fi 标题溢出滚动 v1

## 状态

Acceptance baseline — 2026-09-17。

## 范围

102（Radxa / Debian ARM64）上的 Hi-Fi 现在播放标题与歌词标题不能截断、换行或压到时钟区域。标题只有在真实渲染宽度超过可视区域时才横向循环；能完整显示时保持静止。

该规则覆盖：

- Hi-Fi 无歌词的居中歌曲名；
- 歌词识别中、未找到歌词、以及歌词墙标题；
- Hi-Fi 底部播放栏的歌曲名。

## 实现约束

`OverflowMarquee` 使用 `ResizeObserver` 重新测量可视容器，并只比较第一份原始标题的 `scrollWidth` 与视口宽度。滚动时追加的无障碍隐藏副本不参与判断，因此窗口变宽或下一首变短时动画会停止。

CSS 负责裁剪视口、复制间距和线性位移动画；文本始终单行。歌词标题容器占满可用宽度，歌词墙右侧保留时钟安全区。

## 验收

- `npm run build` 与 `git diff --check` 通过。
- 102 的实际 kiosk 页面通过 CDP 刷新并回到 Hi-Fi；静态歌曲标题在 834px 视口、516px 内容宽度下保持静止。
- 将同一标题视口临时缩至 200px 后，组件进入 `hifi-title-marquee`，计算动画为 `hifi-title-marquee` 且 transform 非零；恢复 834px 后回到 `is-static` / `animation: none`。
- 现场截图确认短标题不换行、不覆盖时钟或控制区。

## 回滚

回滚本提交后重新执行 `npm run build` 并刷新 kiosk 页面即可恢复旧行为。不要用递归同步或清理命令覆盖设备上的运行时配置。
