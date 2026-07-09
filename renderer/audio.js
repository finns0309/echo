// Spectrum + onset engine.
//
// Receives muse's /spectrum WS (24-band + RMS, ~30fps), caches the latest
// frame, and runs a spectral-flux onset detector. Consumers: furin (rms →
// wind, onsets → clapper kicks), roam (rms → director energy, onsets → stage
// glow), eva (rms → sync%, onsets → A.T. field, centroid → pattern). Any
// future audio-reactive theme registers the same way via FL_AUDIO.onOnset(cb)
// / FL_AUDIO.getFrame(), without re-deriving the detector.
//
// Protocol: ./NOW_PLAYING.md §Spectrum channel. Diagnostics: window.__piano.
//
// Public API: window.FL_AUDIO = {
//   frame()              per-rAF tick — runs the onset detector (cheap: only does
//                        real work on a fresh spectrum frame), dispatching onsets
//                        to any registered handlers
//   onOnset(cb)          register (velocity, centroid) => {...} for onsets
//   getFrame()           latest cached spectrum frame (or null)
// }
(function () {

// Onset detector tuning (carried over from the piano/solo era).
const ONSET_FLUX = 0.07;       // spectral-flux threshold for a hard onset
const ONSET_MIN_GAP_MS = 85;   // floor between onsets (~12/s max)

let spectrumFrame = null;
let spectrumWS = null;
let spectrumReconnectTimer = null;

// Onset detector state.
let prevBands = null;
let lastOnsetAt = 0;
let lastStateVersion = -1;
let lastProcessedFrameT = 0;
let frameCounter = 0;
let lastFlux = 0;

// Future audio-reactive themes register here; called with (velocity, centroid).
const onsetHandlers = [];

function processOnset() {
  const frame = spectrumFrame;
  if (!frame || !frame.bands) return;
  if (frame.t === lastProcessedFrameT) return;
  lastProcessedFrameT = frame.t;
  frameCounter++;

  const now = Date.now();
  if (now - (frame.t || 0) > 300) return; // stale, producer paused

  // Track change / seek — clear prev bands so flux isn't computed across a
  // discontinuity (would spike a spurious onset on every switch).
  if (typeof frame.stateVersion === 'number' && frame.stateVersion !== lastStateVersion) {
    lastStateVersion = frame.stateVersion;
    prevBands = null;
    return;
  }

  const bands = frame.bands;

  // Spectral flux = sum of positive per-band deltas vs the previous frame.
  // The classic note-onset detector; measures new energy entering the spectrum.
  let flux = 0;
  if (prevBands) {
    for (let i = 0; i < bands.length; i++) {
      const d = bands[i] - prevBands[i];
      if (d > 0) flux += d;
    }
    flux /= bands.length * 0.25; // normalize so the threshold stays genre-agnostic
  }
  lastFlux = flux;
  if (!prevBands || prevBands.length !== bands.length) prevBands = new Float32Array(bands.length);
  for (let i = 0; i < bands.length; i++) prevBands[i] = bands[i];

  // Spectral centroid (0..1) — where the energy sits, for pitch/position bias.
  let num = 0, den = 0;
  for (let i = 0; i < bands.length; i++) { num += bands[i] * i; den += bands[i]; }
  const centroid = den > 0 ? (num / den) / (bands.length - 1) : 0.5;

  if (now - lastOnsetAt >= ONSET_MIN_GAP_MS && flux > ONSET_FLUX) {
    lastOnsetAt = now;
    const velocity = Math.min(1, 0.6 + flux * 1.2);
    for (const h of onsetHandlers) { try { h(velocity, centroid); } catch {} }
  }
}

function connectSpectrum() {
  spectrumReconnectTimer = null;
  try {
    // window.__SPECTRUM_URL lets the phone build (phone.html) redirect or, by
    // setting it to null, opt out entirely — see the guard on the initial
    // connect below. Undefined on desktop → the default loopback socket.
    spectrumWS = new WebSocket(window.__SPECTRUM_URL || 'ws://127.0.0.1:10755/spectrum');
  } catch { scheduleReconnect(); return; }
  spectrumWS.addEventListener('open', () => console.log('[spectrum] connected to muse'));
  spectrumWS.addEventListener('message', (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.type === 'hello') { console.log('[spectrum] hello', m); return; }
      if (Array.isArray(m.bands)) spectrumFrame = m;
    } catch {}
  });
  spectrumWS.addEventListener('close', scheduleReconnect);
  spectrumWS.addEventListener('error', () => { try { spectrumWS?.close(); } catch {} });
}
function scheduleReconnect() {
  if (spectrumReconnectTimer) return;
  spectrumWS = null;
  // 3s retry — trivial when muse is absent (the error is local).
  spectrumReconnectTimer = setTimeout(connectSpectrum, 3000);
}

// Diagnostics — open DevTools, type `__piano` (name kept for muscle memory).
window.__piano = {
  get ws()     { return spectrumWS?.readyState; }, // 0=connecting 1=open 2=closing 3=closed
  get frame()  { return spectrumFrame; },
  get frames() { return frameCounter; },
  get flux()   { return lastFlux; },
};

// Keep the pipe warm so the cached frame + diagnostics are live and a future
// consumer gets data the instant it registers. The phone build sets
// __SPECTRUM_URL = null (no muse socket to reach from a phone) — skip entirely
// so we don't spin a 3s reconnect loop against the device's own localhost.
if (window.__SPECTRUM_URL !== null) connectSpectrum();

window.FL_AUDIO = {
  // Runs every tick. processOnset early-returns unless muse pushed a fresh
  // frame, so this stays cheap; it keeps __piano diagnostics live even with no
  // consumer, and dispatches onsets to handlers when a theme has registered one.
  frame() { processOnset(); },
  onOnset(cb) { if (typeof cb === 'function') onsetHandlers.push(cb); },
  getFrame() { return spectrumFrame; },
};

})();
