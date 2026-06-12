// Eva · NERV-terminal title cards (新世纪 theme).
//
// The desktop becomes the black void of an anime intertitle: every lyric
// line is slammed on screen as an ultra-bold Mincho title card (the 次回予告
// language — huge type, bleed, asymmetry, hard cuts, NO easing) on a bare
// black void — no corner chrome, just the type and A.T.-field hexagons
// rippling out behind it on onsets. Track change runs a lock-on sequence:
// warning stripes → converging hexagons around the cover → hard cut to the
// first card.
//
// Motion discipline (the whole point): cuts are instant, holds are long,
// the only curves allowed live in the fx canvas. Anything smooth would
// break the dialect.
//
// FL_AUDIO tie (was three, now one): onsets → A.T. field / cross flare.
// (The window stays draggable like every ambient theme — the
// click-to-A.T.-field idea lost to that: drag regions eat clicks before
// the renderer sees them.)
//
// Public API: window.FL_EVA = { start, stop, frame, setLine, setTrack, clear }
(function () {

const TAU = Math.PI * 2;

// palette (kept here for canvas; DOM colors live in style.css)
const ORANGE = [255, 106, 0];
const WHITE  = [242, 240, 232];

let active = false, built = false;
let rootEl, cardEl, fxCanvas, fxCtx;
let coverImg = null;

// ── tiny utils ───────────────────────────────────────────────────────────────
function hash(s) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.codePointAt(0)) >>> 0; return h; }
const pad = (n, w) => String(n).padStart(w, '0');

