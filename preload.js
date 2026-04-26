const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  nowPlaying: () => ipcRenderer.invoke('now-playing'),
  toggleClickThrough: () => ipcRenderer.invoke('toggle-click-through'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
  // Per-theme window profile. Returns the resulting clickThrough state so
  // the renderer can sync its `◌/●` button without a second round-trip.
  // override = { bounds?, clickThrough? } — renderer-side persisted prefs.
  applyWindowProfile: (name, override) => ipcRenderer.invoke('apply-window-profile', name, override),
  // Phase 2 override-memory channel. Main pings these when the user moves /
  // resizes / toggles click-through; renderer persists per-theme.
  onBoundsChange:        (cb) => ipcRenderer.on('theme-bounds-changed',       (_, p) => cb(p)),
  onClickThroughChange:  (cb) => ipcRenderer.on('theme-clickthrough-changed', (_, p) => cb(p)),
  onResetWindow:         (cb) => ipcRenderer.on('reset-window-override',     (_, p) => cb(p)),
  quit: () => ipcRenderer.invoke('quit'),
  reportTheme: (name) => ipcRenderer.send('theme-changed', name),
  onApplyTheme: (cb) => ipcRenderer.on('apply-theme', (_, name) => cb(name)),
  // Scene-rule channel: tray "按场景切换" submenu sends { kind, theme } here.
  // theme === '' clears the rule (fall back to default for that kind).
  onSceneRule: (cb) => ipcRenderer.on('scene-rule', (_, payload) => cb(payload)),
  reportSceneRules: (rules) => ipcRenderer.send('scene-rules-init', rules),
});
