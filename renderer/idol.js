// Idol · the star in the eye (星瞳 theme).
//
// Case study in Oshi no Ko's visual grammar:
//   the six-point star      Ai's pupil — purple→pink gradient ★. Here it
//                           crowns one character of every lyric line, and
//                           onsets burst star glints across the stage
//   bright/dark duality     the star is both brilliance and the lie. The
//                           whole stage runs on one continuous energy value:
//                           a surging chorus = spotlights + synced penlight
//                           sea + falling sparkle; a quiet verse = the
//                           backstage version of the same frame
//   the idol stage          a penlight ocean at the bottom of the screen.
//                           crowd sync is literal: low energy = lazy
//                           individual sway, high energy = phase-locked waves
//   ghost light             when nothing plays, the stage goes dark except
//                           one bare warm bulb on a stand — the theatre
//                           tradition. the idle ornament is an empty venue
//
// Fifth consumer of FL_AUDIO: rms → stage energy (the duality axis),
// onsets → star glints, track change → a penlight wave rolls across the sea.
//
// Public API: window.FL_IDOL = { start, stop, frame, setLine, setTrack, clear }
(function () {

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

const PINK   = [255, 95, 162];
const PURPLE = [176, 124, 255];
const CYAN   = [79, 216, 255];
const WHITE  = [255, 240, 250];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

let active = false, built = false;
let rootEl, cv, ctx, lyricEl;
let W = 0, H = 0;

function hash(s) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.codePointAt(0)) >>> 0; return h; }

// ── build ────────────────────────────────────────────────────────────────────
let sticks = [];
function build() {
  rootEl = document.getElementById('idol');
  if (!rootEl || built) return;
  built = true;
  rootEl.innerHTML = `<canvas class="id-cv"></canvas><div class="id-lyric"></div>`;
  cv = rootEl.querySelector('.id-cv');
  ctx = cv.getContext('2d');
  lyricEl = rootEl.querySelector('.id-lyric');
  // penlight sea: 4 rows, far → near
  sticks = [];
  const ROWS = [
    { n: 34, y: 0.795, len: 11, alpha: 0.35 },
    { n: 28, y: 0.845, len: 15, alpha: 0.5 },
    { n: 22, y: 0.9,   len: 20, alpha: 0.7 },
    { n: 16, y: 0.955, len: 26, alpha: 0.9 },
  ];
  ROWS.forEach((row, ri) => {
    for (let i = 0; i < row.n; i++) {
      const colorPick = Math.random();
      sticks.push({
        fx: (i + 0.5) / row.n + rnd(-0.012, 0.012),
        fy: row.y, len: row.len * rnd(0.9, 1.1), alpha: row.alpha,
        c: colorPick < 0.42 ? PINK : colorPick < 0.72 ? CYAN : colorPick < 0.92 ? PURPLE : WHITE,
        ph: rnd(0, TAU), fq: rnd(0.7, 1.3), row: ri,
      });
    }
  });
  fit();
  window.addEventListener('resize', fit);
}
function fit() {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function start() { build(); active = true; lastT = performance.now(); }
function stop() { active = false; }

// ── the star (six-point, purple→pink) ───────────────────────────────────────
function drawStar(c2, x, y, R, rot, alpha) {
  const r = R * 0.42;
  c2.save();
  c2.translate(x, y); c2.rotate(rot);
  c2.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU - TAU / 4;
    const rr = i % 2 === 0 ? R : r;
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    i ? c2.lineTo(px, py) : c2.moveTo(px, py);
  }
  c2.closePath();
  const g = c2.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, rgba(PURPLE, alpha));
  g.addColorStop(1, rgba(PINK, alpha));
  c2.fillStyle = g;
  c2.shadowColor = rgba(PINK, alpha * 0.9);
  c2.shadowBlur = R * 0.8;
  c2.fill();
  // white core
  c2.shadowBlur = 0;
  c2.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU - TAU / 4;
    const rr = (i % 2 === 0 ? R : r) * 0.38;
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    i ? c2.lineTo(px, py) : c2.moveTo(px, py);
  }
  c2.closePath();
  c2.fillStyle = `rgba(255,255,255,${(alpha * 0.9).toFixed(3)})`;
  c2.fill();
  c2.restore();
}

