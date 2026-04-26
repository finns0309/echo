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
  lines: [],
  lastIdx: -2,
  elapsed: 0,
  rate: 1,
  lastSyncAt: 0,
  isLoading: false,     // guard against concurrent lyric fetches
  nullStreak: 0,        // consecutive null responses from nowplaying-cli
  trackKind: 'lyrical', // 'lyrical' | 'instrumental' | 'unmatched' — drives auto-switch
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

// ─── Piano theme · key strip ────────────────────────────────────────────────
// Modelled as a real piano, not a spectrum visualizer: at any given instant
// only a handful of keys should be "struck", and they decay over ~1.5s like
// a damped string. Spectrum is NOT mapped to keys directly — it's only used
// to detect onsets (when to strike) and bias pitch selection (where to
// strike). In between onsets, every key is fading toward black.
const PIANO_N_WHITE = 24;
const PIANO_BLACK_AFTER = new Set([0, 1, 3, 4, 5]); // white indices within each octave
// Per-frame multiplicative decay. 0.96 at 60fps → ~1.5s half-life, matches
// the feel of a piano note sustaining briefly then fading.
const PIANO_DECAY = 0.96;
// RMS flux (current − slow baseline) above which we declare an onset.
const PIANO_ONSET_FLUX = 0.07;
// Minimum time between onsets. Human pianists max out around 10 notes/sec;
// 85ms caps us at ~12/s so we don't machine-gun keys.
const PIANO_ONSET_MIN_GAP_MS = 85;

// Unified per-key store: one entry per rendered key element, in spatial order
// (left→right, mixing whites and blacks by actual position). Onsets strike
// entries at indices computed from centroid + jitter.
let pianoKeys = null; // { el, level, pos }[]
// Sort key: spatial position along the keyboard as a float 0..N_WHITE. Whites
// land at integer i; blacks sit at i+0.69 (see buildPianoKeys CSS).
function buildPianoKeys() {
  const el = document.getElementById('piano-keys');
  if (!el || el.dataset.built) return;
  el.dataset.built = '1';
  const keys = [];
  for (let i = 0; i < PIANO_N_WHITE; i++) {
    const k = document.createElement('div');
    k.className = 'pk w';
    k.style.setProperty('--i', i);
    k.style.setProperty('--lit', '0');
    el.appendChild(k);
    keys.push({ el: k, level: 0, pos: i });
  }
  for (let i = 0; i < PIANO_N_WHITE - 1; i++) {
    if (!PIANO_BLACK_AFTER.has(i % 7)) continue;
    const b = document.createElement('div');
    b.className = 'pk b';
    b.style.setProperty('--i', i);
    b.style.setProperty('--lit', '0');
    el.appendChild(b);
    keys.push({ el: b, level: 0, pos: i + 0.69 });
  }
  keys.sort((a, b) => a.pos - b.pos); // spatial order: strike picks by index
  pianoKeys = keys;
}

let pianoStrikeCount = 0;
let pianoLastFlux = 0; // last computed spectral flux, exposed via __piano for tuning
function strikeKey(idx, velocity) {
  if (!pianoKeys) return;
  const clamped = Math.max(0, Math.min(pianoKeys.length - 1, idx));
  const k = pianoKeys[clamped];
  if (k.level < velocity) {
    k.level = velocity;
    pianoStrikeCount++;
  }
}

function pulsePianoKeys() {
  if (!document.body.classList.contains('theme-piano')) return;
  if (!pianoKeys) return;
  // Line-change "phrase": 2–4 keys clustered around a random center, like a
  // small chord stab. Uses the same decay channel as onset-driven strikes.
  const n = pianoKeys.length;
  const center = Math.floor(n * (0.25 + Math.random() * 0.5));
  const size = 2 + Math.floor(Math.random() * 3);
  const used = new Set();
  for (let i = 0; i < size; i++) {
    const offset = Math.round((Math.random() - 0.5) * 12);
    const idx = center + offset;
    if (used.has(idx)) continue;
    used.add(idx);
    strikeKey(idx, 0.55 + Math.random() * 0.3);
  }
}

// ─── Onset detector ────────────────────────────────────────────────────────
// Two-channel model:
//   1. Spectral flux — sum of positive band deltas vs previous frame. This is
//      the classic note-onset detector; robust across genres because it
//      measures "new energy entering the spectrum" rather than raw loudness.
//   2. Ambient activity — when rms is clearly non-zero we randomly sprinkle
//      soft strikes at a rate proportional to rms. Gives the "someone is
//      playing continuously" feel even during sustained passages where
//      spectral flux is low (pads, drones, held notes).
let pianoPrevBands = null;
let pianoLastOnsetAt = 0;
let pianoLastStateVersion = -1;
let pianoLastProcessedFrameT = 0;
let pianoFrameCounter = 0;

