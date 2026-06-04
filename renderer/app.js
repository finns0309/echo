// Surface any uncaught errors so they land in the terminal (main.js forwards
// renderer console messages). Without this, a throw in applyTheme / init
// would silently halt the whole app and you'd just see a frozen window.
window.addEventListener('error', (e) => {
  console.error('[fl:uncaught]', e.message, '@', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[fl:unhandled-promise]', e.reason);
});

const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const prevEl = document.getElementById('prev');
const currEl = document.getElementById('curr');
const nextEl = document.getElementById('next');
const stageEl = document.getElementById('stage');

let state = {
  trackKey: '',
  songId: 0,            // NetEase id of the current track (0 if unknown). Used
                        // as the cache key for the semantic-motion analysis.
  lines: [],
  lastIdx: -2,
  elapsed: 0,
  rate: 1,
  lastSyncAt: 0,
  isLoading: false,     // guard against concurrent lyric fetches
  nullStreak: 0,        // consecutive null responses from muse (idle / down)
  // Last stateVersion we observed from muse. A change means muse flagged a
  // discontinuity (seek / play-pause flip / track change) — we hard-reset
  // the local clock instead of smoothing, so the lyric snaps into place.
  stateVersion: -1,
};

// NetEase's macOS client only emits a Now Playing event on track change —
// it never updates elapsedTime afterwards (it's stuck at 0 for the entire
// song). So the only signal we trust from per-poll samples is the track
// identity. The local wall-clock takes over as soon as the track is loaded.

function fmtTrackKey(np) {
  return `${np.title}|${np.artist}`;
}

// Load lyrics for a new track. Returns the loaded lines (or []).
// Does NOT touch the DOM — caller commits the result.
async function fetchLyricsFor(np) {
  try {
    // Fast path: muse already knows the exact NetEase songId — skip search
    // (which is fuzzy and easily picks the wrong cover/instrumental version).
    let id = np.songId;
    let cover = np.cover;
    if (!id) {
      // Pass duration when available so search can break ties between
      // cover/instrumental versions that share title+artist but differ in length.
      const found = await Netease.searchSong(np.title, np.artist, np.duration);
      if (!found) return { lines: [], cover: null };
      id = found.id;
      cover = cover || found.cover;
    }
    const { lrc, tlyric, yrc, pureMusic } = await fetchLyricSafe(id);
    // buildKaraoke gives us a unified model: every line has a chars[] with
    // {time, duration, text}, real (yrc) or synthesized (from LRC). Karaoke
    // reveal animations consume this; older reveals just see line.text and
    // ignore the rest.
    const lines = LRC.buildKaraoke(lrc, tlyric, yrc);
    // Track classification, used by effectiveTheme() for auto-switching.
    //  - instrumental: NetEase explicitly flagged pureMusic. Authoritative.
    //  - unmatched:    no lyrics returned at all (search hit may be wrong).
    //  - lyrical:      everything else (real song with lyrics, even short ones).
    let kind = 'lyrical';
    if (pureMusic) kind = 'instrumental';
    else if (!lines.length) kind = 'unmatched';
    return { lines, cover, kind };
  } catch (e) {
    console.error(e);
    return { lines: [], cover: null, kind: 'unmatched' };
  }
}

async function fetchLyricSafe(id) {
  try { return await Netease.fetchLyric(id); }
  catch { return { lrc: '', tlyric: '', yrc: '', pureMusic: false }; }
}

let pendingSwap = null;
const OUT_DURATION_MS = 280; // how long to dwell in "changing" state before swapping text

// Layout routing: the registry says whether a theme renders into the stage
// (floating cards) or the triplet/single DOM. We check the data-layout
// attribute on body (written by applyTheme) instead of matching on name.
function usesStage() { return document.body.dataset.layout === 'stage'; }

// Stage-layout themes render into #stage: each line becomes an absolutely-
// positioned card stacked in the center. Old cards keep floating upward with
// growing blur so multiple ghosts overlap at once (like NetEase Aura).
const STAGE_LEAVE_MS = 2200;

// Stage-layout render: each line becomes one .stage-card of per-codepoint
// .w > .wi spans. --i drives the reveal stagger (wave/typewriter/ink); the
// float vars drive the idle w-float micro-drift. Old cards keep floating up
// with growing blur until the JS removal window fires.
function renderStage(input) {
  const live = stageEl.querySelectorAll('.stage-card:not(.leaving)');
  live.forEach((c) => {
    c.classList.add('leaving');
    setTimeout(() => c.remove(), STAGE_LEAVE_MS + 200);
  });
  while (stageEl.children.length > 4) stageEl.firstElementChild.remove();

  const text = (input && typeof input === 'object') ? (input.text || '♪') : (input || '♪');

  const card = document.createElement('div');
  card.className = 'stage-card';

  [...text].forEach((ch, i) => {
    const w = document.createElement('span');
    w.className = 'w';
    w.style.setProperty('--fd',     (3.8 + Math.random() * 3.5).toFixed(2) + 's');
    w.style.setProperty('--fdelay', (-Math.random() * 6).toFixed(2) + 's');
    w.style.setProperty('--fy',     (1.4 + Math.random() * 2).toFixed(2) + 'px');
    const wi = document.createElement('span');
    wi.className = 'wi';
    wi.style.setProperty('--i', i);
    // U+00A0 so a lone space survives HTML whitespace-collapse between the
    // inline-block tokens (otherwise adjacent words would run together).
    wi.textContent = ch === ' ' ? ' ' : ch;
    w.appendChild(wi);
    card.appendChild(w);
  });
  stageEl.appendChild(card);
}

function renderAt(t) {
  if (!state.lines.length) return;
  const i = LRC.findIndex(state.lines, t);
  if (i === state.lastIdx) return;
  state.lastIdx = i;
  window.FL_FX?.pulse();

  const cur = i >= 0 ? state.lines[i] : null;
  const prv = i - 1 >= 0 ? state.lines[i - 1] : null;
  const nxt = i + 1 < state.lines.length ? state.lines[i + 1] : null;

  if (document.body.dataset.layout === 'danmaku') {
    if (cur) FL_DANMAKU.spawn(cur);
    return;
  }

  if (document.body.dataset.layout === 'conversation') {
    if (cur) FL_CONVO.spawn(cur);
    return;
  }

  if (usesStage()) {
    // Pass the whole line so renderStage can stamp karaoke timings on tokens.
    // Falls back gracefully when chars[] is absent (it always is for the
    // synthetic placeholder lines below).
    renderStage(cur || '♪');
    return;
  }

  prevEl.textContent = prv?.text || '';
  nextEl.textContent = nxt?.text || '';

  // Two-phase animation: apply `.changing` (fade+blur out) for OUT_DURATION_MS,
  // then swap text and remove the class so the new line transitions back in.
  if (pendingSwap) clearTimeout(pendingSwap);
  currEl.classList.add('changing');
  pendingSwap = setTimeout(() => {
    currEl.textContent = cur?.text || '♪';
    pendingSwap = null;
    requestAnimationFrame(() => currEl.classList.remove('changing'));
  }, OUT_DURATION_MS);
}

// Cache accent results per cover URL. Sampling is cheap (24×24 canvas) but
// we hit the same cover repeatedly: every poll that matches the current track
// re-commits the same URL on re-render paths, and users cycle through the
// same album often. Caching also lets us short-circuit `applyAccentFromCover`
// when the URL hasn't changed, avoiding an Image decode on every commit.
const accentCache = new Map(); // url → { vivid: [r,g,b], avg: [r,g,b] } | null
let lastAccentUrl = '';

// Sample the cover art for a vivid accent color + average ambient color. The
// vivid one populates --accent/--accent-glow; the average tints the vignette.
function extractAccent(url) {
  return new Promise((resolve) => {
    const img = new Image();
    // Required for canvas.getImageData on cross-origin images (NetEase CDN
    // supports CORS). Without this, the canvas is tainted and getImageData
    // throws a SecurityError.
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 24; c.height = 24;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let bs = -1, br = 255, bg = 255, bb = 255;
        let ar = 0, ag = 0, ab = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i+1], b = d[i+2];
          ar += r; ag += g; ab += b; n++;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          const lum = (r + g + b) / 3;
          // prefer saturated, mid-bright colors
          const score = sat * 2 + (1 - Math.abs(lum - 150) / 200);
          if (score > bs) { bs = score; br = r; bg = g; bb = b; }
        }
        resolve({ vivid: [br, bg, bb], avg: [ar/n|0, ag/n|0, ab/n|0] });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function applyAccentFromCover(url) {
  if (!url) return;
  if (url === lastAccentUrl) return; // same cover → tokens/fx already set
  lastAccentUrl = url;
  let color = accentCache.get(url);
  if (color === undefined) {
    color = await extractAccent(url);
    accentCache.set(url, color);
  }
  if (!color) return;
  const [r, g, b] = color.vivid;
  const [ar, ag, ab] = color.avg;
  document.body.style.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
  document.body.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.55)`);
  document.body.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.35)`);
  document.body.style.setProperty('--ambient', `rgb(${ar}, ${ag}, ${ab})`);
  window.FL_FX?.setColors([r, g, b], [ar, ag, ab]);
}

