# skill-map

> Design document and execution plan for `skill-map`. Tracks architecture, decisions, phases, deferred items, and open questions. Updated as conversations progress.

**Last updated**: 2026-04-18
**Target**: Distributable product (not personal tool). This activates versioning policy, plugin security, i18n, onboarding docs, compatibility matrix — all tracked below.

---

## Descripción del proyecto (ES)

### Qué es

**skill-map** (binario: `sm`) es una herramienta para **mapear, inspeccionar y gestionar colecciones de archivos Markdown interrelacionados** — especialmente skills, agents, commands, hooks y documentos que componen ecosistemas de agentes de IA (Claude Code, Codex, Gemini, Copilot, etc.).

Funciona como un explorador de grafo: detecta qué archivo referencia a qué otro, qué triggers activan qué skill, qué dependencias externas existen, qué está obsoleto o duplicado, y permite ejecutar acciones (actions) sobre cualquier nodo seleccionado.

### Qué problema resuelve

Los desarrolladores que trabajan con agentes de IA acumulan decenas de skills, agents, commands y documentos sueltos. No hay visibilidad sobre:

- Qué existe y dónde vive
- Quién invoca a quién (dependencias, referencias cruzadas)
- Qué triggers se solapan o pisan entre sí
- Qué está vivo vs obsoleto
- Qué se puede borrar sin romper nada
- Cuándo fue la última vez que se optimizó / validó cada skill

Ninguna herramienta oficial de Anthropic, Cursor, GitHub o skills.sh cubre esto. Obsidian ofrece gestión de notas pero no entiende semánticamente que un archivo es un skill ejecutable. `skill-map` llena ese hueco.

### Para quién

- Usuarios avanzados de Claude Code (u otros agentes) que mantienen varios plugins / skills propios
- Equipos que comparten colecciones de skills y necesitan auditoría
- Autores de plugins / actions que quieren testear y validar sus creaciones
- Desarrolladores que quieren construir herramientas encima del grafo (vía CLI, JSON o plugins)

### Cómo funciona (alto nivel)

1. **Scanner determinista** recorre los archivos, parsea frontmatter, detecta referencias (`@`, slash commands, wikilinks, links, imports, etc.) y produce un JSON estructurado con el grafo completo (nodes, edges, issues).
2. **Capa LLM opcional** consume ese JSON y agrega inteligencia semántica: valida referencias ambiguas, clusteriza triggers equivalentes, compara nodos, responde preguntas sobre el grafo ("¿qué rompo si borro X?").
3. **CLI `sm`** expone todas las operaciones — scan, list, show, check, compare, record, etc. Es la superficie primaria.
4. **Web UI** (opcional, a partir de v1.0) consume el mismo JSON y ofrece navegación visual, inspector de nodos y ejecución de acciones.
5. **Sistema de plugins** (kernel + extensiones, no-negociable desde día cero) permite que terceros agreguen detectores, reglas, actions, adapters para otras plataformas, renderers o audits sin tocar el kernel.

### Filosofía

- **CLI-first**: todo lo que hace la UI se puede hacer en línea de comandos. Sin excepciones.
- **Determinista por default**: el LLM es opcional, nunca requerido. El producto entero funciona offline.
- **Kernel-first desde commit 1**: el núcleo no contiene conocimiento de ninguna plataforma ni detector específico. Todo vive como extensión.
- **Tests desde commit 1**: pirámide completa (contract, unit, integration, self-scan, CLI, snapshot). Cada extensión trae su test o no bootea.
- **Agnóstico de plataforma**: aunque el primer adapter es Claude Code, la arquitectura soporta cualquier ecosistema de MDs (Codex, Gemini, Copilot, Obsidian vaults, docs sites).
- **Distribuible**: versionado semántico, docs, plugin security, marketplace — pensado para usuarios externos, no solo para el autor.
- **Estándar público**: el spec (JSON Schemas + conformance suite + contratos) vive en `spec/` dentro del repo. Cualquiera puede construir una UI alternativa, una implementación en otro lenguaje, o tooling complementario consumiendo solo el spec, sin necesidad de leer el código del CLI de referencia.

### Diferencias con Obsidian (el competidor más cercano)

Obsidian mapea notas, no ejecutables. `skill-map`:

1. Entiende skills/agents como **unidades accionables** (se ejecutan, tienen inputs/outputs/tools/triggers).
2. **CLI-first y headless** — corre en CI, pipelines, scripts shell. Obsidian es GUI-first.
3. **Layer AI-semántica** integrada al core — no un plugin de terceros.
4. **Actions ejecutables** — correr acciones sobre un nodo seleccionado (optimizar, validar, comparar).
5. **Testkit oficial** para autores de plugins — algo que Obsidian no tiene.

### Estado

Pre-implementación. Diseño, decisiones arquitectónicas y plan de ejecución consolidados en este documento.

### Mapa visual del roadmap

