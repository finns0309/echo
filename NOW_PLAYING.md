# Now-Playing Protocol

Shared contract between `muse` (producer) and `echo` (consumer).

This file is the source of truth. If you add/rename a field in either repo,
update this doc in the same commit.

## Transport

- Producer: HTTP server on `127.0.0.1:10755`, one endpoint: `GET /now`.
- Response: `200 OK`, `content-type: application/json`, CORS `*`.
- Idle (muse running but no track loaded) still returns `200` with the shape
  below — an empty `title` is the "no track" signal.

Consumers poll. muse does not push. Typical poll interval: 1s (enough —
echo runs its own rAF clock between polls).

## Schema (v1.2)

```jsonc
{
  "title":             "string",   // "" when idle
  "artist":            "string",   // comma-separated if multiple
  "album":             "string",
  "cover":             "string",   // http(s) URL; "" if unknown
  "songId":            0,          // NetEase song id; 0 if unknown (non-NetEase source)
  "duration":          0,          // seconds (float ok)
  "currentTime":       0,          // seconds (float)
  "playing":           false,      // true iff audio is not paused
  "updatedAt":         0,          // Date.now() of the last producer-side write
  "positionSampledAt": 0,          // (v1.1) epoch ms at which currentTime was sampled
  "stateVersion":      0           // (v1.1) monotonic; bumps on timeline discontinuity
}
```

### Field semantics

- **`songId`** — when non-zero, the consumer SHOULD use it to fetch lyrics /
  cover directly instead of doing a fuzzy `title+artist` search. This is the
  entire reason the protocol exists: official NetEase clients only expose
  title/artist via MediaRemote, and fuzzy search routinely picks the wrong
  instrumental/cover version.
- **`currentTime`** — producer MUST report the actual playhead position, not
  the fallback 0 that MediaRemote gives. echo treats `currentTime`
  as authoritative only when the source is muse (indicated by the presence
  of a non-zero `songId` + reliable advancing `currentTime`).
- **`updatedAt`** — epoch ms of the last IPC from the renderer. Consumers can
  treat `Date.now() - updatedAt > 5000` as "producer stalled" (e.g. the muse
  window is frozen) and fall back to another source.
- **`playing`** — reflects `!audio.paused`. Accurate: muse is the one holding
  the `<audio>` element, there is no indirection.
- **`positionSampledAt`** (v1.1) — epoch ms of the moment `currentTime` was
  captured. Consumers SHOULD anchor their local interpolation to this value,
  not to their own "now": with a 1s poll interval, raw `currentTime` is up
  to 1s stale, and anchoring to "now" produces a visible lyric lag that
  snaps back after each poll (most obvious on seek/pause). Missing or `0` →
  fall back to local-clock anchoring (pre-v1.1 behavior).
- **`stateVersion`** (v1.1) — monotonically increasing integer. The producer
  bumps it *only* when the timeline is discontinuous from the previous
  sample: new `songId`, `playing` flipped, or `|currentTime − extrapolated|
  > 0.5s` (i.e. a seek). Consumers use a change in `stateVersion` as the
  signal to hard-reset their local clock instead of smoothing. The absolute
  value has no meaning — only equality vs. the previously-observed value.

### Compatibility

- The schema is additive: consumers MUST ignore unknown keys, and MUST
  tolerate the absence of any v1.1 field (older muse builds don't emit
  them). Adding a field does not require a version bump.
- Renaming or removing a field is a breaking change — bump the protocol
  version at the top of this doc and both repos at the same time.

## Producer implementation (muse)

- `muse/main.js` — `startNowServer()` serves the state from an in-memory
  `nowState` object.
- `muse/renderer/player.js` — `pushPlayerState()` writes `nowState` on audio
  events (`play` / `pause` / `timeupdate` throttled to ~4Hz / `loadedmetadata`)
  and whenever `playTrack` commits a new track.

## Consumer implementation (echo)

- `echo/main.js` — `callMuseOnce()` hits `/now`. On success it
  returns `{ title, artist, album, elapsed, duration, rate, source: 'muse',
  songId, cover }`. Non-muse source (`nowplaying-cli`) populates the same
  shape from MediaRemote, minus the trustworthy fields.
- `renderer/app.js` — when `source === 'muse'`, adopts `elapsed` every poll
  and anchors `lastSyncAt` to `positionSampledAt` (so the 0–1s poll lag
  doesn't leak into the rendered position). A change in `stateVersion`
  forces a line re-render on the next frame. Otherwise (nowplaying-cli
  fallback) it ignores `elapsed` and runs a local wall clock; the UI shows
  a "后备" badge so the user knows the timeline isn't authoritative.

## Spectrum channel (v1.2)

Real-time audio-reactive data for visuals (shaders, keyboards, reactive
backgrounds). Separate transport from `/now` because the cadences don't mix:
`/now` is 1s-polled low-frequency truth; spectrum is ~30fps push.

- **Transport**: WebSocket at `ws://127.0.0.1:10755/spectrum` (shares the HTTP
  server that serves `/now`).
- **Handshake**: the first message is a contract frame, not a data frame:

  ```jsonc
  {
    "type":       "hello",
    "sampleRate": 30,       // frames per second the producer targets
    "bandCount":  24,       // length of every subsequent `bands` array
    "logBase":    true,     // bands are log-spaced in frequency
    "fMin":       60,       // Hz, lower edge of band[0]
    "fMax":       12000     // Hz, upper edge of band[bandCount-1]
  }
  ```

  Consumers SHOULD use `fMin`/`fMax`/`logBase` to map bands to screen position
  instead of hardcoding.

- **Frames** (one per ~33ms while audio is playing):

  ```jsonc
  {
    "t":            1714000000000,   // Date.now() at sample time
    "bands":        [0.12, 0.34, /* ... */],  // length = bandCount, float [0,1]
    "rms":          0.28,            // scalar overall loudness [0,1]
    "stateVersion": 7                // same semantics as /now.stateVersion
  }
  ```

- **Normalization**: bands are `sqrt(byte/255)` — a perceptual curve so the
  `[0,1]` range is actually populated. Linear byte values cluster in
  `0.1–0.3`; consumers that assume linear will see dead visuals.
- **Pause**: while `audio.paused`, the producer emits nothing. Consumers
  fade out on their own; all-zero frames would waste bandwidth and blink.
- **Resume**: frames restart on play. No replay of missed frames.
- **stateVersion**: identical semantics to `/now.stateVersion` — bumps on
  track change, play/pause flip, or seek. Consumers use a change as the
  signal to reset smoothing / beat trackers.
- **Reconnect**: on disconnect, the consumer reconnects; the producer does
  not track subscribers. Multiple subscribers are supported (broadcast).
- **Producer stall**: if the producer window is frozen, frames stop arriving.
  Consumers SHOULD treat gaps > ~500ms (while `/now.playing` is still true)
  as a stall and fall back to whatever idle visual they use when paused.

### Non-goals

- No beat / onset detection — consumers run their own.
- No raw waveform (`getByteTimeDomainData`) — no current need.
- No system-audio capture — only what muse's `<audio>` is playing.

## Port collision policy

`muse` probes `/now` on startup. If the endpoint responds with a valid
payload, it assumes another muse is already running and exits with a friendly
dialog instead of trying to rebind `:10755`.
