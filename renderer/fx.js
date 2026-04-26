// Lightweight GPU effects layer. Sits between #bg (cover image) and #tint
// (vignette/grain) in the stacking order. Driven by the theme registry: a
// theme sets `fx: 'plasma' | ...` and app.js calls FL_FX.start/stop/pulse.
//
// Shaders accept four uniforms:
//   uTime   seconds since fx started
//   uBeat   0..1, decays ~exponentially; app.js bumps it on every line change
//   uAccent vivid RGB pulled from the album cover (0..1)
//   uAmbient average RGB from the cover (0..1)
//
// Adding a new fx:
//   1. Add a frag source under SHADERS.
//   2. Reference it from a theme as `fx: '<name>'`.
(function () {

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Plasma: domain-warped fbm with a built-in palette. Cover-derived colors
// are intentionally ignored here — using them produced low-contrast washes
// once the cover's average color landed (often muddy/similar to the vivid
// pick). A fixed palette keeps the theme visually distinct from cover-based
// themes. Tweak BASE_DARK / BASE_HOT below to retune.
//
// Performance: 3-octave fbm (down from 5) and a single domain warp layer
// (down from two). Together with the half-resolution canvas in resize()
// this is ~7× lighter than the original at the same window size.
const FRAG_PLASMA = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uBeat;
// Cover-derived mid-tone color. ONLY the middle palette stop comes from the
// cover — the dark and bright stops are fixed, so the contrast structure
// stays intact regardless of how muddy the album's palette is. This means
// each song "tints" the plasma toward its dominant color without ever
// collapsing to a flat one-color wash (the bug we hit before).
uniform vec3  uAccent;

// Fixed dark + bright stops. BASE_DARK is a saturated deep indigo (not near-
// black), BASE_HOT is near-white cyan. Any cover-derived mid color slots
// between these and the eye reads visible contrast.
const vec3 BASE_DARK = vec3(0.10, 0.04, 0.28);
const vec3 BASE_HOT  = vec3(0.55, 1.00, 1.00);

// Hash21 from David Hoskins (https://www.shadertoy.com/view/4djSRW). The
// classic fract(sin(dot(...)) * 43758) hash collapses on Apple silicon GPUs
// once the input magnitude exceeds ~30 — sin(huge)*43758 produces values with
// no significand precision left, fract returns a degenerate constant, fbm
// becomes uniform across the whole canvas. This variant stays stable across
// the full shader range we hit.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  // 3 octaves is enough at the half-res canvas — extra detail is invisible.
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * 4.0;
  // uTime is already a beat-modulated phase accumulator (see fx.js loop);
  // adding uBeat here would re-introduce the positional jump on each line
  // change.
  float t = uTime;
  // Two-layer domain warp: q feeds r, r feeds final fbm. 5 fbm calls × 3
  // octaves per pixel; with the half-res canvas this is ~40% of the
  // original 5-octave double-warp cost.
  vec2 q = vec2(fbm(p + t),
                fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 1.2),
                fbm(p + 3.5 * q + vec2(8.3, 2.8) - t * 0.9));
  float f = fbm(p + 3.0 * r);
  f = smoothstep(0.25, 0.85, f);
  vec3 col = mix(BASE_DARK, uAccent, f);
  col = mix(col, BASE_HOT, clamp(r.x, 0.0, 1.0) * 0.65);
  col *= 0.6 + 0.55 * f;
  // Beat already accelerates t (the warp speed), which gives a kinetic
  // pulse on every line change. Don't also add a global brightness boost —
  // that flashes the entire canvas on each lyric and reads as a visual glitch.
  vec2 c = uv - 0.5; c.x *= aspect;
  col *= 1.0 - dot(c, c) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}`;

// Ripple: a calm pond surface tinted by the cover. On every audio onset
// (driven from app.js → FL_FX.pulseRipple()) a new circular wave is spawned
// from a random point and expands outward, fading. Up to RIPPLE_SLOTS active
// at once. No expensive fbm here — just a few ring distance calcs per
// fragment, so this is much cheaper than plasma.
const FRAG_RIPPLE = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uAccent;
// Each ripple = (cx_uv, cy_uv, age_seconds). age < 0 means slot is empty.
uniform vec3  uRipples[6];

// Brightened from the original near-black so the water surface is *visible*
// when no ripples are active. Previous values produced an essentially black
// canvas indistinguishable from #bg leakage.
const vec3 WATER_DEEP    = vec3(0.06, 0.12, 0.22);
const vec3 WATER_SURFACE = vec3(0.18, 0.32, 0.55);
const vec3 RIPPLE_HI     = vec3(0.85, 0.95, 1.00); // crest highlight

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  // Stronger base shimmer + 2 layered traveling waves so the water has
  // continuous motion even with no ripples active. Reads as "calm water with
  // a breeze" rather than "dead surface".
  float shimmer1 = sin(uv.y * 14.0 + uTime * 0.6) * sin(uv.x *  9.0 - uTime * 0.4);
  float shimmer2 = sin(uv.y *  7.0 - uTime * 0.3) * sin(uv.x * 12.0 + uTime * 0.5);
  float shimmer = (shimmer1 + shimmer2 * 0.7) * 0.10;
  vec3 base = mix(WATER_DEEP, WATER_SURFACE, 0.45 + shimmer);
  // Pull base toward accent color so albums tint the water.
  base = mix(base, uAccent, 0.22);

  // Sum contributions from active ripples.
  float wave = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 r = uRipples[i];
    if (r.z < 0.0) continue;
    // Aspect-correct distance so ripples are circular, not ellipses.
    vec2 d = uv - r.xy;
    d.x *= aspect;
    float dist = length(d);
    // Front of the ring expands at fixed speed; thin gaussian profile.
    float front = r.z * 0.32;
    float dx = dist - front;
    float ring = exp(-dx * dx * 380.0);
    // Fade with age so ripples die out before piling up.
    float fade = exp(-r.z * 0.55);
    wave += ring * fade;
  }
  wave = clamp(wave, 0.0, 1.0);

  vec3 col = mix(base, RIPPLE_HI, wave * 0.7);
  // Tiny secondary glow inside the ring for richness.
  col += uAccent * wave * 0.18;

  vec2 c = uv - 0.5; c.x *= aspect;
  col *= 1.0 - dot(c, c) * 0.45;
  gl_FragColor = vec4(col, 1.0);
}`;

