const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const path = require('path');

const TRAY_THEMES = require('./renderer/themes.js');
const director = require('./director.js');

let win;
let tray;
let clickThrough = false;
let currentTheme = 'typewriter';

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;

  win = new BrowserWindow({
    width: 520,
    height: 220,
    x: Math.round(width / 2 - 260),
    y: 60,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    vibrancy: null,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'floating' (not 'screen-saver') — screen-saver sits ABOVE pop-up menus,
  // so the tray menu would render under echo whenever a fullscreen profile
  // (ambient / overlay) was active. 'floating' stays above normal windows
  // but yields to the menu layer; the cross-Space behavior comes from the
  // setVisibleOnAllWorkspaces call below, not from the level.
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Diagnostic: surface any renderer console output (errors + logs) into the
  // terminal running `npm start`. Makes debugging the renderer possible even
  // without cracking open devtools. Remove this when the UI stabilizes.
  win.webContents.on('console-message', (_, level, message, line, source) => {
    const tag = ['log', 'warning', 'error'][level] || 'log';
    console.log(`[renderer:${tag}] ${message}  (${source}:${line})`);
  });

  win.on('move',   () => reportBoundsChange());
  win.on('resize', () => reportBoundsChange());
}

// Phase 2: tell the renderer when the user moves / resizes the window so it
// can persist `theme.bounds.<currentTheme>`. Two guards: (1) skip events
// triggered by our own setBounds() inside applyWindowProfile; (2) debounce
// so dragging doesn't spam localStorage writes.
let suppressBoundsEventUntil = 0;
let boundsReportTimer = null;
function reportBoundsChange() {
  if (Date.now() < suppressBoundsEventUntil) return;
  if (!currentTheme || !win || win.isDestroyed()) return;
  clearTimeout(boundsReportTimer);
  boundsReportTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('theme-bounds-changed', { name: currentTheme, bounds: win.getBounds() });
  }, 250);
}

// Read the muse player (http://127.0.0.1:10755/now). muse owns the audio
// element and reports a frame-accurate currentTime, songId, and cover.
// Returns null when muse isn't up (echo then shows its idle state).
// Protocol: ./NOW_PLAYING.md — any field change must land there + in muse
// in the same commit.
async function callMuseOnce() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 250);
    const r = await fetch('http://127.0.0.1:10755/now', { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.title) return null;
    return {
      title: j.title,
      artist: j.artist || '',
      album: j.album || '',
      elapsed: j.currentTime || 0,
      duration: j.duration || 0,
      rate: j.playing ? 1 : 0,
      source: 'muse',
      // Pass NetEase songId + cover through so the renderer can skip its
      // fuzzy title+artist search (which often picks the wrong version).
      songId: j.songId || 0,
      cover: j.cover || '',
      // Timeline-anchoring fields (NOW_PLAYING.md v1.1). Absent from older
      // muse builds — renderer treats missing values as "fall back to
      // poll-time anchoring", which is the pre-v1.1 behavior.
      positionSampledAt: typeof j.positionSampledAt === 'number' ? j.positionSampledAt : 0,
      stateVersion: typeof j.stateVersion === 'number' ? j.stateVersion : 0,
    };
  } catch { return null; }
}

async function runNowPlaying() {
  return callMuseOnce();
}

ipcMain.handle('now-playing', () => runNowPlaying());

// 选词导演：renderer 把整首歌词交来，这里查缓存或调 Bedrock（director.js）。
// 返回 行文本→强调词 映射；任何失败返回 null（renderer 用启发式兜底）。
ipcMain.handle('director', (_, payload) => director.direct(payload));

ipcMain.handle('toggle-click-through', () => {
  clickThrough = !clickThrough;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  // Manual toggle counts as a per-theme override; renderer persists it
  // under `theme.clickthrough.<currentTheme>`.
  if (currentTheme) win.webContents.send('theme-clickthrough-changed', { name: currentTheme, clickThrough });
  return clickThrough;
});

// Per-theme window profiles. Renderer's applyTheme() invokes this on every
// theme switch with the theme's `window` field. Profile→bounds resolution
// lives here (not in themes.js) because only main can read `screen` for
// fullscreen / bottom-strip layouts. See themes.js for the per-theme picks.
//
// Phase 1 only: profiles always win on theme apply. Phase 2 will add
// per-theme override memory (user resize / manual click-through stick).
function resolveWindowProfile(name) {
  const wa = screen.getPrimaryDisplay().workArea; // excludes menubar/dock
  switch (name) {
    case 'headline': // 520×220 顶居中 — typewriter / ink
      return { width: 520, height: 220, x: wa.x + Math.round(wa.width / 2 - 260), y: wa.y + 60, clickThrough: false };
    case 'subtitle-strip': // 屏宽×120 贴底 — subtitle theme; click-through so it can't grab
      return { width: wa.width, height: 120, x: wa.x, y: wa.y + wa.height - 140, clickThrough: true };
    case 'card':     // 380×520 右悬 — imsg/duet conversation
      return { width: 380, height: 520, x: wa.x + wa.width - 400, y: wa.y + 60, clickThrough: false };
    case 'karaoke': {// 居中卡拉OK屏 — 宽幅面板，跟唱时能读到上下文行 + 逐字填充
      const kw = Math.min(760, wa.width - 80);
      const kh = Math.min(420, wa.height - 120);
      return { width: kw, height: kh, x: wa.x + Math.round((wa.width - kw) / 2), y: wa.y + Math.round((wa.height - kh) * 0.32), clickThrough: false };
    }
    case 'hanging':  // 300×470 顶部右侧垂挂 — furin 风铃 (cord hangs from the window top edge)
      return { width: 300, height: 470, x: wa.x + wa.width - 330, y: wa.y, clickThrough: false };
    case 'tall-card': // 380×720 右侧竖卡 — ticket 镭射票 (vertical holo ticket + stub pile)
      return { width: 380, height: 720, x: wa.x + wa.width - 396, y: wa.y + Math.max(0, Math.round((wa.height - 720) * 0.6)), clickThrough: false };
    case 'ambient':  // 全屏背景 — plasma/ripple/sakura/storm/instrumental, NOT click-through
      return { width: wa.width, height: wa.height, x: wa.x, y: wa.y, clickThrough: false };
    case 'overlay':  // 全屏覆盖 — danmaku, click-through ON
      return { width: wa.width, height: wa.height, x: wa.x, y: wa.y, clickThrough: true };
    default: return null;
  }
}

