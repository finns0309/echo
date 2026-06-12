// Shared lyric-text utilities (window.FL_TEXT).
//
// Two jobs the per-char themes (eva / idol / roam) kept getting wrong:
//
//   tokenize(text)     split a mixed CJK/latin line into tokens so latin
//                      words stay whole (wrap at spaces, never mid-word)
//   pickKeyword(text)  choose an emphasis window that reads as a word:
//                      the LLM director's pick first (a real word — it knows
//                      「合う」 is one unit where the heuristic saw two
//                      chars); fallback heuristic: latin → a whole word,
//                      CJK → a 2-char window with no particles (「了早」 is
//                      not a keyword)
//   setDirections(map) merge the director's line→keyword picks (fed from
//                      main's director.js via app.js; keyed by trimmed line
//                      text, so choruses and repeat listens reuse for free)
//
// Deterministic per text (hash-seeded heuristic / temperature-0 director) so
// repeated lines emphasize the same thing — same visual-rhyme principle as
// roam's plan cache.
(function () {

const PARTICLES = '的了是在和把吧呢啊呀哦嘛吗也就都还才又有个不与及或而被着过得地之于';
const isHan = (c) => /\p{Script=Han}/u.test(c);
const isLatin = (c) => /[A-Za-z0-9''-]/.test(c);

function hash(s) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.codePointAt(0)) >>> 0; return h; }

// → [{type:'word'|'char'|'space', text, start}] — start is the codepoint
//   index into [...text], so emphasis ranges can be mapped back onto spans.
function tokenize(text) {
  const chars = [...text];
  const toks = [];
  let buf = '', bs = 0;
  const flush = () => { if (buf) { toks.push({ type: 'word', text: buf, start: bs }); buf = ''; } };
  chars.forEach((ch, i) => {
    if (/\s/.test(ch)) { flush(); toks.push({ type: 'space', text: ch, start: i }); }
    else if (isLatin(ch)) { if (!buf) bs = i; buf += ch; }
    else { flush(); toks.push({ type: 'char', text: ch, start: i }); }
  });
  flush();
  return toks;
}

function latinRatio(text) {
  const chars = [...text];
  if (!chars.length) return 0;
  return chars.filter(isLatin).length / chars.length;
}

// LLM director picks (trimmed line text → keyword string). Entries accumulate
// across songs for the session — text-keyed, so an A→B→A track flip still hits.
const directed = new Map();
function setDirections(map) {
  if (!map) return;
  for (const [line, kw] of Object.entries(map)) directed.set(line, kw);
}

// → {start, len} emphasis window.
function pickKeyword(text) {
  const d = directed.get(text.trim());
  if (d) {
    // indexOf returns UTF-16 units; spans are codepoint-indexed — convert.
    const u16 = text.indexOf(d);
    if (u16 >= 0) return { start: [...text.slice(0, u16)].length, len: [...d].length };
  }
  const chars = [...text];
  const h = hash(text);
  // latin: a whole word (prefer the meatier ones)
  const words = tokenize(text).filter(t => t.type === 'word' && [...t.text].length >= 3);
  if (words.length) {
    const w = words[h % words.length];
    return { start: w.start, len: [...w.text].length };
  }
  // CJK: a 2-char window with no particle on either side
  const cands = [];
  for (let i = 0; i < chars.length - 1; i++) {
    const a = chars[i], b = chars[i + 1];
    if (isHan(a) && isHan(b) && !PARTICLES.includes(a) && !PARTICLES.includes(b)) cands.push(i);
  }
  if (cands.length) return { start: cands[h % cands.length], len: 2 };
  for (let i = 0; i < chars.length; i++) {
    if (isHan(chars[i]) && !PARTICLES.includes(chars[i])) return { start: i, len: 1 };
  }
  return { start: 0, len: Math.min(2, chars.length) };
}

window.FL_TEXT = { tokenize, pickKeyword, setDirections, latinRatio, hash };

})();