function processSpectrumOnset() {
  const frame = spectrumFrame;
  if (!frame || !frame.bands) return;
  if (frame.t === pianoLastProcessedFrameT) return;
  pianoLastProcessedFrameT = frame.t;
  pianoFrameCounter++;

  const now = Date.now();
  if (now - (frame.t || 0) > 300) return; // stale, producer paused

  // Track change / seek — clear prev bands so we don't compute flux across
  // a discontinuity (would produce a spurious huge onset on every switch).
  if (typeof frame.stateVersion === 'number' &&
      frame.stateVersion !== pianoLastStateVersion) {
    pianoLastStateVersion = frame.stateVersion;
    pianoPrevBands = null;
    return;
  }

  const bands = frame.bands;
  const rms = frame.rms || 0;

  // 1) Spectral flux.
  let flux = 0;
  if (pianoPrevBands) {
    for (let i = 0; i < bands.length; i++) {
      const d = bands[i] - pianoPrevBands[i];
      if (d > 0) flux += d;
    }
    // Normalize: typical flux values scale with bandCount. 24 bands / ~0.05
    // per-band average delta → ~1.2 max. We divide so threshold stays genre-
    // agnostic (~0.25 = clear note attack).
    flux /= bands.length * 0.25;
  }
  pianoLastFlux = flux;
  // Copy bands for next frame (allocate once).
  if (!pianoPrevBands || pianoPrevBands.length !== bands.length) {
    pianoPrevBands = new Float32Array(bands.length);
  }
  for (let i = 0; i < bands.length; i++) pianoPrevBands[i] = bands[i];

  // Spectral centroid (for pitch placement / particle origin).
  let num = 0, den = 0;
  for (let i = 0; i < bands.length; i++) {
    num += bands[i] * i;
    den += bands[i];
  }
  const centroid = den > 0 ? (num / den) / (bands.length - 1) : 0.5;
  const jitter = () => Math.round(((Math.random() + Math.random() - 1) * 4));
  const n = pianoKeys ? pianoKeys.length : 0;

  // === Channel 1: hard onset (spectral flux) ===
  // Always dispatch the *event* (so non-piano consumers like solo get pinged);
  // piano-key strikes only fire when the key strip exists.
  const canOnset = now - pianoLastOnsetAt >= PIANO_ONSET_MIN_GAP_MS;
  if (canOnset && flux > PIANO_ONSET_FLUX) {
    pianoLastOnsetAt = now;
    const velocity = Math.min(1, 0.6 + flux * 1.2);
    pulseSoloOnset(velocity, centroid);
    window.FL_FX?.pulseRipple?.(velocity);
    flashLightning(velocity);
    if (n) {
      const primaryIdx = Math.floor(centroid * n) + jitter();
      strikeKey(primaryIdx, velocity);
      if (flux > 0.5 && Math.random() < 0.55) {
        const octave = 7 + Math.floor(Math.random() * 4);
        const sign = Math.random() < 0.5 ? -1 : 1;
        strikeKey(primaryIdx + sign * octave + jitter(), velocity * 0.75);
      }
      if (flux > 0.85 && Math.random() < 0.45) {
        strikeKey(Math.floor(n * (0.6 + Math.random() * 0.35)), velocity * 0.55);
      }
    }
    return; // Don't also trigger ambient this frame
  }

  // === Channel 2: ambient sprinkle (when there's any music at all) ===
  if (rms > 0.12 && canOnset) {
    const p = Math.min(0.12, rms * 0.14);
    if (Math.random() < p) {
      pianoLastOnsetAt = now;
      if (n) {
        const idx = Math.floor(centroid * n) + Math.round((Math.random() - 0.5) * 10);
        strikeKey(idx, 0.3 + Math.random() * 0.25 + rms * 0.2);
      }
    }
  }
}

// end of onset detector

// ─── Spectrum client (ws://127.0.0.1:10755/spectrum, muse-produced) ─────────
// Protocol lives in ./NOW_PLAYING.md §Spectrum channel. We cache the latest
// frame and read it each animation tick — driving DOM from onmessage would
// pin the write-rate to 30fps producer cadence and fight our own smoothing.
let spectrumFrame = null;
let spectrumWS = null;
let spectrumReconnectTimer = null;