// ── lyric: rounded heavy type, one character crowned with the star ─────────
let curText = '';
function setLine(line) {
  if (!built) return;
  const text = ((line && line.text) || '').trim();
  if (!text || text === curText) return;
  curText = text;
  const h = hash(text);
  // the eye-star crowns the LAST character of a real keyword (latin: a whole
  // word; CJK: a particle-free 2-char window — see textpick.js)
  const kw = FL_TEXT.pickKeyword(text);
  const star = kw.start + kw.len - 1;
  lyricEl.innerHTML = '';

  const makeCh = (ch, i) => {
    const s = document.createElement('span');
    s.className = 'id-ch' + (i === star ? ' id-star-ch' : '');
    s.style.setProperty('--d', (i * 36) + 'ms');
    s.textContent = ch;
    if (i === star) {
      const star8 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      star8.setAttribute('class', 'id-crown');
      star8.setAttribute('viewBox', '-10 -10 20 20');
      star8.innerHTML = `<defs><linearGradient id="idg${h % 997}" x1="0" y1="-1" x2="0" y2="1">
          <stop offset="0" stop-color="#b07cff"/><stop offset="1" stop-color="#ff5fa2"/>
        </linearGradient></defs>
        <path d="M 0 -9 L 2.2 -3 L 8 -4.5 L 3.6 0 L 8 4.5 L 2.2 3 L 0 9 L -2.2 3 L -8 4.5 L -3.6 0 L -8 -4.5 L -2.2 -3 Z"
              fill="url(#idg${h % 997})"/>`;
      s.appendChild(star8);
    }
    return s;
  };

  // latin words stay whole (nowrap word wrappers); spaces are plain text
  // nodes so lines can still break between words.
  for (const t of FL_TEXT.tokenize(text)) {
    if (t.type === 'space') {
      lyricEl.appendChild(document.createTextNode(' '));
    } else if (t.type === 'word') {
      const w = document.createElement('span');
      w.className = 'id-word';
      [...t.text].forEach((ch, j) => w.appendChild(makeCh(ch, t.start + j)));
      lyricEl.appendChild(w);
    } else {
      lyricEl.appendChild(makeCh(t.text, t.start));
    }
  }
}
function clear() {
  if (!built) return;
  curText = '';
  if (lyricEl) lyricEl.innerHTML = '';
}

// ── track change: a wave rolls across the penlight sea ─────────────────────
let wave = -1;
function setTrack() { if (active) wave = 0; }

// ── audio ────────────────────────────────────────────────────────────────────
let energy = 0, hasSignal = false;
const glints = [], rain = [];
if (window.FL_AUDIO?.onOnset) {
  window.FL_AUDIO.onOnset((vel) => {
    if (!active) return;
    glints.push({
      x: rnd(0.1, 0.9), y: rnd(0.08, 0.55), t: 0,
      R: (8 + vel * 26) * (vel > 0.88 ? 1.8 : 1),
      rot: rnd(0, TAU), big: vel > 0.88,
    });
  });
}

