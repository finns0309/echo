# Architecture

How the pieces fit together. Written for whoever (future-you or future-me) needs
to add a theme, a reveal animation, or a new data source without having to
reverse-engineer the codebase first.

For the now-playing wire protocol between muse and this app, see
[`./NOW_PLAYING.md`](./NOW_PLAYING.md) — that document is canonical.

## High-level shape

```
┌───────────────────────────────────────────────────────────────┐
│                   Electron main (main.js)                     │
│  · BrowserWindow: transparent, always-on-top, frameless       │
│  · Tray + right-click menu (theme list)                       │
│  · runNowPlaying(): muse /now → nowplaying-cli fallback       │
│  · broadcast socket at /tmp/echo.sock              │
└───────────────────────────────┬───────────────────────────────┘
                                │ IPC (preload.js)
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                     Renderer (renderer/)                      │
│   data → theme tokens → DOM → CSS animation → GL fx           │
└───────────────────────────────────────────────────────────────┘
```

The renderer does the heavy lifting. Main exists to own the window, the tray,
and the two platform-specific ways of reading "what song is playing".

## Renderer components

Five concerns, kept as orthogonal as practical.

### 1. Data

| File           | Role                                                              |
|----------------|-------------------------------------------------------------------|
| `netease.js`   | Search by title+artist, fetch LRC. LRU-cached, single retry.      |
| `lrc.js`       | LRC parsing, original+translation merge, binary-search current idx|
| `app.js`       | `pollNowPlaying()` every 800 ms; `tick()` runs local clock via rAF|

Track identity is the cache key; a new `trackKey` triggers a lyrics fetch,
same key just updates the clock.

When `muse` is the source, the local clock is re-anchored every poll to
`positionSampledAt` (see `NOW_PLAYING.md`), so the 0–1 s poll lag doesn't
leak into rendered position. When `nowplaying-cli` is the source (NetEase
official client), `elapsed` is unreliable — we ignore it and let the local
wall clock run, showing the "后备模式" badge.

### 2. Visual stack

Z-ordered, bottom to top:

```
#bg        Album cover (CSS filter: blur/saturate/brightness)
#fx        Optional WebGL shader layer (only lit by themes with `fx:`)
#tint      Gradient + grain + vignette (tokens drive it)
#stage     ← `stage` layout: floating lyric cards at center
#lyrics    ← `triplet` / `single` layout: prev/curr/next
#topbar    Title + buttons (revealed on hover)
#toast     Theme-change confirmation
#source-badge  Fallback-mode warning
```

### 3. Themes

A theme is a composition along four orthogonal axes:

| Axis      | Values                                        | Lives in          |
|-----------|-----------------------------------------------|-------------------|
| `layout`  | `stage` / `triplet` / `single` / `conversation` / `solo` / `danmaku` | `data-layout` on body |
| `reveal`  | `wave` / `typewriter` / `ink` / `glint` / `karaoke` / `none` | `data-reveal` on body |
| `frame`   | `full` / `cover-left`                         | `data-frame` on body  |
| `tokens`  | `--fl-*` custom properties                    | inline on body     |
| `window`  | `headline` / `wide` / `card` / `subtitle-strip` / `ambient` / `overlay` | window bounds + click-through, applied by main on theme switch |

