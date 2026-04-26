// NetEase prepends ~10 lines of crew credits ("[00:00.000] 作词 : XXX",
// "[00:01.000] 作曲 : XXX", ...) before the real lyrics. They occupy the
// first ~10s of every song and have no business being shown as lyrics —
// without filtering, the display "ticks" through credits during the intro
// and then sits on "录音助理" until the first real line (often >25s in).
const CREDIT_RE =
  /^(作词|作曲|编曲|制作人?|和声(编写)?|吉他|贝斯|鼓|键盘|弦乐|录音(工程|助理)?|混音(工程师?)?|母带|监制|出品|发行|策划|配唱|改编|演唱|主唱|合声|和音|MV|Lyrics?|Composed?\s+by|Arranged?\s+by|Produced?\s+by|Mixed?\s+by|Mastered?\s+by)\s*[:：]/i;

// Parse LRC into [{ time: seconds, text }]
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

// Merge original + translation timelines (match by time within 50ms).
function mergeLyrics(orig, trans) {
  if (!trans || trans.length === 0) return orig;
  return orig.map((l) => {
    const t = trans.find((x) => Math.abs(x.time - l.time) < 0.05);
    return t && t.text ? { ...l, trans: t.text } : l;
  });
}

// ─── Karaoke (per-character) timing ─────────────────────────────────────────
// NetEase yrc format:
//   [lineStartMs,lineDurMs](charStartMs,charDurMs)char(charStartMs,charDurMs)char...
//
// Times are absolute (relative to song start). "char" can be multiple letters
// for languages that group syllables (English words usually arrive as one
// chunk per syllable). We expose a unified line model:
//   { time, duration, text, chars: [{ time, duration, text }] }
// where `chars` is always present — synthesized from line timing when yrc
// is absent, so consumers never have to branch on availability.
function parseYRC(yrc) {
  if (!yrc) return [];
  const lines = [];
  // Match a header [start,dur] followed by one-or-more (start,dur)char tokens.
  // Header must be at start of line. Skip metadata lines with non-numeric content.
  const lineRe = /\[(\d+),(\d+)\]((?:\(\d+,\d+(?:,\d+)?\)[^(\n]*)+)/g;
  const charRe = /\((\d+),(\d+)(?:,\d+)?\)([^(\n]*)/g;
  let m;
  while ((m = lineRe.exec(yrc)) !== null) {
    const lineStart = parseInt(m[1], 10) / 1000;
    const lineDur   = parseInt(m[2], 10) / 1000;
    const body = m[3];
    const chars = [];
    let cm;
    charRe.lastIndex = 0;
    while ((cm = charRe.exec(body)) !== null) {
      const text = cm[3];
      if (!text) continue;
      chars.push({
        time:     parseInt(cm[1], 10) / 1000,
        duration: parseInt(cm[2], 10) / 1000,
        text,
      });
    }
    if (!chars.length) continue;
    lines.push({
      time: lineStart,
      duration: lineDur,
      text: chars.map((c) => c.text).join(''),
      chars,
    });
  }
  return lines;
}

// When yrc isn't available, fabricate per-character timings from the LRC line
// alone. Strategy: spend the first 70% of the time-to-next-line evenly across
// chars (the last 30% is typical instrumental tail). This isn't real karaoke —
// it's "synthetic karaoke" — but for visual reveal effects it reads as
// musical, especially on lines where the singer is fairly even-paced.
function synthChars(line, nextTime) {
  const text = line.text || '';
  const codepoints = [...text]; // surrogate-pair safe
  if (!codepoints.length) return [];
  const tail = (typeof nextTime === 'number' ? nextTime : line.time + 4) - line.time;
  const span = Math.max(0.4, tail * 0.7);
  const charDur = span / codepoints.length;
  return codepoints.map((c, i) => ({
    time: line.time + i * charDur,
    duration: charDur,
    text: c,
  }));
}

// Merge yrc + LRC + translation into a unified line list. yrc is preferred
// when present (line-level + char-level); LRC fills gaps. Translation is
// matched to whichever line list wins, by start-time within 50ms.
function buildKaraoke(lrc, tlyric, yrc) {
  const lrcLines = parseLRC(lrc);
  const trans    = parseLRC(tlyric);
  const yrcLines = parseYRC(yrc);

  const base = yrcLines.length ? yrcLines : lrcLines;

  // Ensure every line has chars[]. yrc lines already do; LRC lines need synth.
  const out = base.map((l, i) => {
    if (l.chars && l.chars.length) return l;
    const next = base[i + 1]?.time;
    return { ...l, chars: synthChars(l, next) };
  });

  // Attach translation by closest timestamp.
  if (trans.length) {
    for (const line of out) {
      const t = trans.find((x) => Math.abs(x.time - line.time) < 0.05);
      if (t && t.text) line.trans = t.text;
    }
  }
  return out;
}

// Find which char in a line is "active" at time t. Returns -1 before first,
// chars.length-1 after last. O(log n) for long lines (Apple Music-style
// scrolling could need it).
function findCharIndex(line, t) {
  const chars = line?.chars;
  if (!chars || !chars.length) return -1;
  let lo = 0, hi = chars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chars[mid].time <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

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

window.LRC = { parseLRC, mergeLyrics, findIndex, parseYRC, buildKaraoke, findCharIndex };
