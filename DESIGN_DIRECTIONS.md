# Design Directions

A living catalogue of visual / interaction ideas for echo that go
beyond the current theme inventory. Use this as a starting point when you (or
future-Claude) are hunting for the next theme — the buckets below are framed
as "which dimension are you attacking?", not as finished designs.

None of these are committed work. Pick, remix, discard.

## 1. Object metaphor — the widget pretends to be a real thing

The strongest lever in the catalogue, because brains respond to objects more
than to UI.

- **Solari flip-board** (train-station split-flap display). Each character
  is a flap that noisily rotates into its new letter on line change; the
  cascade across chars gives instant mechanical charisma.
- **Bound book** — lyrics sit on a center spread; page corner curls 2° on
  line change; background tones toward aged paper. Focus on the page-turn,
  not the type.
- **Vinyl record** — non-rectangular circular window; spiraling groove;
  lyrics travel along it; current character under a virtual stylus.
- **Handwritten letter** — cursive, inky, an occasional strike-through; a
  wax seal at the corner; reveal as if someone is writing in real time.
- **Matchbox / Post-it** — shrunk-down micro widget for screen corners.
- **Polaroid** — cover photo above, handwritten lyric on the white border.

## 2. Ambient / place — the widget is a window into somewhere

Elevates from "display" to "view".

- **Night train window** — abstract light streaks drift past; lyrics read as
  reflections on the glass. Loneliness, motion.
- **Rain on glass** — real WebGL water droplets driven by RMS; text refracts
  through them. Piano theme's shader-grade sibling.
- **Aquarium / underwater** — particles as plankton; text floats up.
- **Constellation / star chart** — characters as stars, hairlines connect
  them into a figure; on line change, figure re-forms.
- **Misty mountains** — distant silhouette + drifting fog whose density
  tracks loudness; lyrics feel inscribed on the landscape.
- **Horizon** — one thin line across the whole widget + a single luminous
  point; sky tint follows wall-clock time.

## 3. Writing medium — typewriter is one, there are many

- **Brush ink (sumi-e)** — per-stroke SVG reveal using glyph path data; the
  *act of writing* is the animation.
- **Chalk on blackboard** — grainy texture, faint dust falling; erase wipe
  between lines.
- **Neon tubes** — bent glass with buzz-flicker; old line cuts out, new line
  segments light sequentially.
- **Dot-matrix printer** — line prints band-by-band with a micro-jitter.
- **Sand painting** — particles blown into letterforms, then scattered away.
- **Broken LED display** — pixel grid with occasional dead pixels. Industrial.

## 4. Kinetic typography — the text *is* the animation

Every music-video design tradition and no lyric widget has really done it.

- **Semantic motion** (needs a one-time LLM pre-pass per song): words with
  meanings like *fall* fall, *forever* stretches wide, *break* shatters.
  High leverage because the preprocessing is cacheable.
- **Weight-on-accent** — stressed syllables bump font weight by 20% then
  spring back, timed to beat. Only the key words move; the rest holds still.
- **Breathing letter-spacing** — whole line's letter-spacing tracks RMS;
  quiet passages cram, crescendos stretch.
- **Staggered word entry** — words (not chars) enter with delays weighted by
  semantic importance (content words first, function words trailing).

## 5. Window shape — break out of the rounded rectangle

The widget doesn't have to be a 520×220 pill. Electron supports non-rect
windows via transparent + shaped content.

- **Circular badge** — small disc near the menu bar; current char centered,
  neighbors orbiting.
- **Vertical strip** — tall narrow bar hugging a screen edge; CJK text
  natively; reads like a scroll.
- **Halo ring** — only text is opaque; it appears to float with no visible
  container.
- **Multi-window layout** — split cover / lyrics / piano strip into three
  windows the user arranges themselves.
- **Breathing window** — window bounds shrink/grow with song dynamics;
  quiet = 400px, chorus = 600px.

## 6. Temporal memory — use more than the present

Lyrics don't have to show only *now*.

- **Today's tape** — hairline timeline at window bottom with color dots for
  every song played today; hover to recall.
- **Line accumulation** — old lines shrink to a corner stack instead of
  vanishing; the "sentences I heard today" build up until a threshold.
- **Full-song view** (expand mode) — whole lyric scrolls, current line
  highlighted at center. Apple Music's lyrics soul, more restrained.
- **Year in lyrics** — auto-save one line per day the moment you first hit
  play that morning; end-of-year retrospective.

## 7. Ritual / context — be different things at different times

- **Morning mode** — warm cream paper, serif, near-zero animation. Auto-on
  07:00–10:00.
- **Late-night mode** — near-black, very slow, letters self-illuminating.
  Auto-on after 23:00.
- **Focus mode** — minimizes chrome, text intentionally slightly blurred so
  it's companionship without distraction. Triggers off macOS Focus hooks.
- **First-song ceremony** — the day's first track gets a one-time "unfold"
  animation where the window blooms from a single point.

## 8. Beyond the screen

- **Hue / smart-light sync** — push cover's accent palette to Philips Hue.
- **Menu-bar mini mode** — a one-character glyph in the macOS menu bar,
  always visible.
- **Lockscreen widget** — iOS / macOS lockscreen via App Intents.
- **AirPlay to picture frame / TV** — piano immersive mode pushed to the
  wall as ambient room art.

## Cross-cutting notes

- **Spectrum-reactive** visuals (rain density, letter-spacing breathing,
  particle motion) are cheap to add once the v1.2 spectrum channel is
  online — prefer those when choosing between equivalent ideas, because
  they multiply the sense that the widget is *listening*, not displaying.
- **One-time LLM passes over lyrics** unlock kinetic typography and
  semantic color — the analysis is cheap per-song and cacheable forever
  by `songId`.
- **Avoid** turning every theme into a full-screen stage — the widget's
  charm is that it's ambient. Dramatic themes should be opt-in
  ("immersive" frame), not default.