// Diagnostic handle — open DevTools and type `__piano` to inspect live state.
// Installed here (early, before any code that might throw) so it's always
// available even if something downstream breaks.
window.__piano = {
  get ws()      { return spectrumWS?.readyState; }, // 0=connecting 1=open 2=closing 3=closed
  get frame()   { return spectrumFrame; },
  get frames()  { return pianoFrameCounter; },
  get strikes() { return pianoStrikeCount; },
  get flux()    { return pianoLastFlux; },
  get keys()    { return pianoKeys; },
};

function connectSpectrum() {
  spectrumReconnectTimer = null;
  try {
    spectrumWS = new WebSocket('ws://127.0.0.1:10755/spectrum');
  } catch { scheduleSpectrumReconnect(); return; }
  spectrumWS.addEventListener('open', () => {
    console.log('[spectrum] connected to muse');
  });
  spectrumWS.addEventListener('message', (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.type === 'hello') {
        console.log('[spectrum] hello', m);
        return;
      }
      if (Array.isArray(m.bands)) spectrumFrame = m;
    } catch {}
  });
  spectrumWS.addEventListener('close', scheduleSpectrumReconnect);
  spectrumWS.addEventListener('error', () => { try { spectrumWS?.close(); } catch {} });
}
function scheduleSpectrumReconnect() {
  if (spectrumReconnectTimer) return;
  spectrumWS = null;
  // 3s retry — trivial when muse is absent (the error is local), lets piano
  // come to life within a few seconds of launching muse after echo.
  spectrumReconnectTimer = setTimeout(connectSpectrum, 3000);
}
connectSpectrum();