// Commit a fully-loaded track to the UI all at once.
function commitTrack(np, lines, cover, elapsed, rate) {
  titleEl.textContent = np.title;
  artistEl.textContent = np.artist ? ' · ' + np.artist : '';
  if (cover) {
    // Cover flows through a CSS var so themes can override --fl-bg-image
    // without fighting an inline style.
    document.body.style.setProperty('--fl-cover-url', `url("${cover}")`);
    applyAccentFromCover(cover);
  }

  state.lines = lines;
  // Song identity for the semantic-motion cache. Prefer muse's NetEase songId;
  // fall back to the title|artist track key when it's absent (nowplaying-cli
  // source) so the cache still keys per-song.
  state.songId = np.songId || state.trackKey || 0;
  state.lastIdx = -2;
  state.elapsed = elapsed;
  state.lastSyncAt = performance.now();
  state.rate = 1;

  if (!lines.length) {
    if (usesStage()) {
      stageEl.innerHTML = '';
      renderStage(np.title);
    } else {
      prevEl.textContent = '';
      currEl.textContent = np.title;
      nextEl.textContent = '';
    }
  }
}

async function pollNowPlaying() {
  if (state.isLoading) return; // don't pile up while fetching lyrics

  const np = await window.api.nowPlaying();

  if (!np) {
    state.nullStreak++;
    // NetEase regularly stops reporting to macOS Now Playing for a few seconds
    // at a time, even while it's actively playing. Tolerate this: keep the
    // local clock running and don't touch the UI until the silence gets long.
    //  - <15 polls (~12s): ignore entirely, lyrics keep scrolling from local clock
    //  - >=15 polls (~12s): assume it really stopped, show the reconnect hint
    if (state.nullStreak >= 15) {
      const msg = '网易云暂停一下再继续，即可重新连上';
      titleEl.textContent = '未在播放';
      artistEl.textContent = '';
      prevEl.textContent = '';
      currEl.textContent = msg;
      nextEl.textContent = '';
      // Stage layouts don't touch prev/curr/next — without this, the last
      // lyric card keeps floating in place as if the song were still playing.
      if (usesStage()) {
        stageEl.innerHTML = '';
        renderStage(msg);
      }
      state.trackKey = '';
      state.lines = [];
      state.rate = 0;
      state.lastIdx = -2;
      document.body.style.setProperty('--fl-cover-url', 'none');
      lastAccentUrl = ''; // so the next real track re-applies accent tokens
    }
    return;
  }

  state.nullStreak = 0;

  const key = fmtTrackKey(np);

  if (key === state.trackKey) {
    // muse owns the <audio> element and reports a frame-accurate currentTime —
    // adopt it as the local clock every poll (free pause/seek handling). Anchor
    // to the moment muse sampled it (positionSampledAt), not "now", so the
    // 0–1s poll lag doesn't surface as lyric drift on seek/pause.
    const sampledAt = np.positionSampledAt || Date.now();
    const ageMs = Math.max(0, Date.now() - sampledAt);
    state.elapsed = np.elapsed;
    state.lastSyncAt = performance.now() - ageMs;
    state.rate = np.rate;
    // Discontinuity: hard-snap to the new position instead of drifting toward it.
    if (np.stateVersion !== state.stateVersion) {
      state.stateVersion = np.stateVersion;
      state.lastIdx = -2;
    }
    titleEl.textContent = np.title;
    artistEl.textContent = np.artist ? ' · ' + np.artist : '';
    return;
  }

  // New track — start a local clock immediately so we know how much time passes
  // while lyrics are loading. When done, we seek to that offset automatically.
  state.isLoading = true;
  state.trackKey = key;
  const loadStartElapsed = np.elapsed;
  const loadStartRate    = np.rate > 0 ? np.rate : 1;
  const loadStartAt      = performance.now();

  const { lines, cover } = await fetchLyricsFor(np);

  if (state.trackKey !== key) {
    state.isLoading = false;
    return;
  }

  // Estimate where the song is now: initial elapsed + time spent loading × rate.
  const loadedElapsed = loadStartElapsed + (performance.now() - loadStartAt) / 1000 * loadStartRate;

  commitTrack(np, lines, cover, loadedElapsed, np.rate);
  // Adopt muse's stateVersion at track-commit time so the next same-track
  // poll doesn't spuriously trip the "discontinuity" branch.
  if (typeof np.stateVersion === 'number') state.stateVersion = np.stateVersion;
  state.isLoading = false;
}

