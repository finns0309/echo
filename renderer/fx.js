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

// Ember: rising charcoal-fire fbm. Black → deep red → orange → near-white,
// with occasional sparks. Cover color tints the whole field warm via uAccent
// (normalized so a muddy cover still reads as a hue, not a brightness shift).
// uTime is the beat-modulated phase, same as plasma — so the fire keeps rising
// with no music, and a line change briefly speeds the rise + brightens sparks.
const FRAG_EMBER = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uBeat;
uniform vec3  uAccent;
float hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p);
  float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.; a*=.5; } return v; }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; float asp=uRes.x/uRes.y;
  vec2 p=vec2(uv.x*asp,uv.y)*3.0; p.y -= uTime*2.2;
  float f=fbm(p+fbm(p*0.5+uTime*0.8)*1.6); f=pow(f,1.4);
  // Cover color drives the flame body (same idea as plasma's mid stop): a dark
  // tint of the accent at the base, the accent itself through the body, and a
  // near-white tip. So a blue album burns blue, purple burns purple — the fixed
  // dark base + white tip keep the contrast structure so it always reads as
  // fire, never a flat one-color wash.
  vec3 cDark = uAccent*0.06;
  vec3 cMid  = uAccent*1.1;
  vec3 cHot  = mix(uAccent, vec3(1.0,0.95,0.85), 0.7);
  vec3 col = mix(cDark, cMid, smoothstep(0.20,0.60,f));
  col = mix(col, cHot, smoothstep(0.60,0.88,f));
  col = mix(col, vec3(1.0,0.96,0.88), smoothstep(0.88,1.0,f));
  float spk=step(0.9,fbm(p*1.6+vec2(0.0,uTime*5.0)))*smoothstep(0.55,1.0,f);
  col += spk*mix(vec3(1.0,0.85,0.6), vec3(1.0), 0.4)*(0.6+uBeat);
  col *= 1.0 - uv.y*0.35;                 // settle the top into embers
  vec2 c=uv-0.5; c.x*=asp; col *= 1.0 - dot(c,c)*0.35;
  gl_FragColor=vec4(col,1.0);
}`;

// Hyperspace: radial star-streaks rushing outward from center. Angular+radial
// fbm produces the streaks; beat injects a speed burst so each line change
// reads as a forward "jump". Center stays bright (the warp core) tinted by
// the cover color.
const FRAG_WARP = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uBeat;
uniform vec3  uAccent;
float hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p);
  float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.; a*=.5; } return v; }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; float asp=uRes.x/uRes.y;
  vec2 c=uv-0.5; c.x*=asp; float ang=atan(c.y,c.x); float rad=length(c);
  // t is pure phase × a constant. The forward acceleration on a line change
  // comes ENTIRELY from uTime itself speeding up (the phase accumulator in the
  // loop below advances faster while beat>0, then eases back) — exactly like
  // plasma. Do NOT add uBeat into t: that shifts the sampling position, so the
  // streaks jump forward on the beat and snap back as it decays (reads as a
  // reset, not a surge). uBeat is used only for non-positional brightness.
  float t=uTime*4.0;
  float streak=fbm(vec2(ang*7.0,  rad*5.0 - t));
  float s2    =fbm(vec2(ang*13.0+5.0, rad*8.0 - t*1.4));
  vec3 col=mix(vec3(0.0,0.0,0.02), uAccent, smoothstep(0.5,0.85,streak));
  col += vec3(1.0)*smoothstep(0.82,1.0,s2)*smoothstep(0.0,0.35,rad);
  col *= smoothstep(0.0,0.12,rad);                       // dark just off-center
  col += uAccent*smoothstep(0.12,0.0,rad)*(1.5+uBeat*1.6); // core flares on beat
  col *= 1.0 + uBeat*0.25;                                // slight overall lift
  gl_FragColor=vec4(col,1.0);
}`;

