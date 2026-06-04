// Audio-reactive subsystem — everything driven by muse's spectrum channel.
// Bundles the piano-key strip, the onset detector, the spectrum WS client,
// and the solo (instrumental) canvas visualizer into one module, because they
// share a single onset stream: the detector runs once per frame and fans the
// same onset out to piano strikes, solo particle bursts, and ripple rings.
//
// Reads app.js globals at call time only: `titleEl` / `artistEl` (solo meta).
// Calls out to window.FL_FX.pulseRipple. The WS connection self-starts on load.
//
// Public API: window.FL_AUDIO = {
//   frame()            per-rAF — onset detect + key decay + solo draw (from tick)
//   pulseLine()        on lyric line change (piano chord stab)
//   buildPiano()       applyTheme(piano) — lazily builds the key strip
//   ensureSolo()       applyTheme(solo) — lazily builds the canvas ctx
//   resizeSolo()       on theme apply / window resize
//   refreshSoloMeta()  push current title/artist into the solo overlay
//   updateSoloAccent() re-read --accent for the solo palette
// }
// Diagnostics live on window.__piano (open DevTools, type `__piano`).
(function () {

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

// ─── Spectrum client (ws://127.0.0.1:10755/spectrum, muse-produced) ─────────
// Protocol lives in ./NOW_PLAYING.md §Spectrum channel. We cache the latest
// frame and read it each animation tick — driving DOM from onmessage would
// pin the write-rate to 30fps producer cadence and fight our own smoothing.
let spectrumFrame = null;
let spectrumWS = null;
let spectrumReconnectTimer = null;

// Diagnostic handle — open DevTools and type `__piano` to inspect live state.
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

function applyPianoFrame() {
  const isPiano  = document.body.classList.contains('theme-piano');
  const isSolo   = document.body.classList.contains('theme-instrumental');
  const isRipple = document.body.classList.contains('theme-ripple');
  // Run the onset detector whenever any spectrum-driven theme is active.
  // Piano (key strikes), solo (particle bursts), and ripple (water rings)
  // all consume the same detector — one run per frame.
  if (isPiano || isSolo || isRipple) processSpectrumOnset();
  if (pianoKeys) {
    for (const k of pianoKeys) {
      k.level *= PIANO_DECAY;
      if (k.level < 0.004) k.level = 0;
      if (isPiano) k.el.style.setProperty('--lit', k.level.toFixed(3));
    }
  }
  if (isSolo) drawSolo();
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

// Open the spectrum socket on load; reconnects itself if muse isn't up yet.
connectSpectrum();

window.FL_AUDIO = {
  frame:            applyPianoFrame,
  pulseLine:        pulsePianoKeys,
  buildPiano:       buildPianoKeys,
  ensureSolo:       ensureSoloCanvas,
  resizeSolo:       resizeSoloCanvas,
  refreshSoloMeta:  refreshSoloMeta,
  updateSoloAccent: updateSoloAccent,
};

})();
