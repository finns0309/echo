#!/usr/bin/env node
// phone-server.js — the bridge that lets echo's renderer run on a phone.
//
// Runs on the Mac (alongside muse), binds to the LAN, and gives a phone browser
// a SINGLE same-origin surface so there are no CORS or forbidden-header
// problems — the two things that stop the renderer's direct NetEase fetches
// from working in mobile Safari (music.163.com sends no CORS headers for
// arbitrary origins, and browsers silently drop the UA/Referer that netease.js
// sets). Everything the phone needs comes from here, same-origin:
//
//   GET /                → renderer/phone.html (the mobile entry)
//   GET /<asset>         → static file from renderer/
//   GET /now             → reverse-proxy muse's loopback /now (read-only)
//   GET /lyric?id=       → NCM lyric, fetched Node-side (headers + no CORS here)
//   GET /search?title&…  → NCM search fallback (songId usually arrives via /now)
//   GET /cover?u=        → proxy album art with permissive CORS (clean <canvas>)
//
// muse is untouched: it keeps serving /now on 127.0.0.1:10755, loopback-only.
// Only THIS server faces the LAN, and it only ever reads — so muse → echo stays
// strictly one-way. Start with `npm run phone`.

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PHONE_PORT) || 10756;
const HOST = process.env.PHONE_HOST || '0.0.0.0'; // LAN-facing on purpose
const MUSE_NOW = process.env.MUSE_NOW || 'http://127.0.0.1:10755/now';
const RENDERER_DIR = path.join(__dirname, 'renderer');

// The same headers netease.js uses. Necessary (and harmless) Node-side, where
// the browser's forbidden-header list doesn't apply.
const NCM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  Referer: 'https://music.163.com/',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function sendJSON(res, obj, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(obj));
}

// Theme control. echo's Electron tray (the menu-bar Theme list) POSTs the
// picked theme here; the phone polls GET /control and switches when `rev`
// bumps. This is the only thing that flows menu → phone; the phone never writes
// back, so it's one-way just like everything else. phoneTheme also seeds the
// initial state so a phone that connects before any menu click still has a
// sensible default.
let phoneTheme = process.env.PHONE_THEME || 'subtitle';
let themeRev = 0;

