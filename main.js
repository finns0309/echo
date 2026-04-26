const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { execFile } = require('child_process');

const BROADCAST_SOCK = '/tmp/echo.sock';

const TRAY_THEMES = require('./renderer/themes.js');

let win;
let tray;
let clickThrough = false;
let currentTheme = 'aura';
// Scene rules cache, mirrored from the renderer so the tray menu can show the
// right radio mark in the "按场景切换" submenu. Renderer is source of truth.
const SCENE_KINDS = [
  { id: 'instrumental', label: '纯音乐 (pureMusic)' },
];
let sceneRules = {};
let broadcastServer;
let broadcastClients = new Set();
let broadcastTimer;
let lastBroadcastKey = '';
let lastElapsed = -1;
let lastElapsedAt = 0;

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

  win.on('move',   () => { pushState(true); reportBoundsChange(); });
  win.on('resize', () => { pushState(true); reportBoundsChange(); });
}

// Phase 2: tell the renderer when the user moves / resizes the window so it
// can persist `theme.bounds.<currentTheme>`. Two guards: (1) skip events
// triggered by our own setBounds() inside applyWindowProfile; (2) debounce
// so dragging doesn't spam localStorage writes.
let suppressBoundsEventUntil = 0;
let boundsBroadcastTimer = null;
function reportBoundsChange() {
  if (Date.now() < suppressBoundsEventUntil) return;
  if (!currentTheme || !win || win.isDestroyed()) return;
  clearTimeout(boundsBroadcastTimer);
  boundsBroadcastTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('theme-bounds-changed', { name: currentTheme, bounds: win.getBounds() });
  }, 250);
}

async function pushState(force = false) {
  if (broadcastClients.size === 0) return;
  const np = await runNowPlaying();
  const bounds = win && !win.isDestroyed() ? win.getBounds() : null;

  // nowplaying-cli's playbackRate is unreliable (NetEase reports 0 while playing),
  // so treat "has title" as loaded and confirm with an advancing elapsed clock.
  let playing = false;
  const now = Date.now();
  if (np && np.title) {
    if (np.rate > 0) {
      playing = true;
    } else if (lastElapsed >= 0 && np.elapsed > lastElapsed + 0.1) {
      playing = true;
    } else if (lastElapsedAt === 0) {
      playing = true;
    }
    lastElapsed = np.elapsed;
    lastElapsedAt = now;
  } else {
    lastElapsed = -1;
  }

  const state = {
    type: 'state',
    playing,
    title: np?.title || '',
    artist: np?.artist || '',
    bounds,
  };
  const key = JSON.stringify(state);
  if (!force && key === lastBroadcastKey) return;
  lastBroadcastKey = key;
  const line = key + '\n';
  for (const c of broadcastClients) {
    try { c.write(line); } catch {}
  }
}

function startBroadcastServer() {
  try { fs.unlinkSync(BROADCAST_SOCK); } catch {}
  broadcastServer = net.createServer((client) => {
    broadcastClients.add(client);
    client.on('close', () => broadcastClients.delete(client));
    client.on('error', () => broadcastClients.delete(client));
    pushState(true);
  });
  broadcastServer.on('error', () => {});
  broadcastServer.listen(BROADCAST_SOCK);
  broadcastTimer = setInterval(() => pushState(false), 1000);
}

function callNowPlayingOnce() {
  return new Promise((resolve) => {
    execFile(
      'nowplaying-cli',
      ['get', '--json', 'title', 'artist', 'album', 'elapsedTime', 'duration', 'playbackRate'],
      { timeout: 1500 },
      (err, stdout) => {
        if (err) return resolve(null);
        let j;
        try { j = JSON.parse(stdout); } catch { return resolve(null); }
        if (!j.title || j.title === 'null') return resolve(null);
        resolve({
          title: j.title,
          artist: j.artist && j.artist !== 'null' ? j.artist : '',
          album: j.album && j.album !== 'null' ? j.album : '',
          elapsed: typeof j.elapsedTime === 'number' ? j.elapsedTime : 0,
          duration: typeof j.duration === 'number' ? j.duration : 0,
          rate: typeof j.playbackRate === 'number' ? j.playbackRate : 0,
        });
      }
    );
  });
}

