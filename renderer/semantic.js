// Semantic motion analysis for the `semantic` theme (kinetic typography / 动态字).
// "The text IS the animation." Words whose meaning implies motion are tagged
// with a motion name; CSS (body.theme-semantic) animates each tagged word.
//
// IMPORTANT: this analysis is a DETERMINISTIC LOCAL HEURISTIC — a small
// keyword→motion dictionary plus a stress heuristic for content words. It does
// NOT call any LLM or network API (echo is a strictly read-only consumer of
// /now; see ARCHITECTURE.md "Boundaries"). Results are pure functions of the
// line text, so the same lyric always animates the same way.
//
// TODO(semantic-llm): to upgrade fidelity later, replace analyzeLine's body
// with a lookup into a per-song motion map produced by a ONE-TIME LLM pass
// keyed by songId (DESIGN_DIRECTIONS §4: "the preprocessing is cacheable
// forever by songId"). Keep the call site + the cache (semanticCache below)
// exactly as-is — only the per-line tagging changes. Suggested shape:
//   motionMap[songId] = { [lineText]: [{ text, motion }] }
// fetched/generated once (e.g. in muse, handed over the existing /now-adjacent
// channel, or a local sidecar file), then this function just returns the
// cached tokens. Until that exists, the dictionary below is the source of truth.
//
// Public API: window.FL_SEMANTIC.analyzeLine(text, songId) → [{ text, space, motion }]
(function () {

// keyword (lowercased) → motion. EN keys match whole words (after stripping
// punctuation); CJK keys are matched as substrings of the raw line so phrases
// like 永远 / 坠落 tag even without word boundaries.
const SEMANTIC_MOTION = {
  // fall / down
  fall: 'fall', falling: 'fall', fell: 'fall', drop: 'fall', down: 'fall',
  sink: 'fall', sinking: 'fall', rain: 'fall', tears: 'fall', gravity: 'fall',
  '落': 'fall', '坠': 'fall', '掉': 'fall', '沉': 'fall', '泪': 'fall', '雨': 'fall',
  // rise / up / high
  rise: 'rise', rising: 'rise', up: 'rise', higher: 'rise', sky: 'rise',
  soar: 'rise', lift: 'rise', '升': 'rise', '飞': 'fly', '天': 'rise', '高': 'rise',
  // forever / wide / endless → stretch tracking
  forever: 'stretch', endless: 'stretch', eternal: 'stretch', always: 'stretch',
  wide: 'stretch', infinite: 'stretch', '永远': 'stretch', '永': 'stretch',
  '无尽': 'stretch', '天长地久': 'stretch', '远': 'stretch',
  // break / shatter / shake
  break: 'shake', broken: 'shake', breaking: 'shake', shatter: 'shake',
  crash: 'shake', shake: 'shake', tremble: 'shake', burst: 'shake',
  '碎': 'shake', '破': 'shake', '裂': 'shake', '颤': 'shake', '抖': 'shake',
  // heart / beat / love → pulse
  heart: 'pulse', beat: 'pulse', pulse: 'pulse', love: 'pulse', alive: 'pulse',
  '心': 'pulse', '爱': 'pulse', '跳': 'pulse',
  // fly / float / dream / drift
  fly: 'fly', float: 'fly', dream: 'fly', drift: 'fly', wind: 'fly', cloud: 'fly',
  '梦': 'fly', '风': 'fly', '云': 'fly', '漂': 'fly', '飘': 'fly',
  // gone / fade / disappear / forget
  gone: 'fade', fade: 'fade', fading: 'fade', vanish: 'fade', disappear: 'fade',
  forget: 'fade', lost: 'fade', '忘': 'fade', '逝': 'fade', '散': 'fade', '消': 'fade',
};
// EN function words that should never get the stress (weight-bump) treatment —
// only content words bump, so the motion stays tasteful rather than chaotic.
const SEMANTIC_STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','by','for','with',
  'is','am','are','was','were','be','been','i','you','he','she','it','we','they',
  'my','your','me','this','that','as','so','no','not','do','did','my','our','if',
]);

// CJK test (covers the common ranges we care about for lyrics).
function isCJKChar(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x4e00 && c <= 0x9fff) ||  // CJK unified
         (c >= 0x3040 && c <= 0x30ff);    // kana
}

// Tokenize a line into render segments: EN words stay whole (run of non-space,
// non-CJK), each CJK char is its own segment, spaces ride with the preceding
// segment as a trailing-space marker. Returns [{ text, space }].
function semanticTokenize(text) {
  const segs = [];
  let buf = '';
  const flush = () => { if (buf) { segs.push({ text: buf, space: false }); buf = ''; } };
  for (const ch of text) {
    if (ch === ' ') { flush(); if (segs.length) segs[segs.length - 1].space = true; continue; }
    if (isCJKChar(ch)) { flush(); segs.push({ text: ch, space: false }); continue; }
    buf += ch;
  }
  flush();
  return segs;
}

// Per-song analysis cache (memory only). Key: `${songId}::${lineText}`.
const semanticCache = new Map();

// Analyze one line → [{ text, space, motion }]. `motion` is a class suffix
// consumed by the CSS (theme-semantic) or '' for hold-still words.
function analyzeLine(text, songId) {
  const key = `${songId || 0}::${text}`;
  const hit = semanticCache.get(key);
  if (hit) return hit;

  const segs = semanticTokenize(text);

  // Pre-scan CJK multi-char phrase keywords against the raw line so e.g.
  // 永远 tags both its chars even though we render per-char. Build a set of
  // CJK char indices → motion from any matched phrase.
  const cjkPhraseMotion = new Map(); // char (single) → motion, last write wins
  for (const k of Object.keys(SEMANTIC_MOTION)) {
    if (k.length > 1 && /[぀-ヿ一-鿿]/.test(k) && text.includes(k)) {
      for (const ch of k) cjkPhraseMotion.set(ch, SEMANTIC_MOTION[k]);
    }
  }

  const out = segs.map((seg) => {
    let motion = '';
    if (seg.text.length === 1 && isCJKChar(seg.text)) {
      motion = cjkPhraseMotion.get(seg.text) || SEMANTIC_MOTION[seg.text] || '';
    } else {
      const word = seg.text.toLowerCase().replace(/[^a-z0-9'']/g, '');
      if (word && SEMANTIC_MOTION[word]) motion = SEMANTIC_MOTION[word];
      // Stress heuristic: a content word (>=4 letters, not a stopword) with no
      // stronger motion bumps weight on entrance. Keeps it to the words the ear
      // would land on; function words and short glue words hold still.
      else if (word.length >= 4 && !SEMANTIC_STOPWORDS.has(word)) motion = 'stress';
    }
    return { text: seg.text, space: seg.space, motion };
  });

  // Taste guard: if too many segments ended up moving, the line reads as
  // chaos. Demote excess 'stress' tags (the weakest motion) until at most
  // ~45% of word-ish segments move. Dictionary motions are always kept.
  const wordish = out.filter((s) => s.text.trim().length > 0);
  const maxMoving = Math.max(1, Math.ceil(wordish.length * 0.45));
  let moving = out.filter((s) => s.motion).length;
  if (moving > maxMoving) {
    for (let i = out.length - 1; i >= 0 && moving > maxMoving; i--) {
      if (out[i].motion === 'stress') { out[i].motion = ''; moving--; }
    }
  }

  semanticCache.set(key, out);
  return out;
}

window.FL_SEMANTIC = { analyzeLine };

})();