```text
═══════════════════════════════════════════════════════════════════════════
  FASE A · CORE DETERMINISTA (sin LLM)
═══════════════════════════════════════════════════════════════════════════
   0  Bootstrap              repo, schemas, registry
   1  Kernel skeleton        graph, orchestrator, storage, CLI stub
   2  First instances        1 adapter, 3 detectors, 3 rules, 1 renderer, 1 audit (6 kinds)
   3  Scan end-to-end        sm scan / list / show / check
   4  History + callback     sm record, orphans, rename heuristic
   5  Project config         .skill-map.json, .skill-mapignore, sm init
   6  Robustness             conflicts, confidence, perf, i18n, GC
   7  Diff + export          sm scan --compare-with, sm export, sm graph
   8  Plugin author UX       drop-in, testkit, docs, signing
  ────────────────────────────────────────────────────────────────────────
   ▶ CUT 1 — v0.1.0 shippable (100% determinista, sin LLM)

═══════════════════════════════════════════════════════════════════════════
  FASE B · CAPA LLM (opcional, nunca requerida)
═══════════════════════════════════════════════════════════════════════════
   9  LLM layer              ⚡ primer uso de LLM — diseño se define después de POC
  10  Semantic enhancements  clustering, validation, why, NL queries (dependen del POC)
  ────────────────────────────────────────────────────────────────────────
   ▶ CUT 2 — v0.5.0 con LLM opcional

═══════════════════════════════════════════════════════════════════════════
  FASE C · UI + DISTRIBUCIÓN
═══════════════════════════════════════════════════════════════════════════
  11  Extra renderers        mermaid, dot, subgraph
  12  Web UI                 server, graph viz, inspector, live validation
  13  Distribution polish    releases, docs, marketplace, telemetry, sm doctor
  ────────────────────────────────────────────────────────────────────────
   ▶ CUT 3 — v1.0.0 completo

═══════════════════════════════════════════════════════════════════════════
  FASE D · DIFERIDOS (post v1.0, bajo demanda)
═══════════════════════════════════════════════════════════════════════════
  14+  Write-back            edit/create/refactor desde UI
  15+  Test harness          dry-run / real / subprocess
  16+  Richer workflows      Node-pipe, JSON declarativo, DAG
  17+  Additional lenses     Obsidian-vault, docs-site
  18+  More adapters         Codex, Gemini, Copilot, generic
  19+  Template preview mejoras
  20+  Schema v2 + migration
═══════════════════════════════════════════════════════════════════════════

  Regla: el LLM nunca es requerido. El producto es completo offline hasta el step 8.
```

---

## Spec as a standard (non-negotiable if targeting a standard)

`skill-map` is designed to become a reusable standard, not a single tool. The **spec** is separated from the **reference implementation** from day zero.

**The spec is public and lives in this repo by design.** Anyone can build a UI, a CLI, a VSCode extension, a web dashboard, or an entirely new implementation (in any language) using only the schemas and conformance suite in `spec/`. They never need to read the reference implementation's source code. This is the purpose of the split.

### Repo layout

```
skill-map/
├── spec/                      ← source of truth for the STANDARD
│   ├── README.md              ← human-readable spec
│   ├── CHANGELOG.md           ← spec history (independent from tool)
│   ├── schemas/               ← JSON Schemas (machine-readable)
│   │   ├── node.schema.json
│   │   ├── scan-result.schema.json
│   │   ├── extension-manifest.schema.json
│   │   ├── execution-record.schema.json
│   │   ├── project-config.schema.json
│   │   └── plugins-registry.schema.json
│   ├── conformance/           ← test suite the spec demands
│   │   ├── fixtures/
│   │   └── cases/
│   └── versioning.md          ← evolution policy
└── src/                       ← reference implementation (the CLI)
```

### What the spec defines

**Schemas (formal JSON Schema):**
1. Node — node shape
2. Edge — relation between nodes
3. ScanResult — full scanner output
4. Issue — rules engine output
5. ExecutionRecord — history entry
6. ExtensionManifest — one variant per kind (7 total)
7. ProjectConfig — `.skill-map.json`
8. PluginsRegistry — `plugins.json`

**Contracts (prose documents):**
9. CLI surface — verbs, flags, exit codes, stdout/stderr format
10. `sm record` API — callback contract
11. Lifecycle events — what the kernel emits and when
12. Plugin discovery — order, priorities, conflict resolution

**Policies:**
13. Spec versioning — semver independent from the tool
14. Stability per field — `stable` / `experimental` / `deprecated`
15. Breaking changes policy — deprecation window, migration path
16. Naming conventions — ids, kinds, actions

### Required properties of the spec

