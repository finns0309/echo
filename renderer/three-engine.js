// Shared Three.js engine for all 3D lyric themes.
//
// Owns the scene, camera, renderer, and rAF loop. Individual themes register
// a "driver" — a small object that knows how to create meshes and animate
// them. The engine calls into the active driver on each frame and on each
// new lyric line.
//
// Driver interface:
//   {
//     name:       string,
//     setup(eng): void           — called once when first activated
//     teardown(eng): void        — called when switching away
//     renderLine(text, eng): void
//     tick(dt, eng): void        — called every frame while active
//   }
//
// `eng` is the engine context: { scene, camera, THREE, textToMesh, dispose }

(function () {

const drivers = {};       // name → driver
let activeDriver = null;  // currently mounted driver
let canvas, scene, camera, renderer;
let running = false;
let animFrameId = null;
let lastTime = 0;

// ── bootstrap ──────────────────────────────────────────────────────────────

function init(canvasEl) {
  if (scene) { resize(); return; }
  canvas = canvasEl;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 100);
  camera.position.z = 3.5;

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!renderer) return;
  const parent = canvas.parentElement || document.body;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ── render loop ────────────────────────────────────────────────────────────

function tick(time) {
  if (!running) return;
  animFrameId = requestAnimationFrame(tick);
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0.016;
  lastTime = time;
  if (activeDriver) activeDriver.tick(dt, ctx());
  renderer.render(scene, camera);
}

function startLoop() {
  if (running) return;
  running = true;
  lastTime = 0;
  animFrameId = requestAnimationFrame(tick);
}

function stopLoop() {
  running = false;
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = null;
}

// ── driver management ──────────────────────────────────────────────────────

function register(driver) {
  drivers[driver.name] = driver;
}

function activate(name) {
  if (activeDriver) {
    activeDriver.teardown(ctx());
    clearScene();
  }
  activeDriver = drivers[name] || null;
  if (activeDriver) {
    activeDriver.setup(ctx());
    startLoop();
  }
}

function deactivate() {
  if (activeDriver) {
    activeDriver.teardown(ctx());
    clearScene();
    activeDriver = null;
  }
  stopLoop();
}

function renderLine(text) {
  if (activeDriver) activeDriver.renderLine(text, ctx());
}

// ── shared utilities (passed to drivers as `eng`) ──────────────────────────

function readStyle() {
  const cs = getComputedStyle(document.body);
  const get = (k, fb) => cs.getPropertyValue(k).trim() || fb;
  return {
    font: get('--fl-text-font', 'system-ui, sans-serif'),
    size: parseInt(get('--fl-text-size', '32')),
    weight: get('--fl-text-weight', '700'),
    color: get('--fl-text-color', '#ffffff'),
  };
}

function textToMesh(text, opts) {
  const style = readStyle();
  const cvs = document.createElement('canvas');
  const c = cvs.getContext('2d');

  const dpr = Math.min(window.devicePixelRatio, 2);
  const px = style.size * dpr * 2.5;
  c.font = `${style.weight} ${px}px ${style.font}`;
  const tw = c.measureText(text).width;

  const pad = px * 0.8;
  cvs.width = Math.ceil(tw + pad * 2);
  cvs.height = Math.ceil(px * 2.0);

  c.font = `${style.weight} ${px}px ${style.font}`;
  c.textBaseline = 'middle';

  // glow layer
  if (opts && opts.glow) {
    c.shadowColor = opts.glow;
    c.shadowBlur = px * 0.35;
    c.fillStyle = style.color;
    c.fillText(text, pad, cvs.height / 2);
    c.shadowBlur = 0;
  }

  c.fillStyle = style.color;
  c.fillText(text, pad, cvs.height / 2);

  const tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const aspect = cvs.width / cvs.height;
  const h = (opts && opts.height) || 1.0;
  const w = h * aspect;
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh._planeW = w;
  mesh._planeH = h;
  return mesh;
}

function dispose(mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  if (mesh.material.map) mesh.material.map.dispose();
  mesh.material.dispose();
}

function clearScene() {
  while (scene.children.length) dispose(scene.children[0]);
}

function ctx() {
  return { scene, camera, THREE, textToMesh, dispose };
}

// ── public API ─────────────────────────────────────────────────────────────

window.FL_3D = {
  init,
  resize,
  register,
  activate,
  deactivate,
  renderLine,
};

})();