function tick() {
  const dt = (performance.now() - state.lastSyncAt) / 1000;
  const t = state.elapsed + dt * state.rate;
  renderAt(t);
  FL_CONVO.applyGap(t);
  FL_AUDIO.frame();
  requestAnimationFrame(tick);
}

// Theme manager. A theme = layout + reveal + frame + tokens. See themes.js
// for the registry (shared with main.js) and style.css for how tokens map
// to CSS custom properties.
const THEMES = window.FL_THEMES;
const toastEl = document.getElementById('toast');
let toastTimer = null;

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1300);
}

// Track which tokens the previous theme wrote, so we can clear them before
// applying the new one. Otherwise a value left over from theme A would leak
// into theme B if B didn't override that specific token.
let appliedTokenKeys = [];

// Phase 2: per-theme window override memory. When the user resizes / moves
// the window or toggles click-through manually, main pings us and we
// persist `theme.bounds.<name>` / `theme.clickthrough.<name>`. On theme
// apply, we pass the stored override into applyWindowProfile so it wins
// over the profile default. Tray "重置该主题的窗口" wipes both keys.
function loadWindowOverride(name) {
  try {
    const bounds = JSON.parse(localStorage.getItem(`theme.bounds.${name}`) || 'null');
    const ctRaw = localStorage.getItem(`theme.clickthrough.${name}`);
    return {
      bounds: bounds && Number.isFinite(bounds.width) ? bounds : undefined,
      clickThrough: ctRaw === null ? undefined : ctRaw === 'true',
    };
  } catch { return {}; }
}
function saveBoundsOverride(name, bounds) {
  if (!name || !bounds) return;
  localStorage.setItem(`theme.bounds.${name}`, JSON.stringify(bounds));
}
function saveClickThroughOverride(name, ct) {
  if (!name) return;
  localStorage.setItem(`theme.clickthrough.${name}`, String(!!ct));
}
function clearWindowOverride(name) {
  if (!name) return;
  localStorage.removeItem(`theme.bounds.${name}`);
  localStorage.removeItem(`theme.clickthrough.${name}`);
}

