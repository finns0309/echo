// NetEase prepends ~10 lines of crew credits ("[00:00.000] 作词 : XXX",
// "[00:01.000] 作曲 : XXX", ...) before the real lyrics. They occupy the
// first ~10s of every song and have no business being shown as lyrics —
// without filtering, the display "ticks" through credits during the intro
// and then sits on "录音助理" until the first real line (often >25s in).
const CREDIT_RE =
  /^(作词|作曲|编曲|制作人?|和声(编写)?|吉他|贝斯|鼓|键盘|弦乐|录音(工程|助理)?|混音(工程师?)?|母带|监制|出品|发行|策划|配唱|改编|演唱|主唱|合声|和音|MV|Lyrics?|Composed?\s+by|Arranged?\s+by|Produced?\s+by|Mixed?\s+by|Mastered?\s+by)\s*[:：]/i;

// Parse an LRC string into a sorted [{ time: seconds, text }]. Credit lines are
// dropped. This is the whole lyric model echo needs: line-level timing for
// findIndex, line text for rendering. (The per-char yrc/karaoke model and the
// translation merge were removed with the themes that used them.)
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

window.LRC = { parseLRC, findIndex };
