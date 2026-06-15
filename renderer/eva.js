// Eva · NERV-terminal title cards (新世纪 theme).
//
// The desktop becomes the black void of an anime intertitle: every lyric
// line is slammed on screen as an ultra-bold Mincho title card (the 次回予告
// dialect — huge type, bleed, asymmetry, hard cuts, NO easing) on a bare
// black void — no corner chrome, no readouts, just the type. Track change
// runs a two-beat lock-on: 緊急 warning strobe → 対象識別 card (cover locked
// inside an A.T.-field hexagon) → hard cut to the first lyric card.
//
// Motion discipline (the whole point): cuts are instant, holds are long,
// nothing eases. The theme used to ripple A.T.-field hexagons out of the
// onset stream behind every line; that broke the typographic pressure more
// than it earned, so the void is now still — the type carries the frame.
// (No FL_AUDIO consumer remains; the lock-on is the only choreography.)
//
// Public API: window.FL_EVA = { start, stop, frame, setLine, setTrack, clear }
(function () {

let active = false, built = false;
let rootEl, cardEl, lockEl, coverImg;

// ── tiny utils ───────────────────────────────────────────────────────────────
function hash(s) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.codePointAt(0)) >>> 0; return h; }
function el(tag, cls, text) { const d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; }

// ── build ────────────────────────────────────────────────────────────────────
function build() {
  rootEl = document.getElementById('eva');
  if (!rootEl || built) return;
  built = true;
  rootEl.innerHTML = `
    <div class="ev-scan"></div>
    <div class="ev-card"></div>
    <div class="ev-stripes ev-stripes-top"></div>
    <div class="ev-stripes ev-stripes-bot"></div>
    <div class="ev-lock">
      <div class="ev-lock-label">対象識別 ── TARGET</div>
      <div class="ev-lock-frame">
        <span class="ev-hexring"></span>
        <img class="ev-cover" alt="">
      </div>
      <div class="ev-lock-title"></div>
      <div class="ev-lock-artist"></div>
    </div>
    <div class="ev-flash"></div>`;
  cardEl = rootEl.querySelector('.ev-card');
  lockEl = rootEl.querySelector('.ev-lock');
  coverImg = rootEl.querySelector('.ev-cover');
}

function start() {
  build();
  active = true;
  lastT = performance.now();
  renderIdleCard();
}
function stop() { active = false; }

