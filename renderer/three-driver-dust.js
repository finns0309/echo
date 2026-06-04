// 3D theme driver: dust (落灰)
// A persistent particle system: tiny luminous motes drift downward like
// settling dust or ash. Lyrics render normally in DOM (stage layout).
// Each line change triggers a small burst of extra particles.

(function () {

const POOL_SIZE = 160;
const BURST_SIZE = 30;
const BURST_LIFE = 3.0;

let pool = [];
let bursts = [];
let geo, mat;

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

function accentRGB() {
  const raw = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  const m = raw.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  return [0.85, 0.8, 0.7];
}

function resetParticle(p, fromTop) {
  const hw = 4.5, hh = 3.0;
  p.position.set(rand(-hw, hw), fromTop ? rand(hh, hh + 1.5) : rand(-hh, hh), rand(-1, 1));
  p.userData.vx = rand(-0.08, 0.08);
  p.userData.vy = rand(-0.25, -0.08);
  p.userData.vz = rand(-0.03, 0.03);
  p.userData.drift = rand(0.3, 1.2);
  p.userData.phase = rand(0, Math.PI * 2);
  p.material.opacity = rand(0.15, 0.45);
  p.userData.baseOpacity = p.material.opacity;
}

function createDot(eng, size) {
  const g = new THREE.PlaneGeometry(size, size);
  const [r, gv, b] = accentRGB();
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(
      0.6 + r * 0.4,
      0.6 + gv * 0.4,
      0.6 + b * 0.4
    ),
    transparent: true,
    depthWrite: false,
    opacity: 0.3,
  });
  return new THREE.Mesh(g, m);
}

window.FL_3D?.register({
  name: 'dust',

  setup(eng) {
    pool = [];
    bursts = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const size = rand(0.015, 0.05);
      const dot = createDot(eng, size);
      resetParticle(dot, false);
      eng.scene.add(dot);
      pool.push(dot);
    }
  },

  teardown(eng) {
    for (const p of pool) eng.dispose(p);
    for (const p of bursts) eng.dispose(p);
    pool = [];
    bursts = [];
  },

  renderLine(text, eng) {
    for (let i = 0; i < BURST_SIZE; i++) {
      const size = rand(0.02, 0.06);
      const dot = createDot(eng, size);
      dot.position.set(rand(-2.5, 2.5), rand(0.5, 2.0), rand(-0.5, 0.5));
      dot.userData.vx = rand(-0.3, 0.3);
      dot.userData.vy = rand(-0.6, -0.15);
      dot.userData.vz = rand(-0.1, 0.1);
      dot.userData.age = 0;
      dot.userData.drift = rand(0.5, 1.5);
      dot.userData.phase = rand(0, Math.PI * 2);
      dot.material.opacity = rand(0.3, 0.7);
      eng.scene.add(dot);
      bursts.push(dot);
    }
  },

  tick(dt, eng) {
    const now = performance.now() * 0.001;
    const hh = 3.5;

    // ambient pool
    for (const p of pool) {
      const d = p.userData;
      p.position.x += (d.vx + Math.sin(now * d.drift + d.phase) * 0.04) * dt;
      p.position.y += d.vy * dt;
      p.position.z += d.vz * dt;

      if (p.position.y < -hh) resetParticle(p, true);
    }

    // burst particles
    for (let i = bursts.length - 1; i >= 0; i--) {
      const p = bursts[i];
      const d = p.userData;
      d.age += dt;

      if (d.age >= BURST_LIFE) {
        eng.dispose(p);
        bursts.splice(i, 1);
        continue;
      }

      p.position.x += (d.vx + Math.sin(now * d.drift + d.phase) * 0.06) * dt;
      p.position.y += d.vy * dt;
      p.position.z += d.vz * dt;
      d.vy -= 0.15 * dt;

      const fade = 1 - (d.age / BURST_LIFE);
      p.material.opacity = fade * fade * 0.7;
    }
  },
});

})();
