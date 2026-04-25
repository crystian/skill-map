const I18N = {
  en: {
    'meta.title': 'skill-map — graph explorer for AI agent ecosystems',
    'top.draft': 'pre-1.0',
    'nav.problem': 'problem',
    'nav.screens': 'screens',
    'nav.how': 'how',
    'nav.quickstart': 'quickstart',
    'nav.spec': 'spec',
    'nav.roadmap': 'roadmap',
    'cta.github': 'github',
    'cta.start': 'get started',
    'cta.npm': 'npm',
    'cta.spec': 'browse spec',
    'hero.tag': 'A graph explorer for Markdown-based AI agents — Claude Code, Codex, Gemini, Copilot. Detects cross-references, trigger collisions, orphans, weight, stale summaries. <b>CLI-first.</b> <b>Deterministic offline.</b> <b>Public spec.</b>',
    'hero.meta.cli': 'cli-first',
    'hero.meta.det': 'deterministic',
    'hero.meta.spec': 'public spec',
    'hero.meta.mit': 'mit',
    'sect.problem.num': '§ 01',
    'sect.problem.h': 'the problem nobody owns',
    'sect.problem.lead': 'Devs working with AI agents accumulate dozens of skills, agents, commands, and loose docs. Nobody sees the whole picture.',
    'problem.1.h': 'what lives where',
    'problem.1.p': 'no single place lists every skill, agent, command, hook, or note across the ecosystem.',
    'problem.2.h': 'who calls whom',
    'problem.2.p': 'cross-file references, invocations, and dependencies are invisible until they break.',
    'problem.3.h': 'trigger collisions',
    'problem.3.p': 'two skills with overlapping triggers silently fight. you only notice when the wrong one wins.',
    'problem.4.h': 'orphans &amp; dead weight',
    'problem.4.p': 'files nothing references. drafts that never shipped. token cost you keep paying.',
    'problem.5.h': 'external dependencies',
    'problem.5.p': 'what skills pull from which sub-agents, mcps, or external services — and where they leak.',
    'problem.6.h': 'last optimized when',
    'problem.6.p': 'no history of when each skill was validated, optimized, or last touched. until now.',
    'sect.screens.num': '§ 02',
    'sect.screens.h': 'three views, one graph',
    'sect.screens.lead': 'List, graph, and inspector — every view reads the same kernel data and stays in sync.',
    'screens.tab.list': 'list',
    'screens.tab.graph': 'graph',
    'screens.tab.inspector': 'inspector',
    'screens.list.cap': 'searchable list with filters by kind, stability, and issues. fastest way to find anything.',
    'screens.graph.cap': 'force-directed graph rendered with foblex flow. pan, zoom, color by kind, click to inspect.',
    'screens.inspector.cap': 'read-only frontmatter, body preview, references, and incoming/outgoing links — for the selected node.',
    'screens.placeholder': 'drop',
    'sect.how.num': '§ 03',
    'sect.how.h': 'how it works',
    'sect.how.lead': 'Four pieces. The kernel knows nothing about platforms — everything else plugs in.',
    'how.legend': 'scanner emits structured nodes/links/issues → kernel applies rules → cli serves json → ui renders.',
    'sect.quick.num': '§ 04',
    'sect.quick.h': 'quickstart',
    'sect.quick.lead': 'One install. One scan. Zero LLM calls unless you ask for them.',
    'quick.p1': 'pure typescript · node ≥ 20 · offline by default.',
    'quick.p2': 'spec is published on npm — build alternative implementations.',
    'quick.p3': 'plugins drop into <code>.skill-map/plugins/</code>. six extension kinds, all stable.',
    'quick.copy': 'copy',
    'quick.copied': 'copied',
    'sect.spec.num': '§ 05',
    'sect.spec.h': 'spec',
    'sect.spec.lead': '29 JSON Schemas (draft 2020-12) + 7 prose contracts + a conformance suite. Every version is on npm. The spec is the contract — build your UI, your impl, your renderer.',
    'spec.url.label': '$id == url',
    'sect.road.num': '§ 06',
    'sect.road.h': 'roadmap',
    'sect.road.lead': 'Authoritative narrative lives in ROADMAP.md. Snapshot below.',
    'road.h.step': 'step',
    'road.h.desc': 'description',
    'road.h.when': 'when',
    'road.h.status': 'status',
    'road.0a.h': 'step 0a · spec bootstrap',
    'road.0a.p': 'schemas, prose contracts, conformance suite, npm release.',
    'road.0a.when': '2026-Q1',
    'road.0a.s': 'shipped',
    'road.0b.h': 'step 0b · reference impl',
    'road.0b.p': 'cli sm boots clean. stub scan verb. kernel-first.',
    'road.0b.when': '2026-Q1',
    'road.0b.s': 'shipped',
    'road.0c.h': 'step 0c · ui prototype',
    'road.0c.p': 'angular spa + foblex flow with mocked data. three views.',
    'road.0c.when': 'now',
    'road.0c.s': 'active',
    'road.10.h': 'step 1.0 · public release',
    'road.10.p': 'stable kernel, plugin marketplace, full integration.',
    'road.10.when': 'soon',
    'road.10.s': 'planned',
    'foot.repo': 'github',
    'foot.spec': 'spec',
    'foot.cli': 'cli',
    'foot.roadmap': 'roadmap',
    'foot.changelog': 'changelog',
    'foot.contributing': 'contributing',
    'foot.issues': 'issues',
    'foot.discussions': 'discussions',
    'foot.lic': 'mit',
  },
  es: {
    'meta.title': 'skill-map — explorador de grafos para ecosistemas de agentes de IA',
    'top.draft': 'pre-1.0',
    'nav.problem': 'problema',
    'nav.screens': 'pantallas',
    'nav.how': 'cómo',
    'nav.quickstart': 'empezar',
    'nav.spec': 'spec',
    'nav.roadmap': 'roadmap',
    'cta.github': 'github',
    'cta.start': 'empezar',
    'cta.npm': 'npm',
    'cta.spec': 'ver spec',
    'hero.tag': 'Un explorador de grafos para agentes de IA basados en Markdown — Claude Code, Codex, Gemini, Copilot. Detecta referencias cruzadas, triggers que chocan, huérfanos, peso, resúmenes obsoletos. <b>CLI-first.</b> <b>Determinista offline.</b> <b>Spec pública.</b>',
    'hero.meta.cli': 'cli-first',
    'hero.meta.det': 'determinista',
    'hero.meta.spec': 'spec pública',
    'hero.meta.mit': 'mit',
    'sect.problem.num': '§ 01',
    'sect.problem.h': 'el problema que nadie tiene',
    'sect.problem.lead': 'Los devs con agentes de IA acumulan decenas de skills, agentes, comandos y docs sueltos. Nadie ve el cuadro completo.',
    'problem.1.h': 'qué hay y dónde',
    'problem.1.p': 'no existe un lugar único que liste cada skill, agente, comando, hook o nota del ecosistema.',
    'problem.2.h': 'quién llama a quién',
    'problem.2.p': 'las referencias entre archivos, las invocaciones y las dependencias son invisibles hasta que fallan.',
    'problem.3.h': 'triggers que chocan',
    'problem.3.p': 'dos skills con triggers superpuestos pelean en silencio. te enterás cuando gana el equivocado.',
    'problem.4.h': 'huérfanos y peso muerto',
    'problem.4.p': 'archivos que nadie referencia. drafts que nunca salieron. tokens que seguís pagando.',
    'problem.5.h': 'dependencias externas',
    'problem.5.p': 'qué skills tiran de qué sub-agentes, mcps o servicios externos — y por dónde se filtran.',
    'problem.6.h': 'cuándo se optimizó',
    'problem.6.p': 'no hay historia de cuándo se validó, optimizó o tocó cada skill. hasta ahora.',
    'sect.screens.num': '§ 02',
    'sect.screens.h': 'tres vistas, un grafo',
    'sect.screens.lead': 'Lista, grafo e inspector — todas leen los mismos datos del kernel y se mantienen en sync.',
    'screens.tab.list': 'lista',
    'screens.tab.graph': 'grafo',
    'screens.tab.inspector': 'inspector',
    'screens.list.cap': 'lista buscable con filtros por tipo, estabilidad e issues. la forma más rápida de encontrar cualquier cosa.',
    'screens.graph.cap': 'grafo dirigido por fuerzas, renderizado con foblex flow. pan, zoom, color por tipo, click para inspeccionar.',
    'screens.inspector.cap': 'frontmatter de solo lectura, preview del body, referencias y links entrantes/salientes — del nodo seleccionado.',
    'screens.placeholder': 'poné',
    'sect.how.num': '§ 03',
    'sect.how.h': 'cómo funciona',
    'sect.how.lead': 'Cuatro piezas. El kernel no sabe nada de plataformas — todo lo demás se enchufa.',
    'how.legend': 'el scanner emite nodos/links/issues estructurados → el kernel aplica reglas → la cli sirve json → la ui renderiza.',
    'sect.quick.num': '§ 04',
    'sect.quick.h': 'empezar',
    'sect.quick.lead': 'Una instalación. Un scan. Cero llamadas a LLMs salvo que las pidas.',
    'quick.p1': 'typescript puro · node ≥ 20 · offline por default.',
    'quick.p2': 'la spec está publicada en npm — armá implementaciones alternativas.',
    'quick.p3': 'los plugins se enchufan en <code>.skill-map/plugins/</code>. seis tipos de extensión, todos estables.',
    'quick.copy': 'copiar',
    'quick.copied': 'copiado',
    'sect.spec.num': '§ 05',
    'sect.spec.h': 'spec',
    'sect.spec.lead': '29 JSON Schemas (draft 2020-12) + 7 contratos en prosa + una suite de conformance. Cada versión está en npm. La spec es el contrato — armá tu UI, tu impl, tu renderer.',
    'spec.url.label': '$id == url',
    'sect.road.num': '§ 06',
    'sect.road.h': 'roadmap',
    'sect.road.lead': 'La narrativa autoritativa vive en ROADMAP.md. Acá un snapshot.',
    'road.h.step': 'paso',
    'road.h.desc': 'descripción',
    'road.h.when': 'cuándo',
    'road.h.status': 'estado',
    'road.0a.h': 'paso 0a · bootstrap de la spec',
    'road.0a.p': 'schemas, contratos en prosa, suite de conformance, release en npm.',
    'road.0a.when': '2026-Q1',
    'road.0a.s': 'listo',
    'road.0b.h': 'paso 0b · reference impl',
    'road.0b.p': 'cli sm bootea limpio. verbo scan stub. kernel-first.',
    'road.0b.when': '2026-Q1',
    'road.0b.s': 'listo',
    'road.0c.h': 'paso 0c · prototipo ui',
    'road.0c.p': 'spa angular + foblex flow con datos mockeados. tres vistas.',
    'road.0c.when': 'ahora',
    'road.0c.s': 'activo',
    'road.10.h': 'paso 1.0 · release público',
    'road.10.p': 'kernel estable, marketplace de plugins, integración completa.',
    'road.10.when': 'pronto',
    'road.10.s': 'planeado',
    'foot.repo': 'github',
    'foot.spec': 'spec',
    'foot.cli': 'cli',
    'foot.roadmap': 'roadmap',
    'foot.changelog': 'changelog',
    'foot.contributing': 'contribuir',
    'foot.issues': 'issues',
    'foot.discussions': 'discusiones',
    'foot.lic': 'mit',
  },
};

