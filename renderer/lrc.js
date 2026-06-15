// NetEase prepends ~10 lines of crew credits ("[00:00.000] 作词 : XXX",
// "[00:01.000] 作曲 : XXX", ...) before the real lyrics. They occupy the
// first ~10s of every song and have no business being shown as lyrics —
// without filtering, the display "ticks" through credits during the intro
// and then sits on "录音助理" until the first real line (often >25s in).
const CREDIT_RE =
  /^(作词|作曲|编曲|制作人?|和声(编写)?|吉他|贝斯|鼓|键盘|弦乐|录音(工程|助理)?|混音(工程师?)?|母带|监制|出品|发行|策划|配唱|改编|演唱|主唱|合声|和音|MV|Lyrics?|Composed?\s+by|Arranged?\s+by|Produced?\s+by|Mixed?\s+by|Mastered?\s+by)\s*[:：]/i;

// Parse an LRC string into a sorted [{ time: seconds, text }]. Credit lines are
// dropped. This is the line-level model every non-karaoke theme needs: line
// timing for findIndex, line text for rendering.
function parseLRC(lrc) {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const out = [];
  // Some NetEase lyrics use `[mm:ss:fff]` (colon before the fraction) instead
  // of the standard `[mm:ss.fff]`. Accept either separator or no fraction.
  const tagRe = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
  for (const raw of lines) {
    const text = raw.replace(tagRe, '').trim();
    if (CREDIT_RE.test(text)) continue;
    let m;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(raw)) !== null) {
      const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
      const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac;
      out.push({ time: t, text });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// ─── Karaoke (per-syllable) timing ──────────────────────────────────────────
// NetEase yrc format (the verbatim / 逐字 track):
//   [lineStartMs,lineDurMs](tokStartMs,tokDurMs,0)tok(tokStartMs,tokDurMs,0)tok…
//
// Times are absolute (relative to song start). A "tok" is whatever unit NetEase
// timed — usually one CJK glyph, or one latin word/syllable. We expose a
// unified line model the karaoke theme consumes:
//   { time, duration, text, chars: [{ time, duration, text }] }
// where `chars` is the list of timed units. It's always present — synthesized
// from line timing when yrc is absent (see synthChars) — so the renderer never
// has to branch on availability.
function parseYRC(yrc) {
  if (!yrc) return [];
  const out = [];
  // A header [start,dur] followed by one-or-more (start,dur[,role])tok tokens.
  // yrc also carries JSON metadata lines ({"t":…,"c":…}) — those don't match
  // the numeric header, so they're skipped for free.
  const lineRe = /\[(\d+),(\d+)\]((?:\(\d+,\d+(?:,\d+)?\)[^(\n]*)+)/g;
  const tokRe  = /\((\d+),(\d+)(?:,\d+)?\)([^(\n]*)/g;
  let m;
  while ((m = lineRe.exec(yrc)) !== null) {
    const lineStart = parseInt(m[1], 10) / 1000;
    const lineDur   = parseInt(m[2], 10) / 1000;
    const chars = [];
    let cm;
    tokRe.lastIndex = 0;
    while ((cm = tokRe.exec(m[3])) !== null) {
      const text = cm[3];
      if (!text) continue;
      chars.push({
        time:     parseInt(cm[1], 10) / 1000,
        duration: parseInt(cm[2], 10) / 1000,
        text,
      });
    }
    if (!chars.length) continue;
    const text = chars.map((c) => c.text).join('');
    if (CREDIT_RE.test(text.trim())) continue; // yrc carries credits too
    out.push({ time: lineStart, duration: lineDur, text, chars });
  }
  return out;
}

// Split a line into karaoke units for SYNTHETIC timing: a maximal run of latin
// word-characters (kept whole + any trailing space, so English words sweep as
// one unit and never break mid-word at a wrap), or a single non-latin codepoint
// (each CJK glyph / punctuation its own unit).
function synthUnits(text) {
  const cps = [...text];
  const isLat = (c) => /[A-Za-z0-9’'\-]/.test(c);
  const units = [];
  let buf = '';
  for (const c of cps) {
    if (isLat(c)) buf += c;
    else if (c === ' ') {                       // space ends the word, rides with it
      if (buf) { units.push(buf + ' '); buf = ''; } else units.push(' ');
    } else { if (buf) { units.push(buf); buf = ''; } units.push(c); }
  }
  if (buf) units.push(buf);
  return units;
}

// When yrc isn't available, fabricate per-unit timings from the LRC line alone.
// Strategy: spend the first 70% of the time-to-next-line across the units,
// weighted by unit length (a long word sings longer than one glyph); the last
// 30% is the typical instrumental tail. Not real karaoke — "synthetic karaoke"
// — but on fairly even-paced lines it reads as musical, and it means every song
// gets a moving fill even without verbatim timing.
function synthChars(line, nextTime) {
  const units = synthUnits(line.text || '');
  if (!units.length) return [];
  const tail = (typeof nextTime === 'number' ? nextTime : line.time + 4) - line.time;
  const span = Math.max(0.4, tail * 0.7);
  const weights = units.map((u) => Math.max(1, [...u].length));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return units.map((u, i) => {
    const dur = (span * weights[i]) / total;
    const c = { time: line.time + acc, duration: dur, text: u };
    acc += dur;
    return c;
  });
}

// Merge yrc + LRC + translation into a unified line list for the karaoke theme.
// yrc wins when present (it carries both line- and unit-level timing); LRC is
// the base otherwise and gets synthetic units. Translation is matched to the
// winning line list by start-time within 60ms.
function buildKaraoke(lrc, tlyric, yrc) {
  const lrcLines = parseLRC(lrc);
  const yrcLines = parseYRC(yrc);
  const trans    = parseLRC(tlyric);

  const base = yrcLines.length ? yrcLines : lrcLines;

  // Ensure every line has chars[]. yrc lines already do; LRC lines need synth.
  const out = base.map((l, i) => {
    if (l.chars && l.chars.length) return l;
    return { ...l, chars: synthChars(l, base[i + 1]?.time) };
  });

  if (trans.length) {
    for (const line of out) {
      const t = trans.find((x) => Math.abs(x.time - line.time) < 0.06);
      if (t && t.text && t.text !== line.text) line.trans = t.text;
    }
  }
  return out;
}

// Find which timed unit in a line is active at time t. Returns -1 before the
// first unit (the count-in window), chars.length-1 after the last.
function findCharIndex(line, t) {
  const chars = line && line.chars;
  if (!chars || !chars.length) return -1;
  let lo = 0, hi = chars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chars[mid].time <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

// Binary-search the active line index at time t. Returns -1 before the first
// line, lines.length-1 after the last.
function findIndex(lines, t) {
  if (!lines.length) return -1;
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

window.LRC = { parseLRC, findIndex, parseYRC, synthChars, buildKaraoke, findCharIndex };
