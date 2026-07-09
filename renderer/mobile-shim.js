// mobile-shim.js — lets the desktop renderer run unchanged in a phone browser.
//
// The Electron build wires the renderer to main through preload's `window.api`
// (IPC), and lets netease.js hit music.163.com directly. Neither works in a
// plain browser: there is no preload, and the NCM endpoints reject cross-origin
// browser fetches (and strip the UA/Referer headers netease.js sets). So on the
// phone we (1) stand up a `window.api` backed by same-origin fetch to
// phone-server, and (2) reroute Netease's lyric/cover fetches through that same
// server, which does the NCM calls Node-side where CORS and forbidden headers
// don't apply.
//
// Load order (see phone.html): AFTER netease.js/audio.js — so we can wrap
// window.Netease, and the `__SPECTRUM_URL = null` pre-flag has already told
// audio.js not to open the (pointless, on a phone) spectrum socket — and BEFORE
// app.js, so window.api exists the moment it boots.
(function () {
  'use strict';

  // nowPlaying() replicates main.js callMuseOnce()'s raw-muse → renderer-shape
  // mapping (elapsed/rate/source/…). On the desktop main did this Node-side;
  // here the phone does it after the same-origin /now proxy hands back muse's
  // raw state. Returns null when nothing is playing → renderer's idle state.
  async function nowPlaying() {
    let j;
    try {
      const r = await fetch('/now', { cache: 'no-store' });
      if (!r.ok) return null;
      j = await r.json();
    } catch {
      return null;
    }
    if (!j || !j.title) return null;
    return {
      title: j.title,
      artist: j.artist || '',
      album: j.album || '',
      elapsed: j.currentTime || 0,
      duration: j.duration || 0,
      rate: j.playing ? 1 : 0,
      source: 'muse',
      songId: j.songId || 0,
      // Route album art through phone-server so the accent sampler reads
      // same-origin pixels — a remote NCM image taints the <canvas> and
      // getImageData throws, dropping the accent back to the theme default.
      cover: j.cover ? '/cover?u=' + encodeURIComponent(j.cover) : '',
      positionSampledAt: typeof j.positionSampledAt === 'number' ? j.positionSampledAt : 0,
      stateVersion: typeof j.stateVersion === 'number' ? j.stateVersion : 0,
    };
  }

  const noop = () => {};
  // app.js hands its theme-switch function to onApplyTheme(); we keep it so the
  // /control poller below can drive theme changes from the Mac menu bar.
  let themeApplyCb = null;
  // Same surface preload.js exposes. Everything past nowPlaying is a desktop
  // concept (windows, tray, click-through, the Bedrock director); app.js guards
  // the optional ones and falls back to its heuristic when director → null.
  window.api = {
    nowPlaying,
    director: async () => null,
    toggleClickThrough: async () => false,
    setIgnoreMouseEvents: async () => {},
    applyWindowProfile: async () => false, // phone is always fullscreen
    onBoundsChange: noop,
    onClickThroughChange: noop,
    onResetWindow: noop,
    toggleMaximizeBounds: async () => false,
    quit: noop,
    reportTheme: noop,
    onApplyTheme: (cb) => {
      themeApplyCb = cb;
    },
  };

  // Poll phone-server's /control so the Mac menu-bar Theme list drives the
  // phone. `rev` bumps on every menu pick; we apply the new theme through
  // app.js's own switch (themeApplyCb) — same path the desktop tray uses.
  //   · First poll with an explicit ?theme= in the URL: sync rev but DON'T
  //     override, so a hand-typed theme sticks until the next menu pick.
  //   · Otherwise: adopt whatever the menu last set (rev > 0), else keep the
  //     booted default until the menu is first used.
  let lastRev = 0;
  let firstControlPoll = true;
  async function pollControl() {
    let data;
    try {
      data = await (await fetch('/control', { cache: 'no-store' })).json();
    } catch {
      return;
    }
    if (firstControlPoll) {
      firstControlPoll = false;
      if (window.__ECHO_HAD_THEME_PARAM) {
        lastRev = data.rev; // respect the URL choice; only later picks override
        return;
      }
    }
    if (data.rev > lastRev) {
      lastRev = data.rev;
      const known = !window.FL_THEMES || window.FL_THEMES.some((t) => t.name === data.theme);
      if (themeApplyCb && known) themeApplyCb(data.theme);
    }
  }
  setInterval(pollControl, 1200);
  pollControl();

  // Reroute Netease through phone-server (same-origin; Node does the NCM call).
  // songId always arrives from muse's /now, so searchSong is a belt-and-braces
  // fallback that's rarely hit.
  if (window.Netease) {
    window.Netease.fetchLyric = async (songId) => {
      try {
        const r = await fetch('/lyric?id=' + encodeURIComponent(songId));
        if (r.ok) return await r.json();
      } catch {}
      return { lrc: '', tlyric: '', yrc: '' };
    };
    window.Netease.searchSong = async (title, artist, duration) => {
      try {
        const q = new URLSearchParams({ title: title || '', artist: artist || '', duration: duration || '' });
        const r = await fetch('/search?' + q.toString());
        if (r.ok) return await r.json();
      } catch {}
      return null;
    };
  }
})();
