// Shinkai · the sky as protagonist (云隙 theme).
//
// Case study in Makoto Shinkai's visual grammar:
//   light is the subject     sun/moon with bloom, anamorphic streak, slow
//                            crepuscular rays (云隙光), air full of lit dust
//   the sky takes 2/3        lyrics live in the bottom third, small and lit
//   impossible-but-natural   a time-of-day palette system keyed to the REAL
//   gradients                clock — dawn / day / magic hour / dusk / night
//   silhouettes cut the sky  telephone pole + sagging wires, perched birds
//   everything is slow       the anti-eva: long eases, drifting clouds,
//                            nothing snaps
//
// The sky lives on wall-clock time even with no song (the ultimate idle
// ornament — it's a window, not a player). Audio enriches: rms stirs the
// air a little; a hard onset by day glints the sun, by night it earns a
// shooting star (君の名は moment, rare on purpose).
//
// Fourth consumer of FL_AUDIO. Debug: window.__FL_HOUR overrides the clock.
//
// Public API: window.FL_SHINKAI = { start, stop, frame, setLine, clear }
(function () {

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

let active = false, built = false;
let rootEl, cv, ctx, lyricEl, birdsEl;
let W = 0, H = 0;

// ── time-of-day palette keyframes ───────────────────────────────────────────
// [hour, {top, mid, hor, sun, halo, cloudHi, cloudLo, star, ray, warm}]
const KEYS = [
  [0.0,  { top: [8, 14, 38],    mid: [14, 24, 60],   hor: [30, 42, 82],    sun: [232, 238, 255], halo: [180, 200, 255], cloudHi: [60, 72, 110],  cloudLo: [26, 32, 58],   star: 1.0, ray: 0.00, warm: 0 }],
  [4.7,  { top: [12, 18, 48],   mid: [30, 36, 78],   hor: [88, 70, 110],   sun: [240, 242, 255], halo: [190, 205, 255], cloudHi: [88, 86, 128],  cloudLo: [36, 38, 70],   star: 0.7, ray: 0.00, warm: 0 }],
  [5.8,  { top: [36, 52, 110],  mid: [120, 100, 150],hor: [255, 170, 120], sun: [255, 214, 160], halo: [255, 178, 120], cloudHi: [255, 196, 160],cloudLo: [110, 90, 130], star: 0.15,ray: 0.05, warm: 0.7 }],
  [7.5,  { top: [62, 122, 200], mid: [120, 170, 226],hor: [222, 234, 246], sun: [255, 244, 214], halo: [255, 230, 180], cloudHi: [255, 252, 248],cloudLo: [150, 172, 205],star: 0,   ray: 0.035,warm: 0.25 }],
  [12.0, { top: [52, 112, 208], mid: [108, 164, 228],hor: [205, 228, 244], sun: [255, 252, 240], halo: [255, 244, 210], cloudHi: [255, 255, 255],cloudLo: [148, 170, 204],star: 0,   ray: 0.03, warm: 0.1 }],
  [16.5, { top: [56, 88, 158],  mid: [150, 130, 170],hor: [255, 188, 120], sun: [255, 226, 160], halo: [255, 196, 120], cloudHi: [255, 224, 180],cloudLo: [130, 110, 140],star: 0,   ray: 0.06, warm: 0.8 }],
  [18.4, { top: [34, 44, 98],   mid: [128, 84, 124], hor: [255, 142, 88],  sun: [255, 196, 120], halo: [255, 150, 90], cloudHi: [255, 170, 130],cloudLo: [84, 64, 104],  star: 0.1, ray: 0.07, warm: 1.0 }],
  [19.6, { top: [16, 24, 64],   mid: [52, 44, 96],   hor: [150, 84, 96],   sun: [255, 190, 130], halo: [230, 150, 110],cloudHi: [120, 96, 130], cloudLo: [40, 38, 72],   star: 0.5, ray: 0.02, warm: 0.6 }],
  [21.5, { top: [9, 15, 42],    mid: [16, 26, 64],   hor: [34, 46, 88],    sun: [235, 240, 255], halo: [185, 205, 255],cloudHi: [66, 78, 116],  cloudLo: [28, 34, 60],   star: 1.0, ray: 0.00, warm: 0 }],
  [24.0, { top: [8, 14, 38],    mid: [14, 24, 60],   hor: [30, 42, 82],    sun: [232, 238, 255], halo: [180, 200, 255],cloudHi: [60, 72, 110],  cloudLo: [26, 32, 58],   star: 1.0, ray: 0.00, warm: 0 }],
];
function paletteAt(h) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
  const k = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  const out = {};
  for (const key of Object.keys(a)) {
    out[key] = Array.isArray(a[key]) ? lerp3(a[key], b[key], k) : lerp(a[key], b[key], k);
  }
  return out;
}
function nowHour() {
  if (typeof window.__FL_HOUR === 'number') return window.__FL_HOUR;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

// ── scene state ──────────────────────────────────────────────────────────────
const STARS = Array.from({ length: 110 }, () => ({
  x: Math.random(), y: Math.random() * 0.72, r: rnd(0.4, 1.4), ph: rnd(0, TAU), fq: rnd(0.3, 1.4)
}));
const DUST = Array.from({ length: 26 }, () => ({
  x: Math.random(), y: Math.random(), z: rnd(0.3, 1), ph: rnd(0, TAU), fq: rnd(0.4, 1.2)
}));
let clouds = [];           // {sprite, tinted, x, y, s, v}
let paletteBucket = -1;    // re-tint clouds only when the light truly changes
let meteors = [], glints = [];
let contrail = null;
let energy = 0;

function bakeCloud(seed) {
  const w = 460, h = 230;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  let s = seed;
  const rr = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const puffs = 16 + (seed % 6);
  for (let i = 0; i < puffs; i++) {
    const px = w * (0.16 + rr() * 0.68);
    const py = h * (0.74 - rr() * rr() * 0.52);
    const pr = (h * 0.16) * (0.55 + rr() * 0.85) * (1 - Math.abs(px / w - 0.5));
    const g = x.createRadialGradient(px, py, 0, px, py, pr * 2.1);
    g.addColorStop(0, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, pr * 2.1, 0, TAU); x.fill();
  }
  return c;
}
function tintCloud(sprite, hi, lo) {
  const c = document.createElement('canvas');
  c.width = sprite.width; c.height = sprite.height;
  const x = c.getContext('2d');
  x.drawImage(sprite, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  const g = x.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, rgb(hi, 1));
  g.addColorStop(1, rgb(lo, 1));
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

// ── DOM build ────────────────────────────────────────────────────────────────
function build() {
  rootEl = document.getElementById('shinkai');
  if (!rootEl || built) return;
  built = true;
  rootEl.innerHTML = `
    <canvas class="sk-cv"></canvas>
    <svg class="sk-wires" preserveAspectRatio="none" viewBox="0 0 1000 1000">
      <path d="M -10 868 Q 250 902 520 880 T 1010 856" fill="none"/>
      <path d="M -10 900 Q 260 938 530 914 T 1010 886" fill="none"/>
      <g class="sk-pole">
        <rect x="836" y="700" width="9" height="310"/>
        <rect x="788" y="742" width="104" height="7"/>
        <rect x="800" y="772" width="80" height="6"/>
        <line x1="794" y1="742" x2="806" y2="772"/>
        <line x1="886" y1="742" x2="872" y2="772"/>
      </g>
      <g class="sk-birds"></g>
    </svg>
    <div class="sk-lyric"></div>`;
  cv = rootEl.querySelector('.sk-cv');
  ctx = cv.getContext('2d');
  lyricEl = rootEl.querySelector('.sk-lyric');
  birdsEl = rootEl.querySelector('.sk-birds');
  clouds = Array.from({ length: 6 }, (_, i) => ({
    sprite: bakeCloud(37 + i * 101),
    tinted: null,
    x: Math.random(), y: 0.1 + i * 0.085 + rnd(-0.02, 0.02),
    s: i < 2 ? rnd(1.1, 1.5) : i < 4 ? rnd(0.7, 0.95) : rnd(0.4, 0.55),
    v: (i < 2 ? 1 : i < 4 ? 0.6 : 0.35) * rnd(0.8, 1.2),
  }));
  spawnBirds();
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

// birds sit on the upper wire; a hard onset sends one off
const BIRD_D = 'M 0 0 q 6 -7 13 -2 q 5 -4 11 -1 q -4 5 -11 5 q -6 4 -13 -2 Z';
let birds = [];
function spawnBirds() {
  birdsEl.innerHTML = '';
  birds = [0.22, 0.34, 0.62].map(fx => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    g.setAttribute('d', BIRD_D);
    birdsEl.appendChild(g);
    return { el: g, fx, flying: 0, fy: 0 };
  });
}
function wireYat(fx) { // approximate the upper wire's y in viewBox units
  const t = fx;
  const a = 868, b = 902, c2 = 880, d = 856;
  // crude two-segment quadratic sample
  return t < 0.52 ? lerp(lerp(a, b, t / 0.52), lerp(b, c2, t / 0.52), t / 0.52) - 8
                  : lerp(lerp(c2, (c2 + d) / 2, (t - 0.52) / 0.48), lerp((c2 + d) / 2, d, (t - 0.52) / 0.48), (t - 0.52) / 0.48) - 8;
}

function start() { build(); active = true; lastT = performance.now(); lyricEl.textContent = ''; }
function stop() { active = false; }

// ── lyrics: soft, lower third, backlit ──────────────────────────────────────
let curText = '';
function setLine(line) {
  if (!built) return;
  const text = ((line && line.text) || '').trim();
  if (!text || text === curText) return;
  curText = text;
  lyricEl.classList.remove('show');
  setTimeout(() => {
    lyricEl.textContent = text;
    lyricEl.classList.add('show');
  }, 240);
}
function clear() {
  if (!built) return;
  curText = '';
  lyricEl.classList.remove('show');
}

// ── audio: the air notices the music ────────────────────────────────────────
if (window.FL_AUDIO?.onOnset) {
  window.FL_AUDIO.onOnset((vel) => {
    if (!active) return;
    const pal = paletteAt(nowHour());
    if (pal.star > 0.5 && vel > 0.85) {
      // night: a shooting star, from the upper sky
      meteors.push({ x: rnd(0.15, 0.8), y: rnd(0.06, 0.3), a: rnd(0.5, 0.9), v: rnd(0.55, 0.8), t: 0 });
    } else if (vel > 0.6) {
      glints.push({ x: rnd(0.2, 0.8), y: rnd(0.15, 0.6), t: 0, k: vel });
      if (vel > 0.9 && birds.length) {
        const b = birds.find(b => !b.flying);
        if (b) { b.flying = 1; b.fy = 0; }
      }
    }
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

  const fr = window.FL_AUDIO?.getFrame?.();
  if (fr && typeof fr.rms === 'number' && Date.now() - (fr.t || 0) < 300) {
    energy += (Math.min(1, fr.rms * 3) - energy) * Math.min(1, 1.5 * dt);
  } else energy *= Math.pow(0.6, dt);

  const h = nowHour();
  const pal = paletteAt(h);

  // sky
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(pal.top));
  g.addColorStop(0.55, rgb(pal.mid));
  g.addColorStop(1, rgb(pal.hor));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // stars
  if (pal.star > 0.02) {
    for (const s of STARS) {
      const tw = 0.45 + 0.55 * Math.sin(wall * s.fq + s.ph);
      ctx.fillStyle = `rgba(235,240,255,${(pal.star * tw * 0.85).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, TAU); ctx.fill();
    }
  }

  // sun / moon position
  const isDay = h > 5.4 && h < 19.9;
  const df = isDay ? (h - 5.4) / 14.5 : ((h + 24 - 19.9) % 24) / 9.5;
  const sx = lerp(0.12, 0.88, df) * W;
  const sy = (0.74 - 0.5 * Math.sin(df * Math.PI)) * H;

  // crepuscular rays (slow rotation, additive)
  if (pal.ray > 0.004) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const a = wall * 0.012 + i * TAU / 7;
      const len = H * 1.1;
      const w0 = 0.05 + 0.02 * Math.sin(i * 2.3);
      const grd = ctx.createLinearGradient(sx, sy, sx + Math.cos(a) * len, sy + Math.sin(a) * len);
      grd.addColorStop(0, rgb(pal.halo, pal.ray * (1 + energy * 0.5)));
      grd.addColorStop(1, rgb(pal.halo, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a - w0) * len, sy + Math.sin(a - w0) * len);
      ctx.lineTo(sx + Math.cos(a + w0) * len, sy + Math.sin(a + w0) * len);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // bloom + disc + anamorphic streak
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.42);
  halo.addColorStop(0, rgb(pal.halo, 0.5));
  halo.addColorStop(0.25, rgb(pal.halo, 0.16));
  halo.addColorStop(1, rgb(pal.halo, 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(sx, sy, H * 0.42, 0, TAU); ctx.fill();
  const disc = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.045);
  disc.addColorStop(0, rgb(pal.sun, 0.95));
  disc.addColorStop(0.7, rgb(pal.sun, 0.5));
  disc.addColorStop(1, rgb(pal.sun, 0));
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(sx, sy, H * 0.045, 0, TAU); ctx.fill();
  const streakW = W * (0.22 + pal.warm * 0.16);
  const st = ctx.createLinearGradient(sx - streakW, sy, sx + streakW, sy);
  st.addColorStop(0, rgb(pal.halo, 0));
  st.addColorStop(0.5, rgb(pal.halo, 0.10 + pal.warm * 0.10));
  st.addColorStop(1, rgb(pal.halo, 0));
  ctx.fillStyle = st;
  ctx.fillRect(sx - streakW, sy - 1.6, streakW * 2, 3.2);
  ctx.restore();

  // clouds (re-tint when the light meaningfully changes)
  const bucket = Math.round(h * 12);
  if (bucket !== paletteBucket) {
    paletteBucket = bucket;
    for (const c of clouds) c.tinted = tintCloud(c.sprite, pal.cloudHi, pal.cloudLo);
  }
  for (const c of clouds) {
    c.x += c.v * (0.0024 + energy * 0.0018) * dt;
    if (c.x > 1.25) c.x = -0.3;
    const cw = 460 * c.s * (W / 1440), ch = 230 * c.s * (W / 1440);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(c.tinted, c.x * W - cw / 2, c.y * H - ch / 2, cw, ch);
    ctx.globalAlpha = 1;
  }

  // contrail: a rare, slow diagonal across the day sky
  if (!contrail && isDay && Math.random() < dt / 160) {
    contrail = { p: 0, y0: rnd(0.12, 0.3), y1: rnd(0.16, 0.36), dir: Math.random() < 0.5 ? 1 : -1 };
  }
  if (contrail) {
    contrail.p += dt / 26;
    const cp = contrail;
    const x0 = cp.dir > 0 ? -0.05 : 1.05;
    const x1 = cp.dir > 0 ? 1.05 : -0.05;
    const px = lerp(x0, x1, Math.min(1, cp.p));
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0 * W, cp.y0 * H);
    ctx.lineTo(px * W, lerp(cp.y0, cp.y1, Math.min(1, cp.p)) * H);
    ctx.stroke();
    if (cp.p > 1.35) contrail = null;
  }

  // air dust, lit by the scene
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const d of DUST) {
    d.x += (0.004 + d.z * 0.008 + energy * 0.01) * dt;
    d.y -= (0.002 + d.z * 0.004) * dt;
    if (d.x > 1.03) d.x = -0.03;
    if (d.y < -0.03) d.y = 1.03;
    const tw = 0.5 + 0.5 * Math.sin(wall * d.fq + d.ph);
    const r = 0.8 + d.z * 2.6;
    ctx.fillStyle = rgb(pal.sun, (0.05 + tw * 0.16) * (0.4 + d.z * 0.6));
    ctx.beginPath(); ctx.arc(d.x * W, d.y * H, r, 0, TAU); ctx.fill();
  }
  // onset glints: tiny cross sparkles in the air
  for (let i = glints.length - 1; i >= 0; i--) {
    const gl = glints[i]; gl.t += dt;
    const p = gl.t / 0.6;
    if (p >= 1) { glints.splice(i, 1); continue; }
    const a = Math.sin(p * Math.PI) * 0.7 * gl.k;
    const L = 5 + p * 13;
    const gx = gl.x * W, gy = gl.y * H;
    ctx.strokeStyle = rgb(pal.sun, a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx - L, gy); ctx.lineTo(gx + L, gy);
    ctx.moveTo(gx, gy - L); ctx.lineTo(gx, gy + L);
    ctx.stroke();
  }
  // meteors
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i]; m.t += dt;
    const p = m.t / 0.9;
    if (p >= 1) { meteors.splice(i, 1); continue; }
    const dx = Math.cos(m.a) * m.v * p, dy = Math.sin(m.a) * m.v * p;
    const hx = (m.x + dx) * W, hy = (m.y + dy) * H;
    const tail = 0.09;
    const tx = (m.x + dx - Math.cos(m.a) * tail) * W, ty = (m.y + dy - Math.sin(m.a) * tail) * H;
    const grd = ctx.createLinearGradient(tx, ty, hx, hy);
    grd.addColorStop(0, 'rgba(235,240,255,0)');
    grd.addColorStop(1, `rgba(235,240,255,${(Math.sin(p * Math.PI) * 0.9).toFixed(2)})`);
    ctx.strokeStyle = grd;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  }
  ctx.restore();

  // birds: perch on the wire, occasionally fly off and circle back
  for (const b of birds) {
    if (b.flying) {
      b.fy += dt;
      const p = b.fy / 6;
      if (p >= 1) { b.flying = 0; b.el.style.opacity = '1'; }
      else {
        const fx = b.fx + p * 0.6, fy2 = -p * 0.5 + 0.06 * Math.sin(p * 9);
        b.el.setAttribute('transform', `translate(${(fx * 1000).toFixed(1)} ${(wireYat(b.fx) + fy2 * 1000).toFixed(1)}) scale(${1 - p * 0.5})`);
        b.el.style.opacity = String(1 - p);
      }
    } else {
      const hop = Math.sin(wall * 2.2 + b.fx * 40) > 0.985 ? -3 : 0;
      b.el.setAttribute('transform', `translate(${(b.fx * 1000).toFixed(1)} ${(wireYat(b.fx) + hop).toFixed(1)})`);
    }
  }
}

window.FL_SHINKAI = { start, stop, frame, setLine, clear };

})();