function applyTheme(name) {
  const theme = THEMES.find((t) => t.name === name);
  if (!theme) return;

  const body = document.body;

  // 1) Clear previous tokens.
  for (const k of appliedTokenKeys) body.style.removeProperty(k);
  appliedTokenKeys = [];

  // 2) Dispatch class + data-attrs. Only themes that flagged customClass get
  //    a `theme-<name>` class (used by bespoke CSS blocks in style.css).
  //    We keep --fl-cover-url (set by the cover sampler) on body.style; it's
  //    not in appliedTokenKeys so it survives theme swaps.
  body.className = theme.customClass ? `theme-${name}` : '';
  body.dataset.layout = theme.layout || 'stage';
  body.dataset.reveal = theme.reveal || 'none';
  body.dataset.frame  = theme.frame  || 'full';

  // 3) Apply tokens.
  if (theme.tokens) {
    for (const [k, v] of Object.entries(theme.tokens)) {
      body.style.setProperty(k, v);
      appliedTokenKeys.push(k);
    }
  }

  // 4) Optional GPU fx layer. Themes without `fx` get a clean stop.
  if (theme.fx) window.FL_FX?.start(theme.fx);
  else          window.FL_FX?.stop();

  // 4b) Theme-specific DOM prep.
  if (theme.layout === 'conversation') { FL_CONVO.build(); FL_CONVO.refreshHeader(); }

  // Persistence is split: the *default* theme (manual pick) is saved by
  // setAndReportTheme(); auto-switch-driven applies do NOT overwrite it.
  // Without this, listening to one instrumental song would silently change
  // the user's "I want piano normally" preference.

  // 5) Per-theme window profile (size + position + click-through default).
  //    Profile names are the contract; resolution to actual bounds lives in
  //    main.js (it owns `screen`). Per-theme user overrides (bounds /
  //    click-through) are read from localStorage and passed through — when
  //    present they win over the profile default.
  if (theme.window && window.api.applyWindowProfile) {
    const override = loadWindowOverride(name);
    window.api.applyWindowProfile(theme.window, override).then((isCT) => {
      clickThrough = !!isCT;
      syncPinButton();
    });
  }

  // 6) Force a re-render so the new layout repopulates its DOM (stage vs.
  //    triplet) from current lyric state without waiting for the next tick.
  stageEl.innerHTML = '';
  // Drop any in-flight danmaku — leftover lines mid-fly under a different
  // layout look broken when the user switches back later.
  const dmEl = document.getElementById('danmaku');
  if (dmEl) dmEl.innerHTML = '';
  // Wipe convo stream too on theme switch — leftover bubbles from a previous
  // session look like phantom messages when the user comes back.
  const cvStream = document.querySelector('#convo .cv-stream');
  if (cvStream) cvStream.innerHTML = '';
  state.lastIdx = -2;
  if (usesStage() && !state.lines.length) {
    renderStage(currEl.textContent || '等待播放…');
  }
}

