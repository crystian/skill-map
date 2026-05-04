// skill-map landing — native JS.
// Ported section by section from web/tmp/*.jsx.

(() => {
  // ============================================================
  // Mobile nav drawer
  // ============================================================
  const toggle = document.querySelector('.lp-nav__toggle');
  const drawer = document.getElementById('nav-drawer');
  if (toggle && drawer) {
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      drawer.dataset.open = String(open);
      document.body.classList.toggle('is-nav-open', open);
    };

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      setOpen(open);
    });
    drawer.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.dataset.open === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });
    const mq = window.matchMedia('(min-width: 769px)');
    mq.addEventListener('change', (e) => { if (e.matches) setOpen(false); });
  }

  // ============================================================
  // Hero graph — selection + drag + inspector
  // ============================================================
  // The card is `display: none` below 768px (see styles.css; 768 inclusive
  // shows the graph). Skip the whole init on mobile — saves event listener
  // registration, adjacency map build, and inspector wiring on a card the
  // user can't see.
  if (window.matchMedia('(max-width: 767px)').matches) return;
  const graphCard = document.getElementById('hero-graph');
  if (!graphCard) return;
  const svg = graphCard.querySelector('.hero__graph-svg');
  if (!svg) return;

  const TYPE_COLOR = {
    skill:   '#00C853',
    agent:   '#7C3AED',
    command: '#4C1D95',
    hook:    '#A78BFA',
    note:    '#8A93A1',
    orphan:  '#5A6472',
  };

  // Graph chrome strings stay in English in both locales — the audience is
  // devs, not mathematicians, and the localized labels read awkward.
  const STR = {
    skill: 'SKILL', agent: 'AGENT', command: 'COMMAND', hook: 'HOOK', note: 'NOTE', orphan: 'ORPHAN',
    refs: 'refs', tokens: 'tokens', bytes: 'bytes', lastscan: 'last scan',
    'warn.collision': 'references 5 skills, 1 collides',
    'warn.orphan':    'no inbound references — never invoked',
  };
  const t = (k) => STR[k] ?? k;
  const formatAgo = (raw) => `${raw} ago`;

  // Build adjacency map from edges in the DOM.
  const edges = Array.from(svg.querySelectorAll('.edge'));
  const adj = new Map();
  for (const e of edges) {
    const a = e.dataset.from, b = e.dataset.to;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }

  const nodes = Array.from(svg.querySelectorAll('.node'));
  const nodeById = new Map(nodes.map((n) => [n.dataset.id, n]));

  // Read each node's current position from its transform="translate(x,y)".
  const nodePos = new Map();
  function readPos(g) {
    const m = /translate\(\s*([-0-9.]+)[ ,]\s*([-0-9.]+)\s*\)/.exec(g.getAttribute('transform') || '');
    return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
  }
  for (const n of nodes) nodePos.set(n.dataset.id, readPos(n));

  // Index edges by endpoint for O(1) updates on drag.
  const edgesByEndpoint = new Map();
  for (const e of edges) {
    for (const id of [e.dataset.from, e.dataset.to]) {
      if (!edgesByEndpoint.has(id)) edgesByEndpoint.set(id, []);
      edgesByEndpoint.get(id).push(e);
    }
  }

  const viewport = svg.querySelector('.hg-viewport');
  const selectFx = svg.querySelector('.select-fx');
  let selectFxG = null;
  let selected = 'reviewer';
  const travelers = new Map(); // edge element → traveler <circle>

  // Inspector panel — created once, updated on selection.
  const inspector = document.createElement('div');
  inspector.className = 'hero__inspector';
  inspector.innerHTML = `
    <div class="hero__inspector__type">
      <span class="hero__inspector__dot"></span>
      <span class="hero__inspector__type-label"></span>
    </div>
    <div class="hero__inspector__name"></div>
    <div class="hero__inspector__path"></div>
    <div class="hero__inspector__rows">
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('refs'))}</span>     <span class="v" data-k="refs"></span></div>
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('tokens'))}</span>   <span class="v" data-k="tokens"></span></div>
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('bytes'))}</span>    <span class="v" data-k="bytes"></span></div>
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('lastscan'))}</span> <span class="v" data-k="lastscan"></span></div>
    </div>
    <div class="hero__inspector__warn" hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9"  x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span class="hero__inspector__warn-text"></span>
    </div>
  `;
  graphCard.appendChild(inspector);

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function updateInspector() {
    const node = nodeById.get(selected);
    if (!node) { inspector.hidden = true; return; }
    inspector.hidden = false;
    const type = node.dataset.type;
    const name = node.querySelector('.node-label')?.textContent ?? selected;
    const color = TYPE_COLOR[type] ?? '#fff';

    inspector.style.borderColor = `${color}55`;
    inspector.style.boxShadow = `0 0 0 1px ${color}22, 0 20px 50px rgba(0,0,0,.5)`;
    inspector.style.setProperty('--type-color', color);

    inspector.querySelector('.hero__inspector__type-label').textContent = t(type);
    inspector.querySelector('.hero__inspector__name').textContent = name;
    inspector.querySelector('.hero__inspector__path').textContent = `${type}s/${name}.md`;

    inspector.querySelector('[data-k="refs"]').textContent     = String(adj.get(selected)?.size ?? 0);
    inspector.querySelector('[data-k="tokens"]').textContent   = node.dataset.tokens   ?? '—';
    inspector.querySelector('[data-k="bytes"]').textContent    = node.dataset.bytes    ?? '—';
    inspector.querySelector('[data-k="lastscan"]').textContent = node.dataset.lastscan ? formatAgo(node.dataset.lastscan) : '—';

    const warn = inspector.querySelector('.hero__inspector__warn');
    const warnKey = node.dataset.warn;
    if (warnKey) {
      warn.hidden = false;
      inspector.querySelector('.hero__inspector__warn-text').textContent = t(warnKey);
    } else {
      warn.hidden = true;
    }
  }

  // Recompute highlight state for ALL nodes/edges. Only call this when
  // `selected` changes — NOT on hover. Hover is local: only the entered
  // node toggles its own data-hover.
  function applyHighlight() {
    const neighbors = adj.get(selected) ?? new Set();
    for (const n of nodes) {
      const id = n.dataset.id;
      const isSel = id === selected;
      const isHi  = isSel || neighbors.has(id);
      n.dataset.selected = String(isSel);
      n.dataset.dim      = String(selected ? !isHi : false);
      n.style.setProperty('--type-color', TYPE_COLOR[n.dataset.type] ?? '#fff');
    }
    for (const e of edges) {
      const isHi = e.dataset.from === selected || e.dataset.to === selected;
      e.dataset.hi  = String(isHi);
      e.dataset.dim = String(selected ? !isHi : false);
    }
    buildSelectFx();
  }

  // Build the pulsing ring for the selected node. Uses a translated <g> so
  // its inner <circle> sits at (0,0); CSS animates `transform: scale()` on
  // the circle (compositor-only). Avoids SMIL's per-frame attribute
  // mutation, which re-rasterizes the SVG.
  //
  // Split into two functions so drag (which fires every pointermove) can
  // call the cheap `setSelectFxPos` instead of rebuilding DOM each frame.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function buildSelectFx() {
    while (selectFx.firstChild) selectFx.removeChild(selectFx.firstChild);
    selectFxG = null;
    travelers.clear();
    const node = nodeById.get(selected);
    if (!node) return;
    const r = +node.querySelector('circle').getAttribute('r');
    const color = TYPE_COLOR[node.dataset.type] ?? '#fff';

    const g = document.createElementNS(SVG_NS, 'g');

    const solid = document.createElementNS(SVG_NS, 'circle');
    solid.setAttribute('cx', '0'); solid.setAttribute('cy', '0');
    solid.setAttribute('r', String(r + 6));
    solid.setAttribute('fill', 'none');
    solid.setAttribute('stroke', color);
    solid.setAttribute('stroke-width', '2');
    solid.setAttribute('opacity', '.7');
    g.appendChild(solid);

    const pulse = document.createElementNS(SVG_NS, 'circle');
    pulse.setAttribute('class', 'select-fx-pulse');
    pulse.setAttribute('cx', '0'); pulse.setAttribute('cy', '0');
    pulse.setAttribute('r', String(r + 8));
    pulse.setAttribute('fill', 'none');
    pulse.setAttribute('stroke', color);
    pulse.setAttribute('stroke-width', '1.5');
    g.appendChild(pulse);

    selectFx.appendChild(g);
    selectFxG = g;
    setSelectFxPos();

    // Traveling pulses on connected edges. Stagger their start so they
    // don't all fire in unison — looks more alive, same total cost.
    let i = 0;
    for (const e of edges) {
      if (e.dataset.from !== selected && e.dataset.to !== selected) continue;
      const tr = document.createElementNS(SVG_NS, 'circle');
      tr.setAttribute('class', 'hg-traveler');
      tr.setAttribute('cx', '0'); tr.setAttribute('cy', '0');
      tr.setAttribute('r', '3');
      tr.setAttribute('fill', '#A78BFA');
      tr.style.animationDelay = `${(i++ * 180) % 1400}ms`;
      selectFx.appendChild(tr);
      travelers.set(e, tr);
      updateTravelerPath(e);
    }
  }
  function setSelectFxPos() {
    if (!selectFxG) return;
    const pos = nodePos.get(selected);
    if (!pos) return;
    selectFxG.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
  }
  function updateTravelerPath(edge) {
    const tr = travelers.get(edge);
    if (!tr) return;
    const x1 = edge.getAttribute('x1');
    const y1 = edge.getAttribute('y1');
    const x2 = edge.getAttribute('x2');
    const y2 = edge.getAttribute('y2');
    tr.style.offsetPath = `path('M ${x1} ${y1} L ${x2} ${y2}')`;
  }

  // Convert client (screen) coords to viewport-local coords. Uses the
  // viewport's CTM so zoom/pan are accounted for automatically — drag
  // continues to work when k != 1 or (x,y) != (0,0).
  function clientToViewport(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = viewport.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: clientX, y: clientY };
  }

  function moveNodeTo(id, x, y) {
    nodePos.set(id, { x, y });
    const g = nodeById.get(id);
    if (g) g.setAttribute('transform', `translate(${x}, ${y})`);
    const conn = edgesByEndpoint.get(id);
    if (conn) {
      for (const e of conn) {
        if (e.dataset.from === id) { e.setAttribute('x1', x); e.setAttribute('y1', y); }
        if (e.dataset.to   === id) { e.setAttribute('x2', x); e.setAttribute('y2', y); }
        updateTravelerPath(e);
      }
    }
    if (id === selected) setSelectFxPos();
  }

  // ---------- Zoom + pan ----------
  const view = { x: 0, y: 0 };
  function applyView() {
    viewport.setAttribute('transform', `translate(${view.x} ${view.y})`);
  }

  let panning = null;

  // Pointer interactions per node — drag, click-as-select, hover.
  let dragging = null; // { id, dx, dy, moved }

  for (const node of nodes) {
    // Hover is local — toggle data-hover only on the entered node so the
    // browser doesn't recompute styles on the other 12.
    node.addEventListener('pointerenter', () => { node.dataset.hover = 'true'; });
    node.addEventListener('pointerleave', () => { delete node.dataset.hover;  });

    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = node.dataset.id;
      const pos = nodePos.get(id);
      const p = clientToViewport(e.clientX, e.clientY);
      dragging = { id, dx: pos.x - p.x, dy: pos.y - p.y, moved: 0 };
      node.dataset.dragging = 'true';
      node.setPointerCapture?.(e.pointerId);
    });
  }

  // Bg pan — pointerdown anywhere on the SVG that isn't a node.
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node')) return;
    panning = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    svg.classList.add('is-panning');
    svg.setPointerCapture?.(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (panning) {
      view.x = panning.vx + (e.clientX - panning.sx);
      view.y = panning.vy + (e.clientY - panning.sy);
      applyView();
      return;
    }
    if (!dragging) return;
    const p = clientToViewport(e.clientX, e.clientY);
    const nx = p.x + dragging.dx;
    const ny = p.y + dragging.dy;
    const prev = nodePos.get(dragging.id);
    dragging.moved += Math.hypot(nx - prev.x, ny - prev.y);
    moveNodeTo(dragging.id, nx, ny);
  });

  function endDrag() {
    if (panning) {
      panning = null;
      svg.classList.remove('is-panning');
    }
    if (!dragging) return;
    const { id, moved } = dragging;
    const node = nodeById.get(id);
    if (node) delete node.dataset.dragging;
    if (moved < 4) {
      selected = id;
      updateInspector();
      applyHighlight();
    }
    dragging = null;
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // Initial paint.
  updateInspector();
  applyHighlight();

  // ============================================================
  // Physics — Coulomb repulsion + spring on edges + drift to home
  // ------------------------------------------------------------
  // Lives inside the same IIFE so it can call moveNodeTo() and read
  // nodePos directly. Ported from web/tmp/hero-graph.jsx.
  //
  // Self-suspends on prefers-reduced-motion / page hidden / card out
  // of viewport (same pattern as the particle field).
  //
  // n = 13 nodes → n² = 169 force ops per frame, plus per-node spring
  // pass on edges. Trivially within budget on the GPU side; the cost
  // is the 13 setAttribute('transform') calls per frame in moveNodeTo,
  // which the compositor handles cheaply because each .node has its
  // own GPU layer (will-change: transform).
  // ============================================================
  const VIEW_W = 900, VIEW_H = 560;
  const EDGE_TARGET = 130;
  const REPULSE_K   = 4500;
  const SPRING_K    = 0.06;
  const DRIFT_K     = 0.6;
  const DAMPING     = 0.82;
  const VMAX        = 50;
  const MARGIN      = 60;
  // 30fps cap. Same approach as the particle field — rAF wakes at the
  // display rate but the n² + setAttribute work only runs every 33ms.
  const PHYS_FRAME_INTERVAL = 1000 / 30;
  let physNextT = 0;

  // Per-node physics state (velocity + home + breathing wobble seed).
  const phys = new Map();
  for (const [id, p] of nodePos) {
    phys.set(id, {
      vx: 0, vy: 0,
      px: p.x, py: p.y,             // home position — drift target
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.4,
    });
  }

  // Pre-index edges as numeric pairs for the spring pass.
  const idxOf = new Map(Array.from(nodeById.keys()).map((id, i) => [id, i]));
  const idsByIdx = Array.from(nodeById.keys());
  const edgePairs = edges.map((e) => ({
    a: idxOf.get(e.dataset.from),
    b: idxOf.get(e.dataset.to),
  }));

  const physReducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let physReduced  = physReducedMQ.matches;
  let physVisible  = false;
  let physPageOK   = !document.hidden;
  let physRaf      = null;
  let physLastT    = 0;

  function physShould() {
    return !physReduced && physVisible && physPageOK;
  }
  function physStart() {
    if (physRaf != null || !physShould()) return;
    physLastT = performance.now();
    physRaf = requestAnimationFrame(physStep);
  }
  function physStop() {
    if (physRaf != null) { cancelAnimationFrame(physRaf); physRaf = null; }
  }

  function physStep(now) {
    physRaf = null;
    if (!physShould()) return;
    if (now < physNextT) {
      physRaf = requestAnimationFrame(physStep);
      return;
    }
    physNextT = now + PHYS_FRAME_INTERVAL;
    const dt = Math.min(0.06, (now - physLastT) / 1000);
    physLastT = now;
    const time = now / 1000;

    // Snapshot positions into arrays for tight inner loops.
    const N = idsByIdx.length;
    const xs = new Float32Array(N), ys = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = nodePos.get(idsByIdx[i]);
      xs[i] = p.x; ys[i] = p.y;
    }
    const fxArr = new Float32Array(N), fyArr = new Float32Array(N);
    const draggedId = dragging?.id;

    // 1. pairwise repulsion (Coulomb-ish)
    for (let i = 0; i < N; i++) {
      if (idsByIdx[i] === draggedId) continue;
      let fx = 0, fy = 0;
      const ax = xs[i], ay = ys[i];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const dx = ax - xs[j];
        const dy = ay - ys[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const d = Math.sqrt(d2);
        const f = REPULSE_K / d2;
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      fxArr[i] = fx; fyArr[i] = fy;
    }

    // 2. spring forces along edges
    for (const e of edgePairs) {
      if (e.a == null || e.b == null) continue;
      const dx = xs[e.b] - xs[e.a];
      const dy = ys[e.b] - ys[e.a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const stretch = d - EDGE_TARGET;
      const fx = (dx / d) * stretch * SPRING_K * 60;
      const fy = (dy / d) * stretch * SPRING_K * 60;
      if (idsByIdx[e.a] !== draggedId) { fxArr[e.a] += fx; fyArr[e.a] += fy; }
      if (idsByIdx[e.b] !== draggedId) { fxArr[e.b] -= fx; fyArr[e.b] -= fy; }
    }

    // 3. drift to home + soft bounds + breathing wobble + integrate
    for (let i = 0; i < N; i++) {
      const id = idsByIdx[i];
      if (id === draggedId) continue;
      const ph = phys.get(id);
      let fx = fxArr[i], fy = fyArr[i];

      // drift to home
      fx += (ph.px - xs[i]) * DRIFT_K;
      fy += (ph.py - ys[i]) * DRIFT_K;

      // soft bounds (push away from edges)
      if (xs[i] < MARGIN)             fx += (MARGIN - xs[i]) * 2;
      if (xs[i] > VIEW_W - MARGIN)    fx -= (xs[i] - (VIEW_W - MARGIN)) * 2;
      if (ys[i] < MARGIN + 40)        fy += (MARGIN + 40 - ys[i]) * 2; // top bar room
      if (ys[i] > VIEW_H - MARGIN)    fy -= (ys[i] - (VIEW_H - MARGIN)) * 2;

      // breathing wobble — sine per node
      fx += Math.cos(time * ph.speed + ph.phase) * 6;
      fy += Math.sin(time * ph.speed * 1.3 + ph.phase) * 6;

      // integrate with damping
      ph.vx = (ph.vx + fx * dt) * DAMPING;
      ph.vy = (ph.vy + fy * dt) * DAMPING;

      // velocity cap
      const vmag = Math.hypot(ph.vx, ph.vy);
      if (vmag > VMAX) { ph.vx *= VMAX / vmag; ph.vy *= VMAX / vmag; }

      const nx = xs[i] + ph.vx * dt;
      const ny = ys[i] + ph.vy * dt;
      moveNodeTo(id, nx, ny);
    }

    physRaf = requestAnimationFrame(physStep);
  }

  // Visibility wiring (mirrors the particle field).
  document.addEventListener('visibilitychange', () => {
    physPageOK = !document.hidden;
    if (physShould()) physStart(); else physStop();
  });
  physReducedMQ.addEventListener('change', (e) => {
    physReduced = e.matches;
    if (physShould()) physStart(); else physStop();
  });
  const physIO = new IntersectionObserver(([entry]) => {
    physVisible = entry.isIntersecting;
    if (physShould()) physStart(); else physStop();
  });
  physIO.observe(graphCard);
})();

