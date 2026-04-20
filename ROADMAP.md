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

## Session log — 2026-04-19 (architecture shift, pending integration)

> Captures decisions and open gaps from the 2026-04-19 design session.
> Sections further below ("Execution plan", "Persistence layout", "Architecture principle: Kernel + Extensions", "Stack conventions", "Decision log", "Open decisions") reflect pre-session design and are **partially superseded**. Full integration happens in the next session once the open gaps close.

### Topic explored

"How does the LLM layer actually get wired into the tool?" Three options surfaced and were discarded in sequence:

1. `LLMProvider` abstract interface inside `sm` with multiple backends (roadmap's original Phase B).
2. Skill pack invoked by the user's own agent session.
3. `claude -p` subprocess as the execution substrate.

The conversation converged on a fourth shape that subsumes (2) and (3): **materialized intent via dispatch files + filesystem queue**.

### Core shift — "Dispatch subsystem" replaces "LLM layer"

Phase B (Steps 9–10) of the existing roadmap collapses into a single subsystem:

1. **Dispatch file** (materialized intent). Each action invocation produces a self-contained MD file: prompt rendered with node content + JSON Schema for expected output + callback instruction. The file IS the atomic unit of execution, independent of who triggered it.
2. **Filesystem maildir** as queue. `.skill-map/dispatch/{queued, running, completed, failed}/*.md`. State transitions are atomic file renames (no locks, no leases, no DB for the queue primitive).
3. **Runners are plural, not singular**:
   - `/skill-map:run-queue` skill inside an agent host (interactive, Claude Code and friends).
   - `sm dispatch run-queue [--max N]` CLI (headless, CI, cron).
   - Both subprocess `claude -p < dispatch.md` per item **by default** — preserves context-free isolation between dispatches. `--in-session` opt-in exists for users who accept the trade-off.
4. **Callback via `sm record`**. The final instruction in every dispatch MD. Writes execution result (status, tokens, duration, report path) to DB.
5. **`sm` never touches an LLM**. Pure template rendering on the write side; LLM only materializes when a runner executes a dispatch. The `sm` binary has zero LLM dependencies, zero API keys, zero billing implications. Offline-first becomes structural, not aspirational.

### Why this shape wins

Resolves multiple deferred items simultaneously:

- **Decision #10 (browser ↔ execution bridge)** — resolved by dispatch MD + user invocation.
- **Decision #15 (plugin security)** — resolved by audit-first: plugin renders MD, user reviews before running. Plugin's attack surface is bounded to "can render misleading prompts", inspectable by a human.
- **Action `invocation-template` mode** — becomes the canonical mode; stdout-to-file is now how it works.
- **Callback contract** — baked into every dispatch, not a separate feature.
- **Decision #32 (LLM POC timing)** — resolved: POC validates dispatch subsystem, not `LLMProvider`.

Additional wins that were not visible in the original roadmap:

- **Prompt versioning**: `diff dispatch-old.md dispatch-new.md` shows exactly what changed in a prompt over time. `git blame` for prompts.
- **Caching by hash**: hash(dispatch MD) = cache key. Same dispatch + same model = cached report. Zero extra schema.
- **Evals as diff-against-snapshot**: no framework, just replay dispatches across models and compare reports.
- **Agent-agnostic**: same MD works in Claude Code, Codex, Cursor, Gemini, ChatGPT. Writing a standard, not an integration.
- **Click-first-run-later UX**: UI queues many, user drains when ready; CI is just another runner of the same queue.
- **Team inbox**: dispatch folder can be committed; one person enqueues, another runs, reports close the loop.

### Persistence shift — SQLite from Step 1

Three JSON files (`plugins.json`, `cache.json`, `history.json`) replaced by a single SQLite DB per scope. Schema split into three semantic zones:

| Prefix | Nature | Regenerable? | Example tables |
|---|---|---|---|
| `scan_*` | Last scan result | **Yes** — `sm scan` truncates and repopulates | `scan_nodes`, `scan_edges`, `scan_issues` |
| `state_*` | Non-regenerable operational history | **No** — must back up | `state_dispatches`, `state_executions`, `state_token_ledger`, `state_plugin_kv` |
| `config_*` | User-owned configuration | **No** | `config_plugins` (installed/enabled), `config_preferences` |

This split gives "nuke and re-scan" safety for `scan_*` and a clear backup target (`state_*` + `config_*` only).

### Global vs project scope (clarified)

`-g` is **not** a toggle between two DBs — it is the scope of what the tool **scans**:

- **Default (no `-g`)**: scans the current project (SKILL.md files, agents, CLAUDE.md, etc. under cwd). Writes to `<repo>/.skill-map/skill-map.db`. This DB may be committed by the team for shared audit history.
- **`-g`**: scans global artifacts (`~/.claude/`, user's global skill installs). Writes to `~/.skill-map/skill-map.db`. Project files are not touched.

Two independent scopes, symmetric. Each scope has its own DB file. No cross-contamination.

### Kernel-as-library architecture

The CLI and the future Web UI are **peer consumers** of a shared kernel library, not one depending on the other. Package layout (monorepo, **single package with internal modules** — see open gaps):

```
skill-map/                   ← single npm package
├── src/
│   ├── kernel/              ← Registry, Orchestrator, Storage, Plugin loader, Dispatch.
│   │                         Zero CLI, zero HTTP. Pure programmatic API.
│   ├── cli/                 ← Thin wrapper: verb → kernel.call() → stdout.
│   ├── server/              ← Hono + SSE. Wrapper: HTTP → kernel.call() → response.
│   └── testkit/             ← Kernel mocks for plugin authors.
├── bin/sm.mjs               ← CLI entry, imports from dist/cli.
└── package.json
    {
      "engines": { "node": ">=22.5" },
      "main": "./dist/index.js",
      "bin": { "sm": "./bin/sm.mjs" },
      "exports": {
        ".": "./dist/index.js",
        "./kernel": "./dist/kernel/index.js",
        "./server": "./dist/server/index.js",
        "./testkit": "./dist/testkit/index.js"
      }
    }
```

Plugins import `import { registerDetector } from 'skill-map/kernel'` — not via CLI spawn. UI consumes server, server consumes kernel, CLI consumes kernel. CLI-first principle reinterprets as: CLI and UI are peers over the same kernel API.

Split to real `@skill-map/*` workspaces deferred until a concrete need appears (third-party kernel consumer on a different release cadence than CLI).

### Deterministic vs probabilistic refresh

Two refresh modes per node, each with its own UI button and CLI verb:

1. **Deterministic refresh** — re-scan this node. Recomputes bytes, tokens, frontmatter hash, body hash, outgoing edges. Synchronous, no LLM, cheap. `sm rescan --node X`.
2. **Probabilistic refresh** — enqueue a dispatch for an LLM-backed action (validate / cluster-triggers / semantic-check). Asynchronous. `sm dispatch <action> --node X`.

Two buttons, two pipelines, same spine.

### Decisions confirmed this session

| # | Item | Resolution |
|---|---|---|
| 33 | Node runtime | **Node 22.5+ required** (uses `node:sqlite` stable). Declared in `engines`. |
| 34 | DB engine | **SQLite via `node:sqlite`** — zero native dependencies. |
| 35 | Plugin storage | **Generic KV API** (option B). Plugins receive `ctx.store.{get,set,list,delete}` scoped to their `plugin_id`. Never see SQL. Backed by single kernel-owned table `state_plugin_kv(plugin_id, node_id, key, value, updated_at)`. |
| 36 | DB scope | **Two independent DBs**, one per scan scope. `-g` selects global scope (scans `~/.claude/`, writes `~/.skill-map/skill-map.db`). Default is project scope. |
| 37 | UI data path | **UI → server → kernel → DB**. UI never touches DB directly. Mirrors CLI path (`CLI → kernel → DB`, in-process). |
| 38 | LLM integration model | **Dispatch subsystem** (materialized intent + maildir queue). Supersedes original Phase B / Step 9 design. |
| 39 | `sm` LLM dependency | **Zero**. `sm` is pure deterministic rendering + DB + filesystem. LLM lives exclusively in the runner process. |
| 40 | Architecture shape | **Kernel-as-library**; CLI, Server, (future UI) are thin wrappers. |
| 41 | Refresh semantics | **Two types** (deterministic / probabilistic), separate UI actions, separate CLI verbs. |
| 42 | Package layout | **Single package with internal modules + multiple `exports`** for MVP. Workspaces deferred until justified by external consumers. |
| 43 | Runner isolation default | **Subprocess-per-item** (`claude -p < dispatch.md`) is default; `--in-session` is opt-in. Preserves context-free property. |

### Open gaps (to close before next roadmap revision)

- **Default probabilistic-refresh action per node**: adapter-registered `defaultRefreshAction`, UI dropdown, or "re-run last action" convention. Unresolved.
- **Report schema enforcement**: `reportSchema` field on actions (previously deferred post-MVP) becomes load-bearing in dispatch. Needs spec'ing before Step 9.
- **Dispatch authentication**: `sm record --dispatch-id X` should require a nonce to prevent forged callback closing someone else's pending dispatch. Contract undesigned.
- **Concurrent dispatch on same (action, node) pair**: lock policy? Accept both, serialize, refuse second, idempotent by hash? Unresolved.
- **Abandoned dispatch reap**: TTL on `running/` items + auto-reap on `run-queue` or manual `sm dispatch reap`. Frontmatter fields (`runner-pid`, `claimed-at`, `lease-ttl`) needed.
- **Prompt injection mitigation**: node content interpolated into dispatch MD can contain injection payloads. Delimiter convention (XML tags) + preamble rule must be a spec'd requirement for all action templates.
- **Tool permissions declared per dispatch**: frontmatter `expected-tools: [Bash, Read, Write]` so host can filter or warn. Shape undefined.
- **Streaming output from runner**: `claude -p --stream` passthrough vs buffered end-of-run. Design needed for interactive CLI ergonomics.
- **Conversational verbs** (e.g., `sm why` with follow-ups): don't fit single-turn dispatch cleanly. Accept limitation or design workaround (session-hand-off pattern)?
- **Atomicity between maildir rename and DB row update**: the two must be a logical transaction. Ordering needs design so partial failure is recoverable in either direction.
- **DB backup / corruption policy**: `sm db backup`, `sm db restore`, `PRAGMA integrity_check` invocation cadence, `sm doctor` integration — undesigned.
- **Migration tooling**: was deferred Step 6, now load-bearing Step 1 (every schema change ships a migration). `sm migrate --apply | --dry-run | --to <n>` surface needs spec.
- **DB schema versioning in spec**: `db-schema.md` joins the spec artifacts.

### Sections below that require revision in the next session

- **Execution plan**: Step 1 gains SQLite + migrations + kernel/CLI/server package split. Step 4 (history + callback) mostly absorbed into dispatch. Step 9 renamed to "Dispatch subsystem + first action template"; scope reduced (most of the complexity moved into MVP).
- **Persistence layout**: rewritten to SQLite two-scope model, scan/state/config table split.
- **Architecture principle: Kernel + Extensions**: expanded to reflect kernel-as-library and package structure.
- **Stack conventions**: Node 22.5+ pinned, `node:sqlite` added, package layout documented.
- **Spec as a standard**: new artifacts — `dispatch.schema.json`, `db-schema.md`, `plugin-kv-api.md`, `dispatch-lifecycle.md`.
- **Decision log**: #10, #15, #16, #32 resolved; #7 (diff mode) and #12 (live validation) unchanged; numbered decisions 33–43 above to be merged into the main table.
- **Open decisions**: items resolved above moved to the decision log; new gaps (list above) added.

---

## Session log — 2026-04-19 (part 2 — vocabulary, commands, hexagonal, runner model)

> Continuation of part 1. Refines terminology, freezes the MVP command surface, names the architectural pattern explicitly, corrects the runner design, and closes several part-1 open gaps.

### Terminology finalized

| Old name | New name | Rationale |
|---|---|---|
| `edge` | **`link`** | Domain-natural (MDs already have "links"). `edge` is graph-theory jargon. Tables: `scan_links`. |
| `dispatch` | **`job`** | Queue-standard naming. Tables: `state_jobs`. Artifact: "job file". |
| `sm rescan` | **absorbed into `sm scan`** | Single verb with filters (`-n`, `--changed`, `--compare-with`). Smaller surface. |

Project name **`skill-map`** kept (discarded `skill-manager` — evokes package manager; discarded `skillctl` — too dev-flavored). Binary remains **`sm`**.

### Named architecture: Hexagonal (Ports & Adapters)

```
                    Driving adapters (primary)
                         │
   ┌─────────┐       ┌─────────┐       ┌──────┐
   │   CLI   │       │ Server  │       │Skill │
   └────┬────┘       └────┬────┘       └───┬──┘
        │                 │                │
        └─────────────────┼────────────────┘
                          ▼
                   ┌──────────────┐
                   │    Kernel    │  ← domain core (pure use cases)
                   └──┬───┬───┬───┘
                      │   │   │
        ┌─────────────┘   │   └──────────────┐
        ▼                 ▼                  ▼
   ┌────────┐        ┌─────────┐        ┌─────────┐
   │ SQLite │        │   FS    │        │ Plugins │
   └────────┘        └─────────┘        └─────────┘
                Driven adapters (secondary)
```

- Kernel accepts **ports** (interfaces) for Storage, FS, PluginLoader, Runner — never imports SQLite/fs/subprocess directly.
- Each adapter swappable: `InMemoryStore` for tests, real SQLite in production; `MockRunner` for tests, real `claude -p` subprocess in production.
- Testing pyramid collapses: unit tests hit kernel with injected mocks; integration tests use real adapters.
- Documented canonically at `spec/architecture.md`.

### Runner model (corrected — supersedes decision #43)

Part 1 proposed subprocess-per-item as universal default. Revised:

| Runner | Execution engine | Context | Use case |
|---|---|---|---|
| **CLI** (`sm job run`) | `claude -p < jobfile.md` subprocess per item | isolated (context-free) | batch, CI, cron, many jobs |
| **Skill** (`/skill-map:run-queue`) | agent executes in-session using its own LLM + tools | in-session, context bleeds between items | interactive, few jobs, user wants to see reasoning |

Both runners share CLI primitives. Skill orchestrates via bash: `sm job claim` → `Read jobfile.md` → agent reasons → `Write report.json` → `sm record ...`. **No `claude -p` from the skill path.** Claim is atomic via SQL `UPDATE ... RETURNING id`.

New CLI verb: **`sm job claim [--filter <action>]`** — returns next queued job's id on stdout, exits non-zero if empty.

### Plugin layout (physical, drop-in)

```
<scope-root>/.skill-map/plugins/
├── my-cluster-plugin/
│   ├── plugin.json              ← manifest
│   └── extensions/
│       ├── cluster.action.mjs
│       └── cluster.detector.mjs
└── validate-plugin/
    └── plugin.json + extensions/...
```

Manifest:
```json
{
  "id": "my-cluster-plugin",
  "version": "1.0.0",
  "spec-compat": ">=1.0.0 <2.0.0",
  "extensions": [
    "extensions/cluster.action.mjs",
    "extensions/cluster.detector.mjs"
  ]
}
```

On boot / `sm plugins list`, kernel walks `<scope>/.skill-map/plugins/*` and `~/.skill-map/plugins/*`, runs `semver.satisfies(specVersion, plugin['spec-compat'])`. If compat OK, dynamic-imports extensions, validates against kind schema, registers. If compat fails, plugin marked `disabled` with reason `incompatible-spec`.

**No `sm plugins add` / `sm plugins remove` for MVP.** User drops files and they appear. `disable` (persisted in `config_plugins`) covers "don't use now" without deleting code.

### Orphan reconciliation by hash

Deterministic rule (MVP):
- New node with `body_hash` matching an orphan → **high** confidence rename.
- Only `frontmatter_hash` match → **medium**.
- Semantic match on description/triggers → **deferred** post-MVP (needs LLM layer).

Surface: `sm orphans reconcile <orphan-id> --to <new-id>` — migrates history rows, clears orphan.

### Config merging

Three-level precedence (lowest → highest):

1. **Library defaults** — `src/config/defaults.json` bundled in library.
2. **User config** — `.skill-map.json` (project) or `~/.skill-map/config.json` (global).
3. **Env vars / CLI flags** — point-in-time overrides.

Effective config = deep merge. User config can be partial (only overrides). Validation via JSON Schema in `spec/schemas/project-config.schema.json`.

Surface: `sm config list | get <k> | set <k> <v> | reset <k> | show <k> --source`. `show --source` reveals origin (default / project / global / env / flag).

### Introspection as first-class property

The CLI is self-describing. Every verb has structured metadata (description, flags, types, examples) exposed programmatically:

```console
$ sm help                     human-readable, all verbs
$ sm help <verb>              detail of a verb
$ sm help --format json       structured dump of the full surface
$ sm help --format md         canonical markdown for docs/cli-reference.md
```

Consumers of the JSON introspection:
- **Markdown generator** → `docs/cli-reference.md` (CI-enforced sync).
- **Shell completion** (bash / zsh / fish).
- **Web UI** — form generation for invoking commands.
- **IDE extensions** — autocomplete.
- **Test harness** — asserts every flag has a smoke test.
- **Agent integration** — the `sm-cli` skill feeds the JSON to the agent so it invokes `sm` precisely, without prompt drift.

Framework pick (pragmatic, not frozen): **Clipanion** — introspection built-in, strict types, used by Yarn Berry.

### Scan unification

`sm scan` is the only scan verb:

| Filter | Behavior |
|---|---|
| (no flag) | full scan — truncates `scan_*`, repopulates |
| `-n <id>` | partial scan of one node — updates row + outgoing links |
| `--changed` | incremental — only files with `mtime > last_scanned_at` |
| `--compare-with <path>` | delta mode — compares against exported scan, prints diff |

### Tokens & bytes (triple-split per node)

| Column | Value |
|---|---|
| `bytes_frontmatter`, `bytes_body`, `bytes_total` | Raw sizes |
| `tokens_frontmatter`, `tokens_body`, `tokens_total` | `js-tiktoken` with encoder in `tokenizer` column (default `cl100k_base`) |

`sm show` renders all six tabulated. Useful to identify heavy-frontmatter nodes.

### Nonce clarification

The nonce lives in the **generated job file** (`.skill-map/jobs/<id>.md`), NOT in any user file. User's SKILL.md, agents, commands, CLAUDE.md, etc., are **read-only** from sm's perspective. sm never writes back to them in MVP. Decision #11 (Node ID = relative path, no UUID injection) stands.

### Job lifecycle without maildir (supersedes decision #54 of part 1)

State lives in DB (`state_jobs.status`). The MD at `.skill-map/jobs/<id>.md` is content only; no folder-per-state.

Atomic claim:
```sql
UPDATE state_jobs
SET status='running', claimed_by=?, claimed_at=?
WHERE id = (SELECT id FROM state_jobs WHERE status='queued'
            ORDER BY priority DESC, created_at ASC LIMIT 1)
  AND status='queued'
RETURNING id;
```

Lifecycle: `queued → running → completed | failed`. Abandoned `running` items (runner died) auto-reaped at start of next `sm job run` based on TTL.

### Full command surface (MVP-frozen)

**Setup & state**

| Command | Purpose |
|---|---|
| `sm init` | Bootstrap scope (`.skill-map/`, DB, first scan). |
| `sm version` | CLI / kernel / spec / DB schema versions. |
| `sm doctor` | DB integrity, pending migrations, orphan files, plugins in error. |
| `sm help [<verb>] [--format human\|md\|json]` | Self-describing introspection. |

**Config**

| Command | Purpose |
|---|---|
| `sm config list` | Effective config. |
| `sm config get <key>` | Single value. |
| `sm config set <key> <value>` | Write to user config (scope-aware). |
| `sm config reset <key>` | Remove override, revert to default. |
| `sm config show <key> --source` | Origin of each value. |

**Scan**

| Command | Purpose |
|---|---|
| `sm scan` | Full scan. |
| `sm scan -n <id>` | Partial (one node). |
| `sm scan --changed` | Incremental (mtime-based). |
| `sm scan --compare-with <path>` | Delta report. |

**Browse**

| Command | Purpose |
|---|---|
| `sm list [--type <kind>] [--issue] [--sort-by ...] [--limit N]` | Tabular listing. |
| `sm show <id>` | Node detail: weight, frontmatter, links in/out, issues, stats. |
| `sm check` | All current issues. |
| `sm graph [--format ascii\|mermaid\|dot]` | Graph render. |
| `sm export <query> --format json\|md\|mermaid` | Filtered export. |
| `sm orphans` | History rows whose node no longer exists. |
| `sm orphans reconcile <orphan-id> --to <new-id>` | Migrate history after rename. |

**Actions**

| Command | Purpose |
|---|---|
| `sm actions list` | Registered action types. |
| `sm actions show <id>` | Action manifest detail. |

**Jobs**

| Command | Purpose |
|---|---|
| `sm job submit <action> -n <id>` | Enqueue (or run inline for `local` mode). |
| `sm job submit <action> -n <id> --run` | Submit + spawn subprocess immediately. |
| `sm job list [--status ...]` | List jobs. |
| `sm job show <id>` | Detail. |
| `sm job preview <id>` | Render the MD (no execution). |
| `sm job claim [--filter <action>]` | **Primitive**. Atomic claim of next queued. |
| `sm job run` | CLI runner: claim + spawn + record. One job. |
| `sm job run --all` | Drain queue. |
| `sm job run --max N` | Up to N jobs. |
| `sm job status [<id>]` | Counts or single-job status. |
| `sm job cancel <id>` | Force to `failed`. |
| `sm job prune` | GC completed/failed per retention policy. |

(Removed: `sm job reap` — auto-reap on `run`.)

**Record (callback)**

| Command | Purpose |
|---|---|
| `sm record --id <id> --nonce <n> --status completed --report <path> --tokens-in N --tokens-out N --duration-ms N --model <name>` | Success close. |
| `sm record --id <id> --nonce <n> --status failed --error "..."` | Failure close. |

**History**

| Command | Purpose |
|---|---|
| `sm history [-n <id>] [--action <id>] [--status ...] [--since <date>]` | Executions log. |
| `sm history stats` | Aggregates (tokens per action, per month, top nodes). |

**Plugins (drop-in only)**

| Command | Purpose |
|---|---|
| `sm plugins list` | Auto-discovered from folders. |
| `sm plugins show <id>` | Manifest + compat status. |
| `sm plugins enable <id>` | Toggle on (persisted). |
| `sm plugins disable <id>` | Toggle off (code remains, not loaded). |
| `sm plugins doctor` | Revalidate spec-compat. |

(Removed: `sm plugins add`, `sm plugins remove`.)

**Audits**

| Command | Purpose |
|---|---|
| `sm audit list` | Registered audits. |
| `sm audit run <id>` | Execute, print report. |

**Database**

| Command | Purpose |
|---|---|
| `sm db reset` | Drop `scan_*` + `state_*`, keep `config_*`. |
| `sm db reset --hard` | Delete DB file. Keep plugins folder. |
| `sm db backup [--out <path>]` | WAL checkpoint + copy. |
| `sm db restore <path>` | Swap DB. |
| `sm db shell` | Interactive sqlite3 session. |
| `sm db dump [--tables ...]` | SQL dump. |
| `sm db migrate [--to <n>\|--dry-run]` | Schema migrations. |

(Removed: `sm db reset --nuke`.)

**Server**

| Command | Purpose |
|---|---|
| `sm serve [--port N] [--host ...] [--no-open]` | Hono server for Web UI. |

**Global flags**: `-g` scope · `--json` output · `-v`/`-q` · `--no-color` · `-h`/`--help` · `--db <path>` (escape hatch).

### Decisions confirmed this part

| # | Item | Resolution |
|---|---|---|
| 44 | Naming: `edge` → `link`, `dispatch` → `job`, `rescan` → `scan -n` | Adopted. |
| 45 | Project name | **`skill-map`** confirmed. Binary `sm`. |
| 46 | Architecture pattern | **Hexagonal (ports & adapters)** named in spec + docs. |
| 47 | Runner model | **Dual**: CLI subprocess-per-item, Skill in-session. Supersedes #43. |
| 48 | `sm job claim` | New primitive, atomic via `UPDATE ... RETURNING id`. |
| 49 | Plugin installation | **Drop-in directory only** for MVP. No `add`/`remove`. |
| 50 | Tool permissions per job | Frontmatter `expected-tools: []`. |
| 51 | Nonce location | **Generated job file only**. User MDs never written. |
| 52 | Orphan reconciliation | `body_hash` high, `frontmatter_hash` medium, semantic deferred. |
| 53 | Token + byte tracking | Triple-split (frontmatter / body / total). |
| 54 | Maildir dropped | Single flat `.skill-map/jobs/` folder; state in DB. Supersedes part 1. |
| 55 | Reap | **Auto** on `sm job run`. TTL default 1h, configurable. |
| 56 | `sm db reset --nuke` | **Dropped**. Soft + `--hard` remain. |
| 57 | Config merging | Library defaults + user partial overrides, deep merge, `--source` lookup. |
| 58 | Introspection | `sm help --format json` spec'd. Framework: Clipanion (pragmatic pick). |
| 59 | CLI reference doc | Auto-generated via `sm help --format md`. CI-enforced sync. `docs/cli-reference.md`. |
| 60 | `sm-cli` skill | Ships with tool. Feeds introspection JSON to the agent. |
| 61 | Post-MVP in roadmap | Everything stays documented; MVP is a cut-line marker, not a delete marker. |

### Gap resolutions (post part 2)

| # | Gap | Resolution |
|---|---|---|
| 62 | Concurrency on same (action, node) | **Refuse duplicates with `--force` override**. On submit, check `state_jobs` for same `(action_id, action_version, node_id, content_hash)` in status `queued\|running`. If exists, error with existing job-id and exit code 3. `sm job submit ... --force` bypasses. Post-completion: no check, re-submit always allowed. `content_hash = sha256(action_id + action_version + node_body_hash + node_frontmatter_hash + prompt_template_hash)`. Exit code convention: 0 ok, 1 issues, 2 error, 3 duplicate-conflict. |
| 63 | Streaming output from `sm job run` | **Three modes with single emitter** (hexagonal). Runner emits to `ProgressEmitter` port; three adapters: **pretty** (default TTY, line-progress, colored), **`--stream-output`** (pretty + model tokens inline, debug), **`--json`** (ndjson canonical events). `sm serve` re-emits same events via **WebSocket** (see #69). Canonical event list: `run.started`, `run.reap.started`, `run.reap.completed`, `job.claimed`, `job.skipped`, `job.spawning`, `model.delta`, `job.callback.received`, `job.completed`, `job.failed`, `run.summary`. Spec'd at `spec/job-events.md`. **Task UI integration** (Claude Code's TaskCreate, Cursor equivalent) lives as host-specific **skill**, NOT as CLI output mode — preserves hexagonal boundary. Ships: `skills/sm-cli-run-queue/SKILL.md` (Claude Code target) for MVP. Other host variants post-MVP. MVP runs jobs sequentially; parallel execution post-MVP (event schema already carries `id` for future demux). |
| 64 | Conversational verbs | **Option D — CLI one-shot + skill wrapper**. CLI verbs are atomic, structured, LLM-backed, single-turn (`sm what <query>`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of <node>`, `sm recommend-optimization`). Each emits `--json` with a schema declared by its action. Conversation lives in a single meta-skill: **`/skill-map:explore`** — user describes what they want in natural language; skill picks which `sm ... --json` calls to make, synthesizes, handles follow-ups, can chain multiple verbs in one conversation. No multi-turn jobs in kernel. MVP ambitious: all 5 CLI verbs + `/skill-map:explore` ship. Per-verb skills (`explore-what`, etc.) discarded in favor of a single meta-skill. |
| 65 | Default prob-refresh action per node kind | **Resolved via summarizer pattern**. Each node-kind has a default Action registered by the adapter: `skill-summarizer` for `kind: skill`, `agent-summarizer`, `command-summarizer`, `hook-summarizer`, `note-summarizer`. Adapter declares `defaultRefreshAction` per kind it registers. UI's "🧠 prob" button submits the default summarizer for that node's kind. |
| 66 | Summarizer pattern | **New concept: action-per-node-kind summarizer**. Each summarizer is an Action applied to one kind, with its own report schema in `spec/schemas/summaries/<kind>.schema.json`. Summary example for skill: `what_it_does`, `recipe[]`, `preconditions[]`, `outputs[]`, `side_effects[]`, `related_nodes[]`, `quality_notes`. Stored in dedicated kernel table `state_summaries(node_id, kind, summarizer_action_id, summarizer_version, body_hash_at_generation, generated_at, summary_json)`. `sm show` renders summary if present; flags as `(stale)` if current `body_hash ≠ body_hash_at_generation`. MVP ambitious: 5 schemas defined in spec (skill/agent/command/hook/note), **all 5 built-in summarizers shipped**. Third-party plugins can register additional summarizers that write to the same table. |
| 67 | Plugin storage dual mode | **Updates #35 to support both modes; plugin declares in manifest.** Mode A = **KV** (`ctx.store`, generic, kernel-owned `state_plugin_kv` table). Mode B = **Dedicated tables**, opt-in via `storage: { mode: "dedicated", tables: [...], migrations: [...] }` in manifest. Kernel provisions tables with mandatory prefix `plugin_<plugin_id>_`. **Triple protection**: (1) kernel injects prefix on all DDL — plugin cannot create un-prefixed tables; (2) DDL validation — reject FK to kernel tables, triggers on kernel tables, DROP/ALTER of kernel tables, ATTACH, global PRAGMAs; (3) scoped connection — plugin receives wrapper of `Database`, not raw handle; wrapper rejects cross-namespace queries at runtime. Honest note: drop-in plugins are user-placed code; protection guards accidents, not hostile plugins (post-v1.0 evaluates signing). |
| 68 | `sm doctor` surfaces missing LLM runner | `sm doctor` checks: (a) `claude` binary in PATH (CLI runner available), (b) current env is inside an agent host (skill runner context). Reports warning if neither, with note that deterministic features still work but probabilistic queue without execution. Same check exposed in UI — "🧠 prob" button disabled with tooltip when no runner available. |
| 69 | Live sync protocol for UI | **WebSocket** (resolves deferred decision #28). `sm serve` exposes `/ws` endpoint (bidirectional). All live events (job lifecycle, scan updates, issue changes) pushed via WS. UI sends commands (rescan, submit, cancel) back over same channel. REST HTTP retained only for discrete CRUD (config reads, exports). Rationale over SSE: interactive map needs bidirectional real-time; unifying to one channel simplifies UI and server both. Library pick deferred to tech-stack-finalization (likely `ws` or Hono's built-in WS support). File-watcher push (Step 6 `chokidar`) wires directly into WS broadcast. |
| 70 | Frontmatter standard | **Catalog of all fields enumerated** across categories: identity (name/description/type), authorship (author/authors/license + github/homepage/linkedin/twitter), versioning (version/spec-compat/stability/supersedes/superseded_by), taxonomy (tags/category/keywords), lifecycle (created/updated/released), integration (requires/conflicts_with/provides/related), display (icon/color/priority/hidden), documentation (docs_url/readme/examples_url). Kind-specific extensions: skill adds inputs/outputs; agent adds model/tools/color; command adds args/shortcut; hook adds event/condition/blocking/idempotent; note has no extras. All fields optional except `name` and `description`. Spec artifacts: `spec/schemas/frontmatter/base.schema.json` + `frontmatter/<kind>.schema.json` (5 kinds). **Validation default: warn** (permissive) on unknown/missing fields. `--strict` flag in `sm scan` / `sm check` promotes to error (for CI). Adapters emit issues `invalid-frontmatter`, `missing-recommended-field`, `unknown-field` (warn by default). Per-surface field visibility (`sm list` / `sm show` / UI inspector / UI node badge) deferred as a rendering-config decision; not a blocker for kernel or schema design. DB denormalizes a few high-query fields as columns (`stability`, `version`, `author`); rest lives in `frontmatter_json`. |
| 71 | Build order inversion — UI prototype first | **New Step 0c inserted between 0b and 1: UI prototype with mocked data (Flavor A)**. Rationale: the map is the main UX; many design decisions (metadata visibility, event schema sufficiency, inspector layout, interactions) validate orders of magnitude faster with a clickable prototype than with specification. Cost: 2-3 days for Flavor A vs weeks of refactor if kernel API is wrong. Flavor A scope: graph view, node list, inspector panel, filters, simulated event flow (run-queue with fake jobs), interaction patterns. Data: JSON fixtures dumped from 5-10 real skills in `_plugins/`. Flavor B (vertical slice with real kernel) absorbed into Step 12 of the existing plan. **Forces three previously-deferred decisions to lock at this step**: #25 frontend framework (lean: **SolidJS**), #26 graph viz library (lean: **Cytoscape.js** for MVP), #27 styling (lean: **Tailwind**). After Step 0c completes, roadmap undergoes a review pass — some decisions confirm, some adjust, new gaps may surface. This is the explicit iteration checkpoint before kernel commitment. |
| 72 | Prompt injection preamble | **Two-layer mitigation, kernel-enforced**. (1) All user content interpolated into job MDs MUST be wrapped in `<user-content id="<node-id>">...</user-content>` tags; kernel escapes any literal `</user-content>` in the content to `\</user-content>`. (2) Kernel auto-prepends a canonical preamble (spec'd verbatim at `spec/prompt-preamble.md`) to every rendered job MD — action templates cannot modify, omit, or precede it. The preamble instructs the model: content inside `<user-content>` is data, never instructions; detected injection attempts must be noted in the report's `safety` field. `spec/schemas/job.schema.json` validates the preamble presence. `sm job preview <id>` shows full rendered MD including preamble for auditability. Not bulletproof but raises the bar significantly; post-MVP extensions: adversarial test suite, deterministic regex second-pass. |
| 73 | `sm findings` verb for probabilistic issues | **New CLI verb separate from `sm check`**. `sm check` remains deterministic (rules over current graph). `sm findings` queries materialized probabilistic reports in DB (injection attempts, low confidence analyses, stale summaries, suspicious content). Filters: `--type injection\|stale\|low-confidence\|suspicious`, `--since <date>`, `--threshold <n>`, `--json`. Zero query cost (reads stored data). UI renders two separate panels: **Issues** (fed by `sm check`) and **Findings** (fed by `sm findings`). |
| 74 | `safety` object in probabilistic reports | **Sibling of `confidence` in shared report base schema** (`spec/schemas/report-base.schema.json`). All probabilistic actions (summarizers, `sm what`, `sm dedupe`, etc.) emit a `safety` object: `{ injection_detected: boolean, injection_details: string\|null, injection_type: enum[direct-override\|role-swap\|hidden-instruction\|other], content_quality: enum[clean\|suspicious\|malformed] }`. Distinct from `confidence` (metacognition about output) — `safety` is assessment of input content. Surfaces in `sm findings` and UI inspector. |
| 75 | Enrichment invocation + skills.sh pivot | **No dedicated verb** — enrichment actions use existing `sm job submit <action> [-n <id>] [--all]` (where `--all` is officially promoted as a universal flag of `job submit`, applying the action to every node matching its `precondition`). **Skills.sh dropped from MVP** (no public API found after investigation; no hash/id endpoint, no documented developer contract). Pivot to **GitHub as primary enrichment source** — public API, raw content access, well-understood. Any nodes with `metadata.source` pointing to a GitHub URL get enrichment. Non-GitHub sources: no enrichment (post-MVP when other registries publish APIs). |
| 76 | GitHub idempotency | **Three-layer caching**. (1) If `metadata.source_version` is a SHA or tag, plugin resolves to immutable raw URL `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`; same SHA = same content = deterministic. (2) If `source_version` points to a branch or is absent, plugin resolves to current SHA via GitHub API and stores the resolved SHA in `state_enrichment.data_json`; subsequent refreshes compare SHA; only re-fetch if changed. (3) Optional ETag/`If-None-Match` caching against GitHub REST API (post-MVP, saves bandwidth within rate limit). Hash verification: compare local `body_hash` to hash of fetched raw content; set `verified: true\|false` and `locally_modified: true` on mismatch. |
| 77 | Default plugin pack | **Pattern confirmed; specific contents TBD during implementation**. On `sm init`, a curated bundled pack is installed automatically (user can `disable` individual plugins but reinstall happens at next init). Only firm commitment now: **`github-enrichment`** bundled, because it implements the hash verify property that Decision #75 depends on. Remaining pack members (minimal security scanner, others) decided when implementing — not prematurely committed. Third-party plugins (Snyk, Socket, etc.) install post-MVP via `sm plugins install <name>` against spec'd interface at `spec/interfaces/security-scanner.md`. |
| 78 | Reference counts | **Three denormalized integer columns on `scan_nodes`**: `links_out_count`, `links_in_count`, `external_refs_count`. Computed at scan time. External URL detection: regex for http/https in body, dedup exact match per node, normalize (strip trailing punctuation). **No new table, no URL liveness, no broken-external-ref rule**. User cares about count, not identity of URLs (user can read the file if they want specifics). `sm show` displays "N in · M out · K external". `sm list --sort-by external-refs` sorts by the counter. URL liveness remains an optional post-MVP plugin if demand appears. |
| 72b | Frontmatter Provenance extension to Decision 70 | Adds `metadata.source` (URL to canonical origin, e.g., GitHub blob URL) and `metadata.source_version` (tag or SHA; branch-name allowed but gets dynamically resolved) to the frontmatter catalog under a new section **Provenance**. Consumed by `github-enrichment`. Drops `metadata.registry` / `metadata.registry_id` (were placeholder for skills.sh; no consumer until a registry publishes a real API). |
| 79 | Atomicity edge cases between DB and filesystem | **Deterministic policy per scenario**. (1) `state_jobs.status = queued\|running` but MD file missing → on next `sm job run` after claim, read fails → kernel marks job `failed` with `error: 'job-file-missing'`, no retry; `sm doctor` reports proactively. (2) MD file with no DB row → reported by `sm doctor`, never auto-deleted; user runs `sm job prune --orphan-files` to clean. (3) MD file edited by user between submit and run → by design, runner uses current file content; user breaks their own guarantees and owns it (no warning, keeps noise low). (4) `completed` + file still present → normal, waits for retention policy via `sm job prune`. (5) Runner crash between atomic claim and file read → covered by existing auto-reap (#55); TTL expires, reap marks `failed` with reason `abandoned`. **`sm job run` operation order**: BEGIN TX → claim via `UPDATE ... RETURNING id` → COMMIT → read MD → if missing, mark `failed` + continue; else spawn `claude -p`, wait for callback. Minimizes inconsistency window to between COMMIT and read, handled deterministically. **New `sm doctor` checks**: reports count of DB-rows-without-files and files-without-DB-rows separately with guidance. **New flag**: `sm job prune --orphan-files` (complements `sm job prune` for retention GC) cleans orphan MD files only on explicit invocation. |

### Gaps still open

- Migration file format (`.sql` vs `.ts`, naming like `001_initial.sql`).
- Per-action TTL override (post-MVP) — manifest field.
- Tech stack finalization (YAML parser, MD parsing, templating engine, pretty CLI libs, globbing, diff, testing framework). Note: #25/#26/#27 (frontend/graph/styling) get locked during Step 0c.
- DB naming conventions (plural/singular, timestamps `<event>_at`, booleans `is_*`, hash/json column suffixes, plugin prefix normalization).
- Per-surface frontmatter visibility (which fields render in `sm list` / `sm show` / UI inspector / graph node badge) — resolvable during Step 0c with the prototype.

### Sections below still pending rewrite

- **Execution plan** — Step 1 includes SQLite + Clipanion + hexagonal wiring + `docs/cli-reference.md` auto-gen; Step 9 renamed "Job subsystem"; runner split (CLI/Skill) documented.
- **Persistence layout** — SQLite two-scope + `scan_*` / `state_*` / `config_*` split + table list.
- **Architecture principle: Kernel + Extensions** — expand to hexagonal with adapter catalog.
- **Decision log** — merge decisions 33–61 into the main table.
- **Action contract** — update `invocation-template` mode to reference job-file rendering.
- **Spec as a standard** — add artifacts: `architecture.md`, `cli-contract.md`, `project-config.schema.json`, `job.schema.json`, `plugin-kv-api.md`, `db-schema.md`.

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