- Machine-readable (JSON Schemas validate from any language)
- Human-readable (prose document with examples)
- Independently versioned (spec `v1.0.0` implementable by CLI `v0.3.2`)
- Platform-neutral (no Claude Code required in any schema; it's only an example adapter)
- Covered by a conformance suite (any implementation passes or fails, binary)

### Distribution of the spec

- Publish schemas to JSON Schema Store for editor autocomplete
- Canonical URLs (`https://skill-map.dev/spec/v1/node.schema.json` if domain exists)
- npm package: `@skill-map/spec` — schemas + conformance tests
- Spec semver separate from CLI semver (`spec-v1.0.0` vs `cli-v0.3.2`)

### Benefits

1. Third-party implementations (Rust, Python, etc.) possible — write against the spec, pass conformance
2. Plugin authors get formal contracts, not implicit TypeScript types
3. Editor integration (LSP, JSON Schema completion) in VSCode/Obsidian/IntelliJ
4. Evolution is controlled — `spec v1` frozen, breaking changes go to `spec v2`

### Cost

- Every feature requires spec change first, then implementation — discipline overhead
- Step 0 takes longer (doubles into spec bootstrap + impl bootstrap)
- Solo maintainer wears two hats (spec editor + impl author) — tolerable but real

### Adjustments to the execution plan

- **Step 0 splits into 0a (Spec bootstrap) + 0b (Implementation bootstrap).** See execution plan below.
- Every later step that adds a feature updates `spec/` first, then `src/`.
- Experimental features marked `stability: experimental` in the spec — don't block `spec v1`.

---

## Execution plan (day 0 to v1.0)

Sequential build path. Each step ships green tests before the next begins. LLM participation marked explicitly. Candidate cut lines marked for release decisions.

> **Cross-cutting**: every step ships its own tests (unit + contract). CI must stay green — no exceptions.

### Step 0a — Spec bootstrap (foundation of the standard)

- `spec/` directory scaffolded and public from commit 1
- `spec/README.md` — human-readable spec skeleton
- `spec/CHANGELOG.md` — independent from tool changelog
- `spec/versioning.md` — evolution policy (semver, stability tags, deprecation window)
- First draft of 8 JSON Schemas (see "Spec as a standard" section above)
- Conformance test suite stub with first cases
- npm package `@skill-map/spec` skeleton — publishable independently

**LLM**: no.

### Step 0b — Implementation bootstrap

- Repo scaffolding: `package.json`, Node ESM, `node:test` wired
- Zod schemas **derived from** the JSON Schemas in `spec/schemas/` — not duplicated
- `Registry` + `Loader` (knows about the 6 kinds, validates, isolates)
- Contract test infrastructure runs the spec's conformance suite against the impl
- CLI binary stub (`bin/sm.mjs` — just prints version)
- CI green with 0 real features

**LLM**: no.

---

### Step 1 — Kernel skeleton

- Graph data structures (in-memory `Graph` class)
- Orchestrator: runs the 6 extension pipelines in correct order (adapters → detectors → rules → actions → audits → renderer)
- Storage: `plugins.json`, `cache.json`, `history.json` (read/write atomic)
- CLI dispatcher with verb parsers (verbs exist, do nothing yet)
- Extension isolation: timeout, crash-catch, `disabled` state
- **Self-boot test**: empty kernel boots, runs scan, returns empty graph, zero errors

**LLM**: no.

---

### Step 2 — First extension instances

One instance of each kind, each with its tests:
- Adapter: `claude` (the adapter carries domain classification — what was previously the "lens" role)
- Detectors: `frontmatter`, `slash`, `at-directive`
- Rules: `trigger-collision`, `broken-ref`, `superseded`
- Renderer: `ascii`
- Audit: `validate-all`
- Actions: 0 shipped (contract available)

**Acceptance criteria**: adding a 4th detector is a pure drop-in, zero kernel touches. Same for any other kind.

**LLM**: no.

---

### Step 3 — Scan end-to-end

- `sm scan` — orchestrator runs, writes cache.json
- `sm list [--type] [--status] [--sort-by weight.tokens|weight.bytes]` — reads cache
- `sm show <id>` — reads cache (shows weight + dependencies + refs)
- `sm check` — reads cache, lists issues (includes token-budget warnings)
- **Weight measurement** — every node gets `{ bytes, tokens, tokenizer }` computed deterministically offline via `js-tiktoken` (`cl100k_base`, ~90% accurate for Claude). No network, no LLM required.
- **Self-scan test green** (mandatory): skill-map scans its own repo successfully

**LLM**: no.

---

### Step 4 — History + callback

- `sm record` CLI with full signature
- Execution history with `invoked` / `completed` / `failed` / `skipped`
- Orphan detection on scan
- Rename heuristic (similarity of description / triggers / body hash) → `possible-rename` flag
- `sm history [--node] [--action]`
- `sm orphans`

**LLM**: no.

---

### Step 5 — Project config + onboarding

- `.skill-map.json` per-project (include/exclude paths, disable detectors)
- `.skill-mapignore` (gitignore-style)
- `sm init` — scaffolding for new users (config, first scan, friendly output)
- `sm plugins list / enable / disable`

**LLM**: no.

---

### Step 6 — Robustness hardening

- Detector conflict resolution policy (documented rule set)
- `confidence` field: either pinned per-detector algorithm OR pivot to boolean `isExplicit`
- Performance budget: incremental scan, fs-watcher-based (prepares live validation)
- Trigger normalization: case / accents / whitespace / i18n rules
- History GC: TTL or `sm history gc`
- Schema versioning policy + `sm migrate` stub

**LLM**: no.

---

### Step 7 — Diff mode + export

- `sm scan --compare-with <cache.json>` → delta report
- `sm export <query> --format <json|md|mermaid>`
- `sm graph --format ascii`

**LLM**: no.

---

### Step 8 — Plugin author experience

- Drop-in plugin discovery (`~/.skill-map/plugins/*.mjs`, `./skill-map.plugins/*.mjs`)
- `skill-map/testkit` module exported for plugin authors
- Plugin API docs (per-kind reference with examples)
- Plugin signing / hash verification (distribution-grade)
- Error mode: broken plugin shows clear diagnostic

### ▶ CUT LINE 1 — v0.1.0 MVP shippable

Distributable tool that is 100% deterministic, fully tested, extensible, zero LLM. Publishes to npm + mia-marketplace. Useful on its own for auditing skill collections.

---

### Step 9 — LLM layer introduction ⚡ FIRST LLM TOUCH-POINT

**Preceded by a dedicated POC**: LLM layer design has too many variables (model choice, cost model, sync, offline semantics). A short POC explores the real integration before the layer is designed. POC scope and outcomes will populate this step's details.

Confirmed decisions so far:
- `LLMProvider` is an **abstract interface** with multiple backends (Claude API, Claude Code session, mock-for-tests at minimum; Ollama as future plugin).
- **Offline-first principle**: LLM-dependent verbs fail gracefully when no provider configured — tool remains fully usable without LLM.

Deferred to POC:
- Which backends ship in v0.5.0
- Config surface (`.skill-map.json` vs env vars vs CLI flags — likely all three)
- Cost / quota / caching strategy
- First LLM-using verb (likely `sm compare`)

**LLM**: first uses. Optional — tool still works without it.

---

### Step 10 — Semantic enhancements (LLM-powered)

- Trigger clustering ("crear plan" ≈ "armar plan" ≈ "hacer plan")
- Prose mention validation (downgrade false positives, upgrade confirmed references)
- Duplication detection (two nodes that do the same thing with different names)
- `sm why <trigger>` with semantic interpretation
- Natural-language queries over the graph ("qué rompo si borro X")

**LLM**: heavy usage, always optional.

### ▶ CUT LINE 2 — v0.5.0 with LLM shippable

Tool gains semantic intelligence. Distinguishes itself clearly from Obsidian. Still works offline.

---

### Step 11 — Additional renderers

- Mermaid renderer
- DOT / Graphviz renderer
- Subgraph export with filters

**LLM**: no.

---

### Step 12 — Web UI

- Server (Hono — light, fast, ESM-native)
- `sm serve [--port]`
- Frontend: tech TBD (candidate: Svelte or plain HTML + vanilla, avoid React bloat)
- Graph visualization (Cytoscape.js or D3)
- List view (same data)
- Node inspector panel
- Copy-to-clipboard actions (triggers `sm record` on click for `invoked` status)
- Live validation via SSE / websocket push on fs changes
- Template preview (reads via `GET /node/:id/template/:name`)

**LLM**: web UI consumes the same LLM-powered verbs when available.

---

### Step 13 — Distribution polish

- GitHub Actions: release automation, changelog generation
- Documentation site (VitePress or similar — static, no heavy infra)
- `mia-marketplace` entry
- Claude Code plugin wrapper (a skill that invokes `sm` from inside Claude)
- Telemetry opt-in (see which detectors/audits are used in the wild)
- Compatibility matrix (core ↔ plugin API versions)
- Breaking-changes / deprecation policy documented
- `sm doctor` — diagnostics for user installs

### ▶ CUT LINE 3 — v1.0.0 full distributable

Complete product. Plugins ecosystem possible. Web UI + CLI + LLM layer + docs + distribution.

---

## Deferred beyond v1.0

These remain in the roadmap but are explicitly not part of the v1 build path. They land on real demand.

### Step 14+ — Write-back (current Phase 1)
Edit, create, refactor from UI. Git-based undo. Detectors become bidirectional.

### Step 15+ — Test harness (current Phase 2)
Dry-run / real execution / subprocess — scope TBD.

### Step 16+ — Richer workflows (current Phase 3)
Beyond hardcoded audits: Node-pipe API, JSON declarative, visual DAG (unlikely).

### Step 17+ — Additional lenses (current Phase 4)
Obsidian-vault, docs-site, etc.

### Step 18+ — More adapters
Codex, Gemini, Copilot, generic.

### Step 19+ — Template preview improvements
Already partially in Step 12.

### Step 20+ — Schema v2 + migration
When breaking changes on the JSON output become necessary.

---

## Summary: LLM participation

| Steps | LLM usage |
|---|---|
| 0–8 | **None**. Fully deterministic. Tool works end-to-end without any LLM. |
| 9–10 | **Optional**. Adds semantic intelligence. Graceful offline degradation. |
| 11–13 | **Optional, consumed by renderers and UI**. |
| 14+ | Likely expanded (write-back suggestions, auto-fix). |

**Key property**: LLM is **never required**. Users who can't or don't want to use an LLM still get a complete, useful tool through step 8.

---

## Original phase sections (preserved for reference)

The sections below were the initial phase breakdown. Superseded by the "Execution plan" above, kept for traceability of how the plan evolved.

## Phase 0 — MVP (current design target)

Read-only inspector with an AI-first lens.

- Generic MD graph core (nodes, detectors, edges)
- AI-first lens: skills, agents, commands, hooks
- Detectors: `@` directive, Markdown links / slash commands, frontmatter, config files, code refs (imports + Bash/Read paths), trigger collisions, prose mentions
- External dependencies detection: npm, binaries, URLs, env vars, MCP servers
- Node fields: inputs, outputs, templates, external deps (with confidence levels)
- Two views: graph explorer + tabular listing
- Node inspector panel (frontmatter + incoming/outgoing refs + issues)
- Actions on selected node — copy-to-clipboard invocation (Group A, item 1)
- Semantic compare between two nodes (Group A, item 11) — LLM-powered
- Export subgraph (Group A, item 12) — markdown / JSON / mermaid
- Live validation (Group C, item 5) — filesystem watcher + re-scan on change
- Workflow engine — hardcoded audits only (Group C, item 4 — flavor 4)
- Plugin system for actions (register actions that operate on nodes)
- LLM layer consumes JSON (validates `medium`/`low` confidence, clusters equivalent triggers, answers queries)
- **Execution history** — `~/.skill-map/history.json` records when actions are invoked on nodes
  - Status `invoked` when launched from UI (copy-to-clipboard intent)
  - Status `completed` | `failed` | `skipped` when action calls back via `skill-map record` CLI
  - On scan: missing IDs flagged as `orphan` (not deleted — user reconciles)
  - Heuristic rename detection (similarity of description / triggers / body hash) → flagged as `possible-rename` for user confirmation
- **Callback service** — `skill-map record` CLI verb
  - Actions call this after finishing to report status + report + duration
  - Convention-based, not enforced — actions that skip it just keep their `invoked` record
  - Atomic writes (tempfile + rename) for safe concurrent use
  - Upgrades existing `invoked` record within 1h window instead of duplicating
- **Node ID strategy** — relative file path from repo root
  - Survives frontmatter `name` changes; breaks on file move (rare enough)
  - Zero write-back required
  - Migration path: inject UUID into frontmatter in Phase 1 when write-back lands

## Phase 1 — Write-back (deferred)

Move from read-only to interactive editing. Undo via direct Git integration (each change = commit or staged diff, no custom snapshot system).

- Edit from UI — modify frontmatter, rename, move (Group B, item 2)
- Create new nodes from templates (Group B, item 3)
- Refactoring — rename with ref propagation (Group B, item 6)
  - Auto-apply on `confidence: high` refs
  - Prompt for confirmation on `medium` / `low`
  - Never auto-apply on prose mentions
- Dry-run mode — show diff before apply
- Requires detectors to become **bidirectional** (read AND write)

## Phase 2 — Test harness (deferred, scope TBD)

Item 13. Needs definition before design:
- Dry-run mode (show which tools would be invoked)?
- Real execution against Claude API (cost implications)?
- Syntactic validation only?
- Subprocess spawn of `claude -p "..."`?

Decision pending.

## Phase 3 — Richer workflows (deferred)

Once hardcoded audits prove insufficient:
- Node-pipe style: programmatic composition via Node APIs
- JSON declarative workflows (versionable in repo) — **JSON, not YAML**
- Visual DAG (low priority — expensive to build, unclear ROI)

## Phase 4 — Additional lenses (deferred)

The core is platform-agnostic. AI-first lens ships in MVP. Others are extension points:
- Obsidian-vault lens (wikilinks, aliases, daily notes, embeds)
- Docs-site lens (mkdocs / docusaurus / astro detection)
- Other AI platforms not in MVP (Codex, Gemini, Copilot, generic) — adapters exist but implementation comes after Claude adapter is proven

## Phase 5 — Template preview (deferred)

Show the content of templates referenced by a node, not just their paths. Server exposes `GET /node/:id/template/:name`, UI renders markdown/code viewer.

---

## Architecture principle: Kernel + Extensions

The core is deliberately small. Everything a user perceives as a "feature" is an extension registered against a port. Six extension types:

| Extension | Role |
|---|---|
| Detector | Extracts signals from MDs (`@`, slash, wikilinks, tags, frontmatter, etc.) |
| Adapter | Recognizes a platform and defines its domain (claude, codex, gemini, copilot, generic, obsidian-vault). Combines platform detection with domain classification — what some systems split into "adapter + lens" lives here as a single concept. |
| Rule | Produces issues over the graph (trigger collisions, broken refs, etc.) |
| Action | Executable action over a node (skill-optimizer, validator, etc.) |
| Audit | Hardcoded workflow (find-duplicates, audit-orphans, validate-all) |
| Renderer | Serializes the graph (ascii, mermaid, dot, json) |

### Contract

Every extension is a Node ES module exporting a default object with:
- `kind` — one of the 7 types (decides registry bucket)
- `id` — unique within kind
- `version` — semver
- Kind-specific fields (`apply`, `appliesTo`, `invocation`, etc.)

Validation via Zod/JSONSchema — unified across kinds.

### Discovery

- **Built-in**: ship inside `src/extensions/`, loaded always
- **User plugins**: drop-in at `~/.skill-map/plugins/*.mjs` (global) or `./skill-map.plugins/*.mjs` (project)
- **npm packages** (`sm-plugin-*`): deferred — drop-in is enough for MVP

### Isolation

- Per-extension timeout (default 5s)
- Crash → logged, extension marked `disabled`, scan continues
- `sm plugins list` shows real runtime state (ok / disabled / error)

### Kernel boundary

Kernel contains: types, registry, orchestrator, storage, CLI dispatcher.
Kernel does NOT contain: any specific platform knowledge, any specific detector, any validation rule, any action. With all extensions removed, the kernel must still boot and return an empty graph without errors.

## Action contract

Actions are one of the 6 extension kinds. They execute actions over nodes. Two execution modes coexist — both are first-class in the spec.

### Execution modes

| Mode | What runs | Where | Uses LLM? | Example |
|---|---|---|---|---|
| `local` | `execute(node, ctx)` function in the plugin | `sm` process | Optional | `count-tokens`, `validate-frontmatter`, `find-broken-links` |
| `invocation-template` | Emits a templated invocation string for external tools (copy-to-clipboard, hook-triggered) | Claude Code session (or similar) | Depends on target | `/skill-optimizer {name}`, `/create-plan` |

### MVP manifest (minimal)

Fields shipping in MVP. All other fields deferred.

```ts
{
  kind: "action",
  id: "count-tokens",
  version: "1.0.0",
  label: "Count tokens",
  description: "Count tokens in a node using cl100k_base tokenizer",
  appliesTo: ["skill", "agent", "note"],
  execution:
    | { mode: "local" }                                    // plugin exports execute()
    | { mode: "invocation-template", template: "/x {name}" }
}
```

### Full manifest (post-MVP, tracked in roadmap)

Fields designed now but not shipping in MVP. Added when real use cases surface:

- `inputs: Input[]` — arguments the action accepts (name, type, required, validation)
- `reportSchema: string` — path/URL to a JSON Schema describing the output report. When declared, `sm record --report` validates the report against it.
- `sideEffects: "none" | "writes-files" | "network" | "system"` — declared up-front so the user sees what the action will do before running it
- `requiresLLM: boolean` — local actions that want an LLM must declare it (checked against current provider)
- `dryRun: boolean` — whether the action supports a dry-run mode

### CLI integration

- `local` mode: invoked via `sm action run <id> --node <node-id>` (deterministic, fully scriptable)
- `invocation-template` mode: invoked via `sm action invoke <id> --node <node-id>` → prints the rendered template to stdout (or copies to clipboard if `--copy`)
- Both modes always create an entry in `history.json` via internal call to `record`

### Roadmap placement

- MVP (step 2+): minimal manifest, both execution modes, `sm action run/invoke` verbs
- Post-MVP: advanced metadata fields (`inputs`, `reportSchema`, `sideEffects`, `requiresLLM`, `dryRun`)

## Testing strategy (non-negotiable, from day zero)

Robust test suite required from commit 1. Same rigor as the kernel-first principle — tests are part of what ships with the MVP, not a later addition.

### Pyramid

| Layer | What it tests | When it runs |
|---|---|---|
| Contract | Every registered extension conforms to its kind's schema | Each startup + CI |
| Unit | Each detector / rule / adapter / etc. in isolation | CI + dev |
| Integration | Scanner end-to-end over controlled fixtures → expected JSON | CI |
| Self-scan | `sm scan` on skill-map's own repo → snapshot match | CI (mandatory) |
| CLI | Spawn binary, assert stdout / stderr / exit codes | CI |
| Snapshot | Renderers produce byte-exact expected output | CI |

### Framework

`node:test` (built-in, zero deps, Node 20+). Aligns with "minimal dependencies" principle. Migrate to Vitest only if pain emerges.

### Per-extension rule

Every extension in `src/extensions/` must ship a sibling `*.test.mjs`. Missing test → contract check fails → tool does not boot. Forces test-first discipline on contributors.

### Mandatory tests for MVP

1. Contract test for the 6 kinds (validates shape of each registered extension)
2. Self-scan test (tool scans itself, produces valid graph, no critical issues)
3. Adapter conformance (each adapter against a controlled fixture vault)
4. Detector isolation (each detector: MD input → expected edges)
5. Rule isolation (each rule: mini graph → expected issues)
6. JSON schema validation (scanner output validates against `schemaVersion: 1` via Zod)
7. CLI smoke tests (all 4 MVP verbs respond without crash on fixtures)

### Coverage philosophy

Not percentage-driven. Requirements:
- 100% of extensions have ≥ 1 unit test + 1 contract check
- 100% of CLI verbs have ≥ 1 smoke test
- Any reported bug adds a regression test before the fix

### Plugin author testkit (distribution-specific)

Export a `skill-map/testkit` module with helpers so third-party plugin authors can test their plugins against the kernel without stub-wrangling. Obsidian lacks an official plugin testkit — this is a concrete differentiator for distribution.

## Stack conventions (confirmed)

- **Runtime**: Node ESM for everything — CLI, scanner, server, detectors
- **Config format for anything we author**: JSON (workflows, plugin manifests, cache)
- **Config format for anything we parse**: whatever the source uses (YAML for SKILL.md frontmatter, JSON for `plugin.json` / `package.json` / `settings.json`)
- **Shell**: avoided unless unavoidable (only for invoking `git` or similar external CLIs)
- **Language**: TypeScript (strict mode) on Node ESM.
- **Build**: TS → JS via `tsup` or `esbuild`. CLI distributed as compiled JS through npm (`npm i -g sm` / `npx sm`). Single-binary packaging (`node-sea` / `pkg`) is a later optimization, not required for MVP.
- **CLI binary name**: `sm` (short form, primary). `skill-map` kept as long alias (symlink).
- **CLI-first principle**: every feature exposed via CLI. Web UI is a consumer of the same surface — anything UI does must be reachable from CLI.

## Persistence layout

Three separate stores with distinct responsibilities. All live in `~/.skill-map/` by default.

| Store | File | Nature | Writer | Regenerable |
|---|---|---|---|---|
| Plugins registry | `~/.skill-map/plugins.json` | Config | User (install/enable/disable) | No |
| Nodes cache | `~/.skill-map/cache.json` | Derived (last scan) | Scanner (overwrites) | Yes |
| Execution history | `~/.skill-map/history.json` | Append-only log | UI intents + `skill-map record` CLI | No |

- **Plugins** and **history** are source of truth — back these up.
- **Cache** is transient — delete and re-scan.
- **History** path configurable via `--history-path`; if the repo contains `.skill-map/history.json` it takes precedence over the global one (enables team-shared audit history).

## Decision log — deferred items (2026-04-18)

> Consolidated status of items explicitly deferred in the design sessions. These are **not pending decisions** — they are decisions to defer with a clear trigger for revisit.

| # | Item | Status | Trigger to revisit |
|---|---|---|---|
| 13 | Cache strategy (mtime + hash invalidation) | **Approved for MVP** | N/A (implementation-ready) |
| 14 | History GC policy | **Deferred** | When orphan entries become noisy in real use |
| 15 | Plugin security (signing, hash verification) | **Deferred** | Before v1.0 public distribution |
| 16 | Schema migration tooling (`sm migrate`) | **Deferred, no action now** | When `spec v2` is in design |
| 17 | Documentation tool (Astro Starlight) | **Approved, implement at Step 13** | Part of distribution polish |
| 18 | Plugin API reference (JSDoc → Starlight) | **Approved, implement at Step 13** | Part of distribution polish |
| 19 | Publishing workflow (GitHub Actions, conventional commits) | **Deferred** | Before first npm publish |
| 20 | Telemetry opt-in | **Deferred** | After v1.0 if user base justifies it |
| 21 | License (MIT) | **Approved** | N/A |
| 22 | Repo layout — `skill-map/` **standalone repo** (revised decision, 2026-04-18). Own git history, own release cycle, own `mia-marketplace` entry. | **Approved** | N/A |
| 23 | Governance (RFC process) | **Deferred** | When external contributors appear |
| 24 | Domain (`skill-map.dev`) | **Deferred** | Before public launch |
| 25 | Frontend framework (Svelte vs vanilla) | **Deferred to Step 12** | When Web UI design starts |
| 26 | Graph viz library (Cytoscape vs D3) | **Deferred to Step 12** | When Web UI design starts |
| 27 | Styling (Tailwind vs PicoCSS) | **Deferred to Step 12** | When Web UI design starts |
| 28 | Live sync (SSE vs WebSocket) | **Deferred to Step 12** | When Web UI design starts |
| 29 | Logging (pino JSON lines) | **Approved** | Implement at Step 1 (kernel skeleton) |
| 30 | Naming (Node, Action, Audit) | **Approved** | Applied to spec and roadmap |
| 31 | `skill-optimizer` coexistence — kept as Claude Code skill **and** wrapped as `skill-map` Action (invocation-template mode). Dual surface. | **Approved** | N/A |
| 32 | LLM POC timing | **Pending decision** | Revisit 2026-04-19 |

## Open decisions (from design doc §9 + new)

### From design doc
1. Extension mechanism for adapters: drop-in directory vs npm packages vs both → **partially resolved**: drop-in for MVP, npm packages deferred.
2. ~~Rules engine: pluggable from day 1 vs hardcoded then extract~~ → **resolved: pluggable from day 1** (aligns with kernel-first non-negotiable rule).
3. ~~Schema validation: Zod vs JSON Schema vs none~~ → **resolved: JSON Schema is source of truth in `spec/`, Zod types derived in impl, distributed via `@skill-map/spec`.**
4. ~~TypeScript vs JS + JSDoc~~ → **resolved: TypeScript strict + Node ESM, built with `tsup`/`esbuild`**
5. Cache strategy: persist last scan in `~/.skill-map/cache.json`
6. ~~CLI verbs — confirm the list~~ → **resolved for MVP: 4 verbs (scan, list, show, check)** confirmed. Rest added in later steps per execution plan.
7. ~~First-sprint adapter scope~~ → **resolved: `claude` only** in MVP.

### New
8. ~~Actions plugin format — need to define the contract~~ → **partially resolved**: actions execute code locally (option A). MVP ships minimal manifest (kind, id, version, label, description, appliesTo, execution mode). Advanced metadata fields (`reportSchema`, `inputs`, `sideEffects`) designed now but deferred to post-MVP — see "Action contract" section below.
9. ~~Workflow audit list~~ → **resolved: only `validate-all` in MVP**. `find-duplicates`, `audit-orphans`, etc. added post-MVP per real usage.
10. Browser ↔ execution bridge — copy-to-clipboard confirmed for MVP. Bridge / MCP / shell-spawn deferred.
11. Node ID confirmed as relative file path from repo root (not UUID in frontmatter) for MVP.
12. `skill-map record` CLI signature — confirm flags (`--node`, `--action`, `--status`, `--note`, `--report`, `--duration-ms`) and exit codes.

---

## Critiques and gaps raised (unordered — to be prioritized)

> Captured from internal design review. Not all action items — some are risks to watch, others are additions. Order and phase assignment TBD.

### Critical — require decision before building

- **Scope creep risk** — started as "script", became "platform" fast. Need explicit MVP floor so it ships. Candidate MVP floor listed in §"Proposed MVP floor" below.
- **Obsidian differentiation** — moat must be explicit. Proposed framing: "Obsidian for AI agents, not for notes". Differentiators: CLI-first, headless-capable, AI-semantic layer, executable actions. Other 5 features from earlier list are covered by Obsidian plugins (DataView, Templater, Graph View with filters) — don't compete on those.
- **AI-first lens is fuzzy** — define explicitly what the lens does that the generic core doesn't. If it's only "recognize SKILL.md patterns", it's trivial and could merge with core.
- **LLM layer is under-specified** — open questions: which model (Claude Code session / API / local)? Cost model for semantic compare? Offline behavior? Sync strategy with the graph?

### Design gaps — solvable but undesigned

- ~~7 extension kinds may be premature generality~~ → **resolved**: kept as 6 (lens merged into adapter). All 6 ship in the kernel from day zero per the non-negotiable kernel-first rule.
- ~~`confidence` field has no defined algorithm~~ → **resolved**: 3 levels (`high` / `medium` / `low`) kept. Each detector declares explicitly in its spec documentation which level it produces and under which condition (e.g., `frontmatter` → always `high`; `prose-mention` → `medium` on exact name match, `low` on fuzzy match). No cross-detector subjectivity: each detector is accountable for its own rule, documented in `spec/detectors/<id>.md`.
- ~~Detector conflict resolution undefined~~ → **resolved**: edge identity is `(from, to)` tuple. Merge preserves all sources in `sources[]` — nothing is lost. Kind conflicts resolve via strength ordering (`invokes > references > mentions`); primary `kind` is the strongest source's kind, all sources retain their original kind for auditability.
- ~~Performance not designed~~ → **resolved for MVP**: parallel file read (bounded concurrency) + mtime-based cache. Target budget: **500 MDs in ≤ 2s** on a modern laptop, enforced by a CI benchmark over a fixed fixture. Incremental scan via `chokidar` added at step 6 (robustness). Worker threads and indexing deferred until evidence of bottleneck.
- **History GC policy missing** — `orphan` entries accumulate if user ignores prompts. Needs TTL, auto-delete, or at minimum `sm history gc`.
- **Plugin security model undefined** — `.mjs` drop-ins are executable code with FS access. Local tool = "trust the user" is acceptable but must be stated. For distribution: consider signing / hash verification for published plugins.
- ~~Case / i18n in triggers~~ → **resolved**: normalization pipeline = NFD → strip diacritics → lowercase → hyphen/underscore → space → collapse whitespace → trim. Edges keep `originalTrigger` for display and `normalizedTrigger` for matching. Based on observed minions conventions (Spanish/English mixed, casual accents dropped, hyphen ≈ space). Note: in observed real-world usage, triggers are embedded as prose inside `description` (`Triggers: "x", "y"`) rather than a dedicated YAML field — adapters parse that prose into a structured field.
- **Schema versioning migration** — `schemaVersion: 1` is set but no migration path. `sm migrate <from> <to>` needed once v2 ships.

### Additions proposed

- **Self-scan test** — `sm scan` on skill-map's own repo is a mandatory integration test. If it can't scan itself, something is wrong.
- **Project-level config** — `.skill-map.json` at repo root to override: include/exclude paths, disable detectors, adapter selection, etc. Without this, same repo scanned by different contributors yields different graphs.
- **`.skill-mapignore`** — gitignore-style exclusions for `node_modules/`, `build/`, `dist/`, drafts.
- **Scan diff mode** — `sm scan --compare-with cache.json` reports what changed since last scan. Not full history (discarded), just delta since last run.
- **Claude Code hook auto-record** — a PostToolUse hook that auto-calls `sm record` after a action completes. Resolves the "convention not enforcement" gap for the 80% case (Claude Code users).
- **`sm init`** — scaffold command: creates `.skill-map.json`, runs first scan, prints listing. Critical for onboarding new users (required for distribution).
- **Telemetry (opt-in)** — for distribution: know which detectors / audits are used. Informs roadmap.

### Distribution-specific (new implications)

- **Versioning policy** — semver for CLI, separate schemaVersion for JSON output, compat matrix between plugin API and core.
- **Breaking-changes policy** — deprecation path for extension contracts.
- **Onboarding docs** — README, quickstart, plugin-author guide.
- **Plugin API reference** — contract for each of the 7 (or 3) extension kinds with examples.
- **Publishing path** — npm package, `mia-marketplace` entry, GitHub releases.

## Proposed MVP floor (not locked)

**Non-negotiable**: kernel-first from day zero. All 6 extension kinds exist as first-class citizens in the kernel from commit 1. The kernel never contains platform-specific, detector-specific, or rule-specific logic — only registries and orchestration. "MVP" means fewer *instances* of extensions shipped, not fewer kinds supported.

For building something shippable in weeks, not months:

1. `sm scan`, `sm list`, `sm show`, `sm check` (4 CLI verbs)
2. **All 6 extension kinds wired in the kernel** (Detector, Adapter, Rule, Action, Audit, Renderer)
3. Instances shipped at MVP:
   - 1 Adapter: `claude` (includes domain classification, what was previously "lens")
   - 3 Detectors: `frontmatter`, `slash`, `at-directive`
   - 3 Rules: `trigger-collision`, `broken-ref`, `superseded`
   - 0 Actions (MVP doesn't ship any; contract available for third parties)
   - 1 Audit: `validate-all`
   - 1 Renderer: `ascii`
4. JSON output with `schemaVersion: 1`
5. History + `sm record` CLI
6. **No web UI. No LLM layer. No workflows beyond audits.**

Adding a second adapter / detector / rule / etc. = drop-in file, zero kernel changes. This is the litmus test for correct kernel-first design.

Everything else lives in the roadmap below with clear triggers ("when MVP pain X surfaces, add Y").

## Discarded (explicitly rejected)

Not planned for any phase.

- **Cursor support** — excluded by user
- **Remote scope** (scanning GitHub repos, etc.) — local only
- **Diff / history** of graph across commits (item 7)
- **Sync with live systems** — detecting what is enabled vs on disk (item 8)
- **Query language** — arbitrary queries over the graph (item 9)
- **Metrics / usage tracking** — invocation counts, logs (item 10)
- **MCP server as the primary interface** — excessive infra for a local tool
- **Hook-based activation** — this is manual inspection, not automatic
- **Python** — Node ESM preferred for unification with future web server
- **`br` / beads task tracking** — experimental project, no formal tracking
- **Custom snapshot system for undo** — use Git directly when write-back lands
