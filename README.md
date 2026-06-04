# echo

桌面悬浮歌词 · macOS · [muse](https://github.com/finns0309/muse) 的可视层。

`echo` 不是一个完整的播放器，它只负责"音乐愿意留在屏幕上的样子"——歌词、封面氛围、按主题切换的窗框。播放本身交给 `muse`，`echo` 只读不控。

```text
muse                            echo
持有 audio + library   ──/now──────▶   悬浮歌词 + 视觉氛围
                       └─/spectrum─┘    （音频反应引擎，休眠待用）
```

## 运行（需要 muse）

`echo` 是 `muse` 的**纯消费端**——只读 `muse` 在 `127.0.0.1:10755` 广播的播放状态，自己不碰音频源。先让 `muse` 跑起来：

```bash
git clone git@github.com:finns0309/echo.git
cd echo
npm install
npm start
```

启动后 `echo` 自动连上 `/now`，拿到准确的 `songId`、`currentTime` 和封面——不用猜歌、也不用猜进度。`muse` 没在跑时，`echo` 显示待播状态。

## 使用

- 拖动窗口主体即可移动；右上 `◌` 切鼠标穿透（变 `●` 后窗口不拦截点击，像贴纸贴在桌面上），`⤢` 铺满 / 还原，`×` 退出
- 菜单栏 `♪` 图标：切主题、重置该主题的窗口、显示 / 隐藏、退出
- **按主题决定窗框**——切到 `流体` 自动全屏可交互，`弹幕` 自动全屏穿透，`短信` 自动右侧竖卡，`字幕` 自动贴底。手动拖大 / 改穿透状态的偏好会按主题记住

## 六个主题

| 主题 | layout | 窗框 | 一句话 |
|---|---|---|---|
| 打字机 | stage | headline · 顶居中 | 纸张 + 等宽 + 逐字光标 |
| 水墨 | stage | headline · 顶居中 | 衬线书法，blur 晕开 |
| 流体 | stage | ambient · 全屏 | WebGL fbm 流体背景 |
| 字幕 | single | subtitle-strip · 贴底 | 不抢戏的桌面字幕条 |
| 弹幕 | danmaku | overlay · 全屏穿透 | 歌词像 B 站弹幕飘过桌面 |
| 短信 | conversation | card · 右侧竖卡 | 歌词逐句变成 iMessage 气泡 |

加新主题大多数时候只是往 `renderer/themes.js` 加一条；详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

> 早期版本有 24 个主题（含 three.js 字碎、雨夜钢琴、纯音乐 visualizer 等）。2026-06 收敛到这 6 个常用的，并去掉了 `nowplaying-cli` 兜底（现在 muse-only）。驱动音频反应主题的 **spectrum + onset 引擎**作为基础设施保留下来、休眠待用，将来要做听声音的主题直接 `FL_AUDIO.onOnset(cb)` 订阅即可——见 [AUDIO_ANALYSIS.md](./AUDIO_ANALYSIS.md)。

## 维护文档

- 架构总览：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 视觉方向手册：[DESIGN_DIRECTIONS.md](./DESIGN_DIRECTIONS.md)
- 音频分析与 onset 检测：[AUDIO_ANALYSIS.md](./AUDIO_ANALYSIS.md)
- muse ↔ echo 协议：[NOW_PLAYING.md](./NOW_PLAYING.md)（两边各持一份正本）

## 已知坑

- macOS 真·全屏（Spaces 那种）的视频播放器会盖住 echo——这是 `'floating'` 层级的预期代价，换来菜单栏弹层不被歌词遮住