const SHADERS = { plasma: FRAG_PLASMA, ripple: FRAG_RIPPLE };

// Ripple state. Up to RIPPLE_SLOTS active at once — older ones get evicted.
const RIPPLE_SLOTS = 6;
const ripples = new Array(RIPPLE_SLOTS).fill(null).map(() => ({ x: 0, y: 0, age: -1 }));
let ripplesFlat = new Float32Array(RIPPLE_SLOTS * 3);
function spawnRipple() {
  // Find oldest (or empty) slot to overwrite.
  let oldest = 0;
  for (let i = 1; i < RIPPLE_SLOTS; i++) {
    if (ripples[i].age < 0) { oldest = i; break; }
    if (ripples[i].age > ripples[oldest].age) oldest = i;
  }
  ripples[oldest].x = 0.15 + Math.random() * 0.7;
  ripples[oldest].y = 0.15 + Math.random() * 0.7;
  ripples[oldest].age = 0;
}
function pulseRipple(/* velocity */) {
  if (active !== 'ripple') return;
  spawnRipple();
}
// Ambient ripple cadence: every ~3 seconds drop a small ripple even without
// a hard onset, so the pond reads as "alive" instead of "frozen waiting for
// audio". Disabled while onset-driven ripples are active recently.
let lastAmbientRippleAt = 0;
function maybeAmbientRipple(now) {
  if (active !== 'ripple') return;
  if (now - lastAmbientRippleAt < 2500 + Math.random() * 1500) return;
  lastAmbientRippleAt = now;
  spawnRipple();
}

// ────────────────────────────────────────────────────────────────
let canvas = null;
let gl = null;
let prog = null;
let raf = 0;
let active = null;
let startedAt = 0;
let lastFrame = 0;
let beat = 0;
let uLoc = {};
// Phase = accumulated "shader time", advanced at a beat-modulated rate every
// frame. Sending this as uTime (instead of wall-clock seconds + beat offset)
// means a beat speeds up the warp continuously — there's never a jump in t,
// so the fbm field is never resampled at a discontinuously different position.
// Replaces the old "t = uTime + uBeat * 0.5" approach which reset the visible
// flow on every line change.
let phase = 0;
const PHASE_BASE_SPEED = 0.28; // units/sec when idle. Higher = visibly faster flow.
const PHASE_BEAT_BOOST = 1.6;  // multiplier added to base when beat is at 1.
// Default mid-stop = hot magenta. Replaced by setColors() once the cover
// has been sampled. Vivid + saturated = the plasma reads as colorful even
// before the first track's accent arrives.
let accent = [0.92, 0.22, 0.52];
// Internal-resolution scale: the canvas drawing buffer is rendered at this
// fraction of CSS pixels and stretched up by GPU. Plasma is a smooth color
// field; you can't see a half-resolution buffer, but you can absolutely see
// the difference in fragment cost — at 0.5 we shade 1/4 the pixels of the
// original DPR=2 path. Cap at 1 for safety on already-tiny windows.
const FX_RES_SCALE = 0.5;

