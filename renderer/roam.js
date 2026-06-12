// Roam · desktop-wide kinetic typography (漫游 theme).
//
// The whole desktop is the stage (fullscreen click-through overlay, like
// danmaku) but instead of one fixed motion, every lyric line is cast by a
// small director: it reads the line's sung duration (from LRC timing), its
// length, the silence before it, and the music's current energy, then
// assigns one of four choreographies:
//
//   drift     the workhorse — fade in somewhere, travel with the wind, fade
//   traverse  phrase openings — one long slow diagonal across the desktop
//   bloom     high-energy lines — appear center, letter-spacing pulls the
//             characters apart toward both sides as the line lives
//   cascade   short punchy lines — characters step down a little staircase
//
// Two structural tricks keep it choreography instead of popcorn:
//   visual rhyme   a repeated line (= chorus) replays its exact plan, so the
//                  chorus always lands in the same place, the same way
//   wind heading   drift vectors follow a slowly-rotating per-song heading,
//                  and consecutive lines avoid each other's screen regions
//
// Second consumer of FL_AUDIO: rms feeds the director's energy read; onsets
// flash a brief accent glow on the lines currently on stage (--rm-beat).
// Without the spectrum channel everything still works — energy falls back to
// a lyric-density proxy.
//
// JS is director + casting only; the performance itself is CSS keyframes
// parameterized by custom properties (see style.css §roam). Lines self-remove
// on animationend, danmaku-style.
//
// Public API: window.FL_ROAM = { spawn, frame, clear }
(function () {

const MAX_LIVE = 5;          // concurrent lines on stage
const PLAN_CACHE_MAX = 64;   // chorus-rhyme memory (per track)

// ── Director state ──────────────────────────────────────────────────────────
const planCache = new Map(); // text → plan (visual rhyme)
const recentCells = [];      // last grid cells used (avoid clustering)
let windBase = Math.random() * Math.PI * 2; // per-song drift heading seed
let traverseFlip = false;    // alternate the two diagonals
let energySmooth = 0;        // rolling rms

// Called every frame (not per spawn) so the rolling energy genuinely tracks
// the music over time; direct() just reads the current value.
function updateEnergy(dt) {
  const fr = window.FL_AUDIO?.getFrame?.();
  if (fr && typeof fr.rms === 'number' && Date.now() - (fr.t || 0) < 300) {
    // muse rms is small (~0..0.35); normalize into a usable 0..1
    const e = Math.min(1, fr.rms * 3.2);
    energySmooth += (e - energySmooth) * Math.min(1, 1.8 * dt);
  } else {
    energySmooth *= Math.pow(0.5, dt); // no signal → decay, ~1s half-life
  }
}

// 3×3 grid, cells 0..8. Pick one avoiding the most recent picks so
// consecutive lines wander across the desktop instead of stacking.
function pickCell(centerOnly) {
  const pool = centerOnly ? [3, 4, 5] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let attempt = 0; attempt < 10; attempt++) {
    const cell = pool[Math.floor(Math.random() * pool.length)];
    if (!recentCells.includes(cell)) {
      recentCells.push(cell);
      while (recentCells.length > 3) recentCells.shift();
      return cell;
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Cell → an anchor point inside it (% of viewport), jittered so reruns of the
// same cell don't pixel-align. Margins keep clear of menubar / dock.
function cellAnchor(cell) {
  const col = cell % 3, row = (cell / 3) | 0;
  const x = 8 + col * 30 + Math.random() * 16;        // 8..84 vw-ish
  const y = 12 + row * 26 + Math.random() * 12;       // 12..76 vh-ish
  return { x, y };
}

function direct(text, ctx) {
  // Visual rhyme: a line we've staged before replays its exact plan.
  const cached = planCache.get(text);
  if (cached) return cached;

  const n = [...text].length;
  const dur = Math.min(12, Math.max(2.5, ctx.dur || 4));
  // Density proxy when the spectrum channel is silent: fast crowded lines
  // read as high energy.
  const density = Math.min(1, (n / Math.max(1.5, ctx.dur || 4)) / 6);
  const heat = Math.max(energySmooth, density);
  const opening = (ctx.gap || 0) > 6 && n >= 6; // long silence → scene opening

  let pattern;
  if (opening)                         pattern = 'traverse';
  else if (heat > 0.55 && n <= 20)     pattern = 'bloom';
  else if (n <= 10 && dur < 3.4)       pattern = 'cascade';
  else                                 pattern = 'drift';

  const size = pattern === 'traverse' ? 'l'
             : pattern === 'bloom'    ? (n <= 12 ? 'l' : 'm')
             : heat > 0.45            ? 'm'
             : n > 18                 ? 's' : 'm';

  // ALL randomness is decided here and frozen into the plan, so a cached
  // plan replays pixel-identically — that's what makes the chorus rhyme.
  const plan = { pattern, size, dur };

  if (pattern === 'traverse') {
    traverseFlip = !traverseFlip;
    plan.x0 = traverseFlip ? '105vw' : '-30vw';
    plan.x1 = traverseFlip ? '-30vw' : '105vw';
    plan.y0 = (10 + Math.random() * 18).toFixed(1) + 'vh';
    plan.y1 = (58 + Math.random() * 22).toFixed(1) + 'vh';
  } else {
    const a = cellAnchor(pickCell(pattern === 'bloom'));
    if (pattern === 'bloom') {
      // ax is the CENTER (bloom translates -50%); keep it middle enough that
      // a max-width line never clips either edge.
      plan.ax = 34 + Math.random() * 32;             // 34..66vw
    } else {
      // Keep the anchor inside the right edge: rough per-char width in vw
      // by size class (CJK at fullscreen scale), capped by wrap max-width.
      const perChar = size === 'l' ? 3.6 : size === 'm' ? 2.8 : 2.1;
      plan.ax = Math.max(2, Math.min(a.x, 94 - Math.min(n * perChar, 38)));
    }
    plan.ay = a.y;
    if (pattern === 'drift') {
      // Wind heading rotates slowly through the song; mostly-horizontal
      // travel keeps moving text readable. Lines jitter around the heading.
      const h = windBase + ctx.index * 0.11 + (Math.random() - 0.5) * 0.5;
      const horiz = Math.cos(h) >= 0 ? 1 : -1;
      const tilt = (Math.random() - 0.5) * 0.6;      // ±~17° off horizontal
      const dist = 9 + Math.random() * 8;            // vw
      plan.tx = horiz * dist * Math.cos(tilt);
      plan.ty = dist * Math.sin(tilt) * 0.6;
    }
  }

  if (planCache.size >= PLAN_CACHE_MAX) planCache.delete(planCache.keys().next().value);
  planCache.set(text, plan);
  return plan;
}

// ── Casting: build the DOM for one staged line ──────────────────────────────
const root = () => document.getElementById('roam');

// Per-pattern character reveal delays, computed here (not CSS) so bloom can
// reveal center-out and cascade can stagger without calc(abs()) tricks.
function charDelay(pattern, i, n) {
  switch (pattern) {
    case 'bloom':    return Math.abs(i - (n - 1) / 2) * 46;
    case 'cascade':  return i * 70;
    case 'traverse': return 0;
    default:         return i * 26; // drift
  }
}

function spawn(line, ctx) {
  const el = root();
  if (!el) return;
  const text = ((line && line.text) || '').trim();
  if (!text) return;

  const plan = direct(text, ctx || {});
  const n = [...text].length;

  const lineEl = document.createElement('div');
  lineEl.className = `rm-line rm-${plan.pattern} rm-size-${plan.size}`;
  lineEl.style.setProperty('--dur', plan.dur.toFixed(2) + 's');

  const makeRc = (ch, i) => {
    const c = document.createElement('span');
    c.className = 'rc';
    c.style.setProperty('--i', i);
    const ci = document.createElement('span');
    ci.className = 'rci';
    ci.style.setProperty('--d', charDelay(plan.pattern, i, n).toFixed(0) + 'ms');
    ci.textContent = ch;
    c.appendChild(ci);
    return c;
  };
  // latin words wrapped nowrap so wrapping happens at spaces, never mid-word
  for (const t of FL_TEXT.tokenize(text)) {
    if (t.type === 'space') {
      lineEl.appendChild(document.createTextNode(' '));
    } else if (t.type === 'word') {
      const w = document.createElement('span');
      w.className = 'rw';
      [...t.text].forEach((ch, j) => w.appendChild(makeRc(ch, t.start + j)));
      lineEl.appendChild(w);
    } else {
      lineEl.appendChild(makeRc(t.text, t.start));
    }
  }

  // Placement — pure execution of the plan (all randomness was frozen into
  // it by direct(), so chorus replays land pixel-identically).
  if (plan.pattern === 'traverse') {
    lineEl.style.setProperty('--x0', plan.x0);
    lineEl.style.setProperty('--x1', plan.x1);
    lineEl.style.setProperty('--y0', plan.y0);
    lineEl.style.setProperty('--y1', plan.y1);
    // A crossing needs room to breathe regardless of the LRC gap.
    lineEl.style.setProperty('--dur', Math.max(plan.dur, 8).toFixed(2) + 's');
  } else {
    lineEl.style.left = plan.ax.toFixed(2) + 'vw';
    lineEl.style.top = plan.ay.toFixed(2) + 'vh';
    if (plan.pattern === 'drift') {
      lineEl.style.setProperty('--tx', (plan.tx || 10).toFixed(2) + 'vw');
      lineEl.style.setProperty('--ty', (plan.ty || 0).toFixed(2) + 'vh');
    }
  }

  lineEl.addEventListener('animationend', (e) => {
    if (e.target === lineEl) lineEl.remove();
  });
  el.appendChild(lineEl);

  // Stage cap — evict the oldest line softly instead of popping it.
  const live = el.querySelectorAll('.rm-line:not(.evict)');
  if (live.length > MAX_LIVE) {
    const oldest = live[0];
    oldest.classList.add('evict');
    setTimeout(() => oldest.remove(), 300);
  }
}

// ── Beat layer: onsets flash an accent glow on whatever is on stage ─────────
let beat = 0;
if (window.FL_AUDIO?.onOnset) {
  window.FL_AUDIO.onOnset((velocity) => {
    if (document.body.dataset.layout !== 'roam') return;
    beat = Math.max(beat, 0.35 + velocity * 0.65);
  });
}

let lastFrameT = 0;
function frame() {
  if (document.body.dataset.layout !== 'roam') return;
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameT) / 1000) || 0.016;
  lastFrameT = now;
  updateEnergy(dt);
  if (beat > 0.004) {
    beat *= Math.pow(0.0008, dt); // ~150ms decay to near-zero
    root()?.style.setProperty('--rm-beat', beat.toFixed(3));
  } else if (beat !== 0) {
    beat = 0;
    root()?.style.setProperty('--rm-beat', '0');
  }
}

// Full reset: wipe the stage and the per-song director memory.
function clear() {
  const el = root();
  if (el) el.innerHTML = '';
  planCache.clear();
  recentCells.length = 0;
  windBase = Math.random() * Math.PI * 2;
  energySmooth = 0;
  beat = 0;
}

window.FL_ROAM = { spawn, frame, clear };

})();
