# Echo

悬浮歌词小工具 · macOS · 配合网易云云音乐使用。

## 一次性准备
```bash
brew install nowplaying-cli
cd /Users/finn/Code/sideProject
npm install
```

## 启动
```bash
npm start
```

## 使用
- 窗口始终置顶，拖动窗口主体即可移动位置。
- 右上 `◌` 切换鼠标穿透（点一下变 `●`，窗口不再拦截点击，歌词挂在桌面上像贴纸）。
- 右上 `×` 退出。
- 菜单栏有个 `♪` 图标，可再次打开穿透或退出。

## 工作原理
1. `nowplaying-cli`（封装 macOS 私有框架 MediaRemote）读取当前播放的歌名/歌手/进度。
2. 用歌名+歌手去网易云公开搜索接口匹配最相近的条目，拉 LRC + 翻译歌词 + 专辑封面。
3. 封面做模糊铺底，进度条按 60fps 插值滚动歌词。

## 维护文档
- 架构总览：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 视觉方向手册：[DESIGN_DIRECTIONS.md](./DESIGN_DIRECTIONS.md)
- 音频分析与 onset 检测：[AUDIO_ANALYSIS.md](./AUDIO_ANALYSIS.md)
- 与 muse 的播放状态协议：[./NOW_PLAYING.md](./NOW_PLAYING.md)

## 已知坑
- 网易云 Mac 客户端偶尔不上报 Now Playing；可以先在网易云里切一下歌触发。
- 纯器乐/冷门曲目可能搜不到，会退化为只显示歌名。
