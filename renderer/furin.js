// Fūrin · hanging glass wind-chime (风铃 theme).
//
// A desktop object first, a lyric display second: an Edo-style glass bell
// (江戸風鈴) hangs from the top edge of a narrow transparent window, with
// the lyric brushed vertically on the paper strip (短冊) tied under the
// clapper. A simulated breeze keeps the whole chain swaying when nothing is
// playing, so the widget reads as a living ornament with zero text.
//
// First real consumer of the dormant FL_AUDIO engine:
//   rms      → wind strength   (the song literally is the wind)
//   onset    → gust on the sail (the beat slams the PAPER; the thread tows
//                                the clapper into the rim a beat later —
//                                strikes are the end of the causal chain,
//                                wind → paper → thread → bead → glass)
//   centroid → ring tint       (bright sounds ring whiter, dark ones warmer)
// Strikes stay honest without audio too: any gust or lyric-change puff that
// pumps the paper enough rings the bell — spectrum just makes it rhythmic.
//
// Physics: three damped *spherical* pendulums (cord+bell / clapper / paper)
// nested as DOM 3D transforms. Each link swings on two axes — in-plane
// (rotateZ) and depth (rotateX, sold by the ancestor perspective) — driven
// by one wind vector whose heading slowly wanders, so the chime traces
// ellipses instead of a flat left-right arc. A third axis (rotateY) is the
// twist: the paper strip is a real torsion oscillator (wind turbulence as
// torque, the thread's wind-up as spring); the bell only drifts slowly and
// is read through parallax — the inside-painted motif shifts with the twist
// while the surface highlights counter-shift. The links are coupled
// bottom-up by the thread tow (the paper sail drags the bead) and top-down
// by collision jolts; full pivot-acceleration coupling is still approximated
// by impulses — visually equivalent at these amplitudes, and stable.
//
// Public API: window.FL_FURIN = { build, start, stop, frame, setLine, clear }
(function () {

// ── Geometry (design px; window profile 'hanging' is 300×470) ──────────────
const CORD_LEN   = 138;  // window-top anchor → bell center
const BELL_R     = 54;
const MOUTH_Y    = 180;  // mouth plane (anchor coords)
const MOUTH_HALF = 30;
const CLAP_TOP   = 120;  // clapper thread attach (inside the bell crown)
const CLAP_LEN   = 74;   // attach → bead center; bead hangs clearly below the mouth
const TZ_GAP     = 12;   // bead → paper top
const TZ_W       = 46;
const TZ_H       = 200;

// The clapper stem crosses the rim when its lateral travel at mouth depth
// exceeds the opening minus the bead: asin((34−6.5)/74) ≈ 0.38 rad.
const STRIKE_ANG = 0.38;

// ── Tuning ──────────────────────────────────────────────────────────────────
const G = 2400;                 // px/s² — sets the pendulum tempo (~1.7s bell period)
// Area/mass ratio decides who the wind talks to: the paper is the sail
// (light, huge area), the bead is dense glass the wind barely notices, the
// bell is heavy and only sways. The clapper moves because the paper TOWS it.
const LINKS = {
  bell:  { len: 170, damp: 0.78, windK: 0.18 },
  clap:  { len:  70, damp: 1.10, windK: 0.07 },
  paper: { len: 150, damp: 1.75, windK: 0.85 },
};
// Thread-tension tow (linearized): the paper's deflection/motion relative to
// the bead pulls the bead after it; the bead's inertia answers back. The two
// links have different natural periods (~1.6s vs ~1.1s), so the tow drifts
// in and out of phase — the never-repeating cadence of a real chime.
const TOW_K          = 15.0;   // rad/s² per rad of paper-bead angle gap
const TOW_KV         = 1.5;    // …plus velocity drag along the thread
const TOW_BACK_RATIO = 0.12;   // Newton's-third back-reaction on the paper
const DEPTH_WIND     = 0.78;    // depth-axis share of the wind
const DEPTH_VIEW_GAIN= 1.7;     // render-only exaggeration of the depth tilt — physics
                                //   stays at true angles, the screen lies a little,
                                //   because a face-on depth swing barely projects
const PAPER_PITCH_KEEP = 0.15;  // how much of the chain's depth pitch the paper keeps.
                                //   A hanging strip translates in depth but stays
                                //   near-vertical (a pendulum bob points down), so the
                                //   render counter-rotates the sheet like a steadicam —
                                //   otherwise the short-focal perspective keystones it
                                //   into a top-wide trapezoid
const RMS_WIND_GAIN  = 5.0;     // rms → wind target (clamped below)
const RMS_WIND_MAX   = 1.2;
const ONSET_COOLDOWN = 170;     // ms — don't re-kick on every 85ms onset in busy passages
const STRIKE_GAP_MS  = 150;
const PSI_MAX        = 0.42;    // rad — paper twist cap; keeps the lyric readable
const REL_W_MAX      = 2.9;     // rad/s — clapper speed relative to the bell, hard cap

// Each link: two swing DOFs — x = in-plane (rotateZ), z = depth (rotateX).
const mkLink = (thX, thZ) => ({ x: { th: thX, w: 0 }, z: { th: thZ, w: 0 } });
const B = mkLink(0.04,  0.015);  // bell+cord
const C = mkLink(0.015, 0);      // clapper
const T = mkLink(0.06,  0.02);   // tanzaku paper
// Twist (rotateY): paper is dynamic, bell is a slow kinematic drift.
const P = { psi: 0.08, w: 0 };
let bellPsi = 0;

let active = false;
let built = false;
let lastT = 0;

// Wind = layered breeze sines (irrational ratios → never loops) + sparse gust
// envelopes + the audio term, then split onto the two swing axes by a slowly
// wandering heading — mostly side-on, occasionally head-on, so the chime
// traces ellipses. Signed; positive blows right / toward the viewer.
let windX = 0, windZ = 0, windMag = 0;
let windAudio = 0;
let windPuff = 0;   // onset-driven micro-gust envelope — the beat as a breath
const gustSeed = Math.random() * 100;

function updateWind(nowMs, dt) {
  const t = nowMs / 1000;
  const breeze =
      Math.sin(t * 0.31 + gustSeed)        * 0.42
    + Math.sin(t * 0.83 + gustSeed * 1.7)  * 0.26
    + Math.sin(t * 2.07 + gustSeed * 0.6)  * 0.12;
  // Two gust envelopes on different clocks: a long one every couple of
  // minutes and a shorter one — idle stays mostly calm with rare moments
  // where the chime genuinely stirs (and may ring once on its own).
  const gustA = Math.max(0, Math.sin(t * 0.043 + gustSeed * 2.3) - 0.80) * 2.8;
  const gustB = Math.max(0, Math.sin(t * 0.110 + gustSeed * 4.1) - 0.93) * 2.3;
  const gust = gustA + gustB;

  // Audio wind: fast attack, slow release, so phrases swell and linger.
  const fr = window.FL_AUDIO?.getFrame?.();
  let target = 0;
  if (fr && typeof fr.rms === 'number' && Date.now() - (fr.t || 0) < 300) {
    target = Math.min(RMS_WIND_MAX, fr.rms * RMS_WIND_GAIN);
  }
  const k = target > windAudio ? 0.10 : 0.018;
  windAudio += (target - windAudio) * Math.min(1, k * (dt * 60));

  windPuff *= Math.exp(-dt * 4.5);
  windMag = breeze * (0.55 + gust * 0.5) + gust * 0.35
          + windAudio * (0.7 + breeze * 0.25) + windPuff;
  const heading = Math.sin(t * 0.127 + gustSeed * 3.1) * 0.9
                + Math.sin(t * 0.047 + gustSeed * 1.3) * 0.65;
  windX = windMag * Math.cos(heading);
  windZ = windMag * Math.sin(heading) * DEPTH_WIND;
}

function stepPend(p, len, damp, force, h) {
  const acc = -(G / len) * Math.sin(p.th) - damp * p.w + force * Math.cos(p.th);
  p.w += acc * h;
  p.th += p.w * h;
}
function stepLink(L, k, h, fx, fz) {
  stepPend(L.x, k.len, k.damp, windX * k.windK + (fx || 0), h);
  stepPend(L.z, k.len, k.damp, windZ * k.windK + (fz || 0), h);
}

// Booster, not a hammer: push *along* the current relative motion (a parent
// pushing a swing), never against it. At a still extreme, push the way
// gravity is about to send it. Energy accumulates by resonance — strikes
// emerge when a passage has pumped enough, instead of the bead teleporting
// across the mouth on every beat.
function kickAligned(c, b, amount) {
  const relW = c.w - b.w;
  let dir = Math.abs(relW) > 0.12 ? Math.sign(relW) : -Math.sign(c.th - b.th);
  if (!dir) dir = Math.random() < 0.5 ? -1 : 1;
  c.w += dir * amount;
}
function capRel(c, b) {
  const relW = c.w - b.w;
  if (Math.abs(relW) > REL_W_MAX) c.w = b.w + Math.sign(relW) * REL_W_MAX;
}

let lastStrikeAt = 0;
function collide(nowMs) {
  // The mouth is round: the stem crosses the rim when the *2D* relative tilt
  // leaves the cone, wherever it points.
  const relX = C.x.th - B.x.th, relZ = C.z.th - B.z.th;
  const mag = Math.hypot(relX, relZ);
  if (mag <= STRIKE_ANG) return;
  const nx = relX / mag, nz = relZ / mag;
  C.x.th = B.x.th + nx * STRIKE_ANG;
  C.z.th = B.z.th + nz * STRIKE_ANG;
  const rvx = C.x.w - B.x.w, rvz = C.z.w - B.z.w;
  const radial = rvx * nx + rvz * nz;
  // Only an *incoming* bead rings; a bead resting on the rim just sits there.
  if (radial > 0.25 && nowMs - lastStrikeAt > STRIKE_GAP_MS) {
    lastStrikeAt = nowMs;
    strike(Math.min(1, radial / 3.2), Math.sign(nx) || 1);
    P.w += (Math.random() - 0.5) * radial * 0.5;   // the jolt also twists the paper
  }
  // Reflect the radial velocity component, keep the tangential part.
  const rx = radial * nx, rz = radial * nz;
  C.x.w = B.x.w + (rvx - rx) - rx * 0.45;   // restitution
  C.z.w = B.z.w + (rvz - rz) - rz * 0.45;
  B.x.w += rx * 0.08;  B.z.w += rz * 0.08;  // glass recoil
  T.x.w += rx * 0.18;  T.z.w += rz * 0.18;  // the paper feels the jolt
}

// ── Audio onsets → clapper kicks ────────────────────────────────────────────
let lastKickAt = 0;
let lastCentroid = 0.5;
if (window.FL_AUDIO?.onOnset) {
  window.FL_AUDIO.onOnset((velocity, centroid) => {
    if (!active) return;
    const now = performance.now();
    if (now - lastKickAt < ONSET_COOLDOWN) return;
    lastKickAt = now;
    lastCentroid = centroid;
    // The gust hits the SAIL, not the bead: the paper takes the beat, swells
    // wide, and tows the clapper after it. The strike, when it comes, is the
    // last event of the chain — not the first.
    kickAligned(T.x, C.x, 0.28 + velocity * 0.80);
    kickAligned(T.z, C.z, 0.18 + velocity * 0.42);
    P.w   += (centroid - 0.5) * velocity * 2.2;   // bright sounds twist one way, dark the other
    // The rest of the beat's energy arrives as wind — the whole chime
    // (bell, depth axis included) breathes with the rhythm.
    windPuff = Math.min(1.0, windPuff + velocity * 0.38);
  });
}

// ── DOM ─────────────────────────────────────────────────────────────────────
let rootEl, l0, l1, l2, paperEl, textSpan, bellSvg, mouthMarkL, mouthMarkR;
let decoEl, reflEl, mouthShadowEl;

function build() {
  rootEl = document.getElementById('furin');
  if (!rootEl || built) return;
  built = true;
  rootEl.innerHTML = `
    <div class="fr-anchor">
      <div class="fr-link fr-l0">
        <svg class="fr-bell-svg" width="160" height="240" viewBox="-80 -10 160 240">
          <defs>
            <!-- Fresnel-ish glass: nearly clear at the center, denser color
                 toward the silhouette edge — the thing that makes a 2D blob
                 read as a blown-glass shell. -->
            <radialGradient id="fr-glass" cx="0.46" cy="0.42" r="0.72">
              <stop offset="0"    style="stop-color: color-mix(in srgb, var(--accent) 14%, #ffffff)" stop-opacity="0.06"/>
              <stop offset="0.55" style="stop-color: color-mix(in srgb, var(--accent) 38%, #ffffff)" stop-opacity="0.10"/>
              <stop offset="0.82" style="stop-color: color-mix(in srgb, var(--accent) 62%, #ffffff)" stop-opacity="0.24"/>
              <stop offset="1"    style="stop-color: color-mix(in srgb, var(--accent) 76%, #39415a)" stop-opacity="0.44"/>
            </radialGradient>
            <radialGradient id="fr-hl" cx="0.4" cy="0.35" r="0.6">
              <stop offset="0"   stop-color="#ffffff" stop-opacity="0.9"/>
              <stop offset="1"   stop-color="#ffffff" stop-opacity="0"/>
            </radialGradient>
            <clipPath id="fr-bell-clip">
              <path d="M -34 178 C -52 168 -57 150 -55 128 C -52 100 -28 84 0 84
                       C 28 84 52 100 56 128 C 58 150 52 168 34 178
                       C 25 182 13 179.5 0 180.5 C -13 181.5 -25 182 -34 178 Z"/>
            </clipPath>
          </defs>

          <!-- cord + knot -->
          <line class="fr-cord" x1="0" y1="-10" x2="0" y2="84"/>
          <circle class="fr-knot" cx="0" cy="83" r="2.4"/>

          <!-- glass body: near-sphere with a wide open cut mouth, faintly
               asymmetric like hand-blown glass -->
          <path class="fr-glass" d="M -34 178 C -52 168 -57 150 -55 128 C -52 100 -28 84 0 84
                   C 28 84 52 100 56 128 C 58 150 52 168 34 178
                   C 25 182 13 179.5 0 180.5 C -13 181.5 -25 182 -34 178 Z"
                fill="url(#fr-glass)"/>

          <!-- painted motif inside the glass: wind-grass flicks leaning the
               way the breeze blows (江戸風鈴 are brushed from the inside) -->
          <g clip-path="url(#fr-bell-clip)" class="fr-deco">
            <path class="fr-d1" d="M -38 166 q 18 -24 36 -32"/>
            <path class="fr-d2" d="M -25 172 q 15 -15 30 -19"/>
            <path class="fr-d3" d="M 6 170 q 11 -8 24 -10"/>
          </g>

          <!-- glass shading: specular bloom + speck, right crescent, inner
               bottom reflection (grouped so the twist parallax can
               counter-shift them), mouth shadow, bright cut rim -->
          <g class="fr-refl">
            <ellipse class="fr-bloom" cx="-24" cy="109" rx="8.5" ry="16"
                     transform="rotate(-24 -24 109)" fill="url(#fr-hl)"/>
            <ellipse class="fr-speck" cx="-12" cy="97" rx="3" ry="5"
                     transform="rotate(-22 -12 97)"/>
            <path class="fr-crescent" d="M 45 114 q 10 17 4 38" fill="none"/>
            <path class="fr-bowlight" d="M -24 170 q 24 10 48 0" fill="none"/>
          </g>
          <ellipse class="fr-mouth-shadow" cx="0" cy="178" rx="29" ry="3.5"/>
          <path class="fr-rim" d="M -34 178 C -25 182 -13 179.5 0 180.5 C 13 181.5 25 182 34 178" fill="none"/>
        </svg>

        <div class="fr-mouth-mark fr-mouth-l"></div>
        <div class="fr-mouth-mark fr-mouth-r"></div>

        <div class="fr-link fr-l1">
          <div class="fr-thread"></div>
          <div class="fr-bead"></div>
          <div class="fr-link fr-l2">
            <div class="tz-thread"></div>
            <div class="fr-tz">
              <div class="tz-paper">
                <div class="tz-hole"></div>
                <div class="tz-text"><span></span></div>
                <div class="tz-seal"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  l0 = rootEl.querySelector('.fr-l0');
  l1 = rootEl.querySelector('.fr-l1');
  l2 = rootEl.querySelector('.fr-l2');
  paperEl = rootEl.querySelector('.tz-paper');
  textSpan = rootEl.querySelector('.tz-text span');
  bellSvg = rootEl.querySelector('.fr-bell-svg');
  mouthMarkL = rootEl.querySelector('.fr-mouth-l');
  mouthMarkR = rootEl.querySelector('.fr-mouth-r');
  decoEl = rootEl.querySelector('.fr-deco');
  reflEl = rootEl.querySelector('.fr-refl');
  mouthShadowEl = rootEl.querySelector('.fr-mouth-shadow');
}

function start() {
  build();
  active = true;
  lastT = performance.now();
}
function stop() { active = false; }

// ── Tanzaku text (vertical, auto-fit, two-sided flip on line change) ───────
let currentText = '';
let pendingText = null;
let flip = 0;          // deg
let flipTarget = 0;

function fitTanzaku(text) {
  const n = [...text].length;
  let size = 17;
  if (n > 8)  size = 16;
  if (n > 11) size = 15;
  if (n > 14) size = 14;
  if (n > 18) size = 13;
  if (n > 22) size = 12;
  textSpan.style.fontSize = size + 'px';
}

function setLine(line) {
  if (!built) return;
  const text = ((line && line.text) || '').trim();
  if (!text) return;
  // Lyric-change puff — even without the spectrum channel, every new line
  // sends a breath through the sail.
  kickAligned(T.x, C.x, 0.55);
  kickAligned(T.z, C.z, 0.28);
  P.w   += (Math.random() - 0.5) * 1.3;
  windPuff = Math.min(1.0, windPuff + 0.35);
  if (text === currentText) return; // repeated chorus line: puff, no flip
  currentText = text;
  pendingText = text;
  flipTarget = 92;
}

// Idle: flip the paper back to blank. The bare strip + seal still reads as a
// deliberate object, which is the whole point of the ornament class.
function clear() {
  if (!built) return;
  currentText = '';
  pendingText = '';
  flipTarget = 92;
}

// ── Per-frame: physics step + render. Called from app.js tick() every rAF. ──
let flutterPhase = 0;

function frame() {
  if (!active || !built) return;
  const now = performance.now();
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt <= 0) return;
  if (dt > 0.05) dt = 0.05;

  updateWind(now, dt);
  const steps = dt > 0.022 ? 2 : 1;
  const h = dt / steps;
  const ts = now / 1000;
  for (let i = 0; i < steps; i++) {
    stepLink(B, LINKS.bell, h);
    // The tow: paper drags the bead through the thread, bead answers back.
    const towX = TOW_K * (T.x.th - C.x.th) + TOW_KV * (T.x.w - C.x.w);
    const towZ = TOW_K * (T.z.th - C.z.th) + TOW_KV * (T.z.w - C.z.w);
    stepLink(C, LINKS.clap, h, towX, towZ);
    stepLink(T, LINKS.paper, h, -towX * TOW_BACK_RATIO, -towZ * TOW_BACK_RATIO);
    // Paper twist: wind turbulence as torque, the thread's wind-up as spring.
    const turb = Math.sin(ts * 1.7 + gustSeed * 5.0) * 0.5
               + Math.sin(ts * 0.61 + gustSeed * 2.2) * 0.5;
    const accPsi = -2.4 * P.psi - 1.5 * P.w
                 + turb * (0.5 + Math.min(1.4, Math.abs(windMag)) * 1.1);
    P.w += accPsi * h;
    P.psi += P.w * h;
    collide(now);
  }
  capRel(C.x, B.x);   // tow can't fling the bead past physical speed
  capRel(C.z, B.z);
  if (P.psi > PSI_MAX)       { P.psi = PSI_MAX;  P.w *= -0.3; }
  else if (P.psi < -PSI_MAX) { P.psi = -PSI_MAX; P.w *= -0.3; }

  // Bell twist: a slow kinematic drift — visible only through the parallax
  // between the inside-painted motif and the surface highlights.
  bellPsi = Math.sin(ts * 0.083 + gustSeed * 0.7) * 0.050
          + Math.sin(ts * 0.031 + gustSeed * 1.9) * 0.045
          + windAudio * 0.03 * Math.sin(ts * 0.41);

  // Paper flip toward target; swap text at the edge-on point.
  flip += (flipTarget - flip) * Math.min(1, 14 * dt);
  if (pendingText !== null && flip > 86) {
    textSpan.textContent = pendingText;
    if (pendingText) fitTanzaku(pendingText);
    paperEl.classList.toggle('blank', !pendingText);
    pendingText = null;
    flipTarget = 0;
  }

  // High-frequency flutter: light paper shivers with wind + its own motion.
  flutterPhase += dt * (5 + Math.abs(windMag) * 4);
  const amp = Math.min(5, 0.5 + Math.abs(windMag) * 1.4 + Math.abs(T.x.w) * 4);
  const skew = Math.sin(flutterPhase) * amp;

  const rad = (v) => v.toFixed(4) + 'rad';
  const zr  = (v) => (v * DEPTH_VIEW_GAIN).toFixed(4) + 'rad';
  l0.style.transform = `rotateZ(${rad(B.x.th)}) rotateX(${zr(B.z.th)}) rotateY(${rad(bellPsi)})`;
  l1.style.transform = `rotateZ(${rad(C.x.th - B.x.th)}) rotateX(${zr(C.z.th - B.z.th)})`;
  l2.style.transform = `rotateZ(${rad(T.x.th - C.x.th)}) rotateX(${zr(T.z.th - C.z.th)})`;
  // The chain's accumulated depth pitch at the paper is exactly T.z (the
  // relative angles telescope) — cancel most of it so the sheet rides the
  // swing upright instead of keystoning.
  const paperPitch = -T.z.th * DEPTH_VIEW_GAIN * (1 - PAPER_PITCH_KEEP);
  paperEl.style.transform = `rotateX(${paperPitch.toFixed(4)}rad) rotateY(${(flip + P.psi * 57.2958).toFixed(2)}deg) skewX(${skew.toFixed(2)}deg)`;

  // Glass parallax: the inside-painted motif rides the twist, the surface
  // reflections counter-shift — a 2D bell that reads as a turning volume.
  const dx = Math.sin(bellPsi) * 46;
  decoEl.setAttribute('transform', `translate(${(dx * 0.8).toFixed(2)} 0)`);
  reflEl.setAttribute('transform', `translate(${(-dx * 0.3).toFixed(2)} 0)`);

  // The strongest depth cue lives on the glass itself: swinging toward the
  // viewer opens the mouth (you see further inside), swinging away flattens
  // it to a sliver — the eye reads rotation-in-depth instantly.
  const mouthS = Math.max(0.5, Math.min(1.9, 1 + B.z.th * DEPTH_VIEW_GAIN * 4.5));
  mouthShadowEl.setAttribute('transform',
    `translate(0 178) scale(1 ${mouthS.toFixed(3)}) translate(0 -178)`);
}

// ── Strike visuals: the sound, made visible ─────────────────────────────────
function strike(intensity, side) {
  if (!rootEl) return;
  bellSvg.classList.add('striking');
  setTimeout(() => bellSvg.classList.remove('striking'), 90);

  const marker = side > 0 ? mouthMarkR : mouthMarkL;
  spawnRing(marker.getBoundingClientRect(), intensity, false);
  if (intensity > 0.62) {
    const r = marker.getBoundingClientRect();
    setTimeout(() => { if (active) spawnRing(r, intensity * 0.7, true); }, 130);
  }
}

function spawnRing(rect, intensity, echo) {
  const el = document.createElement('div');
  el.className = 'fr-ring' + (echo ? ' echo' : '');
  // Marker rects are viewport coords; rings are positioned inside #furin —
  // subtract its origin so the two coordinate spaces line up.
  const base = rootEl.getBoundingClientRect();
  el.style.left = (rect.left + rect.width / 2 - base.left) + 'px';
  el.style.top = (rect.top + rect.height / 2 - base.top) + 'px';
  el.style.setProperty('--ri', intensity.toFixed(2));
  // Bright (high-centroid) hits ring whiter; dark ones keep the glass color.
  el.style.setProperty('--ring-accent-mix', Math.round(20 + (1 - lastCentroid) * 45) + '%');
  el.addEventListener('animationend', () => el.remove());
  rootEl.appendChild(el);
}

// Diagnostics — open DevTools, type `__furin` (same convention as __piano).
window.__furin = {
  get active()  { return active; },
  get flip()    { return flip; },
  get target()  { return flipTarget; },
  get pending() { return pendingText; },
  get current() { return currentText; },
  get wind()    { return { x: windX, z: windZ, mag: windMag, puff: windPuff }; },
  get angles()  {
    return {
      bell:  { x: B.x.th, z: B.z.th, psi: bellPsi },
      clap:  { x: C.x.th, z: C.z.th },
      paper: { x: T.x.th, z: T.z.th, psi: P.psi },
    };
  },
};

window.FL_FURIN = { build, start, stop, frame, setLine, clear };

})();
