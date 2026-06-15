// Theme registry — single source of truth for both main (tray menu) and
// renderer (apply-theme dispatch).
//
// A theme is a composition of components:
//   layout: 'stage' | 'single' | 'conversation' | 'danmaku' | 'furin' | 'roam'
//     - stage:        floating cards at center, one per line. Per-char reveal.
//     - single:       only the current line, huge and centered.
//     - conversation: chat-bubble stream (imsg).
//     - danmaku:      fullscreen right→left barrage.
//     - furin:        hanging wind-chime ornament; lyric on the paper strip.
//     - ticket:       collectible holo concert ticket; lyric foil-stamped on
//                     the card, torn stubs pile into tonight's setlist.
//     - roam:         desktop-wide kinetic typography; a director stages each
//                     line somewhere on screen with its own choreography.
//     - eva:          NERV-terminal title cards; lyrics as hard-cut Mincho
//                     intertitles + live analysis chrome.
//     - shinkai:      time-of-day sky (light/clouds/wires); lyric lower third.
//     - idol:         star stage (penlight sea, spotlights, ★ glints).
//     - karaoke:      scrolling sing-along column; the active line fills
//                     per-syllable in real time (yrc), with a count-in.
//   reveal: 'wave' | 'typewriter' | 'ink' | 'none'
//     Per-char entrance animation. Only meaningful for layout=stage.
//   fx:     'plasma' | undefined  (optional GPU shader layer, renderer/fx.js)
//   window: 'headline' | 'subtitle-strip' | 'ambient' | 'overlay' | 'card' | 'hanging' | 'tall-card'
//     Mode of consumption → window bounds + click-through (resolved in main.js).
//   tokens: map of CSS custom properties applied to <body> (see style.css §TOKENS).
//   customClass: optional, adds `theme-<name>` to body for the few themes that
//     need a bespoke CSS block (typewriter cursor, subtitle strip, etc.).
//
// Adding a new theme: copy an entry, change name/label, tweak tokens. Only add a
// `body.theme-<name>` block + customClass: true if tokens can't express it.
//
// NOTE: the spectrum/onset engine (renderer/audio.js) now has consumers:
// furin (rms → wind, onsets → clapper kicks), roam (rms → director energy,
// onsets → stage glow), eva (onsets → A.T. field), ticket (rms → handling
// energy, onsets → tilt kicks, centroid → diffraction hue). Register more
// via FL_AUDIO.onOnset / getFrame.

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

  // ---------- stage · ember (WebGL rising-fire fbm) ----------
  {
    name: 'ember', label: '余烬', window: 'ambient',
    layout: 'stage', reveal: 'wave', fx: 'ember',
    tokens: {
      // Bg matches the shader's near-black base so any uncovered edge blends.
      '--fl-bg-color':     '#0a0200',
      '--fl-bg-image':     'none',
      '--fl-bg-scale':     '1',
      // Top-weighted vignette + faint scanline; the fire already darkens upward
      // so the lyric near center sits over the hottest, most legible band.
      '--fl-tint-image': `
        radial-gradient(ellipse 130% 100% at 50% 60%, transparent 45%, rgba(0,0,0,0.5) 100%),
        repeating-linear-gradient(0deg, rgba(0,0,0,0.04) 0 1px, transparent 1px 3px)`,
      '--fl-text-color':   '#fff7ec',
      '--fl-text-weight':  '750',
      '--fl-text-size':    '32px',
      '--fl-letter-spacing':'0.4px',
      // Warm-dark shadow so white text stays readable over orange/white flame.
      '--fl-text-shadow': `
        0 2px 10px rgba(40,8,0,0.85),
        0 0 22px rgba(0,0,0,0.55),
        0 0 44px rgba(255,120,30,0.35)`,
      '--fl-chrome-bg':     'rgba(30,10,2,0.5)',
      '--fl-chrome-fg':     '#fff7ec',
      '--fl-chrome-border': 'rgba(255,160,80,0.18)',
      '--fl-chrome-artist': 'rgba(255,240,225,0.6)',
    },
  },

  // ---------- stage · hyperspace (WebGL radial star-streaks) ----------
  {
    name: 'warp', label: '曲速', window: 'ambient',
    layout: 'stage', reveal: 'wave', fx: 'warp',
    tokens: {
      '--fl-bg-color':     '#000005',
      '--fl-bg-image':     'none',
      '--fl-bg-scale':     '1',
      // Strong center-out vignette concentrates the streaks and keeps the
      // bright warp core from washing out the centered lyric.
      '--fl-tint-image': `
        radial-gradient(ellipse 90% 80% at 50% 50%, rgba(0,0,0,0.35) 0%, transparent 35%, rgba(0,0,0,0.5) 100%),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 3px)`,
      '--fl-text-color':   '#ffffff',
      '--fl-text-weight':  '700',
      '--fl-text-size':    '32px',
      '--fl-letter-spacing':'0.6px',
      '--fl-text-shadow': `
        0 2px 14px rgba(0,0,0,0.7),
        0 0 26px rgba(0,0,0,0.5),
        0 0 52px var(--accent-glow)`,
      '--fl-chrome-bg':     'rgba(4,4,18,0.5)',
      '--fl-chrome-fg':     '#fff',
      '--fl-chrome-border': 'rgba(255,255,255,0.14)',
      '--fl-chrome-artist': 'rgba(255,255,255,0.58)',
    },
  },

  // ---------- stage · cel sky (WebGL pastel toon clouds, ちいかわ vibe) ----------
  // The only LIGHT fx theme: pastel sky, so text is dark with a white halo
  // (the opposite of every other theme) to stay legible over white cloud.
  {
    name: 'sky', label: '天空', window: 'ambient',
    layout: 'stage', reveal: 'wave', fx: 'celsky',
    tokens: {
      // Match the shader's cream-bottom so any uncovered edge blends light.
      '--fl-bg-color':     '#fcefe2',
      '--fl-bg-image':     'none',
      '--fl-bg-scale':     '1',
      // No dark vignette here — keep it airy. A faint top-light wash only.
      '--fl-tint-image': `
        radial-gradient(ellipse 120% 80% at 50% 15%, rgba(255,255,255,0.25), transparent 60%)`,
      // Warm dark-brown text (Chiikawa's outline color) + white halo so it
      // lifts off both the white clouds and the blue sky.
      '--fl-text-color':   '#4a4039',
      '--fl-text-weight':  '820',
      '--fl-text-size':    '32px',
      '--fl-letter-spacing':'0.6px',
      '--fl-text-shadow': `
        0 1px 0 rgba(255,255,255,0.85),
        0 0 16px rgba(255,255,255,0.7),
        0 2px 10px rgba(120,100,80,0.25)`,
      '--fl-text-stroke':  '0.5px rgba(255,255,255,0.5)',
      '--fl-chrome-bg':     'rgba(255,250,244,0.6)',
      '--fl-chrome-fg':     '#4a4039',
      '--fl-chrome-border': 'rgba(120,100,80,0.18)',
      '--fl-chrome-artist': 'rgba(74,64,57,0.6)',
      '--fl-chrome-btn-hover-bg': 'rgba(120,100,80,0.1)',
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

  // ---------- roam · desktop-wide kinetic typography / 漫游 ----------
  // The danmaku idea generalized: fullscreen transparent + click-through, but
  // lines are staged anywhere by a director (renderer/roam.js) — quiet lines
  // drift in corners, phrase openings traverse the whole desktop, hot lines
  // bloom from the center, repeated lines replay their exact staging so the
  // chorus visually rhymes. Best fullscreen with click-through on.
  {
    name: 'roam', label: '漫游', window: 'overlay',
    layout: 'roam', reveal: 'none',
    customClass: true, // transparent body, like danmaku
    tokens: {
      '--fl-bg-color':     'transparent',
      '--fl-bg-image':     'none',
      '--fl-tint-image':   'none',
      '--fl-text-color':   '#ffffff',
      '--fl-text-weight':  '800',
      '--fl-letter-spacing':'0.4px',
      // Same readable-anywhere trick as danmaku: layered shadow + thin stroke.
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

  // ---------- shinkai · the sky as protagonist / 云隙 ----------
  // Case study in Makoto Shinkai's grammar: a time-of-day sky (real clock —
  // dawn/day/magic-hour/night palettes), sun with bloom + crepuscular rays,
  // baked cumulus, telephone-wire silhouettes with perched birds. Night
  // onsets earn shooting stars. Lyric sits small in the lower third.
  {
    name: 'shinkai', label: '云隙', window: 'ambient',
    layout: 'shinkai', reveal: 'none',
    customClass: true,
    tokens: {
      '--fl-bg-color':     '#101a3e',
      '--fl-bg-image':     'none',
      '--fl-tint-image':   'none',
      '--fl-text-color':   '#ffffff',
      '--fl-chrome-bg':     'rgba(16, 22, 48, 0.5)',
      '--fl-chrome-fg':     '#eaf2ff',
      '--fl-chrome-border': 'rgba(255, 255, 255, 0.18)',
      '--fl-chrome-artist': 'rgba(234, 242, 255, 0.6)',
    },
  },

  // ---------- idol · the star in the eye / 星瞳 ----------
  // Case study in Oshi no Ko's grammar: penlight sea that phase-locks as the
  // song surges (bright/dark duality on one energy axis), sweeping
  // spotlights, purple→pink six-point star glints on onsets, one lyric
  // character crowned with the eye-star. Idle = ghost light on an empty stage.
  {
    name: 'idol', label: '星瞳', window: 'ambient',
    layout: 'idol', reveal: 'none',
    customClass: true,
    tokens: {
      '--fl-bg-color':     '#0e0a18',
      '--fl-bg-image':     'none',
      '--fl-tint-image':   'none',
      '--fl-text-color':   '#ffffff',
      '--fl-chrome-bg':     'rgba(20, 12, 30, 0.55)',
      '--fl-chrome-fg':     '#ff9fc6',
      '--fl-chrome-border': 'rgba(255, 95, 162, 0.3)',
      '--fl-chrome-artist': 'rgba(255, 240, 250, 0.6)',
    },
  },

  // ---------- karaoke · sing-along lyrics / 卡拉OK ----------
  // A karaoke screen: a scrolling focus column where the active line fills
  // left→right per syllable in real time (real NetEase yrc when the song has
  // it, synthetic even-split otherwise), sung lines stay lit above, upcoming
  // wait empty below, and ●●● count-in dots deplete across the instrumental
  // gap before each line. Optional translation sub-line. renderer/karaoke.js.
  // Keeps the rounded-panel chrome — the blurred cover is the karaoke screen.
  {
    name: 'karaoke', label: '卡拉OK', window: 'karaoke',
    layout: 'karaoke', reveal: 'none',
    customClass: true,
    tokens: {
      // Blurred album cover as the karaoke screen, held dark so the bright
      // syllable fill and the count-in read on top of any cover.
      '--fl-bg-color':      '#0c0a12',
      '--fl-bg-blur':       '44px',
      '--fl-bg-saturate':   '1.5',
      '--fl-bg-brightness': '0.5',
      '--fl-bg-scale':      '1.35',
      '--fl-tint-image': `
        linear-gradient(180deg, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.64) 100%),
        radial-gradient(ellipse 92% 70% at 50% 32%, var(--accent-glow), transparent 64%)`,
      // The wipe palette: --kk-dim is the unsung outline, --kk-fill the sung
      // color (accent-tinted white so it lifts off the cover yet stays on-brand).
      '--kk-dim':   'rgba(255,255,255,0.30)',  // active line's unsung outline (faint, for contrast)
      '--kk-ctx':   'rgba(255,255,255,0.62)',  // context lines' base — readable so you can sing ahead
      '--kk-fill':  'color-mix(in srgb, var(--accent) 52%, #ffffff)',
      '--kk-trans': 'rgba(255,255,255,0.46)',
      '--kk-size':  '30px',
      '--fl-chrome-bg':     'rgba(14, 10, 22, 0.5)',
      '--fl-chrome-fg':     '#fff',
      '--fl-chrome-border': 'rgba(255, 255, 255, 0.14)',
      '--fl-chrome-artist': 'rgba(255, 255, 255, 0.6)',
    },
  },

  // ---------- eva · NERV-terminal title cards / 新世纪 ----------
  // Case study in a specified art direction: lyrics as 次回予告-style Mincho
  // intertitles on a bare black void (hard cuts, no easing); A.T.-field
  // hexagons ripple out on onsets and a lock-on sequence runs on track
  // change. renderer/eva.js.
  {
    name: 'eva', label: '新世纪', window: 'ambient',
    layout: 'eva', reveal: 'none',
    customClass: true,
    tokens: {
      '--fl-bg-color':     '#050505',
      '--fl-bg-image':     'none',
      '--fl-tint-image':   'none',
      '--fl-text-color':   '#f2f0e8',
      '--fl-chrome-bg':     'rgba(12, 9, 6, 0.6)',
      '--fl-chrome-fg':     '#ff6a00',
      '--fl-chrome-border': 'rgba(255, 106, 0, 0.28)',
      '--fl-chrome-artist': 'rgba(242, 240, 232, 0.5)',
    },
  },

  // ---------- furin · hanging glass wind-chime / 风铃 ----------
  // A desktop object, not a panel: an Edo-glass bell on a transparent strip
  // of window, lyric brushed vertically on the paper tanzaku. Breeze keeps it
  // alive when idle; muse's spectrum turns the song itself into the wind
  // (first consumer of the dormant FL_AUDIO engine).
  {
    name: 'furin', label: '风铃', window: 'hanging',
    layout: 'furin', reveal: 'none',
    customClass: true,
    tokens: {
      '--fl-bg-color':     'transparent',
      '--fl-bg-image':     'none',
      '--fl-tint-image':   'none',
      '--fl-text-color':   '#3a2f22',
      '--fl-chrome-bg':     'rgba(24, 18, 12, 0.42)',
      '--fl-chrome-fg':     '#fff',
      '--fl-chrome-border': 'rgba(255, 255, 255, 0.14)',
      '--fl-chrome-artist': 'rgba(255, 255, 255, 0.6)',
    },
  },

  // ---------- ticket · hologram concert ticket / 镭射票 ----------
  // A collectible K-pop laser ticket floats as a desktop object: song title
  // is the billing, the lyric is foil-stamped security print, stub + barcode
  // below. Audio handles the card, the foil answers — onsets tilt it (the
  // sheen sweep is caused by the turn), rms is handling energy, the spectral
  // centroid bends the diffraction hue. Song change tears the stub onto
  // tonight's setlist pile; stop chops a 散场 seal on the face.
  {
    name: 'ticket', label: '镭射票', window: 'tall-card',
    layout: 'ticket', reveal: 'none',
    customClass: true,
    tokens: {
      '--fl-bg-color':     'transparent',
      '--fl-bg-image':     'none',
      '--fl-tint-image':   'none',
      '--fl-text-color':   '#f2f6ff',
      '--fl-chrome-bg':     'rgba(16, 12, 34, 0.5)',
      '--fl-chrome-fg':     '#fff',
      '--fl-chrome-border': 'rgba(255, 255, 255, 0.14)',
      '--fl-chrome-artist': 'rgba(255, 255, 255, 0.6)',
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