function defaultThemeName() {
  const name = localStorage.getItem('theme') || 'typewriter';
  return THEMES.some((t) => t.name === name) ? name : 'typewriter';
}

// The active theme is just the user's persisted pick (or the default). The
// per-track scene-rule layer (auto-switching by trackKind) was removed along
// with the themes that used it.
function effectiveThemeName() {
  return defaultThemeName();
}
function applyEffectiveTheme() {
  const name = effectiveThemeName();
  if (document.body.dataset.theme === name) return; // already applied
  document.body.dataset.theme = name;
  applyTheme(name);
  // Tray needs to know which theme is "currently active" to render its radio
  // mark, even when the user didn't pick it.
  window.api.reportTheme(name);
}

// Theme is driven by the macOS tray menu. The renderer persists the user's
// pick and applies it. Toast fires on the manual click path.
function setAndReportTheme(name) {
  if (!THEMES.some((t) => t.name === name)) return;
  localStorage.setItem('theme', name);
  document.body.dataset.theme = '';
  applyEffectiveTheme();
  const t = THEMES.find((x) => x.name === name);
  if (t) showToast(`主题 · ${t.label}`);
}

window.api.onApplyTheme((name) => setAndReportTheme(name));

// Phase 2 override-memory wiring. Main fires these when the user does
// something that should "stick" for the active theme. The pin-button click
// path also routes through `theme-clickthrough-changed` (main sends it from
// the toggle handler) — no double-write needed in the click handler itself.
window.api.onBoundsChange?.((p) => {
  if (p && p.name && p.bounds) saveBoundsOverride(p.name, p.bounds);
});
window.api.onClickThroughChange?.((p) => {
  if (!p || !p.name || typeof p.clickThrough !== 'boolean') return;
  saveClickThroughOverride(p.name, p.clickThrough);
  clickThrough = p.clickThrough;
  syncPinButton();
});
window.api.onResetWindow?.((p) => {
  if (!p || !p.name) return;
  clearWindowOverride(p.name);
  const t = THEMES.find((x) => x.name === p.name);
  if (t && t.window && window.api.applyWindowProfile) {
    window.api.applyWindowProfile(t.window, {}).then((isCT) => {
      clickThrough = !!isCT;
      syncPinButton();
    });
  }
  showToast?.('已重置窗口');
});

