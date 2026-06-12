// Ticket · collectible hologram concert ticket (镭射票 theme).
//
// A K-pop-merch laser ticket floats upright as a desktop object: song title
// as the billing, artist on the stub plate, lyric foil-stamped across the
// face like a security print. The conceit that keeps every effect honest:
// the card is always being HELD — it drifts in a slow admire-tilt, and all
// holographic surfaces read their light from that one tilt state. Audio
// never paints pixels directly; it handles the card, and the foil answers:
//   rms      → handling energy (wander amplitude, bob)
//   onset    → a tilt kick — the sheen sweep that follows is caused by the
//              card turning, not by the beat "playing an animation"
//   centroid → diffraction hue (grating physics: bright sounds bend blue,
//              dark ones bend gold)
// Song change is the ritual: the stub tears off onto tonight's pile (the
// setlist, accumulated), a fresh ticket deals in. Stop = a 散场 chop.
//
// Public API mirrors furin:
//   window.FL_TICKET = { build, start, stop, frame, setLine, setTrack, clear }
(function () {

// ── Tuning ──────────────────────────────────────────────────────────────────
// Spring-damper per tilt axis: k sets the settle tempo (~1.6s), zeta < 1 so a
// kicked card overshoots once like a real one pinched between two fingers.
const SPRING_K = 16;
const SPRING_C = 3.4;
const RY_MAX = 0.30;            // rad — admire-tilt never goes card-flip
const RX_MAX = 0.16;
const ONSET_COOLDOWN = 130;     // ms
const SHEEN_MIN_V = 0.40;       // weak onsets tilt but don't earn a sweep
const HUE_RANGE = 120;          // deg of hue-rotate across the centroid span

const mkAxis = () => ({ th: 0, w: 0 });
const RX = mkAxis(), RY = mkAxis();
const seed = Math.random() * 100;

let active = false;
let built = false;
let lastT = 0;
let rmsE = 0;                   // smoothed handling energy
let hueE = 0;                   // smoothed diffraction hue (deg)
let kickDir = 1;                // onsets alternate the tilt direction

// ── DOM ─────────────────────────────────────────────────────────────────────
let rootEl, floatEl, cardEl, titleEl, artistEl, lyricEl, plateEl, noEl,
    metaEl, sheenEl, stampEl, stampDateEl, pileEl;

function build() {
  rootEl = document.getElementById('ticket');
  if (!rootEl || built) return;
  built = true;
  rootEl.innerHTML = `
    <div class="tk-scale">
      <div class="tk-float">
        <div class="tk-card">
          <div class="tk-main">
            <div class="tk-halftone"></div>
            <div class="tk-shard tk-shard-big"></div>
            <div class="tk-shard tk-shard-s1"></div>
            <div class="tk-shard tk-shard-s2"></div>
            <div class="tk-frame"></div>
            <div class="tk-tour">ECHO PRESENTS · ON AIR</div>
            <div class="tk-vip">VIP</div>
            <div class="tk-side">LIVE FROM YOUR DESKTOP · ADMIT ONE</div>
            <div class="tk-title"></div>
            <div class="tk-artist"></div>
            <div class="tk-lyric"><span></span></div>
            <div class="tk-meta">
              <span class="tk-gate"></span>
              <span>内场 · 排01 · 座01</span>
              <span>¥0.00</span>
            </div>
            <div class="tk-stamp"><b>散场</b><i></i></div>
            <div class="tk-sheen"></div>
          </div>
          <div class="tk-perf"></div>
          <div class="tk-stub">
            <div class="tk-plate"><span></span></div>
            <div class="tk-bar"></div>
            <div class="tk-no"></div>
          </div>
        </div>
        <div class="tk-pile"></div>
      </div>
    </div>`;
  floatEl   = rootEl.querySelector('.tk-float');
  cardEl    = rootEl.querySelector('.tk-card');
  titleEl   = rootEl.querySelector('.tk-title');
  artistEl  = rootEl.querySelector('.tk-artist');
  lyricEl   = rootEl.querySelector('.tk-lyric span');
  plateEl   = rootEl.querySelector('.tk-plate span');
  noEl      = rootEl.querySelector('.tk-no');
  metaEl    = rootEl.querySelector('.tk-gate');
  sheenEl   = rootEl.querySelector('.tk-sheen');
  stampEl   = rootEl.querySelector('.tk-stamp');
  stampDateEl = rootEl.querySelector('.tk-stamp i');
  pileEl    = rootEl.querySelector('.tk-pile');
  // Standby card: a deliberate object before the first track arrives.
  titleEl.textContent = 'ECHO LIVE';
  artistEl.textContent = 'STAND BY';
  plateEl.textContent = 'ADMIT ONE';
  noEl.textContent = 'NO. 0000-000 · 座位:耳机里';
  metaEl.textContent = '检票 --:--';
}

function start() {
  build();
  active = true;
  lastT = performance.now();
}
function stop() { active = false; }

// ── Audio onsets → the hand flicks the card ────────────────────────────────
let lastKickAt = 0;
if (window.FL_AUDIO?.onOnset) {
  window.FL_AUDIO.onOnset((velocity, centroid) => {
    if (!active) return;
    const now = performance.now();
    if (now - lastKickAt < ONSET_COOLDOWN) return;
    lastKickAt = now;
    // Alternate the admire direction, biased by brightness so a bright
    // passage rolls the card one way and a dark one rolls it back.
    kickDir = centroid >= 0.5 ? 1 : -1;
    RY.w += kickDir * (0.35 + velocity * 1.05);
    RX.w += (Math.random() - 0.5) * velocity * 0.55;
    if (velocity > SHEEN_MIN_V) sheen(Math.min(1, velocity));
  });
}

// One-shot specular sweep. Intensity rides a CSS var; restart by reflow.
function sheen(v) {
  if (!sheenEl) return;
  sheenEl.style.setProperty('--sv', v.toFixed(2));
  sheenEl.classList.remove('on');
  void sheenEl.offsetWidth;
  sheenEl.classList.add('on');
}

// ── Lyric: foil-stamped security print ─────────────────────────────────────
let currentText = '';

function fitLyric(text) {
  const n = [...text].length;
  let size = 27;
  if (n > 8)  size = 24;
  if (n > 12) size = 21;
  if (n > 16) size = 19;
  if (n > 20) size = 17;
  if (n > 26) size = 15;
  if (n > 34) size = 13;
  lyricEl.style.fontSize = size + 'px';
}

function setLine(line) {
  if (!built) return;
  const text = ((line && line.text) || '').trim();
  if (!text) return;
  if (text === currentText) { sheen(0.3); return; } // chorus repeat: a glint
  currentText = text;
  fitLyric(text);
  lyricEl.textContent = text;
  // Re-stamp: the press tilts the card a touch, the foil flashes and settles.
  lyricEl.classList.remove('stamp');
  void lyricEl.offsetWidth;
  lyricEl.classList.add('stamp');
  RY.w += kickDir * 0.22;
  sheen(0.4);
}

// ── Track lifecycle: tear → pile → deal ─────────────────────────────────────
let lastTrackKey = '';
let seq = 0;
let pile = [];                  // [{ title }] newest first
let tearing = false;
let queuedTrack = null;

const pad = (x, n) => String(x).padStart(n, '0');

function fillCard(np) {
  const d = new Date();
  seq += 1;
  titleEl.textContent = np.title || '—';
  artistEl.textContent = (np.artist || 'UNKNOWN ARTIST').toUpperCase();
  plateEl.textContent = np.artist || np.title || 'ADMIT ONE';
  noEl.textContent =
    `NO. ${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}` +
    `-${pad(seq, 3)} · 座位:耳机里`;
  metaEl.textContent = `检票 ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
  currentText = '';
  lyricEl.textContent = '';
  lyricEl.classList.remove('stamp');
  stampEl.classList.remove('on');
}

function renderPile() {
  pileEl.innerHTML = '';
  pile.slice(0, 4).forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'tk-pstub';
    el.textContent = s.title;
    el.style.setProperty('--pi', i);
    el.style.setProperty('--pr', ((i % 2 ? -1 : 1) * (1.6 + i * 1.1)).toFixed(1) + 'deg');
    el.style.zIndex = 10 - i;
    pileEl.appendChild(el);
  });
}

function setTrack(np) {
  if (!built || !np || !np.title) return;
  const key = `${np.title}|${np.artist || ''}`;
  if (key === lastTrackKey) return;
  // Mid-tear arrivals (rapid skips) queue; only the latest one matters.
  if (tearing) { queuedTrack = np; lastTrackKey = key; return; }
  const isFirst = !lastTrackKey;
  lastTrackKey = key;
  const prevTitle = titleEl.textContent;

  if (isFirst || !active) {
    // First show of the session (or theme hidden): no body to tear yet.
    fillCard(np);
    if (active) {
      cardEl.classList.remove('dealing');
      void cardEl.offsetWidth;
      cardEl.classList.add('dealing');
    }
    return;
  }

  tearing = true;
  cardEl.classList.add('tearing');
  setTimeout(() => {
    if (prevTitle && prevTitle !== 'ECHO LIVE') {
      pile.unshift({ title: prevTitle });
      pile = pile.slice(0, 4);
      renderPile();
    }
    const next = queuedTrack || np;
    queuedTrack = null;
    fillCard(next);
    cardEl.classList.remove('tearing');
    void cardEl.offsetWidth;
    cardEl.classList.add('dealing');
    // Dealing a card hands it some real energy.
    RY.w += 0.55; RX.w -= 0.2;
    setTimeout(() => { cardEl.classList.remove('dealing'); tearing = false; }, 620);
  }, 640);
}

// Playback stopped: the show is over — chop the card, keep the title.
// app.js re-calls this on every poll while stopped; only the first chop acts.
function clear() {
  if (!built || stampEl.classList.contains('on')) return;
  currentText = '';
  lyricEl.textContent = '';
  lyricEl.classList.remove('stamp');
  const d = new Date();
  stampDateEl.textContent =
    `${d.getFullYear()}.${pad(d.getMonth() + 1, 2)}.${pad(d.getDate(), 2)}`;
  stampEl.classList.add('on');
  RX.w -= 0.3;                  // the chop lands with weight
}

// ── Per-frame: physics + light. Called from app.js tick() every rAF. ───────
function stepAxis(a, target, h) {
  const acc = -SPRING_K * (a.th - target) - SPRING_C * a.w;
  a.w += acc * h;
  a.th += a.w * h;
}
function capAxis(a, max) {
  if (a.th > max)       { a.th = max;  a.w *= -0.25; }
  else if (a.th < -max) { a.th = -max; a.w *= -0.25; }
}

function frame() {
  if (!active || !built) return;
  const now = performance.now();
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt <= 0) return;
  if (dt > 0.05) dt = 0.05;
  const t = now / 1000;

  // Handling energy: fast attack, slow release — phrases linger in the hand.
  const fr = window.FL_AUDIO?.getFrame?.();
  let rms = 0;
  if (fr && typeof fr.rms === 'number' && Date.now() - (fr.t || 0) < 300) rms = fr.rms;
  const k = rms > rmsE ? 0.12 : 0.03;
  rmsE += (rms - rmsE) * Math.min(1, k * (dt * 60));

  // Admire-wander: incommensurate sines so the idle drift never loops.
  const amp = 0.045 + rmsE * 0.55;
  const ryT = (Math.sin(t * 0.23 + seed)       * 0.5
             + Math.sin(t * 0.61 + seed * 1.7) * 0.3
             + Math.sin(t * 1.31 + seed * 0.6) * 0.2) * amp;
  const rxT = (Math.sin(t * 0.31 + seed * 2.3) * 0.6
             + Math.sin(t * 0.83 + seed * 1.1) * 0.4) * amp * 0.55;
  stepAxis(RY, ryT, dt);
  stepAxis(RX, rxT, dt);
  capAxis(RY, RY_MAX);
  capAxis(RX, RX_MAX);

  // Diffraction hue from spectral centroid (EMA'd so it sails, not flickers).
  if (fr && typeof fr.centroid === 'number') {
    const hueT = (fr.centroid - 0.5) * HUE_RANGE;
    hueE += (hueT - hueE) * Math.min(1, 0.06 * (dt * 60));
  }

  const bob = Math.sin(t * 0.42 + seed) * 3 + Math.sin(t * 0.97 + seed * 3) * 1.4;
  const rotZ = Math.sin(t * 0.17 + seed * 2) * (0.7 + rmsE * 1.2);

  floatEl.style.transform = `translateY(${(bob * (1 + rmsE)).toFixed(2)}px) rotate(${rotZ.toFixed(3)}deg)`;
  cardEl.style.transform = `rotateX(${(-RX.th).toFixed(4)}rad) rotateY(${RY.th.toFixed(4)}rad)`;

  // One light state for every foil surface: the tilt is the light. Layers
  // multiply --lp by different factors in CSS (counter-parallax = the depth
  // a real hologram has). Slow drift keeps the foil alive even at dead calm.
  const lp = 50 + RY.th * 150 + Math.sin(t * 0.07 + seed) * 9;
  cardEl.style.setProperty('--lp', lp.toFixed(2));
  cardEl.style.setProperty('--hue', hueE.toFixed(1) + 'deg');
}

// Diagnostics — DevTools: `__ticket` (same convention as __furin / __piano).
window.__ticket = {
  get active() { return active; },
  get tilt()   { return { rx: RX.th, ry: RY.th }; },
  get rms()    { return rmsE; },
  get hue()    { return hueE; },
  get pile()   { return pile.map((p) => p.title); },
  get track()  { return lastTrackKey; },
};

window.FL_TICKET = { build, start, stop, frame, setLine, setTrack, clear };

})();
