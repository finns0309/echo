// Danmaku · barrage layout (弹幕 theme).
// Each lyric line spawns one flying card that animates right→left and self-
// removes on animationend. Multiple cards coexist (long lines + short
// follow-ups overlap, exactly like real danmaku). Y positions are picked
// from a small set of "lanes" with a recency check so consecutive lines
// don't clobber each other.
//
// Public API: window.FL_DANMAKU.spawn(line)  — line is { text } (or falsy → no-op)
(function () {

const DM_LANES = 8;            // vertical bands the screen is divided into
const DM_LANE_TOP = 0.10;      // start lanes 10% from top
const DM_LANE_BOTTOM = 0.84;   // last lane ends 84% from top (leave bottom)
const dmRecentLanes = [];      // last few lanes used, to dodge clustering

function pickDanmakuLane() {
  // Avoid the most recent 3 lanes if possible — gives short bursts of
  // back-to-back lyric lines real vertical separation.
  for (let attempt = 0; attempt < 8; attempt++) {
    const lane = Math.floor(Math.random() * DM_LANES);
    if (!dmRecentLanes.includes(lane)) {
      dmRecentLanes.push(lane);
      while (dmRecentLanes.length > 3) dmRecentLanes.shift();
      return lane;
    }
  }
  return Math.floor(Math.random() * DM_LANES);
}

function spawn(line) {
  const dm = document.getElementById('danmaku');
  if (!dm) return;
  const text = (line && line.text) || '';
  if (!text) return;

  const el = document.createElement('div');
  el.className = 'dm-line';
  el.textContent = text;

  const lane = pickDanmakuLane();
  const yFrac = DM_LANE_TOP + (lane / (DM_LANES - 1)) * (DM_LANE_BOTTOM - DM_LANE_TOP);
  el.style.setProperty('--y', (yFrac * 100).toFixed(2) + '%');

  // Duration scales with text length so long lines aren't rocketing past
  // before they're readable. 9–22s range covers most lyric lengths.
  const len = [...text].length;
  const dur = Math.max(9, Math.min(22, 9 + len * 0.22));
  el.style.setProperty('--dur', dur.toFixed(2) + 's');

  el.addEventListener('animationend', () => el.remove());
  dm.appendChild(el);
}

window.FL_DANMAKU = { spawn };

})();
