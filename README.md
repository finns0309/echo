# echo

桌面悬浮歌词 · macOS · [muse](https://github.com/finns0309/muse) 的可视层。

`echo` 不是一个完整的播放器，它只负责"音乐愿意留在屏幕上的样子"——歌词、封面氛围、按主题切换的窗框。播放本身交给 `muse`。

```text
muse                       echo
持有 audio + library   →    悬浮歌词 + 视觉氛围
GET /now (HTTP)
```

## 搭配 muse（推荐）

```bash
git clone git@github.com:finns0309/echo.git
cd echo
npm install
npm start
```

`muse` 已经在跑的话，`echo` 启动后会自动连上 `127.0.0.1:10755/now` —— 直接拿到准确的 `songId`、`currentTime` 和封面，不用猜歌也不用猜进度。

## 独立跑（兜底模式）

没有 `muse` 时，`echo` 会退到 `nowplaying-cli`（封装 macOS MediaRemote）读官方 Now Playing：

```bash
brew install nowplaying-cli
npm start
```

代价：

- 官方客户端事件稀疏，`elapsedTime` 经常卡住或缺失
- 只能拿到 title / artist，要去网易云公开接口模糊搜歌、容易匹配到错误版本
- 启动后菜单栏会出现"后备模式"角标提醒你正在走这条路

够用，但 `muse` 在线时体验显著更好。

## 使用

- 拖动窗口主体即可移动；右上 `◌` 切鼠标穿透（变 `●` 后窗口不拦截点击，像贴纸贴在桌面上），右上 `×` 退出
- 菜单栏 `♪` 图标：切主题、按场景切换（纯音乐自动用 visualizer）、重置该主题的窗口、退出
- **按主题决定窗框**——切到 `流体` 自动全屏可交互，切到 `弹幕` 自动全屏穿透，切到 `短信` 自动右侧竖卡，切到 `字幕` 自动贴底。手动拖大 / 改穿透状态的偏好会按主题记住

## 主题概览

18 个，分布在六种 layout 上：

- `stage` — 浮动卡片：波浪 / 打字机 / 水墨 / 字弹 / 樱花 / 暴雨 / 流体 / 水波
- `triplet` — 上一句 / 当前 / 下一句：封套（Folia 风）/ Apple Music
- `single` — 只显示当前句：神光 / 流光页 / 雨夜钢琴
- `conversation` — iMessage 式对话流：短信 / 对唱
- `solo` — 纯音乐 visualizer：纯音乐
- `danmaku` — 桌面弹幕：弹幕
- 加上 `subtitle` 单句字幕条

每个主题挂在一个 *window profile* 上（headline / wide / card / subtitle-strip / ambient / overlay），决定窗口尺寸 + 是否默认穿透。详见 [ARCHITECTURE.md](./ARCHITECTURE.md) §3.

## 维护文档

- 架构总览：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 视觉方向手册：[DESIGN_DIRECTIONS.md](./DESIGN_DIRECTIONS.md)
- 音频分析与 onset 检测：[AUDIO_ANALYSIS.md](./AUDIO_ANALYSIS.md)
- muse ↔ echo 协议：[NOW_PLAYING.md](./NOW_PLAYING.md)（两边各持一份正本）

## 已知坑

- 兜底模式下，纯器乐 / 冷门曲目可能搜不到，只显示歌名
- 兜底模式下，网易云 Mac 客户端偶尔不上报 Now Playing，先在客户端切一下歌可以触发
- macOS 真·全屏（Spaces 那种）的视频播放器会盖住 echo——这是 `'floating'` 层级的预期代价，换来菜单栏弹层不被歌词遮住

## 与 notch-cat 的联动

`echo` 主进程在 `/tmp/echo.sock` 广播播放状态，[notch-cat](https://github.com/wxtsky/CodeIsland) 移植版小猫蹲在 MacBook 刘海下听到 socket 后会跑到歌词框旁边跟着节拍跳舞。可选，不开启不影响 `echo` 本体。
