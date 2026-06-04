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
│  · runNowPlaying(): read muse /now (muse-only, no fallback)   │
└───────────────────────────────┬───────────────────────────────┘
                                │ IPC (preload.js → window.api)
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                     Renderer (renderer/)                      │
│   app.js orchestrates;  data → theme tokens → DOM → CSS / GL  │
└───────────────────────────────────────────────────────────────┘
```

Main owns the window, the tray, and the single way of reading "what song is
playing" (muse's `/now`). The renderer does the visual work.

## Renderer modules

The renderer is split into focused `window.FL_*` modules (plain `<script>`s
sharing global scope, an IIFE each), loaded *before* `app.js` so it can call
into them. `app.js` is the orchestration core; everything self-contained lives
in a sibling module.

| File | Exposes | Role |
|------|---------|------|
| `app.js` | — | Orchestration: poll loop, local clock (`tick`), lyric fetch, `renderStage`/`renderAt`, accent extraction, `applyTheme`, window-override memory, responsive scale. |
| `themes.js` | `FL_THEMES` | Theme registry — the single source of truth (also `require`d by main for the tray). |
| `lrc.js` | `LRC` | LRC parsing → sorted line-level model (`parseLRC`) + active-line lookup (`findIndex`). |
| `netease.js` | `Netease` | Search by title+artist, fetch LRC + cover. LRU-cached. |
| `fx.js` | `FL_FX` | WebGL shader layer (`plasma`). `start/stop/setColors/pulse`. |
| `conversation.js` | `FL_CONVO` | Chat-bubble stream (imsg). |
| `danmaku.js` | `FL_DANMAKU` | Right→left barrage. |
| `audio.js` | `FL_AUDIO` | **Dormant** spectrum WS client + onset detector. See §Audio engine. |

### Data flow

```
pollNowPlaying (800ms) ──new track?──▶ fetchLyricsFor (songId → netease) → LRC.parseLRC
                                            │
                                  applyEffectiveTheme → commitTrack
                                            │
            tick (rAF) runs the local clock → renderAt → dispatch by data-layout
