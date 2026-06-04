// 3D theme driver: shatter (碎裂)
// Lyrics render normally in DOM (stage layout). When a line exits, its
// characters explode into individual particles that fly outward with
// random velocity, spin, and gravity, then fade.

(function () {

const PARTICLE_LIFE = 2.2;
const GRAVITY = -1.8;

let particles = [];
let prevText = '';

function easeInQuad(t) { return t * t; }

function charToMesh(char, eng) {
  const cs = getComputedStyle(document.body);
  const fontFamily = cs.getPropertyValue('--fl-text-font').trim() || 'system-ui, sans-serif';
  const fontSize = parseInt(cs.getPropertyValue('--fl-text-size')) || 32;
  const fontWeight = cs.getPropertyValue('--fl-text-weight').trim() || '700';
  const textColor = cs.getPropertyValue('--fl-text-color').trim() || '#fff';

  const cvs = document.createElement('canvas');
  const c = cvs.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio, 2);
  const px = fontSize * dpr * 2;

  c.font = `${fontWeight} ${px}px ${fontFamily}`;
  const tw = c.measureText(char).width;
  cvs.width = Math.ceil(tw + px * 0.3);
  cvs.height = Math.ceil(px * 1.5);

  c.font = `${fontWeight} ${px}px ${fontFamily}`;
  c.textBaseline = 'middle';
  c.fillStyle = textColor;
  c.fillText(char, px * 0.15, cvs.height / 2);

  const tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter;

  const aspect = cvs.width / cvs.height;
  const h = 0.38;
  const geo = new THREE.PlaneGeometry(h * aspect, h);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

function spawnShatter(text, eng) {
  const chars = [...text];
  if (!chars.length) return;

  const charW = 0.42;
  const totalW = chars.length * charW;
  const startX = -totalW / 2;

  chars.forEach((ch, i) => {
    if (ch === ' ' || ch === ' ') return;
    const mesh = charToMesh(ch, eng);

    const x = startX + (i + 0.5) * charW;
    mesh.position.set(x, 0, 0);

    const angle = Math.atan2(0, x) + (Math.random() - 0.5) * 1.5;
    const speed = 1.2 + Math.random() * 2.0;

    mesh.userData = {
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 1.5,
      vy: 1.5 + Math.random() * 2.5,
      vz: (Math.random() - 0.5) * 2.0,
      rotSpeed: (Math.random() - 0.5) * 8,
      age: 0,
    };

    eng.scene.add(mesh);
    particles.push(mesh);
  });
}

window.FL_3D?.register({
  name: 'shatter',

  setup() {
    particles = [];
    prevText = '';
  },

  teardown(eng) {
    for (const p of particles) eng.dispose(p);
    particles = [];
    prevText = '';
  },

  renderLine(text, eng) {
    if (prevText && prevText !== '♪') {
      spawnShatter(prevText, eng);
    }
    prevText = text;
  },

  tick(dt, eng) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const d = p.userData;
      d.age += dt;

      if (d.age >= PARTICLE_LIFE) {
        eng.dispose(p);
        particles.splice(i, 1);
        continue;
      }

      p.position.x += d.vx * dt;
      p.position.y += d.vy * dt;
      p.position.z += d.vz * dt;
      d.vy += GRAVITY * dt;

      p.rotation.z += d.rotSpeed * dt;

      const t = d.age / PARTICLE_LIFE;
      p.material.opacity = 1 - easeInQuad(t);
    }
  },
});

})();
