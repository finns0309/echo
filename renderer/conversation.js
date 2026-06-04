// Conversation · chat-bubble lyric stream (imsg theme).
// Lyrics presented as chat messages. New line = new bubble appended at the
// bottom; older bubbles stay visible (capped at CV_MAX) and demote to .past.
// Typing dots show during the LRC gap between the current line ending and
// the next line starting (driven by applyGap, called every tick).
//
// Reads app.js globals at call time: `state` (lastIdx/lines), `titleEl`,
// `artistEl`. Loaded before app.js, but every function here runs only after
// init (applyTheme/renderAt/tick), so those globals are always ready.
//
// Public API: window.FL_CONVO = { build, refreshHeader, spawn, applyGap }
(function () {

const CV_MAX = 5;

function buildConvScaffold() {
  const cv = document.getElementById('convo');
  if (!cv || cv.dataset.built) return;
  cv.dataset.built = '1';
  cv.innerHTML = `
    <div class="cv-header">
      <span class="cv-avatar"></span>
      <div class="cv-meta">
        <div class="cv-name"></div>
        <div class="cv-status"><i class="cv-dot"></i><span></span></div>
      </div>
    </div>
    <div class="cv-stream"></div>
    <div class="cv-typing"><i></i><i></i><i></i></div>
  `;
}

function refreshConvHeader() {
  const cv = document.getElementById('convo');
  if (!cv || !cv.dataset.built) return;
  const np = { title: titleEl.textContent || '', artist: (artistEl.textContent || '').replace(/^\s·\s/, '') };
  cv.querySelector('.cv-name').textContent = np.artist || np.title || '—';
  cv.querySelector('.cv-status span').textContent = np.artist ? np.title : '正在播放';
}

function spawnConvBubble(line) {
  const cv = document.getElementById('convo');
  if (!cv) return;
  const stream = cv.querySelector('.cv-stream');
  if (!stream) return;
  const text = (line && line.text) || '';
  if (!text) return;

  // Demote previous current bubble.
  const prevNow = stream.querySelector('.cv-bubble.now');
  if (prevNow) { prevNow.classList.remove('now'); prevNow.classList.add('past'); }

  const b = document.createElement('div');
  b.className = 'cv-bubble now fresh';
  b.textContent = text;
  stream.appendChild(b);
  // Drop fresh class on the next frame so the entrance transition kicks in.
  requestAnimationFrame(() => requestAnimationFrame(() => b.classList.remove('fresh')));

  while (stream.children.length > CV_MAX) stream.firstElementChild.remove();
  refreshConvHeader();
}

function applyConvGap(t) {
  if (document.body.dataset.layout !== 'conversation') return;
  const cv = document.getElementById('convo');
  if (!cv || !cv.dataset.built) return;
  const typing = cv.querySelector('.cv-typing');
  if (!typing) return;
  const i = state.lastIdx;
  if (i < 0 || !state.lines.length) { typing.classList.remove('show'); return; }
  const last = state.lines[i];
  const next = state.lines[i + 1];
  if (!last || !next) { typing.classList.remove('show'); return; }
  // Show typing dots in the gap after the current line ends, before the next.
  const lineDur = next.time - last.time;
  const inGap = t > last.time + lineDur * 0.7 && t < next.time - 0.05;
  typing.classList.toggle('show', inGap);
}

window.FL_CONVO = {
  build:         buildConvScaffold,
  refreshHeader: refreshConvHeader,
  spawn:         spawnConvBubble,
  applyGap:      applyConvGap,
};

})();
