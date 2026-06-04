// Theme registry — single source of truth for both main (tray menu) and
// renderer (apply-theme dispatch).
//
// A theme is a composition of components:
//   layout: 'stage' | 'single' | 'conversation' | 'danmaku'
//     - stage:        floating cards at center, one per line. Per-char reveal.
//     - single:       only the current line, huge and centered.
//     - conversation: chat-bubble stream (imsg).
//     - danmaku:      fullscreen right→left barrage.
//   reveal: 'wave' | 'typewriter' | 'ink' | 'none'
//     Per-char entrance animation. Only meaningful for layout=stage.
//   fx:     'plasma' | undefined  (optional GPU shader layer, renderer/fx.js)
//   window: 'headline' | 'subtitle-strip' | 'ambient' | 'overlay' | 'card'
//     Mode of consumption → window bounds + click-through (resolved in main.js).
//   tokens: map of CSS custom properties applied to <body> (see style.css §TOKENS).
//   customClass: optional, adds `theme-<name>` to body for the few themes that
//     need a bespoke CSS block (typewriter cursor, subtitle strip, etc.).
//
// Adding a new theme: copy an entry, change name/label, tweak tokens. Only add a
// `body.theme-<name>` block + customClass: true if tokens can't express it.
//
// NOTE: the spectrum/onset engine (renderer/audio.js) is kept as dormant
// infrastructure — no current theme consumes it. A future audio-reactive theme
// re-wires its onset handler there; see audio.js.

// IIFE-wrapped so internal names (THEMES, etc.) don't leak to the shared
// global scope. Plain <script> tags all share one global scope, and app.js
// also defines a `THEMES` binding — without the wrapper they collide with
// "Identifier 'THEMES' has already been declared".
(function () {

const THEMES = [
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

  // ---------- conversation · iMessage refresh / 短信 ----------
  // Lyrics as one-sided chat: each line is a new message bubble appended at the
  // bottom; the singer is the sender, you only read. Gap → typing dots.
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
];

// Dual export: CommonJS (main.js `require`) + window global (renderer <script>).
if (typeof module !== 'undefined') module.exports = THEMES;
if (typeof window !== 'undefined') window.FL_THEMES = THEMES;

})();
