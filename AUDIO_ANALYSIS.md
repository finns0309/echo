# Audio Analysis

How echo turns muse's raw audio stream into "it feels like it's
listening to the music". Written as a reference for future-you so you don't
have to derive it again next time you want a theme to react to sound.

## What we're tracking: onset, not beat

These are different problems and it matters which one you pick:

| | **Onset** (what we do) | **Beat** (what we don't) |
|---|---|---|
| Definition | "A new sound started right now" | "The steady pulse of the song" |
| Tracks | Drum hits, note attacks, vocal consonants, guitar strums | BPM, downbeats |
| Requires | Per-frame analysis of spectrum deltas | Model of whole-song rhythm + tempo tracking |
| Latency | ~33 ms (one frame) | ~1–2 beats of lookahead / lag |
| Genre robustness | Works on anything with attacks | Falls apart on ambient / rubato / no-percussion |

For a visual widget that should feel alive in real time, onset is the right
target. Beat tracking is a much harder DSP problem (autocorrelation of onset
timestamps + priors over plausible tempi) and not worth the complexity for
this use case.

## Why spectral flux works so well

Onset detection on a 30 fps band-spectrum stream reduces to one formula:

```
flux = Σ max(0, band[i]_now − band[i]_prev)
```

Two clever properties are baked into those few symbols:

1. **Only positive deltas count.** A note that was struck is decaying for
   the next few seconds; every frame it contributes *0* to flux (because
   `band[i]_now < band[i]_prev`). So held notes / sustained pads / long
   cymbals don't keep re-triggering — flux only jumps when something
   genuinely new enters.

2. **Per-band, not total-RMS.** Looking at each frequency band
   independently means dense music (where overall loudness stays high)
   can still reveal new attacks: when a new note comes in, its band's
   energy jumps even if the total RMS barely changes. Kick drums,
   hi-hats, vocal consonants — they each light up a different subset of
   bands, so flux catches all of them.

Classic DSP: variations of this idea (high-frequency content, complex-domain
deviation, phase deviation) all exist and are marginally better in edge
cases. But plain spectral flux is ~85% as good as the state of the art with
~5% of the complexity — a great trade for a visual widget.

## Producer / consumer split

**muse knows nothing.** It is a dumb pipe:

1. `AnalyserNode.getByteFrequencyData()` → 256 FFT bins
2. Log-spaced downsample to 24 bands (60 Hz–12 kHz)
3. `sqrt()` for perceptual curve
4. Compute RMS
5. Broadcast one frame every 33 ms over WebSocket

No selection, no filtering, no "this looks like a beat" heuristic. Pure 30
fps stream. See `./NOW_PLAYING.md §Spectrum channel` for the wire format.

**All intelligence lives in the consumer** (`renderer/app.js`
`processSpectrumOnset`):

- Compute spectral flux from the stream
- Threshold + minimum-gap throttle
- Estimate spectral centroid for pitch placement
- Decide velocity, chord companions, occasional sparkle
- Maintain per-key decay envelope

### Why this split matters

- **Any future consumer** (plasma shader, folio glow, a desktop waveform
  widget that hasn't been written yet) can subscribe to the same stream
  and run its own analysis. One pipe, N interpretations.
- **Algorithm changes don't require a muse rebuild.** Want to swap spectral
  flux for complex-domain deviation? Want to add BPM tracking? Want to
  classify the song's mood? All consumer-side changes.
- **Clear debug boundary.** Weird behavior always has an obvious side: if
  the raw stream is wrong, it's a muse problem; if the visual reaction
  is wrong, it's a consumer problem.
- **Resilient to renderer stalls.** If the consumer drops a frame, the
  producer just keeps pushing — next tick always gets the freshest
  snapshot. No catch-up logic needed.

## The piano implementation, annotated

Piano is the most demanding consumer of the spectrum stream so far (every
theme after it will be easier). Three channels feed the same per-key decay
envelope:

1. **Hard onset** — `flux > PIANO_ONSET_FLUX` triggers 1–3 keys near the
   spectral centroid with a Gaussian ±4-key jitter; louder onsets add an
   octave companion and occasionally a high-register sparkle.
2. **Ambient sprinkle** — when `rms > 0.12` and no hard onset fired, a
   probabilistic trigger at rate `~rms × 0.14` per frame produces soft
   strikes. Keeps the "someone is playing" feeling during sustained
   passages where flux is low (pads, drones, held notes).
3. **Lyric-line pulse** — a chord stab (2–4 nearby keys) on every line
   change. Provides musical accent even in silent passages or when muse
   is absent.

All three channels write to `pianoKeys[i].level` via `strikeKey()`; decay
(`level *= 0.96` per frame ≈ 1.5 s half-life) is uniform regardless of
source. One smoothing pipeline, three producers.

## Diagnosing

Open DevTools on the echo window, type `__piano`:

- `__piano.ws` — WebSocket state: `1` = open, `3` = closed
- `__piano.frames` — frames received since load (should climb by ~30/s)
- `__piano.frame` — most recent frame (`{ t, bands, rms, stateVersion }`)
- `__piano.flux` — last computed spectral flux (tune `PIANO_ONSET_FLUX`
  against this)
- `__piano.strikes` — cumulative strike count
- `__piano.keys` — live per-key level array

Typical values on well-produced pop: `rms` 0.25–0.55, `flux` 0.05–0.4
with short spikes to 1.0+ on drum hits. If `frames` isn't climbing, the
WebSocket didn't connect (muse not running, or port 10755 not serving).

## Things we deliberately didn't do

- **Beat tracking / BPM estimation** — not needed; onsets already feel
  musical, and beat tracking would add ~1 beat of perceptual latency.
- **Waveform data** (`getByteTimeDomainData`) — no current visual needs
  it; frequency + RMS is sufficient.
- **Onset detection on the producer side** — would couple muse to one
  specific analysis and make the pipe less reusable.
- **Per-genre tuning** — a single threshold works across pop, piano
  ballads, electronic, and vocal because flux is measuring *change in
  spectral content*, which is genre-invariant.
