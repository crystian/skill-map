# `ui/` — skill-map Web UI

Angular SPA bundled with the `@skill-map/cli` package and served by the `sm serve` verb (Hono BFF + WebSocket broadcaster, single-port at `127.0.0.1:4242`). This workspace is **`private: true`** — it is not published as a standalone package; it ships inside the CLI bundle.

The UI consumes the kernel through the BFF (REST read-side endpoints + a `/ws` WebSocket channel for live scan events) and offers:

- **List view** — every node with kind, path, issue count, byte / token weight; filterable by kind, stability, has-issues, and free-text search.
- **Graph view** — Foblex Flow canvas (pan / zoom / drag) over the link graph; per-kind colour palette.
- **Inspector** — selected-node detail panel: enrichment, summary placeholders (Phase B), findings placeholders (Phase B), backlinks.
- **Event log** — live `scan.*` / `extractor.completed` / `rule.completed` / `extension.error` events streamed from the BFF.

A standalone **demo bundle** (no kernel, no backend — reads precomputed JSON) ships at `web/demo/` for the public site. Build-time `<meta name="skill-map-mode" content="live|demo">` switches between the two modes; one Angular bundle, two configurations.

## Stack

- **Angular 21** (standalone components, signals, OnPush by default).
- **Foblex Flow** (`@foblex/flow`) for the graph rendering — see the project-local [`foblex-flow`](../.claude/skills/foblex-flow/) skill for the operating guide (nine non-negotiable rules learned the hard way).
- **PrimeNG** for forms and overlays.
- **Tailwind** for utility styling; PrimeNG components for complex widgets.
- **Transloco** for i18n (`en` / `es`).
- **Vitest** for unit tests.
- **markdown-it + DOMPurify** for the body Formatter (lazy-imported to keep the initial bundle lean).

Pinned exact versions per [AGENTS.md](../AGENTS.md) — no `^` or `~` in `package.json`.

## Development

```bash
# Inside the monorepo root:
npm install                                   # installs all workspaces

# Run the UI against the live BFF (recommended dev loop):
npm run dev:serve                             # tsx --watch sm serve --port 4242

# Or build the UI standalone (no backend):
npm run build --workspace=ui                  # → ui/dist/ui/browser/

# Run the unit tests:
npm test --workspace=ui                       # Vitest

# Lint (when the workspace lint config lands):
npm run lint --workspace=ui
```

> **Smoke-testing the UI from an AI agent**: NEVER use `dev:serve` (it wraps `tsx --watch`, which reparents descendants to init when the wrapper dies — `pkill -f` and `lsof+kill` loops can't keep up). Use a one-shot `timeout 10 node --import tsx src/cli/entry.ts serve --no-open --port N --ui-dist /abs/ui/dist/ui/browser` instead, and free the port with `fuser -k -KILL -n tcp <port>` if needed. Full rule in [`AGENTS.md`](../AGENTS.md).

## Demo build

```bash
npm run demo:build                            # builds UI + demo dataset + patches index.html
```

This chains: `npm run build --workspace=ui && node scripts/build-demo-dataset.js && cp -R ui/dist/ui/browser/. web/demo/ && node scripts/patch-demo-mode.js`. The resulting `web/demo/` is a static bundle that reads `web/demo/data.json` (full `ScanResult`) + per-endpoint envelopes mirroring the BFF surface — the demo SPA never makes an HTTP call, so it deploys to any static host. The `site:build` script depends on `demo:build`, so every public-site deploy ships a fresh demo.

## Test IDs

Every interactive or test-targetable element carries a `data-testid` attribute (kebab-case, shaped as `<area>-<element>` or `<area>-<element>-<modifier>`). The codebase has no E2E tests today, but the IDs are placed proactively so future Playwright / Cypress / Vitest-Testing-Library flows land on stable selectors. Full convention in [`context/ui.md`](../context/ui.md) §UI test IDs.

## Design system

Tailwind-first for layout and spacing; PrimeNG-first for complex widgets (tables, multiselect, dropdowns, dialogs). The decision rule lives in the [`app-angular-quick`](../.claude/skills/minions/app-angular-quick/) and [`app-angular-detailed`](../.claude/skills/minions/app-angular-detailed/) skills — invoke `/app-angular-quick` for a concise rules reference or `/app-angular-detailed` for code patterns with examples.

## Further reading

- [`ROADMAP.md`](../ROADMAP.md) §UI (Step 0c prototype → Step 14 full) — UI execution plan, decisions, design picks.
- [`spec/architecture.md`](../spec/architecture.md) — kernel boundaries (the BFF is a peer driving adapter of the CLI; the UI consumes the BFF, not the kernel directly).
- [`spec/cli-contract.md`](../spec/cli-contract.md) §Server — the BFF endpoint surface the UI consumes.
- The project-local [`foblex-flow`](../.claude/skills/foblex-flow/) skill — required reading before touching any graph code.