```

Track identity (`title|artist`) is the cache key; a new key triggers a lyrics
fetch, the same key just updates the clock. Because muse owns the `<audio>`
element and reports a frame-accurate `currentTime`, the local clock is
re-anchored every poll to `positionSampledAt` (see `NOW_PLAYING.md`), so the
0–1 s poll lag never surfaces as lyric drift.

### Visual stack

Z-ordered, bottom to top:

```
#bg        Album cover (CSS filter: blur/saturate/brightness) or a theme bg-color
#fx        Optional WebGL shader (only lit by themes with `fx:` — currently plasma)
#tint      Gradient + grain + vignette (tokens drive it)
#stage     ← `stage` layout: floating lyric cards at center
#lyrics    ← `single` layout: the current line, large
#convo     ← `conversation` layout: chat bubbles
#danmaku   ← `danmaku` layout: drifting strips
#topbar    Title + buttons (revealed on hover)
#toast     Theme-change confirmation
```

## Themes

A theme is a composition along orthogonal axes — the whole registry is just data
in `renderer/themes.js`:

| Axis      | Values (in use)                                  | Lives in              |
|-----------|--------------------------------------------------|-----------------------|
| `layout`  | `stage` / `single` / `conversation` / `danmaku`  | `data-layout` on body |
| `reveal`  | `wave` / `typewriter` / `ink` / `none`           | `data-reveal` on body |
| `tokens`  | `--fl-*` custom properties                       | inline on body        |
| `window`  | `headline` / `subtitle-strip` / `ambient` / `overlay` / `card` | window bounds + click-through, applied by main on switch |

The six shipping themes: **typewriter** / **ink** (stage), **plasma** (stage +
plasma shader), **subtitle** (single), **danmaku** (danmaku), **imsg**
(conversation). Only themes that need something tokens can't express (the
typewriter cursor, the subtitle pill, danmaku transparency, imsg bubbles) set
`customClass: true` and get a small `body.theme-<name>` block in `style.css`
§BESPOKE.

`window` profiles encode the *mode of consumption*: `headline` is the top-center
card; `subtitle-strip` is a bottom-pinned full-width strip; `ambient` is
fullscreen-but-interactable (plasma — sit beside it, don't click through);
`overlay` is fullscreen + click-through (danmaku); `card` is a portrait sidebar
(imsg). Profile name → bounds resolution lives in `main.js` (only main has
`screen`); `themes.js` just declares the name.

**Override memory.** User moves/resizes and manual click-through toggles are
persisted per-theme (`theme.bounds.<name>` / `theme.clickthrough.<name>` in
localStorage) so they stick across theme switches; main fires
`theme-bounds-changed` / `theme-clickthrough-changed` (debounced) and the
renderer persists. Tray "重置该主题的窗口" wipes both and re-applies the profile.

### Color + beat

| Hook                  | What it does                                        |
|-----------------------|-----------------------------------------------------|
| `extractAccent(url)`  | 24×24 canvas sample → `--accent` (vivid) + `--ambient` (average) |
| `applyAccentFromCover`| Short-circuits on same URL; caches results          |
| `FL_FX.setColors`     | Feeds the vivid color into the plasma shader        |
| `FL_FX.pulse()`       | Beat bump on every line change (plasma warp speeds up briefly) |

### Animation pipeline (stage layout)

1. `tick()` sees `LRC.findIndex()` returned a new index.
2. `renderStage(line)` splits the text into per-codepoint `.w > .wi` spans.
3. Old cards get `.leaving` — CSS transitions transform/filter/opacity over
   `STAGE_LEAVE_MS` (2200 ms) before DOM removal, so departing lines dissipate
   rather than cut.
4. The new card's `.wi` spans animate by `data-reveal` with
   `animation-delay: calc(var(--i) * Xms)` for a per-char stagger.

`single` swaps the current line with a crossfade (`.changing` for
`OUT_DURATION_MS`); `conversation` appends a bubble; `danmaku` spawns one
self-removing flying strip.

### Responsive scale

`--fl-scale` is written by `updateScale()` from the window diagonal. A dead zone
keeps the default window at exactly 1.0; past ~900 diagonal a power curve grows
toward a ~3.2× cap. Lyric font-sizes multiply this variable, so fullscreen gets
dramatic type without any theme needing a breakpoint. Chrome (topbar, buttons)
is **not** scaled — affordances stay a stable hit target. Per-theme override:
`--fl-text-scale-bias` (subtitle uses 0.75 so fullscreen stays subtitle-sized).

## Audio engine (dormant)

`audio.js` keeps the muse `/spectrum` WS client + a spectral-flux onset detector
alive, but **no current theme consumes it** — it's infrastructure kept ready for
a future audio-reactive theme. The earlier piano-key strip and instrumental
visualizer (its only consumers) were removed with their themes.

The WS stays warm (latest frame cached, `window.__piano` diagnostics live). A
future theme registers a handler:

```js
FL_AUDIO.onOnset((velocity, centroid) => { /* react */ });
```

`FL_AUDIO.frame()` (called each tick) runs the detector continuously — it's
cheap (early-returns unless muse pushed a fresh frame) and keeps `__piano`
diagnostics live — but with no handler registered, the detected onsets simply
go nowhere. The DSP rationale is in [`AUDIO_ANALYSIS.md`](./AUDIO_ANALYSIS.md).

## Adding things

### A new theme

1. Append an entry to `renderer/themes.js` with `name`, `label`, `layout`,
   `reveal`, `window`, `tokens`.
2. Done. It shows up in the tray menu automatically.
3. Only if the effect can't be expressed with tokens, set `customClass: true`
   and add a small `body.theme-<name>` block under §BESPOKE in `style.css`.

### A new reveal animation

1. Add a `@keyframes reveal-<name>` to `style.css` §REVEALS.
2. Add a `body[data-reveal="<name>"] .stage-card .wi { animation: ... }` rule.
3. Reference it from a theme as `reveal: '<name>'`.

### A new layout

Append a dispatch case under §LAYOUTS in `style.css` (toggle which DOM subtree
is visible) and handle it in `app.js renderAt`. For self-contained rendering,
add a sibling `FL_*` module rather than growing `app.js`.

### An audio-reactive theme

The engine is already there — call `FL_AUDIO.onOnset(cb)` (see §Audio engine);
no muse rebuild needed (muse is a dumb spectrum pipe).

## Boundaries worth preserving

- **muse → echo is one-way.** muse publishes on `http://127.0.0.1:10755`; echo
  polls. Do not add a control channel back.
- **muse-only.** echo reads only muse's `/now` — there is no `nowplaying-cli` /
  MediaRemote fallback anymore. If muse is down, echo shows its idle state.
- **Theme registry is the single source of truth.** main.js and the renderer
  both load `themes.js`; don't duplicate theme lists anywhere else.
- **Chrome doesn't scale; lyrics do.** Resist multiplying topbar/button sizes by
  `--fl-scale`.