// ── title-card typography ────────────────────────────────────────────────────
// Templates, deterministic per text (hash) so a repeated chorus slams in
// identically. Short lines route to the fill-the-frame layouts (giant /
// bleed / vert) so the void never reads as a half-empty slide; the white
// invert card arrives on a fixed cadence. Rows are built from FL_TEXT tokens
// so latin words never split across rows; idx maps each span to its codepoint
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
  const d = el('div', 'ev-row');
  for (const p of pairs) {
    const s = document.createElement('span');
    s.dataset.idx = p.idx;
    s.textContent = p.ch === ' ' ? ' ' : p.ch; // NBSP survives whitespace collapse
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

// length + script → the template that fills the frame for this line
function pickTpl(text, n, latinish, h) {
  // NB: >>> (unsigned) — a signed >> on a high-bit hash goes negative and
  // indexes off the end of these arrays (silent undefined → fallback stack).
  if (n <= 3)              return (h >>> 3) % 2 ? 'bleed' : 'giant';
  if (!latinish && n <= 6) return ['vert', 'giant', 'bleed'][(h >>> 3) % 3];
  if (n <= 9)              return ['giant', 'box', 'dual', latinish ? 'stack' : 'vert'][(h >>> 4) % 4];
  if (n <= 14)             return ['stack', 'dual', 'box'][(h >>> 5) % 3];
  return (!latinish && (h >>> 6) % 3 === 0) ? 'vert' : 'stack';
}

function renderCard(text) {
  const W = rootEl.clientWidth || 1440, H = rootEl.clientHeight || 900;
  const chars = [...text];
  const n = chars.length;
  const h = hash(text);
  const kw = FL_TEXT.pickKeyword(text);          // a real word, not 「了早」
  const latinish = FL_TEXT.latinRatio(text) > 0.34;
  const invert = h % 7 === 0;                    // the white "AIR" card
  const tpl = pickTpl(text, n, latinish, h);

  cardEl.className = 'ev-card ev-tpl-' + tpl + (invert ? ' ev-invert' : '');
  cardEl.innerHTML = '';

  if (tpl === 'vert') {
    // upright Mincho column(s), right-to-left — the 次回予告 spine.
    const v = el('div', 'ev-vert');
    [...text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.dataset.idx = i;
      s.textContent = ch === ' ' ? ' ' : ch;
      v.appendChild(s);
    });
    // size each column to sit inside the 88% max-height so wrapping is clean
    const cols = n <= 7 ? 1 : n <= 14 ? 2 : 3;
    const fs = Math.min(178, Math.max(60, (H * 0.80) / Math.ceil(n / cols)));
    v.style.fontSize = fs + 'px';
    cardEl.appendChild(v);
    markRed(v, kw);

  } else if (tpl === 'giant') {
    // one keyword huge on the left, the full line small bottom-right
    const key = chars.slice(kw.start, kw.start + kw.len).join('');
    const g = el('div', 'ev-giant', key);
    const perEm = FL_TEXT.latinRatio(key) > 0.5 ? 0.58 : 1.0;
    g.style.fontSize = Math.min(H * 0.62, (W * 0.9) / Math.max(1, key.length * perEm)) + 'px';
    cardEl.appendChild(g);
    if (n > kw.len) {                              // skip the echo when the line IS the keyword
      const r = el('div', 'ev-giant-rest');
      r.appendChild(rowDiv(allPairs(text)));
      markRed(r, kw);
      cardEl.appendChild(r);
    }

  } else if (tpl === 'bleed') {
    // a single glyph blown past the top edge — the cropped-kanji shock cut
    const key = chars.slice(kw.start, kw.start + 1).join('') || chars[0];
    const big = el('div', 'ev-bleed-big', key);
    big.style.fontSize = Math.min(H * 1.15, W * 0.62) + 'px';
    cardEl.appendChild(big);
    if (n > 1) {                                   // skip the echo for single-glyph lines
      const rest = el('div', 'ev-bleed-rest');
      rest.appendChild(rowDiv(allPairs(text)));
      markRed(rest, kw);
      cardEl.appendChild(rest);
    }

  } else if (tpl === 'box') {
    // text sealed in a NERV alert rectangle
    const wrap = el('div', 'ev-box');
    const inner = el('div', 'ev-box-text');
    const k = n > 10 ? 2 : 1;
    const rows = splitPairs(text, k);
    const maxLen = Math.max(...rows.map(r => r.length), 1);
    const perEm = latinish ? 0.58 : 1.0;
    inner.style.fontSize = Math.min(96, (W * 0.6) / (maxLen * perEm)) + 'px';
    rows.forEach(r => inner.appendChild(rowDiv(r)));
    wrap.appendChild(inner);
    cardEl.appendChild(wrap);
    markRed(wrap, kw);

  } else if (tpl === 'dual') {
    // diagonal opposition — two blocks thrown to opposite corners
    const rows = splitPairs(text, 2);
    const pa = rows[0], pb = rows[1] || [];
    const a = rowDiv(pa), b = rowDiv(pb);
    a.classList.add('ev-dual-a'); b.classList.add('ev-dual-b');
    const maxLen = Math.max(pa.length, pb.length, 1);
    const perEm = latinish ? 0.58 : 1.0;
    const fs = Math.min(150, (W * (latinish ? 0.82 : 0.56)) / (maxLen * perEm));
    a.style.fontSize = fs + 'px'; b.style.fontSize = fs + 'px';
    cardEl.append(el('span', 'ev-dual-rule'), a);
    if (pb.length) cardEl.appendChild(b);
    markRed(cardEl, kw);

  } else { // stack
    const k = n > 16 ? 3 : n > 7 ? 2 : 1;
    const rows = splitPairs(text, k);
    const maxLen = Math.max(...rows.map(r => r.length));
    const perEm = latinish ? 0.58 : 1.0;
    const fs = Math.min(H * 0.34, Math.max(56, (W * 0.88) / (maxLen * perEm)));
    const wrap = el('div', 'ev-stack');
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
  cardEl.innerHTML = `<div class="ev-idle-v">待機</div>`;
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
}

// Track lock-on sequence state
const seq = { phase: 0, t: 0, title: '', artist: '' };
function setTrack(np) {
  curText = '';
  if (!built || !active) return;   // hidden theme just forgets the old line
  seq.title = np.title || '';
  seq.artist = np.artist || '';
  rootEl.querySelector('.ev-lock-title').textContent = seq.title;
  rootEl.querySelector('.ev-lock-artist').textContent = seq.artist ? '── ' + seq.artist : '';
  if (np.cover) { coverImg.src = np.cover; coverImg.style.display = ''; }
  else coverImg.style.display = 'none';
  seq.phase = 1; seq.t = 0; lastT = performance.now();
  rootEl.classList.add('ev-warn');
  rootEl.classList.remove('ev-locking');
  cardEl.className = 'ev-card ev-tpl-warn';
  cardEl.innerHTML = '<div class="ev-warn-big">緊 急</div><div class="ev-warn-sub">EMERGENCY</div>';
}

function clear() {
  if (!built) return;
  curText = ''; pendingLine = null; seq.phase = 0;
  rootEl.classList.remove('ev-warn', 'ev-warn-on', 'ev-locking');
  renderIdleCard();
}

// ── per-frame: the lock-on sequence is the only thing that moves ─────────────
let lastT = 0;
function frame() {
  if (!active || !built || !seq.phase) return;
  const now = performance.now();
  let dt = (now - lastT) / 1000; lastT = now;
  if (dt <= 0 || dt > 0.1) dt = 0.016;
  seq.t += dt;

  if (seq.phase === 1) {            // 緊急 — hard red strobe
    rootEl.classList.toggle('ev-warn-on', (seq.t * 7 | 0) % 2 === 0);
    if (seq.t > 0.52) {
      seq.phase = 2; seq.t = 0;
      rootEl.classList.remove('ev-warn', 'ev-warn-on');
      rootEl.classList.add('ev-locking');
      cardEl.className = 'ev-card';
      cardEl.innerHTML = '';          // the lock card owns the frame now
    }
  } else if (seq.phase === 2) {     // 対象識別 — static lock card, then hard cut
    if (seq.t > 0.92) {
      seq.phase = 0;
      rootEl.classList.remove('ev-locking');
      if (pendingLine) { const p = pendingLine; pendingLine = null; curText = p; renderCard(p); }
      else if (!curText) renderIdleCard();
    }
  }
}

window.FL_EVA = { start, stop, frame, setLine, setTrack, clear };

})();