// ============================================================
// Hero graph — particle field (canvas 2D)
// ------------------------------------------------------------
// ~80 floating particles + violet halo under the cursor.
// Self-suspends when:
//   - the user prefers reduced motion
//   - the page is hidden (other tab, minimised) — Page Visibility API
//   - the card scrolls out of view — IntersectionObserver
// DPR-aware via ResizeObserver. No external deps.
// ============================================================
(() => {
  // Card is hidden on mobile via CSS (≤767px); bail before allocating
  // particles, canvas context, and observers.
  if (window.matchMedia('(max-width: 767px)').matches) return;
  const card = document.getElementById('hero-graph');
  if (!card) return;
  const canvas = card.querySelector('.hg-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const N_BASE = 80; // tuned for the 1280×560 reference card; scales with area
  const HALO_R = 200;
  const ATTRACT_R = 320;
  const ATTRACT_F = 0.15; // per-frame acceleration coefficient applied at the cursor
  const TINT_R = 260;
  // Cap the canvas loop at ~30fps. rAF still wakes at the display rate,
  // but the heavy per-frame work (clear + 80 arc draws) only runs every
  // 33ms — same idea as `steps(45)` does for CSS animations.
  const FRAME_INTERVAL = 1000 / 30;
  let nextFrameT = 0;

  const reducedMotionMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reducedMotionMQ.matches;
  let cardVisible = false;
  let pageVisible = !document.hidden;
  let rafId = null;
  let W = 0, H = 0;
  let particles = [];
  const mouse = { x: -9999, y: -9999, active: false };

  function initParticles() {
    particles = [];
    const target = Math.max(20, Math.round(N_BASE * (W * H) / (1280 * 560)));
    for (let i = 0; i < target; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08,
        r: Math.random() * 1.2 + 0.4,
        baseA: Math.random() * 0.22 + 0.10,
      });
    }
  }

  function resize() {
    const rect = card.getBoundingClientRect();
    if (rect.width === W && rect.height === H) return;
    W = rect.width; H = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
  }

  function shouldRun() {
    return !reducedMotion && cardVisible && pageVisible && W > 0;
  }

  function start() {
    if (rafId != null || !shouldRun()) return;
    rafId = requestAnimationFrame(draw);
  }

  function stop() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function draw(now) {
    rafId = null;
    if (!shouldRun()) return;
    if (now < nextFrameT) {
      rafId = requestAnimationFrame(draw);
      return;
    }
    nextFrameT = now + FRAME_INTERVAL;
    ctx.clearRect(0, 0, W, H);

    // Mouse halo (radial gradient, only when over the card).
    if (mouse.active) {
      const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, HALO_R);
      g.addColorStop(0,   'rgba(167,139,250,0.18)');
      g.addColorStop(0.4, 'rgba(124,58,237,0.06)');
      g.addColorStop(1,   'rgba(124,58,237,0)');
      ctx.fillStyle = g;
      ctx.fillRect(mouse.x - HALO_R, mouse.y - HALO_R, HALO_R * 2, HALO_R * 2);
    }

    for (const p of particles) {
      // drift
      p.x += p.vx; p.y += p.vy;
      // wrap edges
      if (p.x < -5)      p.x = W + 5;
      else if (p.x > W + 5) p.x = -5;
      if (p.y < -5)      p.y = H + 5;
      else if (p.y > H + 5) p.y = -5;

      let a = p.baseA;
      let color = '255,255,255';

      if (mouse.active) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < ATTRACT_R * ATTRACT_R) {
          const d = Math.sqrt(d2 || 1);
          const f = (1 - d / ATTRACT_R) * ATTRACT_F;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
          if (d < TINT_R) {
            const k = 1 - d / TINT_R;
            a = Math.min(1, a + k * 0.4);
            color = '167,139,250';
          }
        }
      }

      // damping (keeps the field calm)
      p.vx *= 0.98; p.vy *= 0.98;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color},${a})`;
      ctx.fill();
    }

    rafId = requestAnimationFrame(draw);
  }

  // Visibility wiring — pause the loop in every situation where it can't
  // be seen, so it doesn't burn CPU in the background.
  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
    if (shouldRun()) start(); else stop();
  });
  reducedMotionMQ.addEventListener('change', (e) => {
    reducedMotion = e.matches;
    if (shouldRun()) start();
    else { stop(); ctx.clearRect(0, 0, W, H); }
  });
  const io = new IntersectionObserver(([entry]) => {
    cardVisible = entry.isIntersecting;
    if (shouldRun()) start(); else stop();
  });
  io.observe(card);

  const ro = new ResizeObserver(() => {
    resize();
    if (shouldRun()) start();
  });
  ro.observe(card);

  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.active = true;
  });
  card.addEventListener('mouseleave', () => { mouse.active = false; });

  // Initial sizing — IntersectionObserver fires the first start().
  resize();
})();

// ============================================================
// Roadmap timeline — phase-based interactive milestones
// ------------------------------------------------------------
// Five segments (Phase 0 / A / B / C / D) on a horizontal strip.
// Each segment shows internal progress and opens a detail panel
// with a brief plus a sub-list (highlights for 0, steps for
// A/B/C, sketches for D). Phase data is colocated EN/ES inline
// because it's content, not UI chrome — the framework strings
// (status labels, section headers, hint) live in i18n.json.
// ============================================================
(() => {
  const mount = document.getElementById('roadmap-mount');
  if (!mount) return;
  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';

  const PHASES = [
    {
      id: '0',
      status: 'done',
      release: { en: '@skill-map/spec', es: '@skill-map/spec' },
      title: { en: 'Definition', es: 'Definición' },
      sub: { en: 'Project shape and the standard.', es: 'Forma del proyecto y el estándar.' },
      brief: {
        en: 'Before a line of impl shipped, skill-map had to decide what it was. The result: a hexagonal architecture with a kernel and pluggable extensions, six plugin kinds, two persistence scopes, a job subsystem designed around an LLM that can be absent, a plugin model with two storage modes, a frontmatter standard, and a strict spec-first discipline. The standard itself — 29 JSON Schemas, 9 prose contracts, a conformance suite — is published as @skill-map/spec so anyone can build a second implementation against the same contract.',
        es: 'Antes de una sola línea de implementación, skill-map tuvo que decidir qué era. El resultado: una arquitectura hexagonal con un kernel y extensiones plug-in, seis tipos de plugin, dos scopes de persistencia, un subsistema de jobs diseñado alrededor de un LLM que puede no estar, un modelo de plugins con dos modos de almacenamiento, un estándar de frontmatter, y disciplina spec-first estricta. El estándar mismo — 29 JSON Schemas, 9 contratos en prosa, una suite de conformance — está publicado como @skill-map/spec para que cualquiera pueda construir una segunda implementación contra el mismo contrato.',
      },
      list: 'highlights',
      items: [
        { en: 'Hexagonal architecture · kernel + ports + adapters + 6 plugin kinds', es: 'Arquitectura hexagonal · kernel + puertos + adaptadores + 6 tipos de plugin' },
        { en: 'Persistence model · 2 scopes × 3 zones', es: 'Modelo de persistencia · 2 scopes × 3 zonas' },
        { en: 'Job subsystem · atomic claim, nonce, kernel-enforced preamble', es: 'Subsistema de jobs · claim atómico, nonce, preamble forzado por el kernel' },
        { en: 'Plugin model · 2 storage modes, triple protection', es: 'Modelo de plugins · 2 modos de storage, triple protección' },
        { en: 'Frontmatter standard · universal base · provider-owned kind schemas', es: 'Estándar de frontmatter · base universal · schemas por kind del provider' },
        { en: 'Trigger normalization · 6-step pipeline', es: 'Normalización de triggers · pipeline de 6 pasos' },
        { en: 'Config hierarchy · defaults → global → project → local → env', es: 'Jerarquía de config · defaults → global → proyecto → local → env' },
        { en: 'Versioning policy · changesets, independent semver per package', es: 'Política de versionado · changesets, semver independiente por paquete' },
        { en: 'Spec as a standard · separable from reference impl', es: 'Spec como estándar · separable de la implementación de referencia' },
        { en: '29 schemas + 9 prose contracts + conformance suite', es: '29 schemas + 9 contratos en prosa + suite de conformance' },
        { en: '117 architectural decisions, logged', es: '117 decisiones arquitectónicas, registradas' },
        { en: '@skill-map/spec published on npm', es: '@skill-map/spec publicado en npm' },
      ],
    },
    {
      id: 'A',
      status: 'done',
      release: { en: 'skill-map@0.11 · testkit@0.3', es: 'skill-map@0.11 · testkit@0.3' },
      title: { en: 'Deterministic core', es: 'Núcleo determinista' },
      sub: { en: 'Scan, model, query, visualize. No LLM.', es: 'Escanear, modelar, consultar, visualizar. Sin LLM.' },
      brief: {
        en: 'Bytes hit disk. The spec became a working CLI: feed it any folder of agent files and it returns the full reference graph — collisions flagged, orphans listed, external deps mapped, all in milliseconds. The plugin runtime is real, not theoretical: drop a folder under .skill-map/plugins and the kernel picks it up. @skill-map/testkit ships alongside so authors can write their own extensions against a stable contract. The Web UI baseline lands here too: sm serve boots a Hono BFF with WebSocket live updates and serves the Angular SPA from a single port; the same bundle runs offline from a static demo at skill-map.dev/demo/. A complete product, zero LLM calls.',
        es: 'Los bytes tocaron disco. La spec se volvió una CLI funcional: dale cualquier carpeta de archivos de agentes y te devuelve el grafo de referencias completo — colisiones marcadas, huérfanos listados, deps externas mapeadas, todo en milisegundos. El runtime de plugins es real, no teórico: dejas una carpeta bajo .skill-map/plugins y el kernel la levanta. @skill-map/testkit se publica junto con la CLI para que los autores escriban sus propias extensiones contra un contrato estable. La Web UI baseline también cierra acá: sm serve levanta un BFF Hono con updates en vivo por WebSocket y sirve el SPA Angular desde un solo puerto; el mismo bundle corre offline desde un demo estático en skill-map.dev/demo/. Un producto completo, cero llamadas a LLM.',
      },
      list: 'steps',
      items: [
        { id: '0b', status: 'done',    title: { en: 'Implementation bootstrap',     es: 'Bootstrap de implementación' },         body: { en: 'Workspace, kernel shell, CLI binary, conformance harness, CI green',                                                                       es: 'Workspace, kernel shell, binario CLI, harness de conformance, CI en verde' } },
        { id: '0c', status: 'done',    title: { en: 'UI prototype (Flavor A)',      es: 'Prototipo de UI (Sabor A)' },             body: { en: 'Angular + Foblex Flow + PrimeNG, mock collection, list / graph / inspector views',                                                          es: 'Angular + Foblex Flow + PrimeNG, colección mock, vistas list / graph / inspector' } },
        { id: '1a', status: 'done',    title: { en: 'Storage + migrations',          es: 'Storage + migraciones' },                  body: { en: 'SQLite via node:sqlite, kernel migrations, auto-backup, sm db * verbs',                                                                     es: 'SQLite vía node:sqlite, migraciones de kernel, auto-backup, verbos sm db *' } },
        { id: '1b', status: 'done',    title: { en: 'Registry + plugin loader',      es: 'Registry + cargador de plugins' },        body: { en: 'Six kinds enforced, drop-in plugin discovery, sm plugins list / show / doctor',                                                            es: 'Seis tipos forzados, descubrimiento drop-in de plugins, sm plugins list / show / doctor' } },
        { id: '1c', status: 'done',    title: { en: 'Orchestrator + CLI dispatcher', es: 'Orquestador + dispatcher de CLI' },       body: { en: 'Scan skeleton, full Clipanion verb registration, sm help, autogenerated CLI reference',                                                    es: 'Esqueleto del scan, registro completo de verbos en Clipanion, sm help, referencia CLI autogenerada' } },
        { id: '2',  status: 'done',    title: { en: 'First extensions',              es: 'Primeras extensiones' },                   body: { en: 'claude provider · 3 extractors (frontmatter / slash / at-directive) · 3 rules (collision / broken-ref / superseded) · ASCII formatter · validate-all rule', es: 'Provider claude · 3 extractors (frontmatter / slash / at-directive) · 3 reglas (collision / broken-ref / superseded) · formatter ASCII · rule validate-all' } },
        { id: '3',  status: 'done',    title: { en: 'UI design refinement',          es: 'Refinamiento de diseño de UI' },           body: { en: 'Node cards, connection styling, inspector layout, dark mode parity, responsive baseline',                                                  es: 'Cards de nodos, estilo de conexiones, layout del inspector, paridad en dark mode, baseline responsive' } },
        { id: '4',  status: 'done',    title: { en: 'Scan end-to-end',               es: 'Scan end-to-end' },                        body: { en: 'sm scan persists to SQLite · per-node tokens · external-url-counter extractor · --changed incremental · sm list / show / check reading the snapshot', es: 'sm scan persiste en SQLite · tokens por nodo · extractor external-url-counter · --changed incremental · sm list / show / check leyendo el snapshot' } },
        { id: '5',  status: 'done',    title: { en: 'History + orphans',             es: 'Historia + huérfanos' },                   body: { en: 'scan_meta · sm history + history stats · auto-rename heuristic (high body / medium frontmatter / ambiguous / orphan) tx-atomic FK migration · sm orphans (list / reconcile / undo-rename) · orphan persistence across scans · canonical-YAML frontmatter hash · conformance fixtures', es: 'scan_meta · sm history + history stats · heurística auto-rename (high body / medium frontmatter / ambiguous / orphan) con migración FK tx-atómica · sm orphans (list / reconcile / undo-rename) · persistencia de orphans entre scans · hash de frontmatter sobre YAML canónico · fixtures de conformance' } },
        { id: '6',  status: 'done',    title: { en: 'Config + onboarding',           es: 'Config + onboarding' },                    body: { en: '.skill-map/settings(.local).json · 6-layer config loader · sm config list/get/set/reset/show · .skillmapignore wired into the scan walker · sm init scaffolding (DB + .gitignore append + first scan) · sm plugins enable/disable over config_plugins (DB > settings.json > default precedence) · frontmatter strict mode (--strict / scan.strict)', es: '.skill-map/settings(.local).json · loader de config en 6 capas · sm config list/get/set/reset/show · .skillmapignore conectado al walker · scaffolding de sm init (DB + append a .gitignore + primer scan) · sm plugins enable/disable sobre config_plugins (precedencia DB > settings.json > default) · modo estricto de frontmatter (--strict / scan.strict)' } },
        { id: '7',  status: 'done',    title: { en: 'Robustness',                    es: 'Robustez' },                                body: { en: 'sm watch incremental scan via chokidar · link-conflict rule on extractor disagreement · sm job prune with retention policy · trigger normalization wired everywhere', es: 'sm watch con scan incremental via chokidar · rule link-conflict sobre desacuerdos entre extractors · sm job prune con política de retención · normalización de triggers en todos lados' } },
        { id: '8',  status: 'done',    title: { en: 'Diff + export',                 es: 'Diff + export' },                          body: { en: 'sm graph activated from stub · sm scan compare-with sub-verb (delta vs prior dump) · sm export with mini query language',                  es: 'sm graph activado desde stub · sub-verbo sm scan compare-with (delta contra dump previo) · sm export con mini lenguaje de queries' } },
        { id: '9',   status: 'done',    title: { en: 'Plugin author UX',              es: 'UX para autores de plugins' },             body: { en: 'Plugin runtime wiring · plugin migrations + triple isolation · @skill-map/testkit on npm · plugin author guide + reference plugin',         es: 'Wiring del runtime de plugins · migraciones de plugins + triple aislamiento · @skill-map/testkit en npm · guía para autores + plugin de referencia' } },
        { id: '14a', status: 'done',    title: { en: 'Web UI: BFF + transport',       es: 'UI web: BFF + transporte' },               body: { en: 'sm serve boots a Hono BFF · single-port mandate (Angular SPA + REST + WebSocket on one listener) · /api/* read endpoints with envelope schema · loopback-only by design',                                  es: 'sm serve levanta un BFF Hono · mandato de un solo puerto (SPA Angular + REST + WebSocket en un solo listener) · endpoints /api/* de lectura con schema de envelope · loopback-only por diseño' } },
        { id: '14b', status: 'done',    title: { en: 'Web UI: live mode + demo',      es: 'UI web: modo en vivo + demo' },            body: { en: 'DataSourcePort with REST adapter for live and Static adapter for the offline demo · WebSocket broadcaster wiring chokidar to scan events · Inspector polish (markdown body, linked-nodes panel, per-card refresh) · provider-driven kindRegistry envelope', es: 'DataSourcePort con adaptador REST para vivo y adaptador Static para el demo offline · broadcaster WebSocket conectando chokidar a eventos de scan · pulido de Inspector (body markdown, panel de nodos enlazados, refresh por card) · envelope kindRegistry guiado por provider' } },
        { id: '14c', status: 'done',    title: { en: 'Web UI: polish & budgets',      es: 'UI web: pulido y presupuestos' },          body: { en: 'Initial chunk under 500 kB via lazy Aura preset (provideAppInitializer + dynamic import) · dark-mode tri-state (auto/light/dark following system preference) · Foblex Flow strict types pass · desktop-only ≥ 1024px with sticky red banner below threshold · Playwright demo smoke (boots clean, never fetches /api/*, three views render)', es: 'Chunk inicial bajo 500 kB vía lazy Aura preset (provideAppInitializer + import dinámico) · tri-estado de dark mode (auto/light/dark siguiendo la preferencia del sistema) · pase a tipos estrictos de Foblex Flow · desktop-only ≥ 1024px con banner rojo sticky bajo el umbral · smoke Playwright del demo (boot limpio, nunca pega a /api/*, las tres vistas renderean)' } },
      ],
    },
    {
      id: 'B',
      status: 'planned',
      release: { en: 'target: v0.8.0', es: 'objetivo: v0.8.0' },
      title: { en: 'LLM as an optional layer', es: 'El LLM como capa opcional' },
      sub: { en: 'Plugin model rewrite, summaries, semantic verbs.', es: 'Reescritura del modelo de plugins, resúmenes, verbos semánticos.' },
      brief: {
        en: 'v0.8.0 lands two things in lockstep. First, the plugin model overhaul — Provider / Extractor / Formatter renames, Audit absorbed into Rule, and a new Hook kind subscribing to a curated set of kernel lifecycle events. Second, the LLM joins as an opt-in: a job subsystem queues probabilistic work, the first probabilistic extension turns a skill into a structured brief, then the rest follow with semantic verbs. Nothing breaks if claude is not installed.',
        es: 'v0.8.0 trae dos cosas en lockstep. Primero, el overhaul del modelo de plugins — renames Provider / Extractor / Formatter, Audit absorbido en Rule, y un nuevo kind Hook que se suscribe a un set curado de eventos del kernel. Segundo, el LLM entra como opt-in: un subsistema de jobs encola trabajo probabilístico, la primera extensión probabilística convierte una skill en un brief estructurado, después siguen el resto con verbos semánticos. Nada se rompe si claude no está instalado.',
      },
      list: 'steps',
      items: [
        { id: '9.5',  status: 'done',    title: { en: 'Plugin model overhaul',              es: 'Reescritura del modelo de plugins' },        body: { en: 'Provider / Extractor / Formatter renames · Hook kind added · Audit absorbed into Rule · qualified extension ids', es: 'Renames Provider / Extractor / Formatter · kind Hook agregado · Audit absorbido en Rule · ids de extensión calificados' } },
        { id: '9.6',  status: 'done',    title: { en: 'Foundation refactors',               es: 'Refactors fundacionales' },                  body: { en: 'Open node kinds · storage port promotion (5 namespaces) · universal enrichment layer · incremental scan cache',     es: 'Apertura de Node.kind · promoción del storage port (5 namespaces) · capa universal de enrichment · cache de scan incremental' } },
        { id: '10a',  status: 'planned', title: { en: 'Queue infrastructure',               es: 'Infraestructura de la cola' },               body: { en: 'state_jobs + content-addressed state_job_contents · atomic claim · sm job submit / list / show / preview / claim / cancel / status · sm record + nonce', es: 'state_jobs + state_job_contents content-addressed · claim atómico · sm job submit / list / show / preview / claim / cancel / status · sm record + nonce' } },
        { id: '10b',  status: 'planned', title: { en: 'LLM runner',                         es: 'Runner de LLM' },                            body: { en: 'ClaudeCliRunner + MockRunner · ctx.runner injection · sm job run full loop · sm doctor runner probe · /skill-map:run-queue Skill agent', es: 'ClaudeCliRunner + MockRunner · inyección de ctx.runner · loop completo de sm job run · probe de sm doctor para el runner · agente Skill /skill-map:run-queue' } },
        { id: '10c',  status: 'planned', title: { en: 'First probabilistic extension',      es: 'Primera extensión probabilística' },         body: { en: 'skill-summarizer · extension-mode-derivation + preamble-bitwise-match conformance cases · github-enrichment bundled plugin', es: 'skill-summarizer · casos de conformance extension-mode-derivation + preamble-bitwise-match · plugin bundled github-enrichment' } },
        { id: '11a',  status: 'planned', title: { en: 'Per-kind summarizers',               es: 'Summarizers por kind' },                     body: { en: 'agent · command · hook · note',                                                                                          es: 'agent · command · hook · note' } },
        { id: '11b',  status: 'planned', title: { en: 'Semantic LLM verbs',                 es: 'Verbos semánticos LLM' },                    body: { en: 'sm what · sm dedupe · sm cluster-triggers · sm impact-of · sm recommend-optimization · sm findings',                    es: 'sm what · sm dedupe · sm cluster-triggers · sm impact-of · sm recommend-optimization · sm findings' } },
        { id: '11c',  status: 'planned', title: { en: '/skill-map:explore meta-skill',      es: 'Meta-skill /skill-map:explore' },            body: { en: 'Cross-extension orchestration over the queue + summaries',                                                              es: 'Orquestación cross-extensión sobre la cola + summaries' } },
        { id: '16',   status: 'planned', title: { en: 'UI: LLM surfaces v1 (initial)',      es: 'UI: superficies LLM v1 (inicial)' },         body: { en: 'Inspector summary / enrichment / findings cards (read-only) · /findings page with filters · per-card refresh hooks · token cost surfacing · BFF endpoints for the new state_* tables', es: 'Cards de summary / enrichment / findings en el inspector (sólo lectura) · página /findings con filtros · refresh por card · superficie de costo en tokens · endpoints BFF para las nuevas tablas state_*' } },
      ],
    },
    {
      id: 'C',
      status: 'planned',
      release: { en: 'target: v1.0.0', es: 'objetivo: v1.0.0' },
      title: { en: 'Surface & distribution', es: 'Superficie y distribución' },
      sub: { en: 'Formatters, multi-host, deeper UI flows, single-binary release.', es: 'Formatters, multi-host, flujos de UI más profundos, release de un binario.' },
      brief: {
        en: 'The product reaches 1.0 here. Mermaid and DOT formatters for ops and CI, more providers so skill-map covers the multi-host ecosystem (Codex, Gemini, Copilot, generic) and not just Claude, deeper UI flows that promote the LLM verbs landed in Phase B into interactive panels (queue inspector, findings management, cost dashboard), and @skill-map/cli ships as a single npm package with the UI bundled inside. One process, one port, one command.',
        es: 'Aquí el producto llega a 1.0. Formatters Mermaid y DOT para ops y CI, más providers para cubrir el ecosistema multi-host (Codex, Gemini, Copilot, genérico) y no sólo Claude, flujos de UI más profundos que promueven a paneles interactivos los verbos LLM que aterrizaron en la Fase B (inspector de la cola, gestión de findings, dashboard de costo), y @skill-map/cli se distribuye como un único paquete npm con la UI empaquetada adentro. Un proceso, un puerto, un comando.',
      },
      list: 'steps',
      items: [
        { id: '12',  status: 'planned', title: { en: 'Additional formatters',           es: 'Formatters adicionales' },                  body: { en: 'Mermaid · DOT / Graphviz · subgraph export with filters',                                                                          es: 'Mermaid · DOT / Graphviz · export de subgrafos con filtros' } },
        { id: '13',  status: 'planned', title: { en: 'Multi-host Providers',            es: 'Providers multi-host' },                    body: { en: 'Codex · Gemini · Copilot · generic Provider (frontmatter-driven fallback) · per-host sm-<host>-* skill namespace · Provider conformance suite', es: 'Codex · Gemini · Copilot · Provider genérico (fallback por frontmatter) · namespace sm-<host>-* por host · suite de conformance por Provider' } },
        { id: '17',  status: 'planned', title: { en: 'UI: LLM surfaces v2 (deeper)',    es: 'UI: superficies LLM v2 (más profundo)' },   body: { en: 'Verb panels (sm what · sm dedupe · sm cluster-triggers · sm impact-of · sm recommend-optimization) · queue inspector with cancel / retry · findings management with bulk actions · cost / token dashboards · WCAG AA pass', es: 'Paneles para los verbos (sm what · sm dedupe · sm cluster-triggers · sm impact-of · sm recommend-optimization) · inspector de la cola con cancel / retry · gestión de findings con acciones en masa · dashboards de costo / tokens · pase WCAG AA' } },
        { id: '15a', status: 'planned', title: { en: 'Distribution: single package',    es: 'Distribución: paquete único' },             body: { en: '@skill-map/cli with UI bundled · sm + skill-map binary aliases · sm ui sub-command · settings loader + runtime-settings schema · CI wiring of npm run validate (e2e smoke included) · web/demo/ deploy on every release', es: '@skill-map/cli con UI incluida · alias de binarios sm + skill-map · sub-comando sm ui · loader de settings + schema runtime-settings · wiring en CI de npm run validate (e2e smoke incluido) · deploy de web/demo/ en cada release' } },
        { id: '15b', status: 'planned', title: { en: 'Documentation site',              es: 'Sitio de documentación' },                  body: { en: 'Astro Starlight · plugin API reference (JSDoc → Starlight) · llms.txt + llms-full.txt for AI ingestion · skill-map.dev launch polish · context7 registration', es: 'Astro Starlight · referencia de la API de plugins (JSDoc → Starlight) · llms.txt + llms-full.txt para ingesta por LLMs · pulido del launch de skill-map.dev · registro en context7' } },
        { id: '15c', status: 'planned', title: { en: 'Release infrastructure',          es: 'Infraestructura de release' },              body: { en: 'GitHub Actions release + changelog · telemetry opt-in · compatibility matrix · breaking-changes / deprecation policy · sm doctor install diagnostics · Claude Code plugin wrapper', es: 'Release con GitHub Actions + changelog · telemetría opt-in · matriz de compatibilidad · política de breaking-changes / deprecación · diagnósticos de install de sm doctor · wrapper de plugin para Claude Code' } },
      ],
    },
    {
      id: 'D',
      status: 'pending',
      release: { en: 'target: v1.0.0', es: 'objetivo: v1.0.0' },
      title: { en: 'Real-time', es: 'Real-time' },
      sub: { en: 'Watch what happens, as it happens.', es: 'Observa lo que pasa, mientras pasa.' },
      brief: {
        en: 'skill-map stops being just a static map and starts observing execution. Immutable snapshots of every run for later audit; live view of which skill ran, what triggered it, and which nodes it touched.',
        es: 'skill-map deja de ser solo un mapa estático y empieza a observar la ejecución. Snapshots inmutables de cada run para auditar después; vista en vivo de qué skill se ejecutó, qué la disparó y qué nodos tocó.',
      },
      list: 'sketches',
      items: [
        { en: 'Event stream · live WebSocket from the kernel to the UI',         es: 'Stream de eventos · WebSocket en vivo desde el kernel a la UI' },
        { en: 'Execution snapshot · immutable audit of every run',               es: 'Snapshot de lo ejecutado · auditoría inmutable de cada run' },
        { en: 'Real-time exploration · watch agents and skills as they run',     es: 'Exploración en real time · ver agentes y skills mientras se ejecutan' },
        { en: 'Marketplace ? · plugin discovery and distribution — to evaluate', es: 'Marketplace ? · descubrimiento y distribución de plugins — a evaluar' },
        // Previous "Deferred" items — kept for reference, hidden from render:
        // { en: 'Write-back from UI · edit / create / refactor skills',           es: 'Escritura desde la UI · editar / crear / refactorizar skills' },
        // { en: 'Pluggable storage & runner · Postgres, OpenAI, mock',            es: 'Storage y runner pluggables · Postgres, OpenAI, mock' },
        // { en: 'URL liveness · optional plugin for broken-external-ref',         es: 'URL viva · plugin opcional para broken-external-ref' },
        // { en: 'Schema v2 + migration tooling',                                  es: 'Schema v2 + tooling de migración' },
      ],
    },
  ];

  const STATUS_LABEL = {
    done:    { en: 'Released',    es: 'Released' },
    current: { en: 'In progress', es: 'En curso' },
    planned: { en: 'Planned',     es: 'Planeado' },
    pending: { en: 'Pending',     es: 'Pendiente' },
    open:    { en: 'Open',        es: 'Abierto' },
  };

  const SECTION_LABEL = {
    highlights: { en: 'Milestones', es: 'Milestones' },
    steps:      { en: 'Milestones', es: 'Milestones' },
    sketches:   { en: 'Milestones', es: 'Milestones' },
  };

  const tx = (obj) => obj[lang] ?? obj.en;
  const ofWord = lang === 'es' ? 'de' : 'of';
  const phaseWord = lang === 'es' ? 'Fase' : 'Phase';

  // Detail panel is collapsed by default — `selected = -1` means no phase
  // is open. Clicking a segment opens the panel; clicking the same segment
  // again collapses it back.
  let selected = -1;

  // For phases with a `steps` list, count how many steps are done so the
  // segment can show a `done of total` progress bar. Highlights / sketches
  // phases return null and the segment shows the release line instead.
  function progressOf(p) {
    if (p.list !== 'steps') return null;
    const total = p.items.length;
    const done = p.items.filter((it) => it.status === 'done').length;
    return { done, total };
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  // --- Build the strip (5 segments) ---
  const strip = document.createElement('div');
  strip.className = 'roadmap__strip';

  const segments = document.createElement('div');
  segments.className = 'roadmap__segments';
  strip.appendChild(segments);

  PHASES.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'roadmap__seg';
    btn.dataset.idx = String(i);
    btn.dataset.status = p.status;
    btn.setAttribute('aria-current', i === selected ? 'true' : 'false');
    btn.setAttribute('aria-label', `${phaseWord} ${p.id} — ${tx(p.title)}`);

    const prog = progressOf(p);
    const barHtml = prog
      ? `<div class="roadmap__seg-bar"><span style="width:${(prog.done / prog.total) * 100}%"></span></div>
         <div class="roadmap__seg-prog">${prog.done} ${ofWord} ${prog.total}</div>`
      : `<div class="roadmap__seg-bar roadmap__seg-bar--empty"></div>
         <div class="roadmap__seg-prog">${escapeHtml(tx(p.release))}</div>`;

    btn.innerHTML = `
      <div class="roadmap__seg-id">${p.id}</div>
      <div class="roadmap__seg-title">${escapeHtml(tx(p.title))}</div>
      ${barHtml}
      <div class="roadmap__seg-status">${escapeHtml(tx(STATUS_LABEL[p.status]))}</div>
    `;
    segments.appendChild(btn);
  });

  mount.appendChild(strip);

  // --- Build the detail panel (hidden until a segment is clicked) ---
  const detail = document.createElement('div');
  detail.className = 'roadmap__detail roadmap__detail--hidden';
  detail.innerHTML = `
    <aside class="roadmap__detail-meta">
      <div class="roadmap__detail-id"></div>
      <div class="roadmap__detail-release"></div>
      <div class="roadmap__detail-status"></div>
    </aside>
    <div class="roadmap__detail-body">
      <h3 class="roadmap__detail-title"></h3>
      <div class="roadmap__detail-sub"></div>
      <p class="roadmap__detail-brief"></p>
      <div class="roadmap__detail-list-h"></div>
      <ul class="roadmap__detail-list"></ul>
    </div>
  `;
  mount.appendChild(detail);

  const hint = document.createElement('div');
  hint.className = 'roadmap__hint';
  hint.textContent = lang === 'es'
    ? 'Haz clic en cualquier fase para ver el brief.'
    : 'Click any phase to read the brief.';
  mount.appendChild(hint);

  // Accordion mode: on tablet & phone the detail panel docks right under
  // the clicked segment so the user doesn't have to scroll past the strip
  // to read the brief. On desktop the panel stays after the strip (its
  // original position) so the segment grid keeps the horizontal rhythm.
  const accordionMQ = window.matchMedia('(max-width: 1023px)');

  // Lookup by data-idx, NOT by `segments.children[i]`. Once the detail
  // panel is parented inside `.roadmap__segments`, it counts as a child
  // and shifts the index → segments.children[1] could resolve to the
  // detail itself instead of seg-1, leaving the panel stuck above the
  // newly-clicked segment ("opens upward" symptom).
  const segByIdx = (i) => segments.querySelector(`.roadmap__seg[data-idx="${i}"]`);
  const allSegs = () => segments.querySelectorAll('.roadmap__seg');

  function placeDetail() {
    if (selected < 0) return;
    if (accordionMQ.matches) {
      const seg = segByIdx(selected);
      if (seg && detail.previousElementSibling !== seg) {
        seg.after(detail);
      }
    } else {
      // Desktop home: between the strip and the hint, as a child of mount.
      if (detail.parentNode !== mount || detail.previousElementSibling !== strip) {
        mount.insertBefore(detail, hint);
      }
    }
  }

  accordionMQ.addEventListener('change', () => placeDetail());

  function setSelected(i) {
    if (i < 0 || i >= PHASES.length) return;
    // Clicking the currently-open segment collapses the detail panel.
    if (i === selected) {
      selected = -1;
      detail.classList.add('roadmap__detail--hidden');
      for (const btn of allSegs()) {
        btn.setAttribute('aria-current', 'false');
      }
      return;
    }
    selected = i;
    for (const btn of allSegs()) {
      btn.setAttribute('aria-current', String(+btn.dataset.idx === i));
    }
    detail.classList.remove('roadmap__detail--hidden');
    placeDetail();
    renderDetail();
  }

  function renderDetail() {
    const p = PHASES[selected];
    detail.dataset.status = p.status;
    detail.querySelector('.roadmap__detail-id').textContent = `${phaseWord} ${p.id}`;
    detail.querySelector('.roadmap__detail-release').textContent = tx(p.release);
    detail.querySelector('.roadmap__detail-status').textContent = tx(STATUS_LABEL[p.status]);
    detail.querySelector('.roadmap__detail-title').textContent = tx(p.title);
    detail.querySelector('.roadmap__detail-sub').textContent = tx(p.sub);
    detail.querySelector('.roadmap__detail-brief').textContent = tx(p.brief);
    detail.querySelector('.roadmap__detail-list-h').textContent = tx(SECTION_LABEL[p.list]);

    const ul = detail.querySelector('.roadmap__detail-list');
    ul.className = `roadmap__detail-list roadmap__detail-list--${p.list}`;
    ul.innerHTML = '';
    for (const item of p.items) {
      const li = document.createElement('li');
      li.dataset.status = item.status ?? p.status;
      const titleObj = item.title ?? item;
      li.innerHTML = `
        <span class="roadmap__step-mark" aria-hidden="true"></span>
        <span class="roadmap__step-text">
          <strong>${escapeHtml(tx(titleObj))}</strong>
        </span>`;
      ul.appendChild(li);
    }
  }

  // Click delegation on segments.
  segments.addEventListener('click', (e) => {
    const btn = e.target.closest('.roadmap__seg');
    if (!btn) return;
    setSelected(+btn.dataset.idx);
  });

  // Keyboard nav: arrow left/right on focused segment.
  segments.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const focused = document.activeElement;
    if (!focused?.classList.contains('roadmap__seg')) return;
    const i = +focused.dataset.idx;
    const next = e.key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(PHASES.length - 1, i + 1);
    segByIdx(next)?.focus();
    setSelected(next);
    e.preventDefault();
  });
})();

// ============================================================
// Click-to-copy with toast
// ------------------------------------------------------------
// Any element with class `js-copy` is a copy trigger. The text
// to copy comes from `data-copy` (preferred) or textContent. On
// success we surface a small bottom-center toast; on failure we
// fall back to a hidden-textarea selection + execCommand, and as
// a last resort tell the user to press the OS copy combo.
// Vanilla — no dependency.
// ============================================================
(() => {
  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
  const MSG = {
    en: { ok: 'Copied to clipboard', err: 'Press ⌘C / Ctrl+C to copy' },
    es: { ok: 'Copiado al portapapeles', err: 'Presioná ⌘C / Ctrl+C para copiar' },
  };

  let toast = null;
  let timer = null;

  function ensureToast() {
    if (toast) return toast;
    toast = document.createElement('div');
    toast.className = 'copy-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    return toast;
  }

  function showToast(message, kind = 'ok') {
    const t = ensureToast();
    t.classList.toggle('copy-toast--err', kind === 'err');
    const iconOk = '<polyline points="20 6 9 17 4 12"/>';
    const iconErr = '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16.01"/>';
    t.innerHTML = `
      <svg class="copy-toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${kind === 'err' ? iconErr : iconOk}
      </svg>
      <span></span>
    `;
    t.querySelector('span').textContent = message;
    t.classList.add('copy-toast--show');
    clearTimeout(timer);
    timer = setTimeout(() => t.classList.remove('copy-toast--show'), 2000);
  }

  async function copyText(text) {
    // Modern path: navigator.clipboard (HTTPS / localhost only).
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through */ }
    // Legacy fallback: hidden textarea + execCommand.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  document.addEventListener('click', async (e) => {
    const trigger = e.target.closest('.js-copy');
    if (!trigger) return;
    const text = trigger.dataset.copy || trigger.textContent.trim();
    const ok = await copyText(text);
    showToast(ok ? MSG[lang].ok : MSG[lang].err, ok ? 'ok' : 'err');
  });
})();

// ============================================================
// Audio mini-player (NotebookLM overview)
// ------------------------------------------------------------
// Wires up #audio-player + .lp-nav__listen + .audio-player__*.
// State lives in localStorage under STORAGE_KEY:
//   { open, lastLang, speed, positions: { en: <s>, es: <s> } }
// open + speed are global (so opening behavior is consistent across
// language switches); positions are per-language (each audio is a
// different recording, so resuming should be per-track).
// ============================================================
(() => {
  const player = document.getElementById('audio-player');
  if (!player) return;
  const audio   = player.querySelector('.audio-player__el');
  const trigger = document.querySelector('[data-audio-toggle]');
  if (!audio || !trigger) return;

  const closeBtn   = player.querySelector('[data-audio-close]');
  const playBtn    = player.querySelector('[data-audio-playpause]');
  const scrubBtn   = player.querySelector('[data-audio-scrub]');
  const fillEl     = player.querySelector('.audio-player__progress-fill');
  const elapsedEl  = player.querySelector('.audio-player__elapsed');
  const totalEl    = player.querySelector('.audio-player__total');
  const speedBtn   = player.querySelector('[data-audio-speed]');

  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
  const STORAGE_KEY = 'skill-map.audio.v1';
  const SPEEDS = [1, 1.25, 1.5, 2];
  const I18N = {
    en: { play: 'Play', pause: 'Pause' },
    es: { play: 'Reproducir', pause: 'Pausar' },
  };
  const FALLBACK_DURATION = Number(audio.dataset.fallbackDuration) || 0;

  // The active duration we render. Prefer the browser-reported value once
  // metadata is loaded; until then (or if the file is a raw MPEG ADTS
  // stream that lacks a Xing header, which leaves duration as Infinity in
  // some browsers) fall back to the static value we hardcoded next to
  // the audio asset.
  function getDuration() {
    const d = audio.duration;
    return Number.isFinite(d) && d > 0 ? d : FALLBACK_DURATION;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    } catch { return null; }
  }
  function saveState(patch) {
    try {
      const cur = loadState() ?? {};
      const next = { ...cur, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { /* localStorage may be disabled — fail silent */ }
  }

  function fmtTime(secs) {
    if (!Number.isFinite(secs) || secs < 0) return '--:--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function setOpen(open) {
    // `hidden` is removed first so the transition runs the next frame.
    if (open) {
      player.hidden = false;
      requestAnimationFrame(() => { player.dataset.open = 'true'; });
    } else {
      player.dataset.open = 'false';
      // Keep `hidden` aligned with the transition end so screen readers
      // don't see an invisible-but-present element.
      setTimeout(() => {
        if (player.dataset.open === 'false') player.hidden = true;
      }, 260);
      audio.pause();
    }
    trigger.setAttribute('aria-expanded', String(open));
    saveState({ open });
  }

  function setSpeed(speed) {
    audio.playbackRate = speed;
    if (speedBtn) speedBtn.textContent = `${speed}×`;
    saveState({ speed });
  }
  function cycleSpeed() {
    const cur = audio.playbackRate || 1;
    const idx = SPEEDS.indexOf(cur);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  }

  function setPlaying(playing) {
    player.dataset.state = playing ? 'playing' : 'paused';
    playBtn.setAttribute('aria-label', playing ? I18N[lang].pause : I18N[lang].play);
  }

  function updateProgress() {
    const dur = getDuration();
    const cur = audio.currentTime;
    if (dur > 0) {
      fillEl.style.width = `${(cur / dur) * 100}%`;
      scrubBtn.setAttribute('aria-valuenow', String(Math.floor((cur / dur) * 100)));
    }
    elapsedEl.textContent = fmtTime(cur);
    totalEl.textContent = fmtTime(dur);
  }

  function seekFromClientX(clientX) {
    const dur = getDuration();
    if (dur <= 0) return;
    const rect = scrubBtn.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    try { audio.currentTime = ratio * dur; }
    catch { /* seekable range may be empty if browser hasn't loaded enough — give up silently */ }
    updateProgress();
  }

  // ---- Wiring ----

  trigger.addEventListener('click', () => {
    const opening = player.dataset.open !== 'true';
    setOpen(opening);
    // Opening from the nav is an explicit "I want to listen now" intent.
    // Auto-play on open; the click counts as a user gesture so browsers
    // won't block it. Closing already pauses inside setOpen(false).
    if (opening) audio.play().catch(() => { /* network race / autoplay edge — ignore */ });
  });

  closeBtn.addEventListener('click', () => setOpen(false));

  playBtn.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(() => { /* autoplay/network race — ignore */ });
    else audio.pause();
  });

  speedBtn?.addEventListener('click', cycleSpeed);

  scrubBtn.addEventListener('click', (e) => seekFromClientX(e.clientX));
  scrubBtn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const delta = e.key === 'ArrowLeft' ? -5 : 5;
    const dur = getDuration();
    try { audio.currentTime = Math.max(0, Math.min(dur || 0, audio.currentTime + delta)); }
    catch { /* see seekFromClientX */ }
    updateProgress();
    e.preventDefault();
  });

  audio.addEventListener('play',          () => setPlaying(true));
  audio.addEventListener('pause',         () => setPlaying(false));
  audio.addEventListener('ended',         () => { setPlaying(false); saveState({ positions: { ...(loadState()?.positions ?? {}), [lang]: 0 } }); });
  audio.addEventListener('loadedmetadata', () => { updateProgress(); });
  audio.addEventListener('durationchange',  () => { updateProgress(); });
  audio.addEventListener('timeupdate', () => {
    updateProgress();
    // Throttle persistence to once a second so we don't hammer
    // localStorage during playback.
    const now = performance.now();
    if (now - (audio._lastSave ?? 0) > 1000) {
      audio._lastSave = now;
      const positions = { ...(loadState()?.positions ?? {}), [lang]: audio.currentTime };
      saveState({ positions, lastLang: lang });
    }
  });

  // Pause the audio when the page becomes hidden so it doesn't keep
  // playing in a backgrounded tab the user has forgotten about. We
  // don't auto-resume on visibilitychange — let the user decide.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !audio.paused) audio.pause();
  });

  // ---- Initial state ----

  const state = loadState();
  if (state?.speed && SPEEDS.includes(state.speed)) setSpeed(state.speed);
  else setSpeed(1);

  const savedPos = state?.positions?.[lang];
  if (Number.isFinite(savedPos) && savedPos > 0) {
    // Wait for metadata before seeking — currentTime won't apply otherwise.
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = savedPos; }, { once: true });
  }

  if (state?.open) setOpen(true);
  setPlaying(false);

  // Paint the initial state so the user sees the total duration and a
  // 0% fill before any media event fires. updateProgress() is safe to
  // call before metadata is loaded — it falls back to FALLBACK_DURATION.
  updateProgress();
})();

// ============================================================
// Plugin ecosystem — interactive satellites + brief panel
// ------------------------------------------------------------
// Six plugin kinds orbit the kernel. Hover or focus highlights a
// satellite; clicking pins it. The active id lives on
// `.peco[data-active]` so CSS routes visibility from there. The
// accent color of the active plugin is exposed as `--pe-accent`
// on the section root so the panel themes itself. Hover updates
// the visual highlight but does not change the active id.
// ============================================================
(() => {
  const root = document.querySelector('.peco');
  if (!root) return;

  const sats = [...root.querySelectorAll('.peco__sat')];
  if (!sats.length) return;
  const ids = sats.map((s) => s.dataset.peId);
  const accentOf = Object.fromEntries(sats.map((s) => [s.dataset.peId, s.dataset.peAccent]));

  function setActive(id) {
    if (!ids.includes(id)) return;
    root.dataset.active = id;
    root.style.setProperty('--pe-accent', accentOf[id]);
    const i = ids.indexOf(id);
    const counter = root.querySelector('.peco__nav-i');
    if (counter) counter.textContent = String(i + 1);
  }

  for (const sat of sats) {
    sat.addEventListener('click', () => setActive(sat.dataset.peId));
    sat.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      setActive(sat.dataset.peId);
    });
    sat.addEventListener('focus', () => setActive(sat.dataset.peId));
  }

  root.querySelector('[data-pe-nav="prev"]')?.addEventListener('click', () => {
    const i = ids.indexOf(root.dataset.active);
    setActive(ids[(i - 1 + ids.length) % ids.length]);
  });
  root.querySelector('[data-pe-nav="next"]')?.addEventListener('click', () => {
    const i = ids.indexOf(root.dataset.active);
    setActive(ids[(i + 1) % ids.length]);
  });

  // Initial paint — keeps the count and accent in sync with the
  // `data-active` already declared in the HTML.
  setActive(root.dataset.active || ids[0]);
})();

// ============================================================
// SCREENSHOT LIGHTBOX — native <dialog> with local pinch-zoom + pan
// ============================================================
// Click/tap on a `[data-lightbox-open]` button copies its inner <img>
// src/alt into the dialog's img and calls showModal(). Backdrop click,
// the close button, and Escape (native) all close.
//
// Pinch-zoom is implemented locally (only the image scales, not the page).
// Two fingers on the image: scale 1x–5x, anchored to the gesture midpoint.
// One finger when zoomed > 1: pan. Closing resets the transform.
// `touch-action: none` on .lightbox__img blocks the browser's native page-
// zoom so it doesn't compete with our handlers.
// ============================================================
(() => {
  const dialog = document.querySelector('[data-lightbox]');
  if (!dialog) return;
  const dialogImg = dialog.querySelector('.lightbox__img');
  const closeBtn = dialog.querySelector('[data-lightbox-close]');
  if (!dialogImg || !closeBtn) return;

  const triggers = document.querySelectorAll('[data-lightbox-open]');
  triggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      const sourceImg = btn.querySelector('img');
      if (!sourceImg) return;
      dialogImg.src = sourceImg.currentSrc || sourceImg.src;
      dialogImg.alt = sourceImg.alt || '';
      dialog.showModal();
    });
  });

  closeBtn.addEventListener('click', () => dialog.close());

  // Click on the backdrop area (target === dialog itself, not its
  // children) closes the lightbox. Standard <dialog> idiom.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  // ---------- Pinch-zoom + pan ----------
  // Transform state. `tx/ty` translate the image's center; `scale` magnifies.
  // Composed as `translate(tx, ty) scale(scale)` — order matters: translate
  // first so the gesture-midpoint pinning math stays linear.
  const MIN_SCALE = 1;
  const MAX_SCALE = 5;
  let scale = 1;
  let tx = 0;
  let ty = 0;

  // Gesture state. `gesture` is the active mode: null, 'pinch', or 'pan'.
  // For pinch we remember the initial finger distance + midpoint; for pan
  // we remember the starting touch position and the translate at start.
  // `imgCx/imgCy` is the image's untransformed center in client coords,
  // captured once per pinch — the anchor math needs a stable reference
  // that doesn't drift as we keep applying transforms frame to frame.
  let gesture = null;
  let startDist = 0;
  let startScale = 1;
  let startTx = 0;
  let startTy = 0;
  let startCx = 0;
  let startCy = 0;
  let imgCx = 0;
  let imgCy = 0;

  function applyTransform() {
    dialogImg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }
  function resetTransform() {
    scale = 1;
    tx = 0;
    ty = 0;
    dialogImg.style.transform = '';
  }
  function midpoint(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }
  function distance(touches) {
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
  }

  dialogImg.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      gesture = 'pinch';
      startDist = distance(e.touches);
      startScale = scale;
      const mid = midpoint(e.touches);
      startCx = mid.x;
      startCy = mid.y;
      startTx = tx;
      startTy = ty;
      // Capture the untransformed image center: BCR is the *transformed*
      // rect, but with `transform-origin: 50% 50%` the scale doesn't shift
      // the center — only the translate does. Subtracting startTx/startTy
      // recovers the laid-out center, which stays valid for the whole
      // gesture regardless of how many move events fire.
      const rect = dialogImg.getBoundingClientRect();
      imgCx = rect.left + rect.width / 2 - startTx;
      imgCy = rect.top + rect.height / 2 - startTy;
      e.preventDefault();
    } else if (e.touches.length === 1 && scale > 1) {
      gesture = 'pan';
      startCx = e.touches[0].clientX;
      startCy = e.touches[0].clientY;
      startTx = tx;
      startTy = ty;
      e.preventDefault();
    }
  }, { passive: false });

  dialogImg.addEventListener('touchmove', (e) => {
    if (gesture === 'pinch' && e.touches.length === 2) {
      const ratio = distance(e.touches) / startDist;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, startScale * ratio));
      // Keep the midpoint anchored: as scale changes, translate so the
      // pixel under the midpoint stays under the (moving) midpoint.
      // Derived from `clientX = imgCx + tx + scale * dx` where `dx` is the
      // pixel's image-space offset from center; solve for the new tx that
      // keeps the same `dx` under the current midpoint.
      const mid = midpoint(e.touches);
      const k = newScale / startScale;
      tx = mid.x - imgCx - k * (startCx - imgCx - startTx);
      ty = mid.y - imgCy - k * (startCy - imgCy - startTy);
      scale = newScale;
      applyTransform();
      e.preventDefault();
    } else if (gesture === 'pan' && e.touches.length === 1) {
      tx = startTx + (e.touches[0].clientX - startCx);
      ty = startTy + (e.touches[0].clientY - startCy);
      applyTransform();
      e.preventDefault();
    }
  }, { passive: false });

  dialogImg.addEventListener('touchend', (e) => {
    // Pinch released → if we ended below 1x (shouldn't, MIN_SCALE clamps),
    // or if the user lifted the second finger, snap back when scale ≤ 1.
    if (e.touches.length < 2) {
      if (scale <= MIN_SCALE + 0.01) resetTransform();
      gesture = e.touches.length === 1 ? 'pan' : null;
      if (gesture === 'pan') {
        startCx = e.touches[0].clientX;
        startCy = e.touches[0].clientY;
        startTx = tx;
        startTy = ty;
      }
    }
    if (e.touches.length === 0) gesture = null;
  });

  // Clean up transform whenever the dialog closes (Escape, close button,
  // backdrop click, or any future code path) so the next open starts fresh.
  dialog.addEventListener('close', resetTransform);
})();

// ============================================================
// Footer → mobile drawer migration
// ------------------------------------------------------------
// On phones (≤767px) the footer is hidden by CSS and its content
// (link columns + bottom strip) is moved into the nav drawer so
// the user reaches every link from a single overlay. On desktop
// the original DOM is restored. Brand block stays in the footer
// because the nav already shows the logo on every page.
// ============================================================
(() => {
  const drawer = document.getElementById('nav-drawer');
  const footer = document.querySelector('.lp-footer');
  if (!drawer || !footer) return;

  // Only the link columns migrate. The bottom strip (copyright + Makersia
   // attribution) stays in the footer at every viewport — it carries the
   // author / license signal and must remain visible on the page itself.
  const movable = [
    ...footer.querySelectorAll('.lp-footer__col'),
  ];
  if (movable.length === 0) return;

  // Stable destination inside the drawer. Only created once; the JS toggles
  // its children via DOM moves rather than rebuilding it on each viewport
  // change so listeners on inner anchors stay attached.
  const slot = document.createElement('div');
  slot.className = 'lp-nav__footer-mobile';
  drawer.appendChild(slot);

  // Comment placeholders mark where each node lives in the footer so we can
  // put it back when returning to desktop, regardless of how the surrounding
  // markup has changed in the meantime.
  const anchors = movable.map((node) => {
    const placeholder = document.createComment('footer-slot');
    node.parentNode.insertBefore(placeholder, node);
    return { node, placeholder };
  });

  const apply = (mobile) => {
    if (mobile) {
      for (const { node } of anchors) slot.appendChild(node);
    } else {
      for (const { node, placeholder } of anchors) {
        placeholder.parentNode.insertBefore(node, placeholder);
      }
    }
  };

  const mq = window.matchMedia('(max-width: 767px)');
  apply(mq.matches);
  mq.addEventListener('change', (e) => apply(e.matches));
})();

// ============================================================
// Cookie consent + Google Analytics gating
// ------------------------------------------------------------
// Shows the consent dialog the first time the page loads (no
// `cookieConsent` entry in localStorage). Accept → load GA and
// remember. Decline → remember refusal, GA never loads.
// To re-prompt the user (e.g., a "Cookie preferences" link in
// the footer), call `window.smCookieConsent.reset()`.
// ============================================================
(() => {
  const dialog = document.querySelector('[data-cookie-consent]');
  if (!dialog) return;

  const KEY = 'cookieConsent';
  const GA_ID = 'G-XWJCEH8R9T';

  const stored = localStorage.getItem(KEY);

  // Auto-load analytics on subsequent visits if the user already accepted.
  if (stored === 'accepted') loadAnalytics();

  // First visit: show the dialog. showModal() gives focus trap + Escape
  // handling for free; we don't bind Escape ourselves because we *want*
  // Escape to close the dialog without persisting either choice (the
  // user can still see it on next page load).
  if (!stored && typeof dialog.showModal === 'function') {
    // Defer one tick so any data-i18n pass that ran on DOMContentLoaded
    // has already updated the dialog's text content.
    queueMicrotask(() => dialog.showModal());
  }

  dialog.querySelector('[data-cookie-accept]')?.addEventListener('click', () => {
    localStorage.setItem(KEY, 'accepted');
    loadAnalytics();
    dialog.close();
  });
  dialog.querySelector('[data-cookie-decline]')?.addEventListener('click', () => {
    localStorage.setItem(KEY, 'declined');
    dialog.close();
  });

  // Public hook for re-prompting (e.g. footer link). Mounted on window so
  // markup can wire `onclick="smCookieConsent.reset()"` without imports.
  window.smCookieConsent = {
    reset: () => {
      localStorage.removeItem(KEY);
      if (typeof dialog.showModal === 'function') dialog.showModal();
    },
  };

  function loadAnalytics() {
    // Standard gtag.js loader. The async script registers gtag globally;
    // the inline initializer queues the page_view event for the current
    // session.
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', GA_ID);
  }
})();
