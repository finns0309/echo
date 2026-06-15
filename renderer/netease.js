// Minimal NetEase Cloud Music client: search by title+artist, fetch lyrics & cover.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  Referer: 'https://music.163.com/',
};

// In-memory LRU-ish caches. Two motivations:
//  - Switching back to a recently-played track should be instant (no network).
//  - When muse can't supply a NetEase songId we fall back to a fuzzy
//    title+artist search; caching dedupes repeated searches for the same track.
// Bounded by MAX_ENTRIES; oldest key evicted on overflow.
const MAX_ENTRIES = 128;
const searchCache = new Map(); // key: `${title}|${artist}` → { id, cover }
const lyricCache  = new Map(); // key: songId → { lrc, tlyric, yrc }

function cachePut(map, key, value) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
  return value;
}
function cacheGet(map, key) {
  if (!map.has(key)) return undefined;
  const v = map.get(key);
  map.delete(key); map.set(key, v); // refresh LRU position
  return v;
}

// Single retry with a short backoff. Network blips + NetEase's occasional 429
// make a one-shot fetch unreliable; two tries with a 250ms gap is enough in
// practice to turn transient failures into successes without stalling the UI.
// Each attempt is bounded by FETCH_TIMEOUT_MS: a hung connection (captive
// portal, network switch, CDN stall) would otherwise leave the caller's
// `state.isLoading` guard stuck true and freeze the whole poll loop with no
// error and no recovery.
const FETCH_TIMEOUT_MS = 5000;
async function fetchJSON(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } catch (e) {
      if (attempt === 1) throw e;
      await new Promise((res) => setTimeout(res, 250));
    } finally {
      clearTimeout(tid);
    }
  }
}

async function searchSong(title, artist, duration) {
  const cacheKey = `${title}|${artist}`;
  const hit = cacheGet(searchCache, cacheKey);
  if (hit) return hit;

  const q = encodeURIComponent(`${title} ${artist}`.trim());
  const url = `https://music.163.com/api/search/get?s=${q}&type=1&limit=5`;
  const j = await fetchJSON(url);
  const songs = j?.result?.songs || [];
  if (!songs.length) return cachePut(searchCache, cacheKey, null);

  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
  const wantA = norm(artist);
  const wantT = norm(title);

  // Score candidates: artist match (strong), title match, then duration
  // proximity when we have one from muse. NetEase's own "relevance" order
  // routinely puts a cover/instrumental first, so we re-rank.
  const scored = songs.map((s) => {
    let score = 0;
    if (s.artists?.some((a) => norm(a.name) === wantA)) score += 100;
    if (norm(s.name) === wantT) score += 40;
    if (duration && s.duration) {
      const diffSec = Math.abs(s.duration / 1000 - duration);
      score += Math.max(0, 20 - diffSec * 2); // ±10s ≈ 0 bonus, exact = +20
    }
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].s;

  const out = {
    id: best.id,
    cover: best.album?.picUrl ? best.album.picUrl + '?param=500y500' : null,
  };
  return cachePut(searchCache, cacheKey, out);
}

// Returns { lrc, tlyric, yrc }:
//   lrc    — standard line-level LRC (every theme; the binding contract)
//   tlyric — Chinese translation track (karaoke theme shows it as a sub-line)
//   yrc    — verbatim / 逐字 per-syllable timing (karaoke theme's real sync)
// The v1 endpoint carries all three; we prefer it. If it's unavailable we fall
// back to the classic endpoint for lrc alone, so line-level lyrics — which the
// whole app depends on — can never regress when only the verbatim track fails.
async function fetchLyric(songId) {
  const hit = cacheGet(lyricCache, songId);
  if (hit) return hit;
  try {
    const url = `https://music.163.com/api/song/lyric/v1?id=${songId}&lv=1&tv=1&yv=1`;
    const j = await fetchJSON(url);
    const lrc = j?.lrc?.lyric || '';
    if (lrc || j?.yrc?.lyric) {
      return cachePut(lyricCache, songId, {
        lrc,
        tlyric: j?.tlyric?.lyric || '',
        yrc:    j?.yrc?.lyric    || '',
      });
    }
  } catch { /* fall through to the classic endpoint */ }
  const j2 = await fetchJSON(`https://music.163.com/api/song/lyric?id=${songId}&lv=1`);
  return cachePut(lyricCache, songId, { lrc: j2?.lrc?.lyric || '', tlyric: '', yrc: '' });
}

window.Netease = { searchSong, fetchLyric };
