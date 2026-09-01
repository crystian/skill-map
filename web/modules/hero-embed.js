// ============================================================
// HERO EMBED: the real map, framed
// ============================================================
// The hero card frames `/demo/?embed=1&replay=…&theme=…` (see index.html
// and spec/provider-activity.md §"Embedded replay"): the same bundle the
// "See it live" button opens, rendered chrome-less and looping its
// curated session. The <iframe> ships WITHOUT `src`: an Angular boot
// racing the hero's own first paint would drag the LCP, so the src is
// set after the page `load` (on the first idle slot after it). The
// poster underneath (a screenshot of the same graph) stays until the
// framed map has actually drawn its cards, then `is-live` fades the
// frame in over it; a frame that never reports (blocked, offline)
// leaves the poster in place, which is the honest fallback.
// ============================================================
(() => {
  const card = document.getElementById('hero-graph');
  if (!card) return;
  const frame = card.querySelector('.hero__graph-frame');
  if (!frame) return;
  const src = frame.getAttribute('data-src');
  if (!src) return;

  // Same origin: the framed document is readable, so "live" means the
  // map's node hosts exist, not merely that the HTML arrived (the
  // Angular boot lands a second or so after `load`). Bounded poll.
  const POLL_MS = 120;
  const GIVE_UP_MS = 15000;
  const reveal = () => card.classList.add('is-live');
  const watchForCards = () => {
    const started = Date.now();
    const tick = () => {
      let drawn = false;
      try {
        drawn = !!frame.contentDocument?.querySelector('.sm-gnode-host');
      } catch {
        drawn = true; // cross-origin (a mirror host): trust `load`
      }
      if (drawn) {
        reveal();
        return;
      }
      if (Date.now() - started < GIVE_UP_MS) setTimeout(tick, POLL_MS);
    };
    tick();
  };

  const arm = () => {
    frame.addEventListener('load', watchForCards, { once: true });
    frame.src = src;
  };
  const schedule = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(arm, { timeout: 1500 });
    else setTimeout(arm, 0);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
})();
