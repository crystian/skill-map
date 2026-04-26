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
      refs: 'refs', tokens: 'tokens', bytes: 'bytes', lastscan: 'last scan', ago: '287ms ago',
      warn: 'references 5 skills, 1 collides',
    },
    es: {
      skill: 'SKILL', agent: 'AGENTE', command: 'COMANDO', hook: 'HOOK', note: 'NOTA', orphan: 'HUÉRFANO',
      refs: 'refs', tokens: 'tokens', bytes: 'bytes', lastscan: 'último scan', ago: 'hace 287ms',
      warn: 'referencia 5 skills, 1 colisiona',
    },
  };
  const t = (k) => STR[lang][k] ?? STR.en[k] ?? k;

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
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('tokens'))}</span>   <span class="v" data-k="tokens">2,134</span></div>
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('bytes'))}</span>    <span class="v" data-k="bytes">8.4 KB</span></div>
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('lastscan'))}</span> <span class="v" data-k="lastscan">${escapeHtml(t('ago'))}</span></div>
    </div>
    <div class="hero__inspector__warn" hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9"  x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span class="hero__inspector__warn-text">${escapeHtml(t('warn'))}</span>
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
    inspector.querySelector('[data-k="refs"]').textContent = String(adj.get(selected)?.size ?? 0);

    const warn = inspector.querySelector('.hero__inspector__warn');
    warn.hidden = selected !== 'reviewer';
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
})();
