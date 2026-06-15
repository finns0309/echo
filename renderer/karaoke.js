// Karaoke · sing-along lyrics (卡拉OK theme).
//
// The one job a karaoke screen has that no other lyric view does: tell you
// exactly *what to sing right now* and *when to come in*. Everything here
// serves that.
//
//   • the wipe   — each timed unit (a CJK glyph, a latin word) fills left→right
//                  with the accent-bright color in real time. Lines already
//                  sung stay filled above; upcoming lines wait empty below, so
//                  the column itself is a progress bar you read top-to-bottom.
//   • the scroll — Apple-Music-style focus list: the active line rides the
//                  optical center enlarged + sharp, neighbours dim and blur by
//                  distance, so you can read ahead (you can't sing what you
//                  can't see coming).
//   • the count-in — ●●● dots deplete during the instrumental gap before a
//                  line, so you know the beat you come in on. The KTV tell.
//   • the pop    — the unit being sung lifts a hair: the cursor has life.
//
// Sync source: renderer/lrc.js buildKaraoke() — real NetEase yrc (逐字) when
// the song has it, synthetic even-split timing otherwise, so every track gets a
// moving fill. The line model is { time, duration, text, chars:[{time,duration,
// text}], trans? }. We self-drive from a continuous clock: app.js hands us the
// song time each rAF via frame(t); we own the line/unit cursor and the scroll.
//
// Public API: window.FL_KARAOKE = { build, start, stop, frame, setLines, clear }
(function () {

const LEAD_S   = 3.2;   // how long before a line the count-in dots show
const MIN_GAP_S = 2.4;  // only count in across gaps at least this long (skip
                        //   the tiny gaps between back-to-back lines)

let rootEl, stageEl, scrollEl, countEl, dotEls = [];
let built = false, active = false, titleMode = false;
let lines = [];         // [{…, _el, _spans}]
let curLine = -2, curUnit = -2;

function build() {
  rootEl = document.getElementById('karaoke');
  if (!rootEl || built) return;
  built = true;
  rootEl.innerHTML = `
    <div class="kk-stage">
      <div class="kk-scroll"></div>
      <div class="kk-countin"><i></i><i></i><i></i></div>
    </div>`;
  stageEl  = rootEl.querySelector('.kk-stage');
  scrollEl = rootEl.querySelector('.kk-scroll');
  countEl  = rootEl.querySelector('.kk-countin');
  dotEls   = [...countEl.querySelectorAll('i')];
}

function start() {
  build();
  active = true;
  // Force a re-sync on the next frame: the theme may have been handed lyrics
  // (setLines) while hidden, so the cursor/scroll haven't been applied yet.
  curLine = -2;
  curUnit = -2;
  // Activated before any track committed (e.g. karaoke is the saved default and
  // muse isn't up yet) — rest on a ♪ instead of a blank panel.
  if (!lines.length) showTitle('♪');
}
function stop() { active = false; }

// ── Build the scrolling column from a karaoke line list ──────────────────────
function setLines(newLines, np) {
  build();
  lines = Array.isArray(newLines) ? newLines : [];
  curLine = -2;
  curUnit = -2;
  hideCountin();
  scrollEl.innerHTML = '';

  if (!lines.length) { showTitle((np && np.title) || '♪'); return; }
  titleMode = false;

  for (const line of lines) {
    const el = document.createElement('div');
    el.className = 'kk-line';

    const txt = document.createElement('div');
    txt.className = 'kk-text';
    const spans = [];
    for (const c of line.chars) {
      const s = document.createElement('span');
      s.className = 'kk-ch';
      // U+00A0-safe: a lone space unit must survive whitespace-collapse so the
      // word that owns it keeps its trailing gap.
      s.textContent = c.text === ' ' ? ' ' : c.text;
      txt.appendChild(s);
      spans.push(s);
    }
    el.appendChild(txt);

    if (line.trans) {
      const tr = document.createElement('div');
      tr.className = 'kk-trans';
      tr.textContent = line.trans;
      el.appendChild(tr);
    }

    line._el = el;
    line._spans = spans;
    scrollEl.appendChild(el);
  }
}

// Idle / instrumental: one resting line at the center (title, or ♪ when the
// player stops). No fill, no count-in.
function showTitle(text) {
  titleMode = true;
  scrollEl.innerHTML = '';
  hideCountin();
  const el = document.createElement('div');
  el.className = 'kk-line kk-title active';
  el.textContent = text;
  scrollEl.appendChild(el);
  requestAnimationFrame(() => centerOn(el));
}

function clear() {
  if (!built) return;
  lines = [];
  curLine = -2;
  curUnit = -2;
  showTitle('♪');
}

// ── Per-frame: advance the cursor, paint the fill, scroll, count in ──────────
function setP(span, v) { span.style.setProperty('--p', v.toFixed(3)); }

function centerOn(el) {
  if (!el || !stageEl) return;
  const mid = el.offsetTop + el.offsetHeight / 2;
  scrollEl.style.transform = `translateY(${(stageEl.clientHeight / 2 - mid).toFixed(1)}px)`;
}

// Line changed: restyle the whole column by distance, set each line's fill to
// its resting state (past = full, future = empty; the active line is driven
// live by frame), and scroll the active line to center.
function setActiveLine(i) {
  for (let k = 0; k < lines.length; k++) {
    const L = lines[k], el = L._el;
    if (!el) continue;
    const d = Math.abs(k - i);
    if (k === i) {
      el.classList.add('active');
      el.style.opacity = '1';
      el.style.filter = '';                 // let CSS .active glow take over
    } else {
      el.classList.remove('active');
      el.style.opacity = Math.max(0.2, 0.66 - d * 0.13).toFixed(3);
      el.style.filter = `blur(${Math.min(d * 0.55, 2.2).toFixed(2)}px)`;
    }
    const fill = k < i ? 1 : 0;             // sung lines stay lit above
    for (const s of L._spans) { setP(s, fill); s.classList.remove('now'); }
  }
  // During the intro (no active line yet) hold the first line ready at center.
  centerOn(i >= 0 ? lines[i]._el : lines[0] && lines[0]._el);
}

function frame(t) {
  if (!active || !built || titleMode || !lines.length) return;

  const i = LRC.findIndex(lines, t);
  if (i !== curLine) { setActiveLine(i); curLine = i; curUnit = -2; }

  updateCountin(t, i);
  if (i < 0) return;                        // still in the intro; nothing lit

  const line = lines[i], spans = line._spans;
  const ci = LRC.findCharIndex(line, t);    // -1 before the first unit

  if (ci !== curUnit) {
    for (let k = 0; k < spans.length; k++) {
      if (k < ci) setP(spans[k], 1);
      else if (k > ci) setP(spans[k], 0);
    }
    if (curUnit >= 0 && spans[curUnit]) spans[curUnit].classList.remove('now');
    if (ci >= 0 && spans[ci]) spans[ci].classList.add('now');
    curUnit = ci;
  }

  // The live edge: fill the current unit by how far into its duration we are.
  if (ci >= 0 && ci < spans.length) {
    const c = line.chars[ci];
    const f = c.duration > 0 ? Math.min(1, Math.max(0, (t - c.time) / c.duration)) : 1;
    setP(spans[ci], f);
  }
}

// When the current line's singing actually ends — last unit's end, or the
// line's own duration, falling back to its start. The real instrumental gap is
// measured from here, not from the line's *start* (which would count the line's
// own singing time as silence and fire the count-in mid-line).
function lineEnd(line) {
  if (!line) return 0;
  const c = line.chars;
  if (c && c.length) { const last = c[c.length - 1]; return last.time + (last.duration || 0); }
  return line.time + (line.duration || 0);
}

// ── Count-in: deplete the dots across the instrumental gap before a line ─────
function updateCountin(t, i) {
  const next = lines[i + 1];
  if (!next) { hideCountin(); return; }
  const gap  = next.time - (i >= 0 ? lineEnd(lines[i]) : 0);  // true silence
  const lead = next.time - t;
  if (lead > 0 && lead <= LEAD_S && gap >= MIN_GAP_S) {
    countEl.classList.add('show');
    const lit = Math.ceil((lead / LEAD_S) * dotEls.length);  // 3 → 0
    dotEls.forEach((d, k) => d.classList.toggle('on', k < lit));
  } else {
    hideCountin();
  }
}
function hideCountin() { if (countEl) countEl.classList.remove('show'); }

// Diagnostics — open DevTools, type `__karaoke` (same convention as __furin).
window.__karaoke = {
  get active()  { return active; },
  get count()   { return lines.length; },
  get line()    { return curLine; },
  get unit()    { return curUnit; },
  get verbatim(){ return lines.some((l) => l.chars && l.chars.length > [...l.text].length * 0.4 && l.chars.length > 1); },
};

window.FL_KARAOKE = { build, start, stop, frame, setLines, clear };

})();