(() => {
  const SUPPORTED = Object.keys(I18N);
  const STORAGE_KEY = 'sm.lang';

  function detectInitialLang() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch {}
    const nav = (navigator.language || 'en').toLowerCase();
    if (nav.startsWith('es')) return 'es';
    return 'en';
  }

  function applyLang(lang) {
    const dict = I18N[lang] || I18N.en;
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      const val = dict[key];
      if (val == null) continue;
      el.innerHTML = val;
    }
    for (const btn of document.querySelectorAll('[data-set-lang]')) {
      btn.classList.toggle('active', btn.getAttribute('data-set-lang') === lang);
    }
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
  }

  function bindLangButtons() {
    for (const btn of document.querySelectorAll('[data-set-lang]')) {
      btn.addEventListener('click', () => applyLang(btn.getAttribute('data-set-lang')));
    }
  }

  function bindShotTabs() {
    const tabs = document.querySelectorAll('.shot-tabs [data-shot]');
    const panes = document.querySelectorAll('[data-pane]');
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-shot');
        for (const t of tabs) {
          const on = t === tab;
          t.classList.toggle('active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        for (const p of panes) p.classList.toggle('active', p.getAttribute('data-pane') === target);
      });
    }
  }

  function bindCopy() {
    for (const btn of document.querySelectorAll('[data-copy]')) {
      btn.addEventListener('click', async () => {
        const code = document.getElementById('quick-code');
        if (!code) return;
        const text = code.innerText.replace(/^\$ /gm, '');
        try { await navigator.clipboard.writeText(text); } catch { return; }
        const label = btn.querySelector('[data-copy-label]');
        if (!label) return;
        const dict = I18N[document.documentElement.lang] || I18N.en;
        const original = dict['quick.copy'] || 'copy';
        const copied = dict['quick.copied'] || 'copied';
        label.textContent = copied;
        setTimeout(() => { label.textContent = original; }, 1500);
      });
    }
  }

  applyLang(detectInitialLang());
  bindLangButtons();
  bindShotTabs();
  bindCopy();
})();