function compile(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[fx] shader compile failed:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function build(fragSrc) {
  const vs = compile(VERT, gl.VERTEX_SHADER);
  const fs = compile(fragSrc, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('[fx] program link failed:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function resize() {
  // Render at FX_RES_SCALE × CSS pixels (ignoring DPR entirely — the GPU
  // does the upscale to physical pixels for free, and a smooth fbm field
  // doesn't reveal the lower buffer res).
  const w = Math.max(1, Math.floor(canvas.clientWidth  * FX_RES_SCALE));
  const h = Math.max(1, Math.floor(canvas.clientHeight * FX_RES_SCALE));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  const minStep = document.hasFocus() ? 32 : 66;
  if (now - lastFrame < minStep) return;
  // dt in seconds since last actually-painted frame. Clamp to avoid huge
  // jumps when the tab was throttled (e.g., user came back from another app).
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0.033;
  lastFrame = now;
  // Phase advances faster while beat > 0; beat decays smoothly so the
  // speed-up is gradual.
  phase += dt * (PHASE_BASE_SPEED + beat * PHASE_BEAT_BOOST);
  resize();
  beat *= 0.92;
  gl.uniform1f(uLoc.uTime, phase);
  gl.uniform1f(uLoc.uBeat, beat);
  gl.uniform2f(uLoc.uRes, canvas.width, canvas.height);
  gl.uniform3f(uLoc.uAccent, accent[0], accent[1], accent[2]);
  // Advance + pack ripple state when ripple shader is active.
  if (active === 'ripple' && uLoc.uRipples) {
    maybeAmbientRipple(now);
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      const r = ripples[i];
      if (r.age >= 0) {
        r.age += dt;
        if (r.age > 7) r.age = -1; // expired
      }
      ripplesFlat[i * 3]     = r.x;
      ripplesFlat[i * 3 + 1] = r.y;
      ripplesFlat[i * 3 + 2] = r.age;
    }
    gl.uniform3fv(uLoc.uRipples, ripplesFlat);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function start(name) {
  if (active === name) return;
  stop();
  const frag = SHADERS[name];
  if (!frag) return;
  canvas = document.getElementById('fx');
  if (!canvas) return;
  // Reuse the same GL context across start/stop cycles. Calling
  // WEBGL_lose_context.loseContext() permanently kills the canvas's context —
  // subsequent getContext() calls return the same lost context and drawArrays
  // becomes a silent no-op. Symptom: theme switches away from plasma and back
  // shows the bg color instead of the shader.
  if (!gl) {
    gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!gl) { console.warn('[fx] webgl unavailable'); return; }
  }

  prog = build(frag);
  if (!prog) return;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1, -1,  1,
    -1,  1,  1, -1,  1,  1,
  ]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  uLoc = {
    uTime:    gl.getUniformLocation(prog, 'uTime'),
    uRes:     gl.getUniformLocation(prog, 'uRes'),
    uBeat:    gl.getUniformLocation(prog, 'uBeat'),
    uAccent:  gl.getUniformLocation(prog, 'uAccent'),
    uRipples: gl.getUniformLocation(prog, 'uRipples'),
  };

  canvas.style.display = 'block';
  startedAt = performance.now();
  lastFrame = 0;
  // Phase intentionally NOT reset across start/stop: keeping it preserves the
  // current frame of fluid when toggling themes, instead of snapping to t=0.
  active = name;
  raf = requestAnimationFrame(loop);
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  // Just pause the loop and hide the canvas; do NOT destroy the GL context
  // (loseContext is a one-way ticket — see start() comment).
  if (gl && prog) gl.deleteProgram(prog);
  prog = null;
  uLoc = {};
  if (canvas) canvas.style.display = 'none';
  active = null;
}

// app.js's applyAccentFromCover() calls this with the cover's vivid color.
// We boost saturation a touch — covers often pick something a bit muted,
// and plasma reads better with high-chroma mid-tones. Average color is
// intentionally ignored (using it as the dark stop produced muddy washes
// when album palette was low-contrast).
function setColors(vivid /* avg ignored */) {
  if (!vivid) return;
  let r = vivid[0] / 255, g = vivid[1] / 255, b = vivid[2] / 255;
  // Push toward saturation: pull each channel away from luminance.
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const SAT = 1.25;
  r = Math.max(0, Math.min(1, lum + (r - lum) * SAT));
  g = Math.max(0, Math.min(1, lum + (g - lum) * SAT));
  b = Math.max(0, Math.min(1, lum + (b - lum) * SAT));
  accent = [r, g, b];
}

function pulse() { beat = Math.min(1.0, beat + 0.65); }

window.FL_FX = { start, stop, setColors, pulse, pulseRipple };

})();