// override = { bounds?: {x,y,width,height}, clickThrough?: boolean } — renderer
// reads its localStorage and passes the user's per-theme prefs through. Either
// half can be missing; absent half falls back to the profile default.
ipcMain.handle('apply-window-profile', (_, name, override) => {
  if (!win || win.isDestroyed()) return clickThrough;
  const p = resolveWindowProfile(name);
  if (!p) return clickThrough;
  const ov = override || {};
  const bounds = ov.bounds && Number.isFinite(ov.bounds.width)
    ? { x: ov.bounds.x, y: ov.bounds.y, width: ov.bounds.width, height: ov.bounds.height }
    : { x: p.x, y: p.y, width: p.width, height: p.height };
  // Swallow the resize/move events our own setBounds will trigger, otherwise
  // we'd echo the profile defaults back to renderer as a "user override".
  suppressBoundsEventUntil = Date.now() + 300;
  win.setBounds(bounds);
  clickThrough = typeof ov.clickThrough === 'boolean' ? ov.clickThrough : !!p.clickThrough;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  return clickThrough;
});

ipcMain.handle('set-ignore-mouse-events', (_, ignore) => {
  win.setIgnoreMouseEvents(ignore, { forward: true });
});

// Pseudo-fullscreen: stretch the window to fill the work area, remember the
// pre-expand bounds so a second toggle restores them. Not OS fullscreen —
// we stay frame-less and on top.
let preMaximizeBounds = null;
ipcMain.handle('toggle-maximize-bounds', () => {
  if (!win || win.isDestroyed()) return false;
  const cur = win.getBounds();
  // Use the display the window currently sits on, not the primary display —
  // otherwise a maximize on the external monitor yanks the window back to the
  // built-in screen.
  const wa = screen.getDisplayMatching(cur).workArea;
  const isMax = preMaximizeBounds == null &&
    cur.x === wa.x && cur.y === wa.y &&
    cur.width === wa.width && cur.height === wa.height;
  suppressBoundsEventUntil = Date.now() + 300;
  if (preMaximizeBounds) {
    win.setBounds(preMaximizeBounds);
    preMaximizeBounds = null;
    return false;
  }
  if (isMax) return true;
  preMaximizeBounds = cur;
  win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
  return true;
});

ipcMain.handle('quit', () => app.quit());

function rebuildTrayMenu() {
  if (!tray) return;
  const themeItems = TRAY_THEMES.map((t) => ({
    label: t.label,
    type: 'radio',
    checked: t.name === currentTheme,
    click: () => {
      currentTheme = t.name;
      if (win && !win.isDestroyed()) {
        win.webContents.send('apply-theme', t.name);
      }
      rebuildTrayMenu();
    },
  }));
  const menu = Menu.buildFromTemplate([
    { label: 'Theme', submenu: themeItems },
    { type: 'separator' },
    {
      label: 'Toggle click-through',
      click: () => {
        clickThrough = !clickThrough;
        win.setIgnoreMouseEvents(clickThrough, { forward: true });
        if (currentTheme) win.webContents.send('theme-clickthrough-changed', { name: currentTheme, clickThrough });
      },
    },
    {
      label: '重置该主题的窗口',
      click: () => {
        if (currentTheme) win.webContents.send('reset-window-override', { name: currentTheme });
      },
    },
    {
      label: win && !win.isDestroyed() && win.isVisible() ? '隐藏悬浮歌词' : '显示悬浮歌词',
      click: () => {
        if (!win || win.isDestroyed()) return;
        if (win.isVisible()) win.hide(); else win.show();
        rebuildTrayMenu();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  // Hand-drawn echo mark (dot + two concentric arcs = "broadcasting" / 回响).
  // scripts/render-tray-icon.swift writes BOTH trayTemplate.png (16×16, @1x)
  // and trayTemplate@2x.png (32×32, @2x). Pass only the @1x base name —
  // Electron's nativeImage picks @2x automatically on retina based on the
  // filename suffix (PNG metadata is ignored). The "Template" suffix in the
  // base name is what tells macOS to auto-invert in dark mode; the explicit
  // setTemplateImage(true) is belt-and-suspenders.
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  rebuildTrayMenu();
}

ipcMain.on('theme-changed', (_, name) => {
  if (typeof name === 'string' && TRAY_THEMES.some((t) => t.name === name)) {
    currentTheme = name;
    rebuildTrayMenu();
  }
});

app.whenReady().then(() => {
  director.init(app.getPath('userData'));
  createWindow();
  createTray();
  if (process.platform === 'darwin') app.dock?.hide();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
