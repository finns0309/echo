# echo

桌面悬浮歌词 · macOS · [muse](https://github.com/finns0309/muse) 的可视层。

`echo` 不是一个完整的播放器，它只负责"音乐愿意留在屏幕上的样子"——歌词、封面氛围、按主题切换的窗框。播放本身交给 `muse`，`echo` 只读不控。

```text
muse                            echo
持有 audio + library   ──/now──────▶   悬浮歌词 + 视觉氛围
                       └─/spectrum─┘    （音频反应引擎：风铃 / 漫游 / 新世纪 / 镭射票 在听）
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

### 选词导演（可选，需要 LLM key）

主题里标红 / 放大的「强调词」默认由启发式挑选（`renderer/textpick.js`），CJK 分词常出错（日语只取到「合」而不是「合う」）。配置 LLM 导演后，每首**新**歌在换曲时把整份歌词批量交给 Claude 选词一次，结果按歌词哈希落盘缓存（`userData/director-cache/`），重听零成本；没有 key / 请求失败时静默回退启发式，永远不挡渲染。在仓库根目录建 `secrets.json`（已 gitignore，**不要提交**）：

```json
{
  "bedrockApiKey": "ABSK…（Bedrock API key，bearer）",
  "bedrockRegion": "us-east-1",
  "bedrockModel": "global.anthropic.claude-sonnet-4-6"
}
```

主进程经 Chromium 网络栈（`net.fetch`）调 Bedrock，跟随系统代理。详见 `director.js` 头注释。

## 使用

- 拖动窗口主体即可移动；右上 `◌` 切鼠标穿透（变 `●` 后窗口不拦截点击，像贴纸贴在桌面上），`⤢` 铺满 / 还原，`×` 退出
- 菜单栏 `♪` 图标：切主题、重置该主题的窗口、显示 / 隐藏、退出
- **按主题决定窗框**——切到 `流体` 自动全屏可交互，`弹幕` 自动全屏穿透，`短信` 自动右侧竖卡，`字幕` 自动贴底。手动拖大 / 改穿透状态的偏好会按主题记住

## 十五个主题

| 主题 | layout | 窗框 | 一句话 |
|---|---|---|---|
| 打字机 | stage | headline · 顶居中 | 纸张 + 等宽 + 逐字光标 |
| 水墨 | stage | headline · 顶居中 | 衬线书法，blur 晕开 |
| 流体 | stage | ambient · 全屏 | WebGL fbm 流体背景 |
| 余烬 | stage | ambient · 全屏 | WebGL 上升火焰，烬光托着歌词 |
| 曲速 | stage | ambient · 全屏 | WebGL 径向星流，跃迁隧道 |
| 天空 | stage | ambient · 全屏 | 赛璐璐粉彩云海（ちいかわ感），唯一浅色 fx |
| 字幕 | single | subtitle-strip · 贴底 | 不抢戏的桌面字幕条 |
| 弹幕 | danmaku | overlay · 全屏穿透 | 歌词像 B 站弹幕飘过桌面 |
| 漫游 | roam | overlay · 全屏穿透 | 导演逐句调度全桌面的动态排版，副歌视觉押韵 |
| 云隙 | shinkai | ambient · 全屏 | 新海诚式天空——跟真实时刻走的天色、云隙光、电线剪影 |
| 星瞳 | idol | ambient · 全屏 | 偶像舞台：荧光棒海随歌涌动，星瞳落在一个字上 |
| 新世纪 | eva | ambient · 全屏 | 黑场明朝体字卡硬切（次回予告），鼓点泛起 A.T. 力场 |
| 风铃 | furin | hanging · 顶部垂挂 | 江户玻璃风铃桌面物件，歌词竖排短册，歌声化风 |
| 镭射票 | ticket | tall-card · 右侧竖卡 | 全息演唱会票根，歌词是烫印防伪纹，换曲撕票 |
| 短信 | conversation | card · 右侧竖卡 | 歌词逐句变成 iMessage 气泡 |

加新主题大多数时候只是往 `renderer/themes.js` 加一条；详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

> 早期版本有 24 个主题（含 three.js 字碎、雨夜钢琴、纯音乐 visualizer 等）。2026-06 一度收敛到 6 个常用的，并去掉了 `nowplaying-cli` 兜底（现在 muse-only）；之后按「视觉语法案例研究」的标准重新长出新主题——每个都要有自己的参照系、剧情内歌词、音频映射、空闲态和换曲仪式，而不是换肤。当年休眠保留的 **spectrum + onset 引擎**也随之转正：风铃（rms→风）、漫游（rms→导演能量）、新世纪（onset→A.T. 力场）、镭射票（onset→倾斜、centroid→衍射色）都在 `FL_AUDIO.onOnset(cb)` / `getFrame()` 上听歌——见 [AUDIO_ANALYSIS.md](./AUDIO_ANALYSIS.md)。

## 维护文档

- 架构总览：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 视觉方向手册：[DESIGN_DIRECTIONS.md](./DESIGN_DIRECTIONS.md)
- 音频分析与 onset 检测：[AUDIO_ANALYSIS.md](./AUDIO_ANALYSIS.md)
- muse ↔ echo 协议：[NOW_PLAYING.md](./NOW_PLAYING.md)（两边各持一份正本）

## 已知坑

- macOS 真·全屏（Spaces 那种）的视频播放器会盖住 echo——这是 `'floating'` 层级的预期代价，换来菜单栏弹层不被歌词遮住