// Try the muse player first (http://127.0.0.1:10755/now). If it's running,
// it owns the audio element and reports a frame-accurate currentTime — so
// the renderer can throw away the local-clock estimation entirely. Falls
// back to nowplaying-cli (NetEase official client) when muse isn't up.
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
  const muse = await callMuseOnce();
  if (muse) return muse;
  // Retry once on null — nowplaying-cli occasionally returns empty even when
  // the song is playing; a quick second attempt usually succeeds.
  const first = await callNowPlayingOnce();
  if (first) return first;
  await new Promise((r) => setTimeout(r, 120));
  return callNowPlayingOnce();
}

ipcMain.handle('now-playing', () => runNowPlaying());

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
    case 'headline': // 520×220 顶居中 — legacy default; aura/wave/typewriter/ink/pop/piano
      return { width: 520, height: 220, x: wa.x + Math.round(wa.width / 2 - 260), y: wa.y + 60, clickThrough: false };
    case 'wide':     // 720×240 顶居中 — folio/sleeve/minimal (cover-left or triplet)
      return { width: 720, height: 240, x: wa.x + Math.round(wa.width / 2 - 360), y: wa.y + 60, clickThrough: false };
    case 'subtitle-strip': // 屏宽×120 贴底 — subtitle theme; click-through so it can't grab
      return { width: wa.width, height: 120, x: wa.x, y: wa.y + wa.height - 140, clickThrough: true };
    case 'card':     // 380×520 右悬 — imsg/duet conversation
      return { width: 380, height: 520, x: wa.x + wa.width - 400, y: wa.y + 60, clickThrough: false };
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
  // "按场景切换" — one submenu per kind, with a radio list of all themes
  // (plus "跟随默认" which clears the rule). Sends { kind, theme } to the
  // renderer; renderer persists + re-resolves the active theme.
  const sceneItems = SCENE_KINDS.map((k) => ({
    label: k.label,
    submenu: [
      {
        label: '跟随默认',
        type: 'radio',
        checked: !sceneRules[k.id],
        click: () => {
          delete sceneRules[k.id];
          if (win && !win.isDestroyed()) {
            win.webContents.send('scene-rule', { kind: k.id, theme: '' });
          }
          rebuildTrayMenu();
        },
      },
      { type: 'separator' },
      ...TRAY_THEMES.map((t) => ({
        label: t.label,
        type: 'radio',
        checked: sceneRules[k.id] === t.name,
        click: () => {
          sceneRules[k.id] = t.name;
          if (win && !win.isDestroyed()) {
            win.webContents.send('scene-rule', { kind: k.id, theme: t.name });
          }
          rebuildTrayMenu();
        },
      })),
    ],
  }));
  const menu = Menu.buildFromTemplate([
    { label: 'Theme', submenu: themeItems },
    { label: '按场景切换', submenu: sceneItems },
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
    { label: 'Show / focus window', click: () => win.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  // SF Symbol "music.note" rendered to a template PNG via
  // scripts/render-tray-icon.swift. Template image = black-on-transparent;
  // macOS auto-inverts for dark-mode menu bar. The "-Template" filename
  // suffix is also a recognized hint, but we set the flag explicitly to
  // avoid depending on the heuristic.
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-Template.png'));
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

// Renderer pushes its rules table on startup so the tray submenu opens with
// the correct radio marks (otherwise they'd all be empty after a relaunch).
ipcMain.on('scene-rules-init', (_, rules) => {
  if (rules && typeof rules === 'object') {
    sceneRules = rules;
    rebuildTrayMenu();
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  startBroadcastServer();
  if (process.platform === 'darwin') app.dock?.hide();
});

app.on('before-quit', () => {
  if (broadcastTimer) clearInterval(broadcastTimer);
  try { broadcastServer?.close(); } catch {}
  try { fs.unlinkSync(BROADCAST_SOCK); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