// ── build ────────────────────────────────────────────────────────────────────
function build() {
  rootEl = document.getElementById('eva');
  if (!rootEl || built) return;
  built = true;
  rootEl.innerHTML = `
    <canvas class="ev-fx"></canvas>
    <div class="ev-scan"></div>
    <div class="ev-card"></div>
    <div class="ev-stripes ev-stripes-top"></div>
    <div class="ev-stripes ev-stripes-bot"></div>
    <div class="ev-lock">
      <div class="ev-hex ev-hex1"></div>
      <div class="ev-hex ev-hex2"></div>
      <div class="ev-hex ev-hex3"></div>
      <div class="ev-target">
        <img class="ev-cover" alt="">
        <div class="ev-target-text"></div>
      </div>
    </div>
    <div class="ev-flash"></div>`;
  cardEl = rootEl.querySelector('.ev-card');
  fxCanvas = rootEl.querySelector('.ev-fx');
  fxCtx = fxCanvas.getContext('2d');
  coverImg = rootEl.querySelector('.ev-cover');
  fitFx();
  window.addEventListener('resize', fitFx);
}
function fitFx() {
  if (!fxCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const r = fxCanvas.getBoundingClientRect();
  fxCanvas.width = r.width * dpr; fxCanvas.height = r.height * dpr;
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function start() {
  build();
  active = true;
  lastT = performance.now();
  renderIdleCard();
}
function stop() { active = false; }

// ── title-card typography ────────────────────────────────────────────────────
// Templates: full-bleed stack / vertical columns / giant red keyword /
// diagonal opposition. Deterministic per text (hash) so a repeated chorus
// slams in identically — and inverted (white) cards arrive on a fixed cadence.
// Rows of {ch, idx} pairs, built from FL_TEXT tokens so latin words are
// never split across rows; idx maps each span back to its codepoint index
// for keyword marking.
function splitPairs(text, k) {
  const chars = [...text];
  const per = Math.ceil(chars.length / k);
  const rows = [[]];
  for (const t of FL_TEXT.tokenize(text)) {
    const row = rows[rows.length - 1];
    const tlen = [...t.text].length;
    if (row.length && row.length + tlen > per && rows.length < k) {
      if (t.type === 'space') continue; // never start a row with a space
      rows.push([]);
    }
    const target = rows[rows.length - 1];
    [...t.text].forEach((ch, j) => target.push({ ch, idx: t.start + j }));
  }
  return rows.filter(r => r.length);
}
function rowDiv(pairs) {
  const d = document.createElement('div');
  d.className = 'ev-row';
  for (const p of pairs) {
    const s = document.createElement('span');
    s.dataset.idx = p.idx;
    // NBSP so spaces survive inline whitespace collapse
    s.textContent = p.ch === ' ' ? ' ' : p.ch;
    d.appendChild(s);
  }
  return d;
}
const allPairs = (text) => [...text].map((ch, i) => ({ ch, idx: i }));
function markRed(scope, kw) {
  scope.querySelectorAll('span[data-idx]').forEach(s => {
    const i = +s.dataset.idx;
    if (i >= kw.start && i < kw.start + kw.len) s.classList.add('red');
  });
}

function renderCard(text) {
  const W = rootEl.clientWidth || 1440, H = rootEl.clientHeight || 900;
  const chars = [...text];
  const n = chars.length;
  const h = hash(text);
  const kw = FL_TEXT.pickKeyword(text);          // a real word, not 「了早」
  const latinish = FL_TEXT.latinRatio(text) > 0.34;
  const invert = h % 7 === 0;                    // the white "AIR" card
  // vertical upright latin reads as a ransom note — keep vert CJK-only
  const tpl = !latinish && n <= 9 && (h >> 3) % 3 === 0 ? 'vert'
            : (h >> 5) % 4 === 0 && n >= 8 ? 'dual'
            : (h >> 7) % 3 === 0 ? 'giant'
            : 'stack';

  cardEl.className = 'ev-card ev-tpl-' + tpl + (invert ? ' ev-invert' : '');
  cardEl.innerHTML = '';

  if (tpl === 'vert') {
    const v = document.createElement('div');
    v.className = 'ev-vert';
    const fs = Math.min(170, Math.max(56, (H * 0.72) / n));
    v.style.fontSize = fs + 'px';
    v.appendChild(rowDiv(allPairs(text)));
    cardEl.appendChild(v);
    markRed(v, kw);
    const note = document.createElement('div');
    note.className = 'ev-note';
    note.textContent = '──　' + pad((h % 26) + 1, 2);
    cardEl.appendChild(note);
  } else if (tpl === 'giant') {
    const key = chars.slice(kw.start, kw.start + kw.len).join('');
    const g = document.createElement('div');
    g.className = 'ev-giant';
    g.textContent = key;
    // latin glyphs run ~0.58em wide vs CJK's 1em — fit the word, not the count
    const perEm = FL_TEXT.latinRatio(key) > 0.5 ? 0.58 : 1.0;
    g.style.fontSize = Math.min(H * 0.52, (W * 0.84) / Math.max(1, kw.len * perEm)) + 'px';
    const r = document.createElement('div');
    r.className = 'ev-giant-rest';
    r.appendChild(rowDiv(allPairs(text)));
    cardEl.appendChild(g); cardEl.appendChild(r);
  } else if (tpl === 'dual') {
    const rows = splitPairs(text, 2);
    const pa = rows[0], pb = rows[1] || [];
    const a = rowDiv(pa), b = rowDiv(pb);
    a.classList.add('ev-dual-a'); b.classList.add('ev-dual-b');
    const maxLen = Math.max(pa.length, pb.length, 1);
    const perEm = latinish ? 0.58 : 1.0;
    const fs = Math.min(120, (W * (latinish ? 0.8 : 0.5)) / (maxLen * perEm));
    a.style.fontSize = fs + 'px'; b.style.fontSize = fs + 'px';
    cardEl.appendChild(a);
    if (pb.length) cardEl.appendChild(b);
    markRed(cardEl, kw);
  } else { // stack
    const k = n > 16 ? 3 : n > 7 ? 2 : 1;
    const rows = splitPairs(text, k);
    const maxLen = Math.max(...rows.map(r => r.length));
    const perEm = latinish ? 0.58 : 1.0;
    const fs = Math.min(H * 0.3, Math.max(46, (W * 0.86) / (maxLen * perEm)));
    const wrap = document.createElement('div');
    wrap.className = 'ev-stack';
    wrap.style.fontSize = fs + 'px';
    rows.forEach((r, i) => {
      const d = rowDiv(r);
      d.classList.add(['ev-r-left', 'ev-r-right', 'ev-r-mid'][i % 3]);
      wrap.appendChild(d);
    });
    cardEl.appendChild(wrap);
    markRed(wrap, kw);
  }
  // percussive slam: steps(), no curve
  cardEl.classList.remove('slam');
  void cardEl.offsetWidth; // restart the animation
  cardEl.classList.add('slam');
}

function renderIdleCard() {
  if (!built) return;
  cardEl.className = 'ev-card ev-tpl-idle';
  cardEl.innerHTML = `<div class="ev-idle-v">待機</div><div class="ev-idle-sub">ACTIVITY : NONE</div>`;
}

// ── lyric + track plumbing (called from app.js) ─────────────────────────────
let pendingLine = null;
let curText = '';
function setLine(line) {
  if (!built) return;
  const text = ((line && line.text) || '').trim();
  if (!text || text === curText) return;
  if (seq.phase) { pendingLine = text; return; } // hold during lock-on
  curText = text;
  renderCard(text);
  // every card lands with a small A.T. ripple behind it
  const W = rootEl.clientWidth, H = rootEl.clientHeight;
  spawnAT(W * (0.3 + (hash(text) % 40) / 100), H * 0.5, 0.4);
}

// Track lock-on sequence state
const seq = { phase: 0, t: 0, title: '', artist: '', cover: '' };
function setTrack(np) {
  curText = '';
  // Nothing off-screen needs the track anymore (the corner readouts start()
  // used to restore are gone), so only the live theme bothers: the cached
  // title/artist/cover just feed the lock-on sequence below.
  if (!built || !active) return;
  seq.title = np.title || '';
  seq.artist = np.artist || '';
  seq.cover = np.cover || '';
  if (seq.cover) { coverImg.src = seq.cover; coverImg.style.display = ''; }
  else coverImg.style.display = 'none';
  seq.phase = 1; seq.t = 0;
  rootEl.classList.add('ev-warn');
  cardEl.className = 'ev-card ev-tpl-warn';
  cardEl.innerHTML = '<div class="ev-warn-big">緊 急</div><div class="ev-warn-sub">EMERGENCY</div>';
}

function clear() {
  if (!built) return;
  curText = ''; pendingLine = null; seq.phase = 0;
  rootEl.classList.remove('ev-warn', 'ev-locking');
  renderIdleCard();
}

// ── audio: the one remaining FL_AUDIO consumer ──────────────────────────────
if (window.FL_AUDIO?.onOnset) {
  window.FL_AUDIO.onOnset((vel) => {
    if (!active) return;
    const W = rootEl.clientWidth, H = rootEl.clientHeight;
    spawnAT(W * (0.2 + Math.random() * 0.6), H * (0.25 + Math.random() * 0.5), vel);
    if (vel > 0.86) spawnCross(W * (0.3 + Math.random() * 0.4), H * (0.3 + Math.random() * 0.4), vel);
  });
}

// ── fx canvas: A.T. fields + cross flares ───────────────────────────────────
const fields = [], crosses = [];
function spawnAT(x, y, k) {
  for (let i = 0; i < 3; i++) fields.push({ x, y, t: -i * 0.085, k, rot: Math.random() * TAU / 6 });
}
function spawnCross(x, y, k) { crosses.push({ x, y, t: 0, k }); }

function hexPath(ctx, x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + i / 6 * TAU;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function drawFx(dt) {
  const W = fxCanvas.clientWidth, H = fxCanvas.clientHeight;
  fxCtx.clearRect(0, 0, W, H);
  const [or_, og, ob] = ORANGE;
  for (let i = fields.length - 1; i >= 0; i--) {
    const f = fields[i]; f.t += dt;
    if (f.t < 0) continue;
    const p = f.t / 0.75;
    if (p >= 1) { fields.splice(i, 1); continue; }
    const r = 36 + p * (220 + 200 * f.k);
    const a = (1 - p) * 0.55 * (0.5 + f.k * 0.5);
    fxCtx.save();
    fxCtx.shadowColor = `rgba(${or_},${og},${ob},${a})`;
    fxCtx.shadowBlur = 14;
    fxCtx.strokeStyle = `rgba(${or_},${og},${ob},${a.toFixed(3)})`;
    fxCtx.lineWidth = 2.5 - p * 1.5;
    hexPath(fxCtx, f.x, f.y, r, f.rot);
    fxCtx.stroke();
    fxCtx.restore();
  }
  for (let i = crosses.length - 1; i >= 0; i--) {
    const c = crosses[i]; c.t += dt;
    const p = c.t / 0.45;
    if (p >= 1) { crosses.splice(i, 1); continue; }
    const a = (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85) * 0.8 * c.k;
    const L = 90 + p * 260, wdt = 2.2;
    fxCtx.save();
    fxCtx.globalCompositeOperation = 'lighter';
    const g1 = fxCtx.createLinearGradient(c.x, c.y - L, c.x, c.y + L);
    g1.addColorStop(0, 'rgba(255,255,255,0)');
    g1.addColorStop(0.5, `rgba(${WHITE.join(',')},${a.toFixed(3)})`);
    g1.addColorStop(1, 'rgba(255,255,255,0)');
    fxCtx.fillStyle = g1;
    fxCtx.fillRect(c.x - wdt, c.y - L, wdt * 2, L * 2);
    const g2 = fxCtx.createLinearGradient(c.x - L, c.y, c.x + L, c.y);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(0.5, `rgba(${WHITE.join(',')},${(a * 0.9).toFixed(3)})`);
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    fxCtx.fillStyle = g2;
    fxCtx.fillRect(c.x - L, c.y - wdt, L * 2, wdt * 2);
    fxCtx.restore();
  }
}

// ── per-frame: sequence + fx (driven from app.js tick) ──────────────────────
let lastT = 0;
function frame() {
  if (!active || !built) return;
  const now = performance.now();
  let dt = (now - lastT) / 1000; lastT = now;
  if (dt <= 0 || dt > 0.1) dt = 0.016;

  // lock-on sequence
  if (seq.phase) {
    seq.t += dt;
    if (seq.phase === 1) { // warning
      rootEl.classList.toggle('ev-warn-on', (seq.t * 6 | 0) % 2 === 0);
      if (seq.t > 0.62) {
        seq.phase = 2; seq.t = 0;
        rootEl.classList.remove('ev-warn', 'ev-warn-on');
        rootEl.classList.add('ev-locking');
        cardEl.innerHTML = ''; // the lock screen owns the frame now
      }
    } else if (seq.phase === 2) { // hex converge + target typing
      const p = Math.min(1, seq.t / 0.8);
      [1, 2, 3].forEach(i => {
        const hx = rootEl.querySelector('.ev-hex' + i);
        const s = 3.4 - (3.4 - (0.9 + i * 0.16)) * p;
        hx.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)}) rotate(${(p * 60 + i * 17).toFixed(1)}deg)`;
        hx.style.opacity = (p * 0.85).toFixed(2);
      });
      const tt = rootEl.querySelector('.ev-target-text');
      const full = 'TARGET : ' + seq.title + (seq.artist ? ' / ' + seq.artist : '');
      tt.textContent = full.slice(0, Math.ceil((seq.t / 1.0) * full.length)) + (seq.t % 0.3 < 0.15 ? '▌' : '');
      if (seq.t > 1.45) {
        seq.phase = 0;
        rootEl.classList.remove('ev-locking');
        if (pendingLine) { const p2 = pendingLine; pendingLine = null; curText = p2; renderCard(p2); }
        else if (!curText) renderIdleCard();
      }
    }
  }

  drawFx(dt);
}

window.FL_EVA = { start, stop, frame, setLine, setTrack, clear };

})();
