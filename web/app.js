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

  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
  const STR = {
    en: {
      skill: 'SKILL', agent: 'AGENT', command: 'COMMAND', hook: 'HOOK', note: 'NOTE', orphan: 'ORPHAN',
      refs: 'refs', tokens: 'tokens', bytes: 'bytes', lastscan: 'last scan',
      'warn.collision': 'references 5 skills, 1 collides',
      'warn.orphan':    'no inbound references — never invoked',
      agoPrefix: '', agoSuffix: 'ago',
    },
    es: {
      skill: 'SKILL', agent: 'AGENTE', command: 'COMANDO', hook: 'HOOK', note: 'NOTA', orphan: 'HUÉRFANO',
      refs: 'refs', tokens: 'tokens', bytes: 'bytes', lastscan: 'último scan',
      'warn.collision': 'referencia 5 skills, 1 colisiona',
      'warn.orphan':    'sin referencias entrantes — nunca invocado',
      agoPrefix: 'hace ', agoSuffix: '',
    },
  };
  const t = (k) => STR[lang][k] ?? STR.en[k] ?? k;
  const formatAgo = (raw) => `${STR[lang].agoPrefix}${raw}${STR[lang].agoSuffix ? ' ' + STR[lang].agoSuffix : ''}`;

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
  const view = { x: 0, y: 0, k: 1 };
  const Z_MIN = 0.5, Z_MAX = 3;
  function applyView() {
    viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  }
  function zoomAt(svgX, svgY, factor) {
    const k = Math.max(Z_MIN, Math.min(Z_MAX, view.k * factor));
    view.x = svgX - (svgX - view.x) * (k / view.k);
    view.y = svgY - (svgY - view.y) * (k / view.k);
    view.k = k;
    applyView();
  }
  function clientToSvgRaw(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width)  * 900,
      y: ((clientY - rect.top)  / rect.height) * 560,
    };
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = clientToSvgRaw(e.clientX, e.clientY);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

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

  // Wire the zoom controls (the buttons started disabled in the static HTML).
  const zoomBtns = graphCard.querySelectorAll('.hero__graph-zoom button');
  zoomBtns.forEach((b) => { b.disabled = false; });
  zoomBtns[0]?.addEventListener('click', () => zoomAt(450, 280, 1.2));
  zoomBtns[1]?.addEventListener('click', () => zoomAt(450, 280, 1 / 1.2));
  zoomBtns[2]?.addEventListener('click', () => { view.x = 0; view.y = 0; view.k = 1; applyView(); });

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
  const card = document.getElementById('hero-graph');
  if (!card) return;
  const canvas = card.querySelector('.hg-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const N_BASE = 80; // tuned for the 1280×560 reference card; scales with area
  const HALO_R = 200;
  const ATTRACT_R = 220;
  const TINT_R = 180;
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
          const f = (1 - d / ATTRACT_R) * 0.05;
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
// Roadmap timeline — interactive milestones
// ------------------------------------------------------------
// Renders the timeline strip + initial detail panel into
// #roadmap-mount on load, then wires click handlers that swap
// the detail when a milestone is selected. The dataset is
// kept here (not in i18n.json) because it's data, not UI copy.
// ============================================================
(() => {
  const mount = document.getElementById('roadmap-mount');
  if (!mount) return;
  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';

  const MILESTONES = [
    { v: 'v0.1', q: 'Q3 2024', status: 'done',
      title: { en: 'Initial scan',   es: 'Primer escaneo' },
      sub:   { en: 'Static graph rendering', es: 'Render estático del grafo' },
      brief: { en: 'The first walking version: scan a directory of markdown skills, build the adjacency graph, render a static SVG. No interaction, no daemon — just proof that the structure exists.',
               es: 'La primera versión que caminaba: escanear un directorio de skills en markdown, armar el grafo de adyacencia, renderizar un SVG estático. Sin interacción, sin daemon — solo prueba de que la estructura existe.' } },
    { v: 'v0.3', q: 'Q4 2024', status: 'done',
      title: { en: 'CLI shipped',    es: 'CLI publicada' },
      sub:   { en: 'Flags, JSON, --watch', es: 'Flags, JSON, --watch' },
      brief: { en: '`sm scan` matures into a real CLI: --json for piping into jq, --watch for live reruns, --filter for slicing by node type. Exit codes that play nicely with CI.',
               es: '`sm scan` madura como CLI: --json para hacer pipe a jq, --watch para reruns en vivo, --filter para cortar por tipo de nodo. Exit codes que se llevan bien con CI.' } },
    { v: 'v0.5', q: 'Q1 2025', status: 'current',
      title: { en: 'Web explorer',   es: 'Explorador web' },
      sub:   { en: 'Live, interactive, force-directed', es: 'En vivo, interactivo, force-directed' },
      brief: { en: "The graph becomes interactive. `sm open` boots a local server, opens the browser, force-directed layout that responds to drag, zoom, and pan. This is what you're looking at right now.",
               es: 'El grafo se vuelve interactivo. `sm open` levanta un servidor local, abre el navegador, layout force-directed que responde a drag, zoom y pan. Esto es lo que estás viendo ahora mismo.' } },
    { v: 'v0.7', q: 'Q2 2025', status: 'planned',
      title: { en: 'Trigger collisions', es: 'Colisiones de triggers' },
      sub:   { en: 'Catch ambiguous invocations', es: 'Detectar invocaciones ambiguas' },
      brief: { en: 'When two skills both claim the trigger phrase "deploy", the runtime picks whichever loads first. v0.7 surfaces these conflicts at scan time so you fix them before the agent guesses wrong in production.',
               es: 'Cuando dos skills reclaman la frase trigger "deploy", el runtime elige la que cargue primero. v0.7 muestra estos conflictos al escanear para que los arregles antes de que el agente adivine mal en producción.' } },
    { v: 'v0.8', q: 'Q2 2025', status: 'planned',
      title: { en: 'Orphan detection', es: 'Detección de huérfanos' },
      sub:   { en: 'Find dead skills', es: 'Encontrar skills muertas' },
      brief: { en: 'Skills that are defined but referenced by nothing — the equivalent of dead code, but for your agent ecosystem. Clean them up or mark them as entry points so the graph stops nagging.',
               es: 'Skills que están definidas pero nada las referencia — el equivalente a código muerto, pero para tu ecosistema de agentes. Limpialas o marcalas como entry points para que el grafo deje de joder.' } },
    { v: 'v0.9', q: 'Q3 2025', status: 'planned',
      title: { en: 'Weighted edges', es: 'Edges con peso' },
      sub:   { en: 'Token cost per reference', es: 'Costo de tokens por referencia' },
      brief: { en: 'Each edge gains a weight: the token cost a skill imposes on its callers. Heavy nodes light up red. Now you can see at a glance which 5% of your skills are eating 80% of your context window.',
               es: 'Cada edge gana un peso: el costo en tokens que una skill le impone a sus llamadores. Los nodos pesados se prenden en rojo. Ahora podés ver de un vistazo qué 5% de tus skills se comen el 80% de tu ventana de contexto.' } },
    { v: 'v1.0', q: 'Q4 2025', status: 'planned',
      title: { en: 'Stable 1.0', es: '1.0 estable' },
      sub:   { en: 'Public API · semver guarantees', es: 'API pública · garantías de semver' },
      brief: { en: 'Public, frozen schema for the JSON output. Plugin contract sealed. Backwards compatibility promise from here forward. We ship docs, examples, a real changelog.',
               es: 'Schema público y congelado para el output JSON. Contrato de plugins sellado. Promesa de compatibilidad hacia atrás de acá en adelante. Documentamos, damos ejemplos, escribimos un changelog real.' } },
    { v: 'v1.2', q: 'Q1 2026', status: 'planned',
      title: { en: 'Plugin system', es: 'Sistema de plugins' },
      sub:   { en: 'Custom node types & rules', es: 'Nodos y reglas custom' },
      brief: { en: 'Bring your own node type. Write a plugin to scan, say, your internal RPC schema and have it appear in the graph alongside skills and agents. Same goes for custom lint rules — write code, not config.',
               es: 'Trae tu propio tipo de nodo. Escribí un plugin que escanee, digamos, tu schema RPC interno y aparece en el grafo junto a skills y agents. Igual para reglas de lint custom — código, no config.' } },
    { v: 'v1.4', q: 'Q2 2026', status: 'planned',
      title: { en: 'Cross-repo federation', es: 'Federación entre repos' },
      sub:   { en: 'Join graphs across projects', es: 'Unir grafos entre proyectos' },
      brief: { en: 'Most teams have their skills scattered across 4–5 repos. v1.4 lets each project publish its graph as a manifest and lets you mount others as namespaced subgraphs — query the whole org at once.',
               es: 'La mayoría de los equipos tiene sus skills repartidas en 4 o 5 repos. v1.4 deja que cada proyecto publique su grafo como un manifest y monte los otros como subgrafos con namespace — consultá toda la org de una.' } },
    { v: 'v2.0', q: 'Q4 2026', status: 'planned',
      title: { en: 'Team dashboards', es: 'Dashboards de equipo' },
      sub:   { en: 'Optional cloud sync', es: 'Sync en la nube opcional' },
      brief: { en: "Opt-in service that aggregates your team's graphs over time. See drift between branches, who introduced which collision, when an orphan first appeared. Self-hostable. Local-first stays the default.",
               es: 'Servicio opt-in que agrega los grafos del equipo en el tiempo. Ver drift entre branches, quién introdujo qué colisión, cuándo apareció un huérfano. Self-hostable. Local-first sigue siendo el default.' } },
  ];

  const STATUS_LABEL = {
    done:    { en: 'Shipped',     es: 'Lanzado' },
    current: { en: 'In progress', es: 'En curso' },
    planned: { en: 'Planned',     es: 'Planeado' },
  };

  const tx = (obj) => obj[lang] ?? obj.en;
  const currentIdx = MILESTONES.findIndex((m) => m.status === 'current');
  let selected = currentIdx >= 0 ? currentIdx : 0;

  // --- Build the strip + dots once ---
  const strip = document.createElement('div');
  strip.className = 'roadmap__strip';

  const rail = document.createElement('div');
  rail.className = 'roadmap__rail';
  strip.appendChild(rail);

  const progress = document.createElement('div');
  progress.className = 'roadmap__progress';
  // Width = position of the current milestone along the inner 92% rail.
  const progressPct = currentIdx >= 0
    ? (currentIdx / (MILESTONES.length - 1)) * 92
    : 0;
  progress.style.width = `${progressPct}%`;
  strip.appendChild(progress);

  const dots = document.createElement('div');
  dots.className = 'roadmap__dots';

  MILESTONES.forEach((m, i) => {
    const above = i % 2 === 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'roadmap__milestone';
    btn.dataset.idx = String(i);
    btn.dataset.status = m.status;
    btn.setAttribute('aria-current', i === selected ? 'true' : 'false');
    btn.setAttribute('aria-label', `${m.v} — ${tx(m.title)}`);

    const labelHtml = `
      <div class="roadmap__label roadmap__label--${above ? 'above' : 'below'}">
        <div class="roadmap__label-v">${m.v}</div>
        <div class="roadmap__label-t">${escapeHtml(tx(m.title))}</div>
      </div>`;
    const dotHtml = `
      <div class="roadmap__dot-wrap">
        <span class="roadmap__pulse" aria-hidden="true"></span>
        <span class="roadmap__sel-ring" aria-hidden="true"></span>
        <span class="roadmap__dot" aria-hidden="true"></span>
      </div>`;
    btn.innerHTML = above ? labelHtml + dotHtml : dotHtml + labelHtml;
    dots.appendChild(btn);
  });

  strip.appendChild(dots);
  mount.appendChild(strip);

  // --- Build the detail panel ---
  const detail = document.createElement('div');
  detail.className = 'roadmap__detail';
  detail.innerHTML = `
    <div>
      <div class="roadmap__detail-q"></div>
      <div class="roadmap__detail-v"></div>
      <div class="roadmap__detail-status"></div>
    </div>
    <div>
      <h3 class="roadmap__detail-title"></h3>
      <div class="roadmap__detail-sub"></div>
      <p class="roadmap__detail-brief"></p>
    </div>
  `;
  mount.appendChild(detail);

  const hint = document.createElement('div');
  hint.className = 'roadmap__hint';
  hint.textContent = lang === 'es'
    ? 'Hacé clic en cualquier hito para ver el brief.'
    : 'Click any milestone to read the brief.';
  mount.appendChild(hint);

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function setSelected(i) {
    if (i < 0 || i >= MILESTONES.length) return;
    selected = i;
    for (const btn of dots.children) {
      btn.setAttribute('aria-current', String(+btn.dataset.idx === i));
    }
    renderDetail();
  }

  function renderDetail() {
    const m = MILESTONES[selected];
    detail.dataset.status = m.status;
    detail.querySelector('.roadmap__detail-q').textContent = m.q;
    detail.querySelector('.roadmap__detail-v').textContent = m.v;
    detail.querySelector('.roadmap__detail-status').textContent = tx(STATUS_LABEL[m.status]);
    detail.querySelector('.roadmap__detail-title').textContent = tx(m.title);
    detail.querySelector('.roadmap__detail-sub').textContent = tx(m.sub);
    detail.querySelector('.roadmap__detail-brief').textContent = tx(m.brief);
  }

  // Click delegation on the dots row.
  dots.addEventListener('click', (e) => {
    const btn = e.target.closest('.roadmap__milestone');
    if (!btn) return;
    setSelected(+btn.dataset.idx);
  });

  // Keyboard nav: arrow left/right on focused milestone.
  dots.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const focused = document.activeElement;
    if (!focused?.classList.contains('roadmap__milestone')) return;
    const i = +focused.dataset.idx;
    const next = e.key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(MILESTONES.length - 1, i + 1);
    dots.children[next].focus();
    setSelected(next);
    e.preventDefault();
  });

  // Initial paint.
  renderDetail();
})();