`window` profiles encode the *mode of consumption*: `headline` is the
legacy 520×220 top-center card; `wide` is the same shape but roomier for
cover-left/triplet themes; `card` is a portrait sidebar for chat-style
layouts; `subtitle-strip` is a bottom-pinned full-width strip; `ambient`
is fullscreen-but-interactable (流体 / 水波 / 樱花 / 暴雨 / 纯音乐 — sit
beside it, don't click through it); `overlay` is fullscreen + click-through
(弹幕). Profile name → bounds resolution lives in `main.js` (only main has
`screen`); themes.js just declares the profile name.

**Override memory.** User-driven moves/resizes and manual click-through
toggles are persisted per-theme so they stick across theme switches:

- `theme.bounds.<name>` ← written when main fires `theme-bounds-changed`
  (debounced 250ms after a `move` / `resize` event). Self-emitted events
  from `applyWindowProfile`'s own `setBounds` are suppressed for 300ms so
  profile defaults aren't echoed back as user overrides.
- `theme.clickthrough.<name>` ← written when main fires
  `theme-clickthrough-changed` (manual `◌/●` button or tray "Toggle
  click-through"; profile-driven flips do NOT fire this).
- `applyTheme` reads both keys via `loadWindowOverride(name)` and passes
  them as the second arg to `applyWindowProfile`. Either half can be
  absent; the absent half falls back to the profile default.
- Tray "重置该主题的窗口" sends `reset-window-override`; renderer wipes
  both keys for the active theme and re-applies the profile cleanly.

The registry (`renderer/themes.js`) is the single source of truth — it's
`require`d by main for the tray menu and exposed on `window.FL_THEMES` for
the renderer. Each entry is one theme; adding a theme usually means just
appending an entry.

Only themes that need something tokens can't express (blinking cursor,
breathing pulse, bespoke mask) set `customClass: true` and get a small
`body.theme-<name>` block in `style.css §BESPOKE`.

### 4. Color + beat

| Hook                  | What it does                                        |
|-----------------------|-----------------------------------------------------|
| `extractAccent(url)`  | 24×24 canvas sample → `--accent` (vivid) + `--ambient` (average) |
| `applyAccentFromCover`| Short-circuits on same URL; caches results         |
| `FL_FX.setColors`     | Feeds the same palette into the shader layer       |
| `FL_FX.pulse()`       | 0.65 beat bump on every line change (exp decay)    |

This is the thin seam that makes the UI feel like it's listening to the song
rather than displaying text on top of it.

### 5. Animation pipeline

What happens in the ~60 frames of a line change (stage layout):

1. `tick()` sees `findIndex()` returned a new index.
2. `renderStage(newText)` is called.
3. Existing `.stage-card`s get `.leaving` — CSS transitions `transform`,
   `filter`, `opacity` over `STAGE_LEAVE_MS` (2200 ms) before DOM removal.
4. The new `.stage-card` is inserted. Each char becomes
   `.w > .wi` with `style.--i = charIndex`.
5. CSS dispatches on `data-reveal`: every `.wi` animates with
   `animation-delay: calc(var(--i) * Xms)` for a per-char stagger.
6. The card itself rides a slow `w-float` loop so chars micro-breathe in place.

Triplet/single layouts take a simpler path: `app.js:renderAt` adds
`.changing` to `#curr`, waits `OUT_DURATION_MS` (280 ms), swaps text, removes
the class — a single crossfade rather than per-char choreography.

### 6. Responsive scale

`--fl-scale` is written by `updateScale()` in `app.js` from the window
diagonal, recomputed on resize. A dead zone keeps the default 520×220 window
(and any casual resize up to ~900 diagonal) at exactly 1.0; past that, a
power curve grows toward a ~3.2× cap. Every lyric font-size and leave
distance multiplies this variable, so fullscreen gets dramatic type without
any theme needing its own breakpoint.

Per-theme override: `--fl-text-scale-bias` (default 1). `subtitle` uses 0.75
so fullscreen still feels like a subtitle strip rather than a headline.

Chrome (topbar, buttons, toast) is **not** scaled — affordances stay a
stable hit target at every window size.

## Adding things

### A new theme

1. Append an entry to `renderer/themes.js` with `name`, `label`, `layout`,
   `reveal`, `tokens`.
2. Done. It shows up in the tray menu automatically and the renderer routes
   it on `apply-theme`.
3. If the effect genuinely can't be expressed with tokens, set
   `customClass: true` and add a small `body.theme-<name>` block under
   `§BESPOKE THEME BLOCKS` in `style.css`.

### A new reveal animation

1. Add a `@keyframes reveal-<name>` to `style.css §REVEALS`.
2. Add a `body[data-reveal="<name>"] .stage-card .wi { animation: ... }` rule.
3. Reference it from a theme as `reveal: '<name>'`.

### A new layout or frame

Append a case under `§LAYOUTS` or `§FRAMES` in `style.css`. Layouts toggle
which DOM subtree (`#stage` vs `#lyrics`) is visible; frames reshape the
window-level regions (e.g. reserving a square for the cover).

### A new data source

Implement something that returns the shape `callMuseOnce` returns in
`main.js` (title/artist/album/elapsed/duration/rate, optional songId/cover/
positionSampledAt/stateVersion). Wire it into `runNowPlaying` ahead of the
existing fallbacks. The renderer doesn't need to change.

## Boundaries worth preserving

- **muse → echo is one-way.** muse publishes state on
  `http://127.0.0.1:10755/now`; echo polls. Do not add a control
  channel back — it would turn both processes into state machines that have
  to agree.
- **Theme registry is the single source of truth.** main.js and the renderer
  both `require`/load `themes.js`; don't duplicate theme lists anywhere else.
- **Chrome doesn't scale; lyrics do.** This is deliberate — resist the urge
  to multiply topbar/button sizes by `--fl-scale`. The widget should always
  be clickable the same way no matter how large it is.
