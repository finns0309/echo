// Theme registry — single source of truth for both main (tray menu) and
// renderer (apply-theme dispatch).
//
// A theme is a composition of components:
//   layout: 'stage' | 'triplet' | 'single'
//     - stage:   floating cards at center, one per line. Per-char reveal.
//     - triplet: prev / curr / next stacked.
//     - single:  only the current line, huge and centered.
//   reveal: 'wave' | 'typewriter' | 'ink' | 'none'
//     Per-char entrance animation. Only meaningful for layout=stage.
//   fx:     'plasma' | undefined  (optional GPU shader layer)
//     Turns on renderer/fx.js: a full-screen WebGL quad painted between
//     #bg and #tint. Pulled by app.js on theme apply; uniforms get fed
//     the album's vivid/ambient colors and a beat bump on each line change.
//   frame:  'full' | 'cover-left'  (default 'full')
//     'cover-left' reserves the left square of the window for the album
//     cover and shifts lyrics to the right. No current theme uses it — the
//     DOM + CSS scaffold is in place for you to add one.
//   tokens: map of CSS custom properties applied to <body>
//     See style.css §TOKENS for the full list. Any `--fl-*` you set here
//     overrides the default in the base layer.
//   customClass: optional string, adds `theme-<name>` to body for the few
//     themes that need a bespoke CSS block (typewriter cursor, aura breathing,
//     minimal left-aligned mask, etc). Most themes don't need this.
//
// Adding a new theme:
//   1. Copy an entry below, change name/label, tweak tokens.
//   2. Done. Most of the time you will not touch style.css.
//   3. Only if you need something the token layer can't express (a new
//      animation, pseudo-elements, layout tweaks), add a small
//      `body.theme-<name>` block to style.css and set customClass: true.