// ── render ───────────────────────────────────────────────────────────────────
let lastT = 0, wall = 0;
function frame() {
  if (!active || !built || !W) return;
  const now = performance.now();
  let dt = (now - lastT) / 1000; lastT = now;
  if (dt <= 0 || dt > 0.1) dt = 0.016;
  wall += dt;

  const frm = window.FL_AUDIO?.getFrame?.();
  hasSignal = !!(frm && Date.now() - (frm.t || 0) < 400);
  const st = typeof state !== 'undefined' ? state : null;
  const playing = st ? st.rate > 0 : false;
  if (hasSignal) energy += (Math.min(1, frm.rms * 3.1) - energy) * Math.min(1, 1.8 * dt);
  else if (playing) energy += (0.45 - energy) * Math.min(1, 0.8 * dt); // no spectrum: mid-stage
  else energy *= Math.pow(0.45, dt);

  const B = energy; // the duality axis, 0 = backstage/dark, 1 = full stage
  rootEl.style.setProperty('--stageB', B.toFixed(3));

  // stage void
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, `rgb(${12 + B * 10},${8 + B * 6},${20 + B * 16})`);
  bg.addColorStop(0.7, `rgb(${18 + B * 14},${10 + B * 8},${30 + B * 20})`);
  bg.addColorStop(1, `rgb(${8 + B * 6},${6 + B * 4},${14 + B * 10})`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const ghost = !playing && B < 0.12;

  if (!ghost) {
    // spotlights: three beams sweeping, brightness rides the energy
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beams = [
      { x: 0.18, base: 0.5, range: 0.5, sp: 0.31, c: PINK },
      { x: 0.5,  base: 0.0, range: 0.42, sp: 0.23, c: WHITE },
      { x: 0.82, base: -0.5, range: 0.5, sp: 0.37, c: CYAN },
    ];
    for (const b of beams) {
      const a = Math.PI / 2 + b.base * 0.5 + Math.sin(wall * b.sp) * b.range * 0.45;
      const x0 = b.x * W, y0 = -H * 0.05;
      const len = H * 1.35, half = 0.085;
      const g = ctx.createLinearGradient(x0, y0, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
      g.addColorStop(0, rgba(b.c, 0.20 * B));
      g.addColorStop(1, rgba(b.c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(a - half) * len, y0 + Math.sin(a - half) * len);
      ctx.lineTo(x0 + Math.cos(a + half) * len, y0 + Math.sin(a + half) * len);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // sparkle rain at high energy
    if (B > 0.55 && Math.random() < (B - 0.5) * dt * 22) {
      rain.push({ x: Math.random(), y: -0.04, v: rnd(0.1, 0.2), r: rnd(1, 2.4), c: Math.random() < 0.5 ? PINK : Math.random() < 0.5 ? CYAN : WHITE });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = rain.length - 1; i >= 0; i--) {
      const p = rain[i];
      p.y += p.v * dt; p.x += Math.sin(wall * 2 + p.y * 30) * 0.01 * dt;
      if (p.y > 0.8) { rain.splice(i, 1); continue; }
      ctx.fillStyle = rgba(p.c, 0.5);
      ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r, 0, TAU); ctx.fill();
    }

    // the penlight sea: lock = how synced the crowd is
    const lock = Math.max(0, Math.min(1, (B - 0.22) / 0.5));
    const commonA = Math.sin(wall * 1.9);
    if (wave >= 0) wave += dt * 1.4;
    for (const s of sticks) {
      const own = Math.sin(wall * s.fq + s.ph);
      const ang = (own * (1 - lock) + commonA * lock) * (0.28 + B * 0.5);
      const x = s.fx * W, y = s.fy * H;
      const L = s.len * (W / 1440 + 0.45);
      const tx = x + Math.sin(ang) * L, ty = y - Math.cos(ang) * L;
      let glow = s.alpha * (0.2 + B * 0.85);
      // track-change wave rolls left → right and briefly over-lights each stick
      if (wave >= 0 && wave < 2) {
        const d = Math.abs(s.fx - wave / 1.6);
        if (d < 0.08) glow = Math.min(1.3, glow + (1 - d / 0.08) * 0.9);
      }
      ctx.strokeStyle = rgba(s.c, Math.min(1, glow));
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      const tip = ctx.createRadialGradient(tx, ty, 0, tx, ty, 7);
      tip.addColorStop(0, rgba(s.c, Math.min(1, glow)));
      tip.addColorStop(1, rgba(s.c, 0));
      ctx.fillStyle = tip;
      ctx.beginPath(); ctx.arc(tx, ty, 7, 0, TAU); ctx.fill();
    }
    if (wave > 2.2) wave = -1;
    ctx.restore();
  } else {
    // ghost light: the empty venue keeps one warm bulb lit
    ctx.save();
    const bx = W * 0.5, by = H * 0.6;
    ctx.strokeStyle = 'rgba(120,108,96,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by + 8); ctx.lineTo(bx, H * 0.86); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - 26, H * 0.865); ctx.lineTo(bx + 26, H * 0.865); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(bx, by, 0, bx, by, H * 0.22);
    halo.addColorStop(0, 'rgba(255,214,160,0.34)');
    halo.addColorStop(0.3, 'rgba(255,200,140,0.12)');
    halo.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(bx, by, H * 0.22, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,232,190,0.96)';
    ctx.beginPath(); ctx.arc(bx, by, 5.5, 0, TAU); ctx.fill();
    // floor pool
    const pool = ctx.createRadialGradient(bx, H * 0.875, 0, bx, H * 0.875, W * 0.13);
    pool.addColorStop(0, 'rgba(255,214,160,0.10)');
    pool.addColorStop(1, 'rgba(255,214,160,0)');
    ctx.fillStyle = pool;
    ctx.beginPath(); ctx.ellipse(bx, H * 0.875, W * 0.13, H * 0.035, 0, 0, TAU); ctx.fill();
    // two dust motes circling in the glow
    for (let i = 0; i < 2; i++) {
      const a = wall * (0.3 + i * 0.17) + i * 2.7;
      ctx.fillStyle = 'rgba(255,230,190,0.5)';
      ctx.beginPath();
      ctx.arc(bx + Math.cos(a) * (26 + i * 18), by + Math.sin(a * 1.3) * (16 + i * 10), 1.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // star glints (drawn above everything — the eye-star burst)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = glints.length - 1; i >= 0; i--) {
    const g = glints[i]; g.t += dt;
    const life = g.big ? 0.8 : 0.55;
    const p = g.t / life;
    if (p >= 1) { glints.splice(i, 1); continue; }
    const k = Math.sin(p * Math.PI);
    drawStar(ctx, g.x * W, g.y * H, g.R * (0.6 + p * 0.7), g.rot + p * 0.7, k * 0.9);
    if (g.big) {
      ctx.strokeStyle = rgba(PINK, (1 - p) * 0.4);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(g.x * W, g.y * H, g.R * (1 + p * 2.4), 0, TAU); ctx.stroke();
    }
  }
  ctx.restore();
}

window.FL_IDOL = { start, stop, frame, setLine, setTrack, clear };

})();