// Apply the persisted theme on startup. Wrap so a bad theme entry can't halt
// the rest of init (poll loop, event listeners).
try {
  applyEffectiveTheme();
} catch (e) {
  console.error('[fl:init] applyEffectiveTheme failed', e);
}

let clickThrough = false;

// Shared so both manual toggles and theme-profile-driven flips keep the
// `◌/●` glyph in sync. Function declaration so applyTheme (defined earlier
// in the file) can call this through hoisting.
function syncPinButton() {
  const pin = document.getElementById('pin');
  if (pin) pin.textContent = clickThrough ? '●' : '◌';
}

document.getElementById('pin').addEventListener('click', async () => {
  clickThrough = await window.api.toggleClickThrough();
  syncPinButton();
});
document.getElementById('maximize').addEventListener('click', async () => {
  const maxed = await window.api.toggleMaximizeBounds();
  const btn = document.getElementById('maximize');
  if (btn) btn.textContent = maxed ? '⤡' : '⤢';
});
document.getElementById('close').addEventListener('click', () => window.api.quit());

// Manual sync nudges. Shift the local lyric clock by ±0.2s.
// Positive = lyrics jump ahead (useful when lyrics lag behind the song).
function nudge(delta) {
  state.elapsed += delta;
  // Force re-render of current line even if the index technically didn't change
  state.lastIdx = -2;
}
document.getElementById('fwd').addEventListener('click', () => nudge(+0.2));
document.getElementById('back').addEventListener('click', () => nudge(-0.2));

// In click-through mode the window still receives mousemove (forward:true).
// Temporarily disable ignore when hovering the controls so buttons stay clickable.
const topbar = document.getElementById('topbar');
topbar.addEventListener('mouseenter', () => {
  if (clickThrough) window.api.setIgnoreMouseEvents(false);
});
topbar.addEventListener('mouseleave', () => {
  if (clickThrough) window.api.setIgnoreMouseEvents(true);
});

// Window-size responsive scale. The base window is 520×220 (diag ≈ 565); as
// the user enlarges or fullscreens the window, lyric typography scales with
// sqrt-ish curve so proportions stay readable at every size. Chrome
// (topbar/buttons) is NOT multiplied by this — affordances keep a stable
// target size. Themes can override via `--fl-text-scale-bias` token.
// Dead-zone threshold: below this window diagonal, scale is locked to 1 so
// the widget matches its original hand-tuned proportions (the default 520×220
// window, plus a generous margin for casual resizes). Only when the user
// genuinely enlarges — half-screen and up — does the scale begin to grow.
const SCALE_DEADZONE_DIAG = 900;
function updateScale() {
  const diag = Math.hypot(window.innerWidth, window.innerHeight);
  // Below deadzone: 1.0 exactly. Above: gentle power curve capped at 3.2×
  // so fullscreen on a huge external display doesn't push single-line
  // layouts past the canvas.
  let scale = 1;
  if (diag > SCALE_DEADZONE_DIAG) {
    scale = Math.min(3.2, Math.pow(diag / SCALE_DEADZONE_DIAG, 0.7));
  }
  document.documentElement.style.setProperty('--fl-scale', scale.toFixed(3));
  // Blur scales with sqrt(scale): a 45px blur tuned for a 520×220 canvas
  // reads as ~visually the same amount of haze at fullscreen if we bump
  // the radius, but we don't want it to 3× (would wash colors to grey).
  document.documentElement.style.setProperty(
    '--fl-blur-scale', Math.sqrt(scale).toFixed(3)
  );
}
window.addEventListener('resize', updateScale);
updateScale();

pollNowPlaying();
setInterval(pollNowPlaying, 800);
requestAnimationFrame(tick);