function applyPianoFrame() {
  const isPiano  = document.body.classList.contains('theme-piano');
  const isSolo   = document.body.classList.contains('theme-instrumental');
  const isRipple = document.body.classList.contains('theme-ripple');
  const isStorm  = document.body.classList.contains('theme-storm');
  // Run the onset detector whenever any spectrum-driven theme is active.
  // Piano (key strikes), solo (particle bursts), ripple (water rings), and
  // storm (lightning) all consume the same detector — one run per frame.
  if (isPiano || isSolo || isRipple || isStorm) processSpectrumOnset();
  if (pianoKeys) {
    for (const k of pianoKeys) {
      k.level *= PIANO_DECAY;
      if (k.level < 0.004) k.level = 0;
      if (isPiano) k.el.style.setProperty('--lit', k.level.toFixed(3));
    }
  }
  if (isSolo) drawSolo();
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
// Accepts a string (legacy) or a line object {text, chars}. When chars[] is
// present each .wi gets data-t/data-d so the karaoke reveal can class-flip
// per real timing rather than relying on uniform stagger delays.
function renderStage(input) {
  const live = stageEl.querySelectorAll('.stage-card:not(.leaving)');
  live.forEach((c) => {
    c.classList.add('leaving');
    setTimeout(() => c.remove(), STAGE_LEAVE_MS + 200);
  });
  while (stageEl.children.length > 4) stageEl.firstElementChild.remove();

  const isLine = input && typeof input === 'object';
  const text   = isLine ? (input.text || '♪') : (input || '♪');
  const chars  = isLine && input.chars && input.chars.length ? input.chars : null;

  const card = document.createElement('div');
  card.className = 'stage-card';

  // Tokens come from karaoke chars[] when present (yrc tokens may span
  // multiple letters per syllable); otherwise we split on codepoints.
  const tokens = chars
    ? chars.map((c) => ({ text: c.text, time: c.time, duration: c.duration }))
    : [...text].map((c) => ({ text: c, time: null, duration: null }));

  tokens.forEach((tok, i) => {
    const w = document.createElement('span');
    w.className = 'w';
    w.style.setProperty('--fd',     (3.8 + Math.random() * 3.5).toFixed(2) + 's');
    w.style.setProperty('--fdelay', (-Math.random() * 6).toFixed(2) + 's');
    w.style.setProperty('--fy',     (1.4 + Math.random() * 2).toFixed(2) + 'px');
    const wi = document.createElement('span');
    wi.className = 'wi';
    wi.style.setProperty('--i', i);
    // Random per-token "personality" — used by the karaoke reveal to throw
    // each token out at a unique angle/offset so the popping looks organic.
    wi.style.setProperty('--rot', ((Math.random() - 0.5) * 36).toFixed(1) + 'deg');
    wi.style.setProperty('--dx',  ((Math.random() - 0.5) * 0.6).toFixed(2) + 'em');
    if (tok.time !== null) {
      wi.dataset.t = tok.time.toFixed(3);
      wi.dataset.d = (tok.duration ?? 0.2).toFixed(3);
    }
    // Replace every space with U+00A0 (non-breaking) so they survive HTML
    // whitespace collapsing between adjacent inline-block tokens. yrc tokens
    // for English songs typically embed trailing spaces ("Every ", "day ");
    // without this swap those spaces vanish and words run together.
    wi.textContent = tok.text.replace(/ /g, ' ');
    w.appendChild(wi);
    card.appendChild(w);
  });
  stageEl.appendChild(card);
}

// ─── Danmaku · barrage layout ──────────────────────────────────────────────
// Each lyric line spawns one flying card that animates right→left and self-
// removes on animationend. Multiple cards coexist (long lines + short
// follow-ups overlap, exactly like real danmaku). Y positions are picked
// from a small set of "lanes" with a recency check so consecutive lines
// don't clobber each other.
const DM_LANES = 8;            // vertical bands the screen is divided into
const DM_LANE_TOP = 0.10;      // start lanes 10% from top
const DM_LANE_BOTTOM = 0.84;   // last lane ends 84% from top (leave bottom)
const dmRecentLanes = [];      // last few lanes used, to dodge clustering
function pickDanmakuLane() {
  // Avoid the most recent 3 lanes if possible — gives short bursts of
  // back-to-back lyric lines real vertical separation.
  for (let attempt = 0; attempt < 8; attempt++) {
    const lane = Math.floor(Math.random() * DM_LANES);
    if (!dmRecentLanes.includes(lane)) {
      dmRecentLanes.push(lane);
      while (dmRecentLanes.length > 3) dmRecentLanes.shift();
      return lane;
    }
  }
  return Math.floor(Math.random() * DM_LANES);
}
function spawnDanmaku(line) {
  const dm = document.getElementById('danmaku');
  if (!dm) return;
  const text = (line && line.text) || '';
  if (!text) return;

  const el = document.createElement('div');
  el.className = 'dm-line';
  el.textContent = text;

  const lane = pickDanmakuLane();
  const yFrac = DM_LANE_TOP + (lane / (DM_LANES - 1)) * (DM_LANE_BOTTOM - DM_LANE_TOP);
  el.style.setProperty('--y', (yFrac * 100).toFixed(2) + '%');

  // Duration scales with text length so long lines aren't rocketing past
  // before they're readable. 9–22s range covers most lyric lengths.
  const len = [...text].length;
  const dur = Math.max(9, Math.min(22, 9 + len * 0.22));
  el.style.setProperty('--dur', dur.toFixed(2) + 's');

  el.addEventListener('animationend', () => el.remove());
  dm.appendChild(el);
}

// ─── Sakura · falling petals ───────────────────────────────────────────────
// One DOM element per petal, animated by a CSS keyframe. We build a pool once
// (idempotent — re-applying the theme doesn't double up) and let CSS drive
// the rest. Petals sway via combined translate + rotate animations.
const SAKURA_COUNT = 32;
function buildSakuraPool() {
  const root = document.getElementById('sakura');
  if (!root || root.dataset.built) return;
  root.dataset.built = '1';
  for (let i = 0; i < SAKURA_COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'petal';
    // Random per-petal style: x position, fall duration, sway period, size,
    // delay so the field looks "in motion" from frame 1 instead of all
    // launching together.
    p.style.setProperty('--x',     (Math.random() * 100).toFixed(2) + '%');
    p.style.setProperty('--dur',   (10 + Math.random() * 10).toFixed(2) + 's');
    p.style.setProperty('--sway',  (3 + Math.random() * 3).toFixed(2) + 's');
    p.style.setProperty('--delay', (-Math.random() * 12).toFixed(2) + 's');
    p.style.setProperty('--size',  (8 + Math.random() * 8).toFixed(1) + 'px');
    p.style.setProperty('--rot',   ((Math.random() - 0.5) * 360).toFixed(0) + 'deg');
    root.appendChild(p);
  }
}

// ─── Storm · lightning flash on onset ──────────────────────────────────────
// CSS handles heavy rain hatching via the tint layer. Lightning is a separate
// concern: a brief whole-screen flash, fired only on hard onsets so it's
// dramatic rather than constant. We throttle to avoid epilepsy-territory rates.
let lastLightningAt = 0;
function flashLightning(velocity) {
  if (!document.body.classList.contains('theme-storm')) return;
  // Onset velocities cluster in 0.68–0.85 (see processSpectrumOnset). Threshold
  // at 0.78 catches noticeable hits without firing on every kick drum, and
  // pairs with the 2.2s cooldown so lightning still feels rare/dramatic.
  if (velocity < 0.78) return;
  const now = Date.now();
  if (now - lastLightningAt < 2200) return;
  lastLightningAt = now;
  const el = document.getElementById('lightning');
  if (!el) return;
  el.classList.remove('flash');
  // Force reflow so re-adding the class restarts the animation.
  void el.offsetWidth;
  el.classList.add('flash');
}

// ─── Solo · instrumental visualizer (canvas spectrum + particle cloud) ────
// Full-window canvas. Drawn each frame from spectrumFrame.bands and an internal
// particle pool. No cover — the song is the picture. Particles spawn on every
// detected onset (reuses the piano onset detector's flux signal).
let soloCtx = null;
let soloCanvas = null;
let soloAccent = [255, 230, 210];
let soloLastPainted = false;
const soloParticles = [];
const SOLO_MAX_PARTICLES = 90;
const SOLO_BARS = 56; // doubles as horizontal sample count

function ensureSoloCanvas() {
  if (soloCtx) return soloCtx;
  soloCanvas = document.getElementById('solo-fx');
  if (!soloCanvas) return null;
  soloCtx = soloCanvas.getContext('2d');
  resizeSoloCanvas();
  window.addEventListener('resize', resizeSoloCanvas);
  return soloCtx;
}
function resizeSoloCanvas() {
  if (!soloCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = soloCanvas.clientWidth || window.innerWidth;
  const h = soloCanvas.clientHeight || window.innerHeight;
  soloCanvas.width  = Math.max(2, Math.floor(w * dpr));
  soloCanvas.height = Math.max(2, Math.floor(h * dpr));
  if (soloCtx) soloCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Sample a few well-spread bands across the spectrum so each visual bar maps
// to a distinct frequency slice (linear here is fine — bands themselves are
// already log-spaced upstream).
function sampleSoloBars(bands) {
  const n = SOLO_BARS;
  const out = new Float32Array(n);
  if (!bands || !bands.length) return out;
  const step = bands.length / n;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(bands.length - 1, Math.floor((i + 1) * step));
    let m = 0;
    for (let j = a; j <= b; j++) if (bands[j] > m) m = bands[j];
    out[i] = m;
  }
  return out;
}

function spawnSoloBurst(velocity, centroid) {
  if (!soloCanvas) return;
  const w = soloCanvas.clientWidth || window.innerWidth;
  const h = soloCanvas.clientHeight || window.innerHeight;
  // Burst origin biased toward the centroid horizontally + center vertically.
  const ox = w * (0.2 + 0.6 * centroid);
  const oy = h * (0.45 + (Math.random() - 0.5) * 0.1);
  const count = Math.min(20, Math.round(6 + velocity * 16));
  for (let i = 0; i < count; i++) {
    if (soloParticles.length >= SOLO_MAX_PARTICLES) soloParticles.shift();
    const ang = Math.random() * Math.PI * 2;
    const speed = 0.6 + Math.random() * 2.4 + velocity * 1.5;
    soloParticles.push({
      x: ox, y: oy,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 0.4, // slight upward bias — feels like rising sparks
      life: 1,
      decay: 0.012 + Math.random() * 0.012,
      size: 1.4 + Math.random() * 2.2 + velocity * 1.6,
    });
  }
}

function drawSolo() {
  if (!soloCtx) return;
  const w = soloCanvas.clientWidth || window.innerWidth;
  const h = soloCanvas.clientHeight || window.innerHeight;
  const ctx = soloCtx;

  // Soft motion-blur — fade prior frame instead of clearing fully so bars +
  // particles leave a faint trail.
  ctx.fillStyle = 'rgba(8, 6, 14, 0.22)';
  ctx.fillRect(0, 0, w, h);

  const [ar, ag, ab] = soloAccent;
  const frame = spectrumFrame;
  const fresh = frame && frame.bands && (Date.now() - (frame.t || 0) < 350);
  const bars = sampleSoloBars(fresh ? frame.bands : null);
  const rms  = fresh ? (frame.rms || 0) : 0;

  // Spectrum bars — vertical mirror around midline (top↓ + bottom↑). Bars are
  // spaced edge-to-edge. The midline gap is constant so the title strip in
  // the middle never gets covered.
  const barW = w / SOLO_BARS;
  const midGap = Math.max(60, h * 0.18);
  const maxBarH = (h - midGap) / 2;
  ctx.lineWidth = Math.max(2, barW * 0.55);
  ctx.lineCap = 'round';
  for (let i = 0; i < SOLO_BARS; i++) {
    const v = Math.min(1, bars[i] || 0);
    if (v < 0.02) continue;
    const bh = v * maxBarH;
    const x = (i + 0.5) * barW;
    // Color: accent saturation grows with bar height; alpha follows v.
    const alpha = 0.18 + v * 0.62;
    ctx.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, ${alpha})`;
    // bottom-up bar
    ctx.beginPath();
    ctx.moveTo(x, h / 2 + midGap / 2);
    ctx.lineTo(x, h / 2 + midGap / 2 + bh);
    ctx.stroke();
    // mirrored top-down bar (slightly fainter — gives an above-water feel)
    ctx.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, ${alpha * 0.55})`;
    ctx.beginPath();
    ctx.moveTo(x, h / 2 - midGap / 2);
    ctx.lineTo(x, h / 2 - midGap / 2 - bh * 0.85);
    ctx.stroke();
  }

  // Center glow that breathes with rms — pins the visual without a cover.
  if (rms > 0.02) {
    const radius = Math.max(40, h * 0.08) + rms * 90;
    const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, radius);
    grad.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, ${0.12 + rms * 0.18})`);
    grad.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(w/2 - radius, h/2 - radius, radius * 2, radius * 2);
  }

  // Particles — additive blend so overlaps brighten naturally.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = soloParticles.length - 1; i >= 0; i--) {
    const p = soloParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.015; // gentle gravity-ish, but upward bias keeps them rising
    p.life -= p.decay;
    if (p.life <= 0 || p.y < -10 || p.y > h + 10 || p.x < -10 || p.x > w + 10) {
      soloParticles.splice(i, 1);
      continue;
    }
    ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${p.life * 0.85})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  soloLastPainted = true;
}

// Drive solo's particle bursts off the same onset stream as piano keys, so the
// detector runs once and feeds whichever theme is active. Called from
// processSpectrumOnset() when an onset is committed.
function pulseSoloOnset(velocity, centroid) {
  if (!document.body.classList.contains('theme-instrumental')) return;
  spawnSoloBurst(velocity, centroid);
}

function refreshSoloMeta() {
  const t = document.querySelector('.solo-title');
  const a = document.querySelector('.solo-artist');
  if (t) t.textContent = titleEl.textContent || '—';
  if (a) a.textContent = (artistEl.textContent || '').replace(/^\s·\s/, '');
}

function updateSoloAccent() {
  // Pull current --accent from body inline style (set by applyAccentFromCover).
  const cs = getComputedStyle(document.body);
  const m = (cs.getPropertyValue('--accent') || '').match(/\d+/g);
  if (m && m.length >= 3) soloAccent = [+m[0], +m[1], +m[2]];
}

// ─── Conversation · iMessage / duet bubble stream ─────────────────────────
// Lyrics presented as chat messages. New line = new bubble appended at the
// bottom; older bubbles stay visible (capped at CV_MAX) and demote to .past.
// Duet alternates left/right + accent/comp coloring by line index parity.
// Typing dots show during the LRC gap between the current line ending and
// the next line starting (driven by applyConvGap, called every tick).
const CV_MAX = 5;
function buildConvScaffold() {
  const cv = document.getElementById('convo');
  if (!cv || cv.dataset.built) return;
  cv.dataset.built = '1';
  cv.innerHTML = `
    <div class="cv-header">
      <span class="cv-avatar"></span>
      <div class="cv-meta">
        <div class="cv-name"></div>
        <div class="cv-status"><i class="cv-dot"></i><span></span></div>
      </div>
    </div>
    <div class="cv-stream"></div>
    <div class="cv-typing"><i></i><i></i><i></i></div>
  `;
}
function refreshConvHeader() {
  const cv = document.getElementById('convo');
  if (!cv || !cv.dataset.built) return;
  const np = { title: titleEl.textContent || '', artist: (artistEl.textContent || '').replace(/^\s·\s/, '') };
  cv.querySelector('.cv-name').textContent = np.artist || np.title || '—';
  cv.querySelector('.cv-status span').textContent = np.artist ? np.title : '正在播放';
}
function spawnConvBubble(line) {
  const cv = document.getElementById('convo');
  if (!cv) return;
  const stream = cv.querySelector('.cv-stream');
  if (!stream) return;
  const text = (line && line.text) || '';
  if (!text) return;

  // Demote previous current bubble.
  const prevNow = stream.querySelector('.cv-bubble.now');
  if (prevNow) { prevNow.classList.remove('now'); prevNow.classList.add('past'); }

  const idx = state.lastIdx >= 0 ? state.lastIdx : 0;
  const side = (idx % 2 === 0) ? 'L' : 'R';

  const b = document.createElement('div');
  b.className = 'cv-bubble now fresh';
  b.dataset.side = side;
  b.textContent = text;
  stream.appendChild(b);
  // Drop fresh class on the next frame so the entrance transition kicks in.
  requestAnimationFrame(() => requestAnimationFrame(() => b.classList.remove('fresh')));

  while (stream.children.length > CV_MAX) stream.firstElementChild.remove();
  refreshConvHeader();
}
function applyConvGap(t) {
  if (document.body.dataset.layout !== 'conversation') return;
  const cv = document.getElementById('convo');
  if (!cv || !cv.dataset.built) return;
  const typing = cv.querySelector('.cv-typing');
  if (!typing) return;
  const i = state.lastIdx;
  if (i < 0 || !state.lines.length) { typing.classList.remove('show'); return; }
  const last = state.lines[i];
  const next = state.lines[i + 1];
  if (!last || !next) { typing.classList.remove('show'); return; }
  // Use yrc duration when present, else fall back to gap-to-next.
  const lineDur = last.duration || (next.time - last.time);
  const inGap = t > last.time + lineDur * 0.7 && t < next.time - 0.05;
  // Side mirrors the *next* speaker so dots appear where the new bubble will land.
  typing.dataset.side = ((i + 1) % 2 === 0) ? 'L' : 'R';
  typing.classList.toggle('show', inGap);
}

// Per-frame karaoke trigger. Walks the live stage card and flips .now on
// each token whose start time has passed. Class-driven so CSS can run a
// keyframe animation per token at its real moment.
function applyKaraoke(t) {
  if (document.body.dataset.reveal !== 'karaoke') return;
  const card = stageEl.querySelector('.stage-card:not(.leaving)');
  if (!card) return;
  const wis = card.querySelectorAll('.wi');
  for (const wi of wis) {
    const charT = parseFloat(wi.dataset.t);
    if (Number.isNaN(charT)) continue;
    const active = t >= charT;
    if (active && !wi.classList.contains('now')) wi.classList.add('now');
    else if (!active && wi.classList.contains('now')) wi.classList.remove('now');
  }
}

function renderAt(t) {
  if (!state.lines.length) return;
  const i = LRC.findIndex(state.lines, t);
  if (i === state.lastIdx) return;
  state.lastIdx = i;
  window.FL_FX?.pulse();
  pulsePianoKeys();

  const cur = i >= 0 ? state.lines[i] : null;
  const prv = i - 1 >= 0 ? state.lines[i - 1] : null;
  const nxt = i + 1 < state.lines.length ? state.lines[i + 1] : null;

  if (document.body.dataset.layout === 'danmaku') {
    if (cur) spawnDanmaku(cur);
    return;
  }

  if (document.body.dataset.layout === 'conversation') {
    if (cur) spawnConvBubble(cur);
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

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
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
  // Complementary hue for two-voice themes (duet etc). Cheap rgb→hsl, then
  // shift hue by 180° and round-trip back so themes can interpolate against
  // either accent without computing themselves.
  const [hh, ss, ll] = rgbToHsl(r, g, b);
  const compHue = (hh + 180) % 360;
  document.body.style.setProperty('--accent-comp',      `hsl(${compHue} ${ss}% ${ll}%)`);
  document.body.style.setProperty('--accent-comp-soft', `hsl(${compHue} ${ss}% ${ll}% / 0.55)`);
  window.FL_FX?.setColors([r, g, b], [ar, ag, ab]);
}

// Commit a fully-loaded track to the UI all at once.
function commitTrack(np, lines, cover, elapsed, rate) {
  titleEl.textContent = np.title;
  artistEl.textContent = np.artist ? ' · ' + np.artist : '';
  if (cover) {
    // Cover flows through a CSS var so themes that want a fully custom
    // background (gradients, CRT, etc) can override --fl-bg-image without
    // fighting an inline style. Also feed the cover-panel img for the
    // reserved 'cover-left' frame layout.
    document.body.style.setProperty('--fl-cover-url', `url("${cover}")`);
    const coverImg = document.getElementById('cover');
    if (coverImg) coverImg.src = cover;
    applyAccentFromCover(cover).then(updateSoloAccent);
  }
  refreshSoloMeta();

  state.lines = lines;
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

  // Source badge — visible only when we're running on nowplaying-cli, where
  // elapsed is unreliable and lyrics may match the wrong version. Set before
  // any early return so idle state still reflects the last known source.
  document.body.dataset.source = np ? (np.source === 'muse' ? 'muse' : 'mediaremote') : 'idle';

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
    // When the source is `muse`, we own the audio element and report a
    // frame-accurate currentTime — adopt it as the local clock every poll
    // (also gives us free pause/seek handling).
    //
    // Otherwise (nowplaying-cli on the official NetEase client), elapsed
    // is permanently stuck at 0; ignore it and let tick()'s local clock run.
    if (np.source === 'muse') {
      // Anchor to the moment muse sampled currentTime (positionSampledAt),
      // not to "now". Without this, the 0–1s poll lag shows up as a visible
      // lyric drift on seek/pause — especially noticeable in stage layouts.
      // Fall back to "now" if the field is missing (older muse build).
      const sampledAt = np.positionSampledAt || Date.now();
      const ageMs = Math.max(0, Date.now() - sampledAt);
      state.elapsed = np.elapsed;
      state.lastSyncAt = performance.now() - ageMs;
      state.rate = np.rate;
      // Discontinuity: hard-snap to the new position instead of letting the
      // interpolator drift toward it over the next frame.
      if (np.stateVersion !== state.stateVersion) {
        state.stateVersion = np.stateVersion;
        state.lastIdx = -2;
      }
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

  const { lines, cover, kind } = await fetchLyricsFor(np);

  if (state.trackKey !== key) {
    state.isLoading = false;
    return;
  }

  // Estimate where the song is now: initial elapsed + time spent loading × rate.
  const loadedElapsed = loadStartElapsed + (performance.now() - loadStartAt) / 1000 * loadStartRate;

  state.trackKind = kind;
  // Kind decides which theme is "effective" — auto-switch on every commit.
  applyEffectiveTheme();
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
  applyKaraoke(t);
  applyConvGap(t);
  applyPianoFrame();
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

  // 4b) Theme-specific DOM prep. Piano lazily builds its key strip once.
  if (name === 'piano') buildPianoKeys();
  if (name === 'sakura') buildSakuraPool();
  if (theme.layout === 'conversation') { buildConvScaffold(); refreshConvHeader(); }
  if (theme.layout === 'solo') {
    ensureSoloCanvas();
    resizeSoloCanvas();
    refreshSoloMeta();
    updateSoloAccent();
  }

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
  const name = localStorage.getItem('theme') || 'aura';
  return THEMES.some((t) => t.name === name) ? name : 'aura';
}

// Auto-switch rules. JSON-encoded { instrumental: 'instrumental', ... }
// in localStorage 'theme.rules'. Empty / missing slot → fall back to default.
function loadThemeRules() {
  try {
    const raw = JSON.parse(localStorage.getItem('theme.rules') || '{}');
    return (raw && typeof raw === 'object') ? raw : {};
  } catch { return {}; }
}
function saveThemeRules(rules) {
  localStorage.setItem('theme.rules', JSON.stringify(rules || {}));
}
// Resolve which theme should be active right now given the current track.
// Order: rule-for-kind → default. Manual selections update the default;
// "按场景切换" submenu updates rules.
function effectiveThemeName() {
  const rules = loadThemeRules();
  const kind = state.trackKind || 'lyrical';
  const ruled = rules[kind];
  if (ruled && THEMES.some((t) => t.name === ruled)) return ruled;
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
// manual pick as the *default*, then re-resolves the effective theme through
// the rule layer (which may steer to a different one if the current track
// matches a rule). Toast only fires on the manual click path.
function setAndReportTheme(name) {
  if (!THEMES.some((t) => t.name === name)) return;
  localStorage.setItem('theme', name);
  document.body.dataset.theme = '';
  applyEffectiveTheme();
  const t = THEMES.find((x) => x.name === name);
  if (t) showToast(`主题 · ${t.label}`);
}

// Tray "按场景切换" subitems land here. value = '' clears the rule (fall
// back to default for that kind). Re-resolve effective theme immediately.
function setSceneRule(kind, themeName) {
  const rules = loadThemeRules();
  if (!themeName) delete rules[kind];
  else if (THEMES.some((t) => t.name === themeName)) rules[kind] = themeName;
  saveThemeRules(rules);
  document.body.dataset.theme = '';
  applyEffectiveTheme();
}
window.api.onSceneRule?.((payload) => {
  if (payload && typeof payload === 'object') setSceneRule(payload.kind, payload.theme);
});

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

// Apply the persisted default theme on startup. trackKind is 'lyrical' until
// the first track lands, so this just resolves to the default. Wrap so a bad
// theme entry can't halt the rest of init (poll loop, event listeners).
try {
  applyEffectiveTheme();
  // Hand the persisted rules back to main so the tray submenu boots with the
  // right radio marks. Optional chaining for older preload builds.
  window.api.reportSceneRules?.(loadThemeRules());
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
