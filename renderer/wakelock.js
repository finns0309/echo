// wakelock.js — keep the phone screen awake so echo stays readable while it
// sits on a charger. Phone-only (loaded from phone.html); the desktop app never
// sleeps its window this way.
//
// iOS supports navigator.wakeLock from Safari 16.4+ (and, after a long-standing
// WebKit bug, installed PWAs from iOS 18.4+). Two platform constraints shape the
// UX here:
//   · acquiring the lock needs a user gesture — so we arm on the first tap
//     anywhere on the page, and surface a small pill inviting one in case the
//     page is propped up and never touched;
//   · the lock is dropped whenever the page is backgrounded — so we re-acquire
//     on every return to the foreground (visibilitychange).
(function () {
  'use strict';
  if (!('wakeLock' in navigator)) return; // unsupported → no lock, no UI

  let sentinel = null;
  let wanted = true; // user intent; the pill toggles it

  // --- tiny status/toggle pill, bottom-right, safe-area aware ---
  const style = document.createElement('style');
  // Top-right, not bottom-right: Safari's bottom toolbar overlaps bottom-fixed
  // content (and bottom is where subtitle/imsg put lyrics). z-index maxed so no
  // theme layer can bury it; dark chip + light ring so it reads on any cover.
  style.textContent = `
    #wl-pill{position:fixed;z-index:2147483647;
      top:calc(env(safe-area-inset-top) + 12px);
      right:calc(env(safe-area-inset-right) + 12px);
      display:flex;align-items:center;gap:7px;padding:10px 15px;border:0;
      border-radius:999px;font:600 14px/1 -apple-system,system-ui,sans-serif;
      background:rgba(0,0,0,.42);color:#fff;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.28),0 2px 10px rgba(0,0,0,.35);
      backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      opacity:.72;cursor:pointer;-webkit-tap-highlight-color:transparent;
      transition:opacity .5s ease,box-shadow .3s,color .3s;}
    #wl-pill .wl-dot{width:9px;height:9px;border-radius:50%;background:currentColor;
      box-shadow:0 0 6px currentColor;}
    #wl-pill.on{opacity:.98;color:var(--accent,#7fd1ff);
      box-shadow:inset 0 0 0 1px var(--accent,#7fd1ff),0 0 22px -4px var(--accent,#7fd1ff);}
    /* Auto-hidden after a few seconds so nothing static lingers on the OLED and
       it's out of the way. A tap anywhere brings it back briefly. Placed last so
       it overrides the .on opacity at equal specificity. */
    #wl-pill.wl-hidden{opacity:0;pointer-events:none;}
  `;
  document.head.appendChild(style);

  const pill = document.createElement('button');
  pill.id = 'wl-pill';
  pill.type = 'button';
  pill.innerHTML = '<span class="wl-dot"></span><span class="wl-label">常亮</span>';
  (document.body || document.documentElement).appendChild(pill);

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1300);
  }

  function render() {
    const on = !!sentinel;
    pill.classList.toggle('on', on);
    pill.setAttribute('aria-pressed', String(on));
    pill.title = on ? '屏幕常亮已开（点按关闭）' : '点按保持屏幕常亮';
  }

  async function acquire(announce) {
    if (!wanted || sentinel) return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      // iOS drops the lock on background; reflect that and let re-arm handle it.
      sentinel.addEventListener('release', () => {
        sentinel = null;
        render();
      });
      render();
      if (announce) toast('🔆 屏幕常亮已开');
    } catch {
      sentinel = null; // gesture missing / not visible — the first tap will arm
      render();
    }
  }

  async function disarm() {
    wanted = false;
    try {
      await sentinel?.release();
    } catch {}
    sentinel = null;
    render();
    toast('屏幕常亮已关');
  }

  // Auto-hide: flash the pill up, then fade it out after a few seconds so no
  // static element sits on the OLED (burn-in) or clutters the view. Any tap
  // brings it back briefly — long enough to toggle keep-awake off if wanted.
  let hideTimer = null;
  function reveal() {
    pill.classList.remove('wl-hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => pill.classList.add('wl-hidden'), 3500);
  }

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sentinel) disarm(); // on → off
    else {
      wanted = true;
      acquire(true);
    } // off → on
    reveal();
  });

  // Arm on the first interaction anywhere (satisfies the gesture requirement)
  // and briefly flash the pill so it's reachable, then let it fade again.
  document.addEventListener(
    'pointerdown',
    () => {
      if (wanted) acquire(true);
      reveal();
    },
    { passive: true },
  );
  // Re-acquire when the page returns to the foreground (the lock drops on hide).
  // No reveal here — it stays hidden unless you actually tap.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire(false);
  });

  // Optimistic attempt on load, then show the pill once (auto-hides after) so
  // it's discoverable without leaving anything permanent on screen.
  render();
  acquire(true);
  reveal();
})();