// IIFE-wrapped so internal names (THEMES, etc.) don't leak to the shared
// global scope. Plain <script> tags all share one global scope, and app.js
// also defines a `THEMES` binding — without the wrapper they collide with
// "Identifier 'THEMES' has already been declared".
(function () {

const THEMES = [
  // ---------- stage · wave ----------
  {
    name: 'wave', label: '波浪', window: 'headline',
    layout: 'stage', reveal: 'wave',
    tokens: {
      '--fl-bg-blur':       '45px',
      '--fl-bg-saturate':   '1.7',
      '--fl-bg-brightness': '0.78',
      '--fl-bg-scale':      '1.45',
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.45)),
        radial-gradient(ellipse 100% 70% at 50% 40%, var(--accent-glow), transparent 65%)`,
      '--fl-text-color':   '#fff',
      '--fl-text-weight':  '700',
      '--fl-text-shadow':  '0 2px 12px rgba(0,0,0,0.5), 0 0 22px var(--accent-glow)',
    },
  },

  // ---------- stage · typewriter ----------
  {
    name: 'typewriter', label: '打字机', window: 'headline',
    layout: 'stage', reveal: 'typewriter',
    customClass: true, // needs the blinking cursor pseudo-element
    tokens: {
      '--fl-bg-color':      '#f4efe4',
      '--fl-bg-image':      'none',
      '--fl-tint-image': `
        repeating-linear-gradient(0deg, rgba(0,0,0,0.025) 0 1px, transparent 1px 3px),
        radial-gradient(ellipse 120% 90% at 50% 50%, transparent 40%, rgba(120,90,60,0.1) 100%)`,
      '--fl-text-font':     '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      '--fl-text-weight':   '500',
      '--fl-text-size':     '24px',
      '--fl-letter-spacing':'1px',
      '--fl-text-color':    '#2a2018',
      '--fl-text-shadow':   'none',
      '--fl-chrome-bg':     'rgba(255,250,240,0.7)',
      '--fl-chrome-fg':     '#2a2018',
      '--fl-chrome-border': 'rgba(60,40,20,0.15)',
      '--fl-chrome-artist': 'rgba(42,32,24,0.55)',
      '--fl-chrome-btn-hover-bg': 'rgba(60,40,20,0.1)',
    },
  },

  // ---------- stage · ink ----------
  {
    name: 'ink', label: '水墨', window: 'headline',
    layout: 'stage', reveal: 'ink',
    tokens: {
      '--fl-bg-color': '#f2ebdc',
      '--fl-bg-image': `
        radial-gradient(ellipse 70% 50% at 30% 20%, rgba(180,140,100,0.12), transparent 60%),
        radial-gradient(ellipse 60% 50% at 80% 80%, rgba(120,80,50,0.1),   transparent 55%)`,
      '--fl-tint-image': `
        repeating-linear-gradient(37deg,  rgba(80,50,20,0.03) 0 2px, transparent 2px 6px),
        repeating-linear-gradient(-53deg, rgba(80,50,20,0.02) 0 1px, transparent 1px 5px)`,
      '--fl-tint-blend':   'multiply',
      '--fl-text-font':    '"Songti SC", "STSong", "Noto Serif CJK SC", "Ma Shan Zheng", serif',
      '--fl-text-weight':  '800',
      '--fl-text-size':    '36px',
      '--fl-letter-spacing':'4px',
      '--fl-text-color':   '#1a1410',
      '--fl-text-shadow':  '0 0 2px rgba(26,20,16,0.5), 0 1px 0 rgba(26,20,16,0.2)',
      '--fl-chrome-bg':     'rgba(242,235,220,0.75)',
      '--fl-chrome-fg':     '#1a1410',
      '--fl-chrome-border': 'rgba(60,40,20,0.18)',
      '--fl-chrome-artist': 'rgba(26,20,16,0.55)',
      '--fl-chrome-btn-hover-bg': 'rgba(60,40,20,0.12)',
    },
  },

  // ---------- single · aura (NetEase default) ----------
  {
    name: 'aura', label: '神光', window: 'headline',
    layout: 'single', reveal: 'none',
    customClass: true, // curr-line breathing + scale-in-out change
    tokens: {
      '--fl-bg-blur':       '56px',
      '--fl-bg-saturate':   '1.9',
      '--fl-bg-brightness': '0.88',
      '--fl-bg-scale':      '1.6',
      '--fl-bg-animation':  'aura-breathe 18s ease-in-out infinite',
      '--fl-tint-image': `
        radial-gradient(ellipse 80% 60% at 20% 0%,   rgba(255,220,200,0.14), transparent 55%),
        radial-gradient(ellipse 90% 70% at 100% 100%, rgba(80,100,160,0.18), transparent 60%),
        radial-gradient(ellipse 130% 90% at 50% 50%, transparent 30%, rgba(0,0,0,0.38) 82%, rgba(0,0,0,0.58) 100%),
        linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.28))`,
      '--fl-text-size':    '34px',
      '--fl-text-weight':  '700',
      '--fl-letter-spacing':'0.4px',
      '--fl-text-color':   '#fffaf4',
    },
  },

  // ---------- stage · folio (Folia-inspired line focus) ----------
  {
    name: 'folio', label: '流光页', window: 'wide',
    layout: 'stage', reveal: 'glint',
    customClass: true, // hairline grid + stronger current-line glow
    tokens: {
      '--fl-bg-blur':       '38px',
      '--fl-bg-saturate':   '1.45',
      '--fl-bg-brightness': '0.62',
      '--fl-bg-scale':      '1.34',
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(7,8,12,0.24), rgba(7,8,12,0.58)),
        radial-gradient(ellipse 70% 50% at 50% 48%, var(--accent-glow), transparent 68%)`,
      '--fl-text-color':    '#fffdf8',
      '--fl-text-size':     '32px',
      '--fl-text-weight':   '800',
      '--fl-letter-spacing':'0.2px',
      '--fl-text-shadow': `
        0 2px 14px rgba(0,0,0,0.58),
        0 0 22px rgba(255,255,255,0.24),
        0 0 38px var(--accent-glow)`,
      '--fl-leave-filter':  'blur(16px) saturate(1.4)',
      '--fl-chrome-bg':     'rgba(8,9,14,0.34)',
      '--fl-chrome-fg':     'rgba(255,255,255,0.92)',
      '--fl-chrome-border': 'rgba(255,255,255,0.12)',
      '--fl-chrome-artist': 'rgba(255,255,255,0.56)',
    },
  },

  // ---------- triplet · sleeve (album cover as the left anchor) ----------
  {
    name: 'sleeve', label: '封套', window: 'wide',
    layout: 'triplet', reveal: 'none', frame: 'cover-left',
    customClass: true, // cover divider + tighter right-side typography
    tokens: {
      '--fl-bg-blur':       '34px',
      '--fl-bg-saturate':   '1.35',
      '--fl-bg-brightness': '0.58',
      '--fl-bg-scale':      '1.28',
      '--fl-tint-image': `
        linear-gradient(90deg, rgba(8,8,10,0.18), rgba(8,8,10,0.66)),
        radial-gradient(ellipse 90% 70% at 20% 50%, var(--accent-glow), transparent 66%)`,
      '--fl-text-size':     '24px',
      '--fl-text-weight':   '760',
      '--fl-prev-size':     '12.5px',
      '--fl-prev-color':    'rgba(255,255,255,0.42)',
      '--fl-letter-spacing':'0.2px',
      '--fl-text-shadow':   '0 2px 12px rgba(0,0,0,0.58)',
      '--fl-chrome-bg':     'rgba(8,8,10,0.38)',
      '--fl-chrome-fg':     'rgba(255,255,255,0.9)',
      '--fl-chrome-border': 'rgba(255,255,255,0.12)',
      '--fl-chrome-artist': 'rgba(255,255,255,0.58)',
      '--fl-chrome-btn-hover-bg': 'rgba(255,255,255,0.14)',
    },
  },

  // ---------- single · subtitle (desktop subtitle strip) ----------
  {
    name: 'subtitle', label: '字幕', window: 'subtitle-strip',
    layout: 'single', reveal: 'none',
    customClass: true, // bottom aligned transparent-subtitle treatment
    tokens: {
      '--fl-bg-image':      'none',
      '--fl-bg-color':      'transparent',
      '--fl-tint-image':    'none',
      '--fl-text-color':    '#ffffff',
      '--fl-text-size':     '30px',
      '--fl-text-weight':   '820',
      // Subtitle is meant to be an unobtrusive strip — hold it down so
      // even fullscreen keeps it subtitle-sized, not headline-sized.
      '--fl-text-scale-bias': '0.75',
      '--fl-letter-spacing':'0px',
      '--fl-text-shadow': `
        0 2px 3px rgba(0,0,0,0.88),
        0 0 12px rgba(0,0,0,0.76)`,
      '--fl-text-stroke':   '0.7px rgba(0,0,0,0.72)',
      '--fl-chrome-bg':     'rgba(0,0,0,0.34)',
      '--fl-chrome-fg':     '#fff',
      '--fl-chrome-border': 'rgba(255,255,255,0.12)',
      '--fl-chrome-artist': 'rgba(255,255,255,0.58)',
    },
  },

  // ---------- stage · plasma (WebGL shader flow, domain-warped fbm) ----------
  {
    name: 'plasma', label: '流体', window: 'ambient',
    layout: 'stage', reveal: 'wave', fx: 'plasma',
    tokens: {
      // Hide the cover layer entirely — the shader is the background.
      // Bg color matches the shader's BASE_DARK so any uncovered edge (during
      // resize, or under the vignette) blends instead of revealing black.
      '--fl-bg-color':     '#1a0e3d',
      '--fl-bg-image':     'none',
      '--fl-bg-scale':     '1',
      '--fl-tint-image': `
        radial-gradient(ellipse 130% 100% at 50% 50%, transparent 50%, rgba(0,0,0,0.45) 100%),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 3px)`,
      '--fl-text-color':   '#ffffff',
      '--fl-text-weight':  '700',
      '--fl-text-size':    '32px',
      '--fl-letter-spacing':'0.4px',
      '--fl-text-shadow': `
        0 2px 12px rgba(0,0,0,0.55),
        0 0 24px rgba(255,255,255,0.45),
        0 0 48px var(--accent-glow)`,
    },
  },

  // ---------- stage · karaoke pop (per-character timing reveal) ----------
  {
    name: 'pop', label: '字弹', window: 'headline',
    layout: 'stage', reveal: 'karaoke',
    tokens: {
      '--fl-bg-blur':       '40px',
      '--fl-bg-saturate':   '1.6',
      '--fl-bg-brightness': '0.66',
      '--fl-bg-scale':      '1.4',
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.5)),
        radial-gradient(ellipse 90% 65% at 50% 50%, var(--accent-glow), transparent 65%)`,
      '--fl-text-color':    '#fffaf0',
      '--fl-text-size':     '34px',
      '--fl-text-weight':   '800',
      '--fl-letter-spacing':'0.6px',
      '--fl-text-shadow': `
        0 2px 14px rgba(0,0,0,0.55),
        0 0 22px var(--accent-glow)`,
    },
  },

  // ---------- single · piano (Deemo-style rainy piano ballad) ----------
  {
    name: 'piano', label: '雨夜钢琴', window: 'headline',
    layout: 'single', reveal: 'none',
    customClass: true, // needs piano-key strip + rain + serif treatment
    tokens: {
      '--fl-bg-saturate':   '0',      // grayscale the cover
      '--fl-bg-brightness': '0.42',
      '--fl-bg-blur':       '28px',
      '--fl-bg-scale':      '1.22',
      // Layers, top to bottom:
      //  1) heavy top→bottom vignette (melancholic dimming)
      //  2) warm sepia wash (faint, to tint grayscale cover toward paper)
      //  3) diagonal rain hatching, animated by --fl-tint-animation
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(15,12,10,0.55), rgba(8,6,5,0.82)),
        linear-gradient(180deg, rgba(90,60,30,0.06), rgba(60,40,20,0.12)),
        repeating-linear-gradient(14deg, rgba(255,255,255,0.055) 0 1px, transparent 1px 7px)`,
      '--fl-tint-animation': 'rain-fall 1.8s linear infinite',
      '--fl-text-font':     '"Iowan Old Style", "Palatino", "Songti SC", "STSong", serif',
      '--fl-text-weight':   '500',
      '--fl-text-size':     '34px',
      '--fl-letter-spacing':'2px',
      '--fl-text-color':    '#efe7d8',
      '--fl-text-shadow':   '0 2px 8px rgba(0,0,0,0.65), 0 0 24px rgba(0,0,0,0.5)',
      '--fl-chrome-bg':     'rgba(12,10,8,0.48)',
      '--fl-chrome-fg':     '#efe7d8',
      '--fl-chrome-border': 'rgba(239,231,216,0.14)',
      '--fl-chrome-artist': 'rgba(239,231,216,0.55)',
    },
  },

  // ---------- danmaku · fullscreen barrage / 弹幕 ----------
  // Best paired with: drag window to fullscreen + toggle click-through (◌ → ●).
  // The result is your desktop with lyric strips drifting across it like
  // bilibili comments, ignoring all your clicks.
  {
    name: 'danmaku', label: '弹幕', window: 'overlay',
    layout: 'danmaku', reveal: 'none',
    customClass: true, // disables body shadow + radius for true transparency
    tokens: {
      '--fl-bg-color':     'transparent',
      '--fl-bg-image':     'none',
      '--fl-tint-image':   'none',
      '--fl-text-color':   '#ffffff',
      '--fl-text-size':    '32px',
      '--fl-text-weight':  '800',
      '--fl-letter-spacing':'0.4px',
      // Heavy multi-layer shadow + thin stroke = readable on any background
      // (this is the trick bilibili / Niconico use too).
      '--fl-text-shadow': `
        0 2px 4px  rgba(0,0,0,0.95),
        0 0 12px   rgba(0,0,0,0.7),
        0 0 28px   rgba(0,0,0,0.45)`,
      '--fl-text-stroke': '0.6px rgba(0,0,0,0.6)',
      '--fl-chrome-bg':     'rgba(0,0,0,0.42)',
      '--fl-chrome-fg':     '#fff',
      '--fl-chrome-border': 'rgba(255,255,255,0.14)',
    },
  },

  // ---------- stage · ripple (water surface, onset → ring) ----------
  // Calm pond surface tinted by cover. Each audio onset spawns a circular
  // wave from a random point that expands and fades. Cheaper than plasma
  // (no fbm) — ~6 distance calcs per fragment per ripple.
  {
    name: 'ripple', label: '水波', window: 'ambient',
    layout: 'stage', reveal: 'wave', fx: 'ripple',
    customClass: true, // needed so app.js's onset-driven check can match `theme-ripple`
    tokens: {
      // Bg color matches the shader's WATER_DEEP so any uncovered edge blends.
      '--fl-bg-color':     '#0a0e1c',
      '--fl-bg-image':     'none',
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(8,10,18,0.16), rgba(8,10,18,0.42)),
        radial-gradient(ellipse 110% 80% at 50% 50%, transparent 50%, rgba(0,0,0,0.35) 100%)`,
      '--fl-text-color':    '#fafcff',
      '--fl-text-weight':   '700',
      '--fl-text-size':     '32px',
      '--fl-letter-spacing':'0.4px',
      '--fl-text-shadow': `
        0 2px 14px rgba(0,0,0,0.55),
        0 0 22px rgba(180,210,255,0.45)`,
    },
  },

  // ---------- stage · sakura (falling petals) ----------
  // Cover-tinted petals fall + sway across the canvas. Lyrics stay in stage
  // layout on top — petals are background only. Pure CSS-driven animation,
  // no GPU/spectrum cost.
  {
    name: 'sakura', label: '樱花', window: 'ambient',
    layout: 'stage', reveal: 'wave',
    customClass: true,
    tokens: {
      // Dusk sky: warm pink-purple top → cool indigo bottom. Brightened from
      // the previous near-black gradient so the bg actually reads as a sky.
      '--fl-bg-color':     '#2a1a3a',
      '--fl-bg-image':     'linear-gradient(180deg, #4a2840 0%, #2e1c3a 45%, #1a1428 100%)',
      '--fl-bg-blur':      '0px',
      // Top: hint of warm twilight glow. Bottom: ground-level accent wash so
      // accent color from cover seeps in subtly. No heavy darkening overlay.
      '--fl-tint-image': `
        radial-gradient(ellipse 85% 50% at 50% -10%, rgba(255,180,200,0.18), transparent 70%),
        radial-gradient(ellipse 80% 55% at 50% 105%, var(--accent-glow), transparent 75%)`,
      '--fl-text-color':    '#fff5f0',
      '--fl-text-size':     '32px',
      '--fl-text-weight':   '700',
      '--fl-letter-spacing':'0.4px',
      '--fl-text-shadow':   '0 2px 14px rgba(0,0,0,0.55), 0 0 24px var(--accent-glow)',
    },
  },

  // ---------- stage · storm (heavy rain + lightning on onset) ----------
  // Like piano's rain but heavier, no piano keys, with full-canvas lightning
  // flashes triggered by hard onsets. Uses --fl-tint-animation to slide the
  // rain hatching the same way piano theme does.
  {
    name: 'storm', label: '暴雨', window: 'ambient',
    layout: 'stage', reveal: 'wave',
    customClass: true,
    tokens: {
      '--fl-bg-saturate':   '0.6',
      '--fl-bg-brightness': '0.36',
      '--fl-bg-blur':       '22px',  // was 34 — heavy blur was the main perf cost
      '--fl-bg-scale':      '1.18',
      // Crank the rain hatching opacity way up so it actually reads as rain
      // against a dark cover. Two layers at slightly different angles +
      // densities = parallax-feeling sheet of rain. Low solid darkening on
      // top so the rain survives.
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(6,10,20,0.45), rgba(2,4,12,0.7)),
        repeating-linear-gradient(20deg, rgba(255,255,255,0.22) 0 1.5px, transparent 1.5px 4px),
        repeating-linear-gradient(17deg, rgba(255,255,255,0.12) 0 1px,   transparent 1px 7px)`,
      '--fl-tint-animation':'storm-rain 0.9s linear infinite',
      '--fl-text-color':    '#e8eef8',
      '--fl-text-weight':   '700',
      '--fl-text-size':     '32px',
      '--fl-letter-spacing':'0.4px',
      '--fl-text-shadow':   '0 2px 14px rgba(0,0,0,0.7), 0 0 24px rgba(160,180,220,0.35)',
    },
  },

  // ---------- solo · instrumental visualizer / 纯音乐 ----------
  // The default target for tracks NetEase flagged with pureMusic. No cover,
  // no lyrics — full-canvas spectrum + onset-driven particles, with the song
  // title centered. Auto-switch maps trackKind:'instrumental' here by default.
  {
    name: 'instrumental', label: '纯音乐', window: 'ambient',
    layout: 'solo', reveal: 'none',
    customClass: true,
    tokens: {
      '--fl-bg-color':      '#06050c',
      '--fl-bg-image':      'none',
      '--fl-tint-image':    'none',
      '--fl-text-color':    '#fffaf2',
      '--fl-text-size':     '20px',
      '--fl-text-weight':   '700',
      '--fl-letter-spacing':'0.4px',
      '--fl-chrome-bg':     'rgba(0,0,0,0.42)',
      '--fl-chrome-fg':     '#fff',
      '--fl-chrome-border': 'rgba(255,255,255,0.12)',
      '--fl-chrome-artist': 'rgba(255,255,255,0.58)',
    },
  },

  // ---------- conversation · iMessage refresh / 短信 ----------
  // Lyrics as one-sided chat: each line is a new message bubble appended at
  // the bottom; the singer is the sender, you only read. Gap → typing dots.
  {
    name: 'imsg', label: '短信', window: 'card',
    layout: 'conversation', reveal: 'none',
    customClass: true,
    tokens: {
      // Use the blurred album cover so the room takes on the song's color,
      // but pin brightness low + add a heavy bottom-weighted vignette so the
      // accent-gradient bubble at the bottom never blends into a same-hue bg.
      '--fl-bg-color':      '#0d0c14',
      '--fl-bg-blur':       '46px',
      '--fl-bg-saturate':   '1.55',
      '--fl-bg-brightness': '0.42',
      '--fl-bg-scale':      '1.4',
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.62) 100%),
        radial-gradient(ellipse 90% 60% at 50% 0%, var(--accent-glow), transparent 60%)`,
      // Match Apple Messages: SF text, no serif fallback. Override the global
      // CJK fallback first so 中/日 lyrics also render in the system UI face.
      '--fl-text-font':     '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans", system-ui, sans-serif',
      '--fl-text-color':    '#f4f0e8',
      '--fl-text-size':     '14px',
      '--fl-text-weight':   '500',
      '--fl-text-shadow':   'none',
      '--fl-letter-spacing':'0.2px',
      '--fl-chrome-bg':     'rgba(255,255,255,0.04)',
      '--fl-chrome-fg':     '#f4f0e8',
      '--fl-chrome-border': 'rgba(255,255,255,0.08)',
      '--fl-chrome-artist': 'rgba(255,255,255,0.5)',
    },
  },

  // ---------- conversation · duet / 对唱 ----------
  // Two voices alternating: even lines speak in accent (left), odd lines in
  // accent-comp (right). Past bubbles keep their side color faintly so the
  // back-and-forth stays legible scrolling up.
  {
    name: 'duet', label: '对唱', window: 'card',
    layout: 'conversation', reveal: 'none',
    customClass: true,
    tokens: {
      // Two-voice variant uses the cover too, but pulled even darker — the
      // duet bubbles span both accent and accent-comp, so any single-hue bg
      // tint is guaranteed to clash with one of them. Heavy desat + dark
      // vignette keeps the bg as ambient haze rather than a competing color.
      '--fl-bg-color':      '#0a0810',
      '--fl-bg-blur':       '52px',
      '--fl-bg-saturate':   '1.1',
      '--fl-bg-brightness': '0.32',
      '--fl-bg-scale':      '1.42',
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(0,0,0,0.22), rgba(0,0,0,0.55)),
        radial-gradient(ellipse 70% 45% at 25% 25%, var(--accent-glow), transparent 70%),
        radial-gradient(ellipse 70% 45% at 75% 75%, var(--accent-comp-soft), transparent 70%)`,
      '--fl-text-font':     '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans", system-ui, sans-serif',
      '--fl-text-color':    '#f4f0e8',
      '--fl-text-size':     '13px',
      '--fl-text-weight':   '600',
      '--fl-text-shadow':   'none',
      '--fl-letter-spacing':'0.2px',
      '--fl-chrome-bg':     'rgba(255,255,255,0.03)',
      '--fl-chrome-fg':     '#f0ece4',
      '--fl-chrome-border': 'rgba(255,255,255,0.06)',
      '--fl-chrome-artist': 'rgba(255,255,255,0.5)',
    },
  },

  // ---------- triplet · minimal (Apple Music look) ----------
  {
    name: 'minimal', label: 'Apple Music', window: 'wide',
    layout: 'triplet', reveal: 'none',
    customClass: true, // left-align + mask fade on prev/next
    tokens: {
      '--fl-bg-blur':       '42px',
      '--fl-bg-saturate':   '1.55',
      '--fl-bg-brightness': '0.78',
      '--fl-bg-scale':      '1.38',
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.55)),
        radial-gradient(ellipse 120% 80% at 50% 50%, transparent 40%, rgba(0,0,0,0.25) 100%)`,
    },
  },
];

// Dual export: CommonJS (main.js `require`) + window global (renderer <script>).
if (typeof module !== 'undefined') module.exports = THEMES;
if (typeof window !== 'undefined') window.FL_THEMES = THEMES;

})();