// Read a small JSON request body (POST /control). Caps at 10KB and resolves to
// {} on any malformed / oversized input rather than throwing.
function readJsonBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 10240) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(b || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// Reverse-proxy muse's loopback /now. The phone's shim maps this raw shape
// (currentTime/playing/…) into the renderer shape, exactly as main.js does on
// the desktop. muse down → empty object → renderer shows its idle state.
async function handleNow(res) {
  try {
    const r = await fetch(MUSE_NOW, { signal: AbortSignal.timeout(600) });
    sendJSON(res, await r.json());
  } catch {
    sendJSON(res, {});
  }
}

// NCM lyric. Heads up: NetEase's v1 endpoint now returns the newer word-timed
// JSON blob (`{"t":..,"c":[..]}`) in lrc.lyric for most songs, which echo's
// [mm:ss] parser (lrc.js) can't read — so preferring v1's lrc (as netease.js
// still does) yields NO lyrics. The classic endpoint keeps serving real
// line-level LRC, so we take lrc from there and use v1 only to enrich with the
// translation (tlyric) and, when present, the verbatim track (yrc).
async function handleLyric(res, id) {
  if (!id) return sendJSON(res, { lrc: '', tlyric: '', yrc: '' });
  let lrc = '';
  let tlyric = '';
  let yrc = '';
  // Line-level lrc ALWAYS from the classic endpoint. The v1 endpoint now serves
  // a word-timed JSON blob in lrc.lyric that echo's [mm:ss] parser can't read
  // (and which even contains `[n:n` fragments, so a "looks like LRC?" sniff on
  // it gives false positives) — so don't trust v1's lrc at all.
  try {
    const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1`;
    const j = await (await fetch(url, { headers: NCM_HEADERS, signal: AbortSignal.timeout(6000) })).json();
    lrc = j?.lrc?.lyric || '';
  } catch {
    /* leave lrc empty → renderer shows title/idle */
  }
  // v1 only to enrich: tlyric (translation, classic [mm:ss]) and yrc (verbatim
  // per-syllable — its own format, parsed by karaoke.js; passed through as-is).
  try {
    const url = `https://music.163.com/api/song/lyric/v1?id=${encodeURIComponent(id)}&tv=1&yv=1`;
    const j = await (await fetch(url, { headers: NCM_HEADERS, signal: AbortSignal.timeout(6000) })).json();
    tlyric = j?.tlyric?.lyric || '';
    yrc = j?.yrc?.lyric || '';
  } catch {
    /* enrichment is optional */
  }
  return sendJSON(res, { lrc, tlyric, yrc });
}

// Fallback only — muse's /now carries songId, so the renderer normally skips
// search entirely. Kept for parity with netease.js's title+artist re-ranking.
async function handleSearch(res, q) {
  const title = q.get('title') || '';
  const artist = q.get('artist') || '';
  const duration = Number(q.get('duration')) || 0;
  try {
    const s = encodeURIComponent(`${title} ${artist}`.trim());
    const url = `https://music.163.com/api/search/get?s=${s}&type=1&limit=5`;
    const j = await (await fetch(url, { headers: NCM_HEADERS, signal: AbortSignal.timeout(6000) })).json();
    const songs = j?.result?.songs || [];
    if (!songs.length) return sendJSON(res, null);
    const norm = (x) => (x || '').toLowerCase().replace(/\s+/g, '');
    const wantA = norm(artist);
    const wantT = norm(title);
    const best = songs
      .map((sng) => {
        let score = 0;
        if (sng.artists?.some((a) => norm(a.name) === wantA)) score += 100;
        if (norm(sng.name) === wantT) score += 40;
        if (duration && sng.duration) score += Math.max(0, 20 - Math.abs(sng.duration / 1000 - duration) * 2);
        return { sng, score };
      })
      .sort((a, b) => b.score - a.score)[0].sng;
    sendJSON(res, { id: best.id, cover: best.album?.picUrl ? best.album.picUrl + '?param=500y500' : null });
  } catch {
    sendJSON(res, null);
  }
}

// Proxy album art so the phone reads it same-origin: the renderer samples the
// cover on a <canvas> to derive its accent color, and a remote (NCM) image
// taints the canvas so getImageData throws and the accent falls back to grey.
async function handleCover(res, u) {
  if (!u) return void res.writeHead(400).end();
  try {
    const r = await fetch(u, { headers: NCM_HEADERS, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return void res.writeHead(502).end();
    res.writeHead(200, {
      'content-type': r.headers.get('content-type') || 'image/jpeg',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400',
    });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.writeHead(502).end();
  }
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'phone.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.join(RENDERER_DIR, rel);
  // Path-traversal guard: the resolved path must stay inside renderer/.
  if (!full.startsWith(RENDERER_DIR + path.sep)) return void res.writeHead(403).end();
  fs.readFile(full, (err, data) => {
    if (err) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

async function requestListener(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  switch (u.pathname) {
    case '/now':
      return void handleNow(res);
    case '/lyric':
      return void handleLyric(res, u.searchParams.get('id'));
    case '/search':
      return void handleSearch(res, u.searchParams);
    case '/cover':
      return void handleCover(res, u.searchParams.get('u'));
    case '/control': {
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body && typeof body.theme === 'string' && body.theme) {
          phoneTheme = body.theme;
          themeRev++;
        }
      }
      return sendJSON(res, { theme: phoneTheme, rev: themeRev });
    }
    default:
      return void serveStatic(res, u.pathname);
  }
}

// Serve HTTPS when certs are present (certs/cert.pem + key.pem), else HTTP.
// The Screen Wake Lock API — the whole reason the phone display stays lit —
// only exists in a secure context (HTTPS or localhost), so over a LAN IP the
// page MUST be https for it to work. `npm run certs` generates the local CA +
// server cert; the cert dir is gitignored (it holds private keys).
const certDir = path.join(__dirname, 'certs');
const tls =
  fs.existsSync(path.join(certDir, 'cert.pem')) && fs.existsSync(path.join(certDir, 'key.pem'))
    ? { cert: fs.readFileSync(path.join(certDir, 'cert.pem')), key: fs.readFileSync(path.join(certDir, 'key.pem')) }
    : null;

const server = tls ? https.createServer(tls, requestListener) : http.createServer(requestListener);

// On HTTPS, hand out the root CA over plain HTTP on PORT+1 so the phone can
// install it, then trust it (Settings → install profile → Certificate Trust
// Settings → toggle full trust). After that the https URL is a trusted secure
// context and the Wake Lock API becomes available.
//
// The cert is delivered as a .mobileconfig profile (content-type
// application/x-apple-aspen-config) — NOT a raw .crt with a download
// disposition, which iOS Safari saves to Files instead of prompting to install.
// A PEM body is already base64(DER), so stripping its armor yields the exact
// base64 the <data> payload needs.
if (tls && fs.existsSync(path.join(certDir, 'rootCA.pem'))) {
  const der64 = fs
    .readFileSync(path.join(certDir, 'rootCA.pem'), 'utf8')
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '');
  const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.security.root</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>com.echo.phone.ca</string>
      <key>PayloadUUID</key><string>8F2A1B4C-0001-4E5F-9A6B-EC0DECA00001</string>
      <key>PayloadDisplayName</key><string>echo local CA</string>
      <key>PayloadCertificateFileName</key><string>echo-rootCA.cer</string>
      <key>PayloadContent</key>
      <data>${der64}</data>
    </dict>
  </array>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>com.echo.phone.profile</string>
  <key>PayloadUUID</key><string>8F2A1B4C-0002-4E5F-9A6B-EC0DECA00002</string>
  <key>PayloadDisplayName</key><string>echo local CA (phone HTTPS)</string>
  <key>PayloadDescription</key><string>Trusts echo's local certificate so the phone lyrics display can use HTTPS.</string>
</dict></plist>`;
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-apple-aspen-config' });
      res.end(mobileconfig);
    })
    .listen(PORT + 1, HOST, () => {});
}

server.listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  const scheme = tls ? 'https' : 'http';
  console.log(`[phone] echo mobile is up (${scheme}):`);
  console.log(`  local : ${scheme}://localhost:${PORT}/`);
  ips.forEach((ip) => console.log(`  phone : ${scheme}://${ip}:${PORT}/   ← open in Safari`));
  if (tls) ips.forEach((ip) => console.log(`  cert  : http://${ip}:${PORT + 1}/   ← open this FIRST on the phone, then install + trust`));
  console.log(`[phone] now-playing proxied from ${MUSE_NOW} — muse stays loopback-only`);
});