// Cel sky (ちいかわ-flavored): pastel sky gradient with puffy flat-shaded clouds
// and a SOFT TAUPE outline (not the hard black of typical toon shading) — that
// gentle low-contrast palette + rounded puffs is what reads as "cute/Chiikawa"
// rather than crisp Shinkai. Clouds drift slowly so it's alive with no music;
// the cover color only tints the sky a touch (pastel, never garish). uBeat just
// puffs the clouds a hair, no position shift.
//
// Note this is the only LIGHT theme that uses fx — themes.js pairs it with dark
// text + a white halo so lyrics read over both white cloud and blue sky.
const FRAG_CELSKY = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uBeat;
uniform vec3  uAccent;
float hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p);
  float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.; a*=.5; } return v; }
float cloudAt(vec2 q){ return smoothstep(0.53,0.74, fbm(q)); }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; float asp=uRes.x/uRes.y; vec2 p=vec2(uv.x*asp,uv.y);
  // pastel gradient: warm cream low, soft sky-blue high (low saturation)
  vec3 sky=mix(vec3(0.99,0.94,0.88), vec3(0.62,0.80,0.93), smoothstep(0.0,1.0,uv.y));
  sky=mix(sky, sky*mix(vec3(1.0),uAccent*1.4,0.6), 0.14);   // gentle cover tint
  vec2 dr=vec2(uTime*0.04,0.0); vec2 sp=p*1.8;
  float n =fbm(sp+dr);
  float cl =cloudAt(sp+dr);
  float cl2=cloudAt(sp+vec2(0.018,0.0)+dr);
  float cl3=cloudAt(sp+vec2(0.0,0.018)+dr);
  float band =step(0.5,cl), band2=step(0.5,cl2), band3=step(0.5,cl3);
  // two flat cloud tones (lit top vs faint shadow underside) = cel look
  float shade=smoothstep(0.55,0.72,n);
  vec3 cloudCol=mix(vec3(0.92,0.91,0.95), vec3(1.0), step(0.5,shade));
  float edge=(band!=band2||band!=band3)?1.0:0.0;
  vec3 col=mix(sky, cloudCol, band);
  col=mix(col, vec3(0.70,0.63,0.57), edge*0.9);            // soft taupe outline
  col += band*uBeat*0.06;                                   // clouds puff on beat
  vec2 c=uv-0.5; c.x*=asp; col*=1.0-dot(c,c)*0.12;          // gentle warm vignette
  gl_FragColor=vec4(col,1.0);
}`;

const SHADERS = { plasma: FRAG_PLASMA, ember: FRAG_EMBER, warp: FRAG_WARP, celsky: FRAG_CELSKY };

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
// Internal-resolution scale, PER SHADER. Smooth color fields (plasma/ember/
// warp) hide a half-res buffer completely, so they render at 0.5× CSS pixels —
// 1/4 the fragment cost. But edge-based shaders (celsky: flat bands + a 1px
// cloud outline) reveal a low-res buffer as mush/blur once it's upscaled, so
// they must render at full physical resolution (CSS × DPR). Default 0.5.
const DPR = Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 2);
const FX_RES_SCALE_BY_SHADER = { plasma: 0.5, ember: 0.5, warp: 0.5, celsky: DPR };
const FX_RES_SCALE_DEFAULT = 0.5;
let fxResScale = FX_RES_SCALE_DEFAULT;

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
  // Render at fxResScale × CSS pixels (set per-shader in start()). Smooth
  // fields use 0.5 and let the GPU upscale; edge-based shaders use full DPR so
  // outlines/flat-band boundaries stay crisp instead of blurring on upscale.
  const w = Math.max(1, Math.floor(canvas.clientWidth  * fxResScale));
  const h = Math.max(1, Math.floor(canvas.clientHeight * fxResScale));
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
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function start(name) {
  if (active === name) return;
  stop();
  const frag = SHADERS[name];
  if (!frag) return;
  fxResScale = FX_RES_SCALE_BY_SHADER[name] || FX_RES_SCALE_DEFAULT;
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

window.FL_FX = { start, stop, setColors, pulse };

})();
