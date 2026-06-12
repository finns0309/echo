// director.js — 选词导演（主进程，零依赖）。
//
// 核心判断：歌词不是流，是剧本 —— commitTrack 时整首歌的行已全量已知，
// 所以 LLM 不需要逐行实时跟拍，而是每首歌一次批量「读剧本、写分镜」：
// 去重后的全部歌词行 → Claude (Bedrock) → 每行一个强调词。结果按歌词
// 内容 sha1 落盘（userData/director-cache/），重听零成本零延迟；首听
// 期间已显示的行用启发式，导演结果只升级之后的行 —— LLM 永远不挡渲染。
//
// 失败语义：无 secrets.json / 网络错 / 超时 / 解析失败 ⇒ 返回 null 且
// 不写缓存（下次切回这首歌自动重试），renderer 维持 FL_TEXT 启发式。
//
// 调用面：bedrock-runtime InvokeModel + Bedrock API key（bearer）。模型
// 与区域在 secrets.json（gitignored，见 README 不入库）。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_LINES = 160;    // 超长歌词截断（罕见；溢出的行回退启发式）
const TIMEOUT_MS = 30000;

const SYS = `你是歌词字卡的选词导演。输入是一首歌去重后的歌词行，格式「行号|歌词」。为每一行选一个「强调词」——这行情感与画面的核心，舞台会把它放大、标红。

硬规则：
1. 强调词必须是该行原文中逐字符连续出现的子串（程序按精确子串定位，多一字少一字都会失效）。
2. 必须是完整的自然词：日语动词含送り仮名（选「巡り合う」，不是「巡り合」或「合」）；中文取完整词语；英文取完整单词或不超过三个词的短语；复合词取整。
3. 不选纯助词、虚词、语气词（の・を・が・て、的・了・是・在、a/the/of 这类）。
4. 中日文强调词 1–6 个字；英文不超过 20 个字符。宁可短而完整，不要长而破碎。
5. 只输出一个 JSON 对象：{"k":["行0的词","行1的词",...]}，第 i 项对应行号 i，项数与输入行数一致。不要解释，不要 markdown 围栏。`;

// 网络栈：Electron 主进程里用 Chromium 的 net.fetch —— 它跟随系统代理。
// Bedrock 对 Anthropic 模型按出口 IP 做地区限制，这台机器靠代理出海；
// Node 原生 fetch 不读 http_proxy 环境变量，直连会被 400 地区墙拦下
// （renderer 的 NetEase 请求一直能跑就是因为走的 Chromium 栈）。
// standalone 测试脚本没有 electron，回退 global fetch —— 跑的时候带
// NODE_USE_ENV_PROXY=1（Node ≥ 22.15）让它吃同一份代理变量。
let doFetch = (...a) => globalThis.fetch(...a);
try {
  const { net } = require('electron');
  if (net && net.fetch) doFetch = (...a) => net.fetch(...a);
} catch {}

let cfg = null;      // { apiKey, region, model } — 无则导演停职
let cacheDir = '';
const mem = new Map();      // hash → map（会话内重听免磁盘 IO）
const inflight = new Map(); // hash → Promise（同一首歌的并发请求共享一次调用）

function init(userDataDir) {
  cacheDir = path.join(userDataDir, 'director-cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
  try {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'secrets.json'), 'utf8'));
    if (s.bedrockApiKey && s.bedrockModel) {
      cfg = { apiKey: s.bedrockApiKey, region: s.bedrockRegion || 'us-east-1', model: s.bedrockModel };
    }
  } catch {}
  if (!cfg) console.log('[director] secrets.json 缺失或不完整 — 选词回退启发式');
}

// payload = { title, artist, lines: string[] }（renderer 的原始行文本）
// → Promise<{ 行文本: 强调词 } | null>
async function direct(payload) {
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const uniq = [...new Set(lines.map((t) => String(t).trim()).filter(Boolean))].slice(0, MAX_LINES);
  if (!uniq.length) return null;
  const h = crypto.createHash('sha1').update(uniq.join('\n')).digest('hex').slice(0, 16);

  if (mem.has(h)) return mem.get(h);
  const f = path.join(cacheDir, h + '.json');
  try {
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    mem.set(h, m);
    return m;
  } catch {}

  if (!cfg) return null;
  if (inflight.has(h)) return inflight.get(h);

  const p = (async () => {
    const t0 = Date.now();
    const arr = await callClaude(payload, uniq);
    const map = buildMap(uniq, arr);
    if (!map) throw new Error('no usable keywords');
    fs.writeFileSync(f, JSON.stringify(map));
    mem.set(h, map);
    console.log(`[director] ${payload.title || '?'} — ${Object.keys(map).length}/${uniq.length} 行选词, ${Date.now() - t0}ms`);
    return map;
  })().catch((e) => {
    console.warn('[director]', payload.title || '?', '失败:', e.message);
    return null; // 失败不入缓存 — 下次进这首歌自动重试
  }).finally(() => inflight.delete(h));

  inflight.set(h, p);
  return p;
}

async function callClaude(meta, uniq) {
  const user = `《${meta.title || ''}》${meta.artist ? ' — ' + meta.artist : ''}\n` +
    uniq.map((l, i) => `${i}|${l}`).join('\n');
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await doFetch(
      `https://bedrock-runtime.${cfg.region}.amazonaws.com/model/${encodeURIComponent(cfg.model)}/invoke`,
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 3000,
          temperature: 0, // 决定性：同一首歌永远同一份分镜（与缓存语义一致）
          system: SYS,
          messages: [{ role: 'user', content: user }],
        }),
        signal: ctrl.signal,
      },
    );
    if (!r.ok) throw new Error(`bedrock ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const text = (j.content || []).map((b) => b.text || '').join('');
    const m = text.match(/\{[\s\S]*\}/); // 容忍模型偶尔加围栏/前后缀
    if (!m) throw new Error('response has no JSON');
    const arr = JSON.parse(m[0]).k;
    if (!Array.isArray(arr)) throw new Error('bad JSON shape');
    return arr;
  } finally { clearTimeout(tid); }
}

// 逐行校验：强调词必须原样出现在该行里，不合格的行弃用（回退启发式）。
// 防御 LLM 的两类典型错误：改写用词、行号错位。
function buildMap(uniq, arr) {
  const map = {};
  let ok = 0;
  uniq.forEach((line, i) => {
    const kw = typeof arr[i] === 'string' ? arr[i].trim() : '';
    if (kw && kw.length <= 24 && line.includes(kw)) { map[line] = kw; ok++; }
  });
  return ok ? map : null;
}

module.exports = { init, direct };
