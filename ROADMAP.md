# skill-map

> Design document and execution plan for `skill-map`. Architecture, decisions, phases, deferred items, and open questions. Target: distributable product (not personal tool). Versioning policy, plugin security, i18n, onboarding docs, and compatibility matrix all apply.

**Last updated**: 2026-04-27 (Step 6 closed: spec rename `.skill-map.json` → `.skill-map/settings.json` + 6-layer config loader + `sm config list/get/set/reset/show` + `.skill-mapignore` parser wired into the scan walker + `sm init` scaffolding + `sm plugins enable/disable` over `config_plugins` with DB-over-`settings.json` precedence + frontmatter strict mode (`--strict` / `scan.strict`). 7 changesets pending — committed under `.changeset/step-6-*` and consolidated into two commits (`f41dbad` for .1–.4, `8a4667f` for .5–.7), all tagged patch). Changes land via `.changeset/*.md` and `spec/CHANGELOG.md` — this header stops paraphrasing them.

---

## Project overview

The project description, problem statement, target audience, philosophy, and Obsidian positioning live in the README. Both language variants carry the same content:

- **English (default)**: [README.md](./README.md).
- **Español**: [README.es.md](./README.es.md).

Each README also ships a short essentials-only glossary with a pointer back to the full [§Glossary](#glossary) below. This document (`ROADMAP.md`) is the design narrative — architecture decisions, execution plan, decision log, and deferred work — and sits beneath the READMEs; it is maintained in English only.

**Status**: Steps **0a**, **0b**, **0c**, **1a**, **1b**, **1c**, **2**, **3**, **4**, **5**, and **6** are **complete**. `@skill-map/spec` is published on npm; the `ui/` workspace ships Flavor A. Step 6 shipped Config + onboarding across 7 sub-steps: 6.1 spec rename `.skill-map.json` → `.skill-map/settings.json` (description + db-schema + coverage refs), 6.2 layered config loader (defaults → user → user-local → project → project-local → overrides; per-key resilient — bad JSON or schema violations strip the offending key without invalidating siblings; `--strict-config` re-routes warnings to thrown errors; sources map records who set what), 6.3 `sm config list / get / set / reset / show` (5 stub verbs become real, JSON-first value coercion, schema re-validation on `set`, `--source` revealing layer), 6.4 `.skill-mapignore` parser (`ignore@7.0.5` pinned dep, bundled defaults file, `IIgnoreFilter` plumbed through `IAdapter.walk` + `RunScanOptions`, claudeAdapter walker tracks rel-path during recursion), 6.5 `sm init` scaffolding (creates `.skill-map/{settings.json,settings.local.json,skill-map.db}`, drops `.skill-mapignore` template, appends to `.gitignore` deduping existing entries, runs first scan inline; `--no-scan` and `--force` flags; `-g` for global scope without `.gitignore` writes), 6.6 `sm plugins enable/disable` + `config_plugins` storage (4 storage helpers, resolver implementing DB > `settings.json` > installed default precedence, new `'disabled'` `TPluginLoadStatus`, doctor treats disabled as intentional, merge rule documented in `spec/db-schema.md`), 6.7 frontmatter strict mode (per-kind frontmatter schemas validated during scan, fence-less files silent, fenced-but-broken files emit `frontmatter-invalid` issue at `warn` by default and `error` under `--strict` or `scan.strict: true`, incremental scans preserve cached issues across passes). 303 of 303 tests pass (213 → 303 = +90 across all seven Step 6 sub-steps). 7 changesets pending in `.changeset/` (`step-6-1-config-folder-rename` through `step-6-7-frontmatter-strict`, all tagged patch). Next step: **Step 7 — Robustness**. The canonical completeness marker lives in §Execution plan below.

---

## Glossary

> Canonical vocabulary of the project. The rest of the roadmap uses these terms without ambiguity.

### Domain and graph

| Concept | Description |
|---|---|
| **Node** | Markdown file representing a unit (skill, agent, command, hook, note). Identified by path relative to the scope root. |
| **Link** | Directed relation between two nodes (replaces the term "edge"). Carries `kind` (invokes / references / mentions / supersedes), confidence (high / medium / low), and sources (which detectors produced it). |
| **Issue** | Problem emitted by a deterministic rule when evaluating the graph. Has severity (warn / error). |
| **Finding** | Result emitted by probabilistic analysis (summarizer, LLM verb), persisted in the DB. Covers injection detection, low confidence, stale summaries. |
| **Node kind** | Category of a node: skill / agent / command / hook / note. Field `node.kind` in the spec. Distinct from **link kind** (value of `link.kind`) and **extension kind** (plugin category, see next table). All three are polysemic specializations of the generic term "kind"; the prefix is used when context is not obvious. |

### Extensions (6 extension kinds)

"Extension kind" is the category of a plugin piece, distinct from **node kind** in the previous table. The ecosystem exposes six, and they form the stable kernel contract.

| Concept | Description |
|---|---|
| **Adapter** | Extension kind. Recognizes a platform (claude, codex, gemini, generic) and classifies each file into its node kind. |
| **Detector** | Extension kind. Extracts links (references) from a node's body during the scan. |
| **Rule** | Extension kind. Evaluates the graph and emits deterministic issues. |
| **Action** | Extension kind. Operation executable over one or more nodes. Two modes: local (plugin code) or invocation-template (rendered prompt for an LLM). |
| **Audit** | Extension kind. Deterministic workflow composing rules and actions. |
| **Renderer** | Extension kind. Serializes the graph into ascii / mermaid / dot / json. |

### Architecture

| Concept | Description |
|---|---|
| **Kernel** | Domain core. Pure logic; performs no direct IO. Exposes use cases. |
| **Port** | Interface declared by the kernel. Enables adapter injection. |
| **Driving adapter** | Primary adapter — consumes the kernel from the outside. CLI, Server, Skill agent. |
| **Driven adapter** | Secondary adapter — implements a kernel port. SQLite storage, FS, Plugin loader, LLM runner. |
| **Hexagonal** | Ports & adapters pattern. Canonical name of this project's architecture. |

### Job runtime

| Concept | Description |
|---|---|
| **Action (type)** | Defined by a plugin. What the user can invoke. |
| **Job** | Runtime instance of an Action over one or more nodes (replaces the term "dispatch"). Lives in `state_jobs`. |
| **Job file** | MD generated by `sm` at `.skill-map/jobs/<id>.md`. Contains rendered prompt + callback instruction. Ephemeral. |
| **CLI runner loop** | Driving adapter — the `sm job run` command itself. Claims queued jobs, spawns a `RunnerPort` impl, and records callbacks. Does NOT implement `RunnerPort`. |
| **`ClaudeCliRunner`** | Default `RunnerPort` impl (driven adapter). Spawns a `claude -p` subprocess per item; `MockRunner` is the test fake. Lands in Step 10 with the job subsystem. |
| **Skill agent** | Driving adapter that runs inside an LLM session and consumes `sm job claim` + `sm record` like any other client. Does NOT implement `RunnerPort`; peer of CLI / Server. |
| **Report** | JSON produced by a job, validated against the schema declared by the action. |
| **Callback** | Call to `sm record` that closes a job: status, tokens, duration. |
| **Nonce** | Unique token in the job file frontmatter. Required by `sm record` to prevent callback forgery. |
| **Content hash** | Hash identifying a job for deduplication: `sha256(actionId + actionVersion + bodyHash + frontmatterHash + promptTemplateHash)`. |
| **Atomic claim** | `UPDATE ... RETURNING id` operation letting a runner take a queued job without a race. |
| **Reap** | Automatic process at the start of every `sm job run` that detects `running` jobs with expired TTL and marks them `failed` (reason `abandoned`). |

### States

| Concept | Description |
|---|---|
| **queued** | Job created, awaiting a runner. |
| **running** | A runner claimed it; execution in flight. |
| **completed** | The runner finished successfully and the report validated. |
| **failed** | The runner reported an error, or the job was abandoned by TTL. |
| **abandoned** | Sub-state of failed: runner died without a callback. |
| **stale** | Data computed over an older `body_hash`; the file has changed since. |
| **orphan** | Node with DB history but no file on disk. |

### Plugins and storage

| Concept | Description |
|---|---|
| **Plugin** | Distributable unit registering one or more extensions. Drop-in at `<scope>/.skill-map/plugins/<id>/`. |
| **Extension** | One of the 6 categories (adapter, detector, rule, action, audit, renderer) a plugin contributes. |
| **Drop-in** | Installation mode: place files in the right folder and they appear. No `sm plugins add`. |
| **Spec-compat** | Semver range in the plugin manifest against the spec version. Checked at load. |
| **Storage mode KV** | Mode A. Plugin uses `ctx.store.{get,set,list,delete}`, persisted in the kernel table `state_plugin_kvs`. |
| **Storage mode Dedicated** | Mode B. Plugin declares its own tables; the kernel provisions them with prefix `plugin_<id>_`. Triple protection against kernel contamination. |

### Refresh and analysis

| Concept | Description |
|---|---|
| **Deterministic refresh** | Re-scan of a node: recomputes bytes, tokens, hashes, links. Synchronous, no LLM. `sm scan -n <id>`. |
| **Probabilistic refresh** | Enqueues an LLM-backed action (summarizer, what, cluster). Async. `sm job submit <action> -n <id>`. |
| **Summarizer** | Per-kind Action that produces a structured semantic summary. One summarizer per kind (skill / agent / command / hook / note). |
| **Meta-skill** | Conversational skill (`/skill-map:explore`) that consumes `sm … --json` verbs and maintains follow-ups with the user. |

### Safety and content

| Concept | Description |
|---|---|
| **User-content delimiter** | XML tags `<user-content id="...">...</user-content>` that wrap user content inside job files. The kernel escapes any literal `</user-content>` inside the content. |
| **Prompt preamble** | Canonical block auto-prepended by the kernel to every job MD. Instructs the model to treat user-content as data, not instructions. |
| **Safety object** | Block in probabilistic reports (sibling of `confidence`): `injectionDetected`, `injectionType`, `contentQuality`, `injectionDetails`. |
| **Injection detection** | Detection (by the model) of prompt-injection attempts inside node content. Categorized as direct-override / role-swap / hidden-instruction / other. |

### Enrichment and provenance

| Concept | Description |
|---|---|
| **Enrichment** | Fetching external data (GitHub stars, last activity) to augment node info. Action with a refresh TTL. |
| **Provenance** | Frontmatter section: `metadata.source` (canonical URL) + `metadata.sourceVersion` (tag or SHA). |
| **Hash verification** | Comparison of local `body_hash` against the hash computed over raw GitHub content to set `verified: true/false`. |

### Scope and persistence

| Concept | Description |
|---|---|
| **Scope project** | Default scope. Scans the current repo. DB at `./.skill-map/skill-map.db`. |
| **Scope global** | Opt-in scope via `-g`. Scans `~/.claude/` and similar. DB at `~/.skill-map/skill-map.db`. |
| **Zone scan_** | Prefix for **regenerable** tables: `sm scan` truncates and repopulates them. E.g. `scan_nodes`, `scan_links`. |
| **Zone state_** | Prefix for **persistent** tables: jobs, executions, summaries, plugin_kv. Back up. |
| **Zone config_** | Prefix for user-owned tables: plugins enabled/disabled, preferences, schema versions. |
| **Migration** | Versioned `.sql` file (`NNN_snake_case.sql`) that evolves the schema. Up-only. |
| **user_version** | Built-in SQLite PRAGMA. Fast tracking of the kernel schema. |
| **Auto-backup** | Automatic copy of the DB to `.skill-map/backups/…db` before applying migrations. |

### CLI and UI

| Concept | Description |
|---|---|
| **Introspection** | Property of the CLI to emit its own structure (`sm help --format json`) — consumed by docs, completion, UI, agents. |
| **Graph view** | Main UI view: nodes + links, interactive. |
| **List view** | Tabular view of nodes with filters and sort. |
| **Inspector panel** | UI section showing detail of the selected node: metadata, weight, summary, links, issues, findings. |
| **Issues panel** | UI section fed by `sm check` (deterministic). |
| **Findings panel** | UI section fed by `sm findings` (probabilistic). |
| **WebSocket** | Bidirectional protocol between server and UI. Push of events (job lifecycle, scan updates) + user commands (rescan, submit, cancel). |

---

## Visual roadmap

```text
═══════════════════════════════════════════════════════════════════════════
  PHASE A · DETERMINISTIC CORE (no LLM)
═══════════════════════════════════════════════════════════════════════════
✅ 0a  Spec bootstrap          schemas, conformance, @skill-map/spec published
✅ 0b  Implementation          workspace + kernel shell + CLI + CI green
✅ 0c  UI prototype            Flavor A with mocked data (iteration checkpoint)
✅ 1a  Storage + migrations    SQLite adapter, kernel migrations, auto-backup, sm db *
✅ 1b  Registry + loader       6 kinds, drop-in plugin discovery, sm plugins list/show/doctor
✅ 1c  Orchestrator + CLI      scan skeleton, Clipanion dispatcher, cli-reference.md autogen, self-boot green
✅ 2   First extensions        1 adapter, 3 detectors, 3 rules, 1 renderer, 1 audit
✅ 3   UI design refinement    node cards, connections, inspector, dark mode parity
✅ 4   Scan end-to-end         sm scan / list / show / check
✅ 5   History + orphans       state_executions, history, rename heuristic via body_hash
✅ 6   Project config          .skill-map/settings(.local).json, .skill-mapignore, sm init,
                               sm config *, sm plugins enable/disable, frontmatter strict
  ────────────────────────────────────────────────────────────────────────
   ▶ YOU ARE HERE (2026-04-27) — complete through 6 · next: 7
  ────────────────────────────────────────────────────────────────────────
   7   Robustness              conflict resolution, perf, chokidar, GC
   8   Diff + export           sm scan --compare-with, sm export, sm graph
   9   Plugin author UX        drop-in workflow, testkit, docs
  ────────────────────────────────────────────────────────────────────────
   ▶ v0.5.0 — deterministic, offline, zero LLM

═══════════════════════════════════════════════════════════════════════════
  PHASE B · JOB SUBSYSTEM + LLM VERBS (LLM optional, never required)
═══════════════════════════════════════════════════════════════════════════
  10   Job subsystem           state_jobs, flat-folder job files, atomic
                               claim, nonce, preamble, CLI runner loop +
                               Skill agent, first summarizer (skill-summarizer)
  11   Remaining summarizers   agent / command / hook / note. First LLM verbs
                               (sm what, sm cluster-triggers). sm findings.
                               /skill-map:explore meta-skill.
  ────────────────────────────────────────────────────────────────────────
   ▶ v0.8.0 — LLM optional layer

═══════════════════════════════════════════════════════════════════════════
  PHASE C · SURFACE & DISTRIBUTION (renderers, UI, docs, marketplace)
═══════════════════════════════════════════════════════════════════════════
  12  Extra renderers          mermaid, dot, subgraph export
  13  Web UI full              Flavor B vertical slice, graph + inspector,
                               WebSocket live events, command submit from UI
  14  Distribution polish      releases, docs site, marketplace, sm doctor,
                               telemetry opt-in, compatibility matrix
  ────────────────────────────────────────────────────────────────────────
   ▶ v1.0.0 — full distributable

═══════════════════════════════════════════════════════════════════════════
  PHASE D · DEFERRED (post v1.0, on-demand)
═══════════════════════════════════════════════════════════════════════════
  15+  Write-back              edit / create / refactor from UI
  16+  Test harness            dry-run / real / subprocess
  17+  Richer workflows        Node-pipe, JSON declarative, DAG
  18+  Additional lenses       Obsidian-vault, docs-site
  19+  More adapters           Codex, Gemini, Copilot, generic
  20+  URL liveness            optional plugin for broken-external-ref
  21+  Schema v2 + migration
  22+  Density / token-economy drop-in bundle closing scan → optimize loop
═══════════════════════════════════════════════════════════════════════════

  Rule: the LLM is never required. Product is complete offline through step 9.
```

---

## Spec as a standard

`skill-map` is a reusable standard, not only a tool. The **spec** is separated from the **reference implementation** from day zero. Anyone can build a UI, a CLI, a VSCode extension, or an entirely new implementation (any language) using only `spec/`, without reading the reference source.

### Repo layout

```
skill-map/
├── spec/                          ← source of truth for the STANDARD (29 schemas + 7 prose contracts)
│   ├── README.md                  ← human-readable spec
│   ├── CHANGELOG.md               ← spec history (independent from tool)
│   ├── versioning.md              ← evolution policy
│   ├── architecture.md            ← hexagonal ports & adapters
│   ├── cli-contract.md            ← verbs, flags, exit codes, JSON introspection
│   ├── job-events.md              ← canonical event stream schema
│   ├── prompt-preamble.md         ← canonical injection-mitigation preamble
│   ├── db-schema.md               ← table catalog (kernel-owned)
│   ├── plugin-kv-api.md           ← ctx.store contract for storage mode A
│   ├── job-lifecycle.md           ← queued → running → completed | failed
│   ├── index.json                 ← machine-readable manifest + per-file sha256
│   ├── package.json               ← published as @skill-map/spec
│   ├── schemas/                   ← 29 JSON Schemas, draft 2020-12, camelCase keys
│   │   ├── node.schema.json                 ┐
│   │   ├── link.schema.json                 │
│   │   ├── issue.schema.json                │
│   │   ├── scan-result.schema.json          │
│   │   ├── execution-record.schema.json     │ 11 top-level
│   │   ├── project-config.schema.json       │
│   │   ├── plugins-registry.schema.json     │
│   │   ├── job.schema.json                  │
│   │   ├── report-base.schema.json          │
│   │   ├── conformance-case.schema.json     │
│   │   ├── history-stats.schema.json        ┘
│   │   ├── extensions/                      ← one per extension kind (loaded at plugin load)
│   │   │   ├── base.schema.json             ┐
│   │   │   ├── adapter.schema.json          │
│   │   │   ├── detector.schema.json         │ 7 extension schemas
│   │   │   ├── rule.schema.json             │ (base + 6 kinds)
│   │   │   ├── action.schema.json           │
│   │   │   ├── audit.schema.json            │
│   │   │   └── renderer.schema.json         ┘
│   │   ├── frontmatter/                     ← user-authored; additionalProperties: true
│   │   │   ├── base.schema.json             ┐
│   │   │   ├── skill.schema.json            │
│   │   │   ├── agent.schema.json            │ 6 frontmatter (base + 5 kinds,
│   │   │   ├── command.schema.json          │ kinds extend base via allOf)
│   │   │   ├── hook.schema.json             │
│   │   │   └── note.schema.json             ┘
│   │   └── summaries/                       ← kernel-controlled; additionalProperties: false
│   │       ├── skill.schema.json            ┐
│   │       ├── agent.schema.json            │ 5 summaries (extend
│   │       ├── command.schema.json          │ report-base via allOf)
│   │       ├── hook.schema.json             │
│   │       └── note.schema.json             ┘
│   ├── interfaces/
│   │   └── security-scanner.md              ← convention over the Action kind (NOT a 7th kind)
│   └── conformance/
│       ├── README.md                        ← human-readable guide to the suite
│       ├── coverage.md                      ← release-gate matrix (schemas + artifacts ↔ cases)
│       ├── fixtures/                        ← controlled MD corpora + preamble-v1.txt
│       └── cases/                           ← basic-scan, kernel-empty-boot (preamble-bitwise-match deferred to Step 10)
└── src/                           ← reference implementation (published as skill-map)
```

### Properties

- **Machine-readable**: all schemas are JSON Schema; validate from any language.
- **Human-readable**: prose documents with examples.
- **Independently versioned**: spec `v1.0.0` implementable by CLI `v0.3.2`.
- **Platform-neutral**: no Claude Code required in any schema; it's one example adapter.
- **Conformance-tested**: any implementation passes or fails, binary.

### Distribution

- Publish schemas to JSON Schema Store (deferred until the `v0 → v1` stable release; current `v0` URLs are live but pre-stable).
- Canonical URLs: `https://skill-map.dev/spec/v0/<path>.schema.json` (live today via Railway-deployed Caddy; DNS at Vercel). Scheme bumps to `v1` at the first stable release.
- npm package `@skill-map/spec` — schemas + conformance tests.
- Spec semver separate from CLI semver; the current reference roadmap stabilizes both tracks at `v1.0.0`, but future versions can diverge.

---

## Architecture: Hexagonal (Ports & Adapters)

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
                   └──────┬───────┘
                          │
      ┌────────┬──────────┴──────────┬────────┐
      ▼        ▼                     ▼        ▼
  ┌────────┐ ┌────┐              ┌─────────┐ ┌────────┐
  │ SQLite │ │ FS │              │ Plugins │ │ Runner │
  └────────┘ └────┘              └─────────┘ └────────┘
                Driven adapters (secondary)
```

(ProgressEmitterPort exists alongside the four shown; its adapters are terminal sinks — `pretty` / `stream-output` / `--json` — and do not participate in the kernel-owning diagram.)

- Kernel accepts **ports** (interfaces) for `StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`.
- Kernel never imports SQLite, fs, or subprocess directly.
- Each adapter swappable: `InMemoryStorageAdapter` for tests, real `SqliteStorageAdapter` in production; `MockRunner` for tests, real `ClaudeCliRunner` in production.
- Test pyramid collapses cleanly: unit tests inject mocks into kernel; integration tests wire real adapters.
- CLI-first principle reinterpreted: CLI and UI are **peers** consuming the same kernel API — neither depends on the other.

### Package layout

npm workspaces. Two today (`spec/`, `src/`); `ui/` joins at Step 0c. Changesets manage each package's semver independently (see Decision #5 and the note at the end of this section).

The marker `[Step N]` in the tree below means the folder is part of the target layout and lands at that step — it is NOT yet on disk as of Step 0b. The remaining folders already exist.

```
skill-map/                        ← private root workspace (not published)
├── package.json                  ← { "name": "skill-map-monorepo", "private": true,
│                                     "workspaces": ["spec", "src"],  // "ui" added at Step 0c
│                                     "engines": { "node": ">=24.0" } }
├── .changeset/                   ← changesets config + pending release notes
├── scripts/                      ← build-site.mjs · build-spec-index.mjs · check-changeset.mjs · check-coverage.mjs
├── web/                          ← editable landing source (HTML/CSS/JS); copied into site/ at build
├── site/                         ← generated public site (Caddy on Railway)
│
├── spec/                         ← workspace #1, published as @skill-map/spec
│   └── (see previous §Repo layout tree)
│
├── src/                          ← workspace #2, published as @skill-map/cli
│   ├── package.json              ← { "name": "@skill-map/cli",
│   │                                  "bin": { "sm": "bin/sm.mjs", "skill-map": "bin/sm.mjs" },
│   │                                  "exports": { ".", "./kernel", "./conformance" } }
│   ├── kernel/                   Registry, Orchestrator, domain types, ports, use cases
│   ├── cli/                      Clipanion commands, thin wrappers over kernel
│   ├── conformance/              Contract runner (loads a spec case, asserts against binary)
│   ├── extensions/               Built-in extensions (empty until Step 2; user plugins drop in at `<scope>/.skill-map/plugins/`)
│   ├── test/                     node:test + tsx loader (*.test.ts)
│   ├── bin/sm.mjs                CLI entry, imports from ../dist/cli
│   ├── index.ts                  Package entry (re-exports)
│   ├── server/         [Step 13] Hono + WebSocket, thin wrapper over kernel
│   ├── testkit/        [Step 9]  Kernel mocks for plugin authors
│   ├── migrations/     [Step 1a] Kernel .sql migrations, up-only
│   └── adapters/       [Step 1a+] port implementations
│       ├── sqlite/               node:sqlite + Kysely + CamelCasePlugin
│       ├── filesystem/           real fs
│       ├── plugin-loader/        drop-in discovery
│       └── runner/               claude -p subprocess (ClaudeCliRunner) + MockRunner
│
└── ui/                 [Step 0c] workspace #3 — Angular SPA (standalone) + Foblex Flow + PrimeNG
    └── (scaffolded when Step 0c starts; isolation rule: no import from ../src/)
```

Two independently published packages (`@skill-map/spec`, `@skill-map/cli`). Two un-scoped placeholder packages (`skill-map`, `skill-mapper`) were published once to lock the names against squatters and have since been retired locally — they remain on npm with a `npm deprecate` notice pointing at `@skill-map/cli` and the workspaces are gone (see decision #5 history). `ui/` stays private at least through v1.0.0. Plugin authors reach the kernel via `import { registerDetector } from '@skill-map/cli/kernel'` (subpath export). Splitting into more `@skill-map/*` packages is deferred until a concrete external consumer justifies it; the org scope is already protected by ownership of `@skill-map/spec`.

The kernel never imports Angular; `ui/` never imports `src/` internals. The sole cross-workspace contract is `spec/` (JSON Schemas + typed DTOs). At Step 13 the Hono BFF inside `src/server/` exposes kernel operations over HTTP/WS, and `sm serve` serves the built Angular SPA from the same listener (single-port mandate).

---

## Persistence

### Two scopes, symmetric

| Scope | Scans | DB location |
|---|---|---|
| **project** (default) | current repo (skills, agents, CLAUDE.md under cwd) | `./.skill-map/skill-map.db` |
| **global** (`-g`) | `~/.claude/` and similar | `~/.skill-map/skill-map.db` |

Project DB is **gitignored by default**. A team that wants to share audit history across contributors opts in explicitly via the `history.share` config flag (`spec/schemas/project-config.schema.json`, marked `Stability: experimental`); when set to `true`, the project is expected to remove `./.skill-map/skill-map.db` from its `.gitignore`. The default stays conservative because the DB carries per-developer state (job runs, summaries, plugin KV) that most teams do not want to diff in PRs.

### Three zones per scope

| Zone | Nature | Regenerable | Examples |
|---|---|---|---|
| `scan_*` | last scan result | yes — `sm scan` truncates and repopulates | `scan_nodes`, `scan_links`, `scan_issues` |
| `state_*` | persistent operational data | no — must back up | `state_jobs`, `state_executions`, `state_summaries`, `state_enrichments`, `state_plugin_kvs` |
| `config_*` | user-owned configuration | no | `config_plugins`, `config_preferences`, `config_schema_versions` |

Backups preserve `state_*` + `config_*`. `scan_*` regenerated on demand.

### Naming conventions

- Tables: `snake_case`, **plural** (`scan_nodes`, `state_jobs`). Zone prefix required.
- Plugin tables: `plugin_<normalized_id>_<table>` where normalization = lowercase + `[^a-z0-9]` → `_` + collapse runs + strip leading/trailing. Collisions after normalization = load-time error.
- Columns: `snake_case`. PK = `id`. FK = `<referenced_table_singular>_id`.
- Timestamps: suffix `_at`, type **INTEGER** (Unix milliseconds).
- Durations: suffix `_seconds` or `_ms`.
- Booleans: prefix `is_` or `has_`.
- Hashes: suffix `_hash`, TEXT (hex).
- JSON blobs: suffix `_json`, TEXT.
- Counts: suffix `_count`, INTEGER.
- Enums: plain column + CHECK constraint, values kebab-case lowercase. No lookup tables.
- Indexes: `ix_<table>_<cols>`. Constraints: `fk_`, `uq_`, `ck_` prefixes.
- SQL keywords UPPERCASE, identifiers lowercase.

### Data-access layer

- **Kysely + CamelCasePlugin** inside the SQLite adapter.
- Kernel / CLI / Server / Skill consume typed repos exposing `camelCase` domain types. Never see SQL.
- Mapping `snake_case ↔ camelCase` is handled automatically inside the adapter.
- Full ORMs (Prisma, Drizzle, TypeORM) rejected — incompatible with hand-written `.sql` migrations.

### Migrations

- Format: `.sql` files only. Naming: `NNN_snake_case.sql` (3-digit sequential padded).
- Version tracking: `PRAGMA user_version` (fast check) + `config_schema_versions(scope, version, description, applied_at)` multi-scope.
- Direction: up-only. Rollback via `sm db restore <backup>`.
- Kernel auto-wraps each migration in `BEGIN` / `COMMIT`. Files contain only DDL.
- Strict versioning — no idempotency required.
- Location: `src/migrations/` (kernel), `<plugin-dir>/migrations/` (plugins).
- Auto-apply on startup with auto-backup (`.skill-map/backups/skill-map-pre-migrate-v<N>.db`). Config flag `autoMigrate: true` default.

### DB management commands

- `sm db reset` — drop `scan_*` only. Keeps `state_*` (history, jobs, summaries, enrichment) and `config_*`. Non-destructive; equivalent to asking for a fresh scan. No prompt.
- `sm db reset --state` — also drop `state_*` and every `plugin_<normalized_id>_*` table (mode B) and `state_plugin_kvs` (mode A). Keeps `config_*`. Destructive to operational history; requires interactive confirmation unless `--yes`.
- `sm db reset --hard` — delete the DB file entirely. Keeps the plugins folder on disk so the next boot re-discovers them. Destructive; requires interactive confirmation unless `--yes`.
- `sm db backup [--out <path>]` — WAL checkpoint + copy.
- `sm db restore <path>` — swap DB.
- `sm db shell` — interactive sqlite3.
- `sm db dump [--tables ...]` — SQL dump.
- `sm db migrate [--dry-run | --status | --to <n> | --kernel-only | --plugin <id> | --no-backup]`.

---

## Job system

### Core model

- **Job** = runtime instance of an Action applied to one or more Nodes. Lives in `state_jobs`.
- **Job file** = MD at `.skill-map/jobs/<id>.md` with rendered prompt + callback instruction. Kernel-generated. Ephemeral (pruned after retention).
- **ID formats**: base shape `<prefix>-YYYYMMDD-HHMMSS-XXXX` (UTC timestamp + 4 lowercase hex chars), with one optional `<mode>` segment on runs. Prefixes: `d-` for jobs, `e-` for execution records, and `r-[<mode>-]` for runs — carried in `runId` on progress events so parallel per-runner streams stay demuxable. Canonical `<mode>` values today: `ext` (external Skill claims), `scan` (scan runs), `check` (standalone issue recomputations). Without `<mode>`, runs are the CLI runner's own loop. Human-readable, sortable, collision-resistant for single-writer. Full rule in Decision #88.
- **No maildir**. State lives in DB (`state_jobs.status`); file is content only. Flat folder.

### Lifecycle

```
             submit
                │
                ▼
        ┌──────────┐   atomic claim   ┌──────────┐
        │  queued  │ ───────────────▶ │ running  │
        └────┬─────┘                  └─────┬────┘
             │                              │
             │ cancel                       │ callback success
             │                              │ callback failure
             │                              │ TTL expires (auto-reap)
             │                              │ runner-error / report-invalid
             ▼                              ▼
        ┌────────┐                    ┌──────────────────┐
        │ failed │                    │ completed/failed │
        └────────┘                    └──────────────────┘
```

Terminal states: `completed`, `failed`. `queued → failed` is only reachable via `sm job cancel` (reason `user-cancelled`). Full transition table in `spec/job-lifecycle.md`.

- Atomic claim: `UPDATE state_jobs SET status='running' WHERE id=(SELECT id FROM state_jobs WHERE status='queued' ORDER BY priority DESC, created_at ASC LIMIT 1) AND status='queued' RETURNING id`.
- Auto-reap at start of every `sm job run`: marks `running` rows with `claimed_at + ttl_seconds * 1000 < now` as failed (reason `abandoned`).

### TTL per action

Resolved at submit time in three steps; the outcome is frozen on `state_jobs.ttlSeconds` and never changes for the life of the job.

1. **Base duration** (seconds):
   - `action.expectedDurationSeconds` from the manifest, if declared.
   - Else `config.jobs.ttlSeconds` (default `3600`). Used for `mode: local` actions and any manifest that omits the hint.
2. **Computed TTL**:
   - `computed = max(base × config.jobs.graceMultiplier, config.jobs.minimumTtlSeconds)`.
   - Defaults: `graceMultiplier = 3`, `minimumTtlSeconds = 60` (acts as a floor, never a default).
3. **User overrides** (later wins):
   - `config.jobs.perActionTtl.<actionId>` — replaces steps 1+2 entirely.
   - `sm job submit --ttl <seconds>` — replaces everything.

Normative contract lives in `spec/job-lifecycle.md §TTL resolution`.

### Duplicate prevention

- On submit, check for active `(actionId, actionVersion, nodeId, contentHash)` in status `queued|running`. If exists: refuse with exit code 3 and display existing job-id.
- `--force` override bypasses the check.
- `contentHash = sha256(actionId + actionVersion + bodyHash + frontmatterHash + promptTemplateHash)`.
- Post-completion: no check; re-submit always allowed.

### Runners

Three execution paths, matching the three values the `runner` field in `job.schema.json` can take (`cli` / `skill` / `in-process`):

| Path | Role | `RunnerPort` impl | Execution engine | Isolation | Use case |
|---|---|---|---|---|---|
| **CLI runner loop** (`sm job run`, `runner: cli`) | Driving command that claims, invokes a `RunnerPort` impl, and records | `ClaudeCliRunner` (the driven adapter the loop uses in prod; `MockRunner` in tests) | `claude -p < jobfile.md` subprocess per item | Context-free (clean) | CI, cron, batch |
| **Skill agent** (`/skill-map:run-queue`, `runner: skill`) | Driving adapter that consumes `sm job claim` + `sm record` from inside an LLM session | **None** — the agent IS the execution; it does not cross `RunnerPort` | Agent executes in-session using its own LLM + tools | Context bleeds between items | Interactive |
| **In-process** (`mode: local` actions, `runner: in-process`) | Kernel-internal path for actions that do not need an LLM at all | **None** — the action's own code produces the report; no job file, no subprocess | Action function executes in the submitting process; kernel validates the returned report against `reportSchemaRef` and transitions the job straight to `completed` or `failed` | Same process as the submitter | Deterministic enrichment (`github-enrichment`), cheap aggregations, rule-like actions |

The `RunnerPort` interface is implemented by `ClaudeCliRunner` (plus `MockRunner` for tests). `sm job run` is the command loop that uses it — not the port impl itself. The **Skill agent** is a peer driving adapter to CLI / Server: it calls `sm job claim` + `sm record` as any other user of the binary would, and never crosses `RunnerPort`. The name "runner" applied to the skill path is descriptive, not structural. The **in-process** path skips the job file entirely: `sm job submit <local-action>` computes the report synchronously, writes the execution record, and returns. `sm job submit --run` and `sm job run` are no-ops for `mode: local` actions — they already ran.

Skill agent flow:
```
loop:
  1. bash: sm job claim         → <id> or exit 1 (queue empty)
  2. Read: .skill-map/jobs/<id>.md
  3. [agent reasons in-session]
  4. Write: <report-path>
  5. bash: sm record --id <id> --nonce <n> --status completed ...
```

### Nonce + callback auth

- Each job MD has unique `nonce` in frontmatter.
- `sm record` requires `--id <job-id> --nonce <nonce>` — mismatch rejects.
- Prevents forged callback closing someone else's pending dispatch.

### Prompt injection mitigation

Two kernel-enforced layers:

1. **User-content delimiters**: all interpolated node content wrapped in `<user-content id="<node.path>">...</user-content>`. Kernel escapes any literal occurrence of the closing tag inside the content by inserting a zero-width space before the `>`: `</user-content>` → `</user-content&#x200B;>` (U+200B). The substitution is reversed **only for display** — never when computing `bodyHash`, `frontmatterHash`, `contentHash`, or the `promptTemplateHash` fed into the job's content hash. Nesting of `<user-content>` blocks is forbidden; an action template that needs multiple nodes emits one top-level block per node. An action template that interpolates user text outside a `<user-content>` block is rejected at registration time. Full contract in `spec/prompt-preamble.md`.
2. **Canonical preamble**: kernel auto-prepends `spec/prompt-preamble.md` text before any action template. Action templates cannot modify, omit, or precede it. The preamble instructs the model: user-content is data, never instructions; detected injections must be noted in `safety` field of the report.

### Atomicity edge cases

| Scenario | Handling |
|---|---|
| DB `queued`/`running` but MD file missing | Mark `failed` with `error: job-file-missing`. `sm doctor` reports proactively. |
| MD file with no DB row | Reported by `sm doctor`. User runs `sm job prune --orphan-files`. Never auto-deleted. |
| User edited MD file before run | By design: runner uses current content. User owns the consequences. |
| `completed` + file present | Normal. Retention policy (`sm job prune`) eventually cleans. |
| Runner crash between claim and read | Covered by auto-reap; TTL expires → `failed` with `abandoned`. |

### Concurrency

The job subsystem runs jobs **sequentially within a single runner** — one claim / spawn / record cycle at a time. There is no pool or scheduler through `v1.0`.

Multiple runners MAY coexist (e.g. a cron `sm job run --all` in parallel with an interactive Skill agent draining via `sm job claim`). The atomic-claim semantics exist precisely for this case: the `UPDATE ... WHERE status='queued' RETURNING id` guarantees that no two runners ever claim the same row, even when they race.

The event schema carries `runId` + `jobId` so parallel per-runner sequences can be interleaved without losing order per `jobId`. True in-runner parallelism (a pool inside `sm job run`) is a non-breaking post-`v1.0` extension.

### Progress events

Canonical event stream (`spec/job-events.md`):

- **Job family (stable)**: `run.started`, `run.reap.started`, `run.reap.completed`, `job.claimed`, `job.skipped`, `job.spawning`, `model.delta`, `job.callback.received`, `job.completed`, `job.failed`, `run.summary`, plus the synthetic `emitter.error`.
- **Non-job families (experimental, v0.x)**: `scan.*` (`scan.started`, `scan.progress`, `scan.completed`) and `issue.*` (`issue.added`, `issue.resolved`). Shipped at Step 13 with the WebSocket broadcaster; shapes lock when promoted to `stable` in a later minor bump.

All events share the envelope `{ type, timestamp, runId, jobId, data }`. Non-job events use synthetic runs: scans run under `r-scan-…`, standalone issue recomputations under `r-check-…` (same `r-<mode>-…` pattern as `r-ext-…` for external Skill claims).

Emitted via `ProgressEmitterPort`. Three output adapters:
- **pretty** (default TTY): line progress, colored.
- **`--stream-output`**: pretty + model tokens inline (debug).
- **`--json`**: ndjson canonical.

Server re-emits the same events via **WebSocket**. Task UI integration (Claude Code's `TaskCreate` and any future host primitive) lives as a host-specific skill (`sm-cli-run-queue`), not as a CLI output mode. Cursor is explicitly out of scope (see §Discarded).

### `sm job` CLI surface

| Command | Purpose |
|---|---|
| `sm job submit <action> -n <id>` | Enqueue (or run inline for local mode). |
| `sm job submit <action> -n <id> --run` | Submit + spawn subprocess immediately. |
| `sm job submit <action> --all` | Apply to every node matching action's precondition. |
| `sm job submit ... --force` | Bypass duplicate check. |
| `sm job submit ... --ttl <seconds>` | Override computed TTL. |
| `sm job submit ... --priority <n>` | Override job priority (Decision #40). Integer; higher runs first; default `0`; negatives permitted. Frozen on `state_jobs.priority` at submit. |
| `sm job list [--status ...]` | List jobs. |
| `sm job show <id>` | Detail (includes TTL remaining for running). |
| `sm job preview <id>` | Render the MD (no execution). |
| `sm job claim [--filter <action>]` | Atomic primitive. Returns next queued id. |
| `sm job run` | CLI runner loop: claim + spawn + record. One job. |
| `sm job run --all \| --max N` | Drain the queue. |
| `sm job status [<id>]` | Counts or single-job status. |
| `sm job cancel <id> \| --all` | Force one or every queued/running job to `failed`. |
| `sm job prune` | Retention GC. |
| `sm job prune --orphan-files` | Clean orphan MD files. |

---

## Plugin system

### Drop-in installation

No `add` / `remove` verbs. User drops files in:
- `<scope>/.skill-map/plugins/<plugin-id>/` (project)
- `~/.skill-map/plugins/<plugin-id>/` (global)

Layout:
```
<plugin-id>/
├── plugin.json              ← manifest
├── extensions/
│   ├── foo.action.mjs
│   ├── foo.detector.mjs
│   └── ...
└── migrations/              ← only if storage mode dedicated
    └── 001_initial.sql
```

Manifest:
```json
{
  "id": "my-cluster-plugin",
  "version": "1.0.0",
  "specCompat": "^0.2.0",
  "extensions": [
    "extensions/foo.action.mjs",
    "extensions/foo.detector.mjs"
  ],
  "storage": {
    "mode": "kv"
  }
}
```

Pre-`v1.0.0`, `specCompat` pins a **minor range** per `versioning.md` §Pre-1.0 (e.g. `"^0.2.0"` resolves to `>=0.2.0 <0.3.0`). Narrow pins are the defensive default because minor bumps MAY carry breaking changes while the spec is `0.y.z` — a plugin that spans minor boundaries can load successfully and crash at first use against a changed schema. A plugin author who has reviewed the spec changelog for the next minor MAY widen to `"^0.2.0 || ^0.3.0"` at their own risk. Once the spec ships `v1.0.0`, manifests move to `"^1.0.0"` (= `>=1.0.0 <2.0.0`).

### Loading

On boot or `sm plugins list`:
1. Walk `<scope>/.skill-map/plugins/*` and `~/.skill-map/plugins/*`.
2. Read `plugin.json`.
3. Run `semver.satisfies(specVersion, plugin.specCompat)`.
4. If compat fails: `disabled` with reason `incompatible-spec`. Skip.
5. Dynamic-import each extension. Validate against kind schema. Register in kernel.
6. If plugin has storage mode dedicated: kernel provisions tables (prefix-enforced) and runs migrations.

### Storage modes

Plugin declares in manifest:

| Mode | Declaration | API | Backing |
|---|---|---|---|
| **A — KV** | `"storage": { "mode": "kv" }` | `ctx.store.{get,set,list,delete}` scoped by `plugin_id` | Kernel table `state_plugin_kvs(plugin_id, node_id, key, value_json, updated_at)`. Per spec `db-schema.md`, plugin-owned serialized values use the standard `_json` suffix. |
| **B — Dedicated** | `"storage": { "mode": "dedicated", "tables": [...], "migrations": [...] }` | Scoped `Database` wrapper | Kernel-provisioned tables `plugin_<normalized_id>_<table>` |

### Triple protection (mode B)

1. **Prefix enforcement**: kernel injects `plugin_<id>_` into every DDL. Plugin cannot create un-prefixed tables.
2. **DDL validation**: reject FK to kernel tables, triggers on kernel tables, `DROP`/`ALTER` of kernel tables, `ATTACH`, global PRAGMAs.
3. **Scoped connection**: plugin receives a `Database` wrapper, not raw handle. Wrapper rejects cross-namespace queries at runtime.

Honest note: drop-in plugins are user-placed code; protection guards accidents, not hostile plugins. Post-v1.0 evaluates signing.

### Plugin commands

| Command | Purpose |
|---|---|
| `sm plugins list` | Auto-discovered from folders. |
| `sm plugins show <id>` | Manifest + compat status. |
| `sm plugins enable <id> \| --all` | Toggle one or every discovered plugin on (persisted in `config_plugins`). |
| `sm plugins disable <id> \| --all` | Toggle one or every discovered plugin off without deleting. |
| `sm plugins doctor` | Revalidate specCompat. |

### Default plugin pack

Pattern confirmed. Contents TBD during implementation. Only firm commitment: **`github-enrichment`** bundled (needed for hash verify property). Other candidates: `minimal-security-rules`, more detectors. Third-party plugins (Snyk, Socket) install post-`v1.0` against `spec/interfaces/security-scanner.md`.

---

## Summarizer pattern

Each node-kind has a default Action that generates a semantic summary. Registered by the adapter:
- `skill-summarizer` → `kind: skill` (`skill-summarizer` lands at Step 10, the other four at Step 11; `v0.5.0` ships none)
- `agent-summarizer` → `kind: agent`
- `command-summarizer` → `kind: command`
- `hook-summarizer` → `kind: hook`
- `note-summarizer` → `kind: note`

### Schemas

Each summarizer declares a report schema in `spec/schemas/summaries/<kind>.schema.json`, extending `spec/schemas/report-base.schema.json`.

Example — skill:
```json
{
  "confidence": 0.85,
  "safety": { "injectionDetected": false, "contentQuality": "clean" },
  "whatItDoes": "One-sentence summary",
  "recipe": [ { "step": 1, "description": "..." } ],
  "preconditions": ["..."],
  "outputs": ["..."],
  "sideEffects": ["..."],
  "relatedNodes": ["..."],
  "qualityNotes": "..."
}
```

### Storage

Dedicated kernel table `state_summaries`:
```sql
CREATE TABLE state_summaries (
  node_id                  TEXT NOT NULL,
  kind                     TEXT NOT NULL,
  summarizer_action_id     TEXT NOT NULL,
  summarizer_version       TEXT NOT NULL,
  body_hash_at_generation  TEXT NOT NULL,
  generated_at             INTEGER NOT NULL,
  summary_json             TEXT NOT NULL,
  PRIMARY KEY (node_id, summarizer_action_id)
);
```

`sm show <node>` renders the summary if present; marks `(stale)` if current `body_hash ≠ body_hash_at_generation`.

### Probabilistic refresh

UI exposes two buttons per node:
- **🔄 det** → `sm scan -n <id>`: recomputes bytes, tokens, hashes, links. Sync.
- **🧠 prob** → `sm job submit <defaultRefreshAction-for-kind> -n <id>`: async, queued. The default refresh action per kind is the summarizer for that kind.

### Report base schema

All probabilistic reports (summarizers, LLM verbs) extend `report-base.schema.json`:

```json
{
  "confidence": 0.0,
  "safety": {
    "injectionDetected": false,
    "injectionDetails": null,
    "injectionType": null,
    "contentQuality": "clean"
  }
}
```

- `confidence` (0.0–1.0): model's metacognition about its own output.
- `safety.injectionDetected`: boolean; input contains injection attempt.
- `safety.injectionType`: enum (`direct-override`, `role-swap`, `hidden-instruction`, `other`).
- `safety.contentQuality`: enum (`clean`, `suspicious`, `malformed`).

---

## Frontmatter standard

All fields optional except `name`, `description`, `metadata`, and `metadata.version`. Spec artifacts: `spec/schemas/frontmatter/base.schema.json` + `frontmatter/<kind>.schema.json` (5 kinds).

### Base (all kinds)

**Identity**: `name`, `description`, `type`.

**Authorship**: `author`, `authors[]`, `license` (SPDX), `metadata.github`, `metadata.homepage`, `metadata.linkedin`, `metadata.twitter`.

**Versioning**: `metadata.version` (semver), `metadata.specCompat` (semver range), `metadata.stability` (`experimental` | `stable` | `deprecated`), `metadata.supersedes[]`, `metadata.supersededBy`.

**Provenance**: `metadata.source` (URL to canonical origin, e.g., GitHub blob), `metadata.sourceVersion` (tag or SHA; branch name allowed but dynamically resolved).

**Taxonomy**: `metadata.tags[]`, `metadata.category`, `metadata.keywords[]`.

**Lifecycle**: `metadata.created`, `metadata.updated`, `metadata.released` (ISO 8601).

**Integration**: `metadata.requires[]`, `metadata.conflictsWith[]`, `metadata.provides[]`, `metadata.related[]`.

**Tooling** (decision #55, top-level on purpose — mirrors Claude Code's own frontmatter shape):
- `tools[]` — **allowlist**. If present, the host MUST restrict the node to exactly these tools. Matches the Claude Code subagent `tools` frontmatter. Agents use it to lock down the spawned subagent; other kinds use it as a declarative hint.
- `allowedTools[]` — **pre-approval**. Tools the host MAY use without per-use permission prompts while this node is active. Every other tool remains callable under normal permission rules. Matches the Claude Code skill `allowed-tools` frontmatter. Accepts argument-scoped patterns where the host supports them (`Bash(git add *)`).

**Display**: `metadata.icon`, `metadata.color`, `metadata.priority`, `metadata.hidden`.

**Documentation**: `metadata.docsUrl`, `metadata.readme`, `metadata.examplesUrl`.

### Kind-specific

| Kind | Extra fields |
|---|---|
| `skill` | `inputs`, `outputs` (optional structured) |
| `agent` | `model` |
| `command` | `args[]` (name, type, required), `shortcut` |
| `hook` | `event`, `condition`, `blocking: boolean`, `idempotent: boolean` |
| `note` | (no extras) |

`tools[]` and `allowedTools[]` live on `base` (see §Tooling above) and therefore apply to every kind. They are not repeated in the kind-specific list.

### Validation

Default: **warn** on unknown or missing recommended fields. Emits issues `invalid-frontmatter`, `missing-recommended-field`, `unknown-field`. `--strict` flag promotes to error (for CI).

### DB denormalization

High-query fields stored as columns on `scan_nodes`: `stability`, `version`, `author`. Everything else lives in `frontmatter_json`.

---

## Enrichment

### Scope

- **GitHub** only through `v1.0`. Nodes with `metadata.source` pointing to a GitHub URL.
- **Dropped from the bundle**: skills.sh (no public API after investigation), npm, other registries.
- Post-`v1.0`: other providers via new plugins against stable contract.

### Hash verification (idempotency)

Three layers:

1. **SHA pin**: if `metadata.sourceVersion` is a full commit SHA, the plugin resolves to immutable raw URL `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`. Deterministic.
2. **Tag / branch resolution**: if `sourceVersion` is a tag, branch, or absent, the plugin queries GitHub API for the current commit SHA. Stores `resolvedSha` in `state_enrichments.data_json`. Next refresh compares SHA; only re-fetches if changed.
3. **ETag / `If-None-Match`** (post-`v1.0`): saves bandwidth within rate limit.

### State storage

```sql
CREATE TABLE state_enrichments (
  node_id      TEXT NOT NULL,
  provider_id  TEXT NOT NULL,
  data_json    TEXT NOT NULL,
  verified     BOOLEAN,
  fetched_at   INTEGER NOT NULL,
  stale_after  INTEGER,
  PRIMARY KEY (node_id, provider_id)
);
```

`verified: true` if local `body_hash` matches hash computed over remote raw content. `false` with implicit `locallyModified: true` on mismatch.

### Invocation

No dedicated verb. Uses `sm job submit github-enrichment [-n <id>] [--all]`. Here `--all` is the targeted fan-out flag of `sm job submit`: it applies the action to every eligible node matching the action preconditions.

---

## Reference counts

Three denormalized integer columns on `scan_nodes`:

| Column | Meaning |
|---|---|
| `links_out_count` | outgoing links to other graph nodes |
| `links_in_count` | incoming links from other graph nodes |
| `external_refs_count` | http/https URLs in body (dedup exact match, normalized) |

Computed at scan time. No separate table for URL list — user cares about count, not identity. Reads the file if details needed. No liveness check (optional post-`v1.0` plugin).

Surfaces:
- `sm show`: "N in · M out · K external".
- `sm list --sort-by external-refs`: sort order.

---

## Trigger normalization

Detectors that extract invocation-style links (slashes, at-directives, command names) emit a `link.trigger` block with two fields. Field shape in `spec/schemas/link.schema.json`; normative pipeline in `spec/architecture.md §Detector · trigger normalization`.

- `originalTrigger` — the exact text the detector saw in the source, byte-for-byte. Used for display in `sm show` and the UI.
- `normalizedTrigger` — the output of the pipeline below. Used for equality and collision detection (the `trigger-collision` rule keys on this field).

Both are always present on every trigger-bearing link. Never mutate one without the other.

### Pipeline (Decision #21, normative)

Applied at detector output time, in exactly this order:

1. **Unicode NFD** — decompose into canonical form so combining marks separate from their base characters.
2. **Strip diacritics** — remove every combining mark in the Unicode category `Mn` (Nonspacing_Mark).
3. **Lowercase** — ASCII and Unicode lowercase via locale-independent mapping.
4. **Separator unification** — map every hyphen (`-`), underscore (`_`), and run of whitespace to a single space.
5. **Collapse whitespace** — runs of two or more spaces become one.
6. **Trim** — remove leading and trailing whitespace.

Non-letter/non-digit characters outside the separator set (e.g. `/`, `@`, `:`, `.`) are **preserved** — they are often part of the invocation syntax (`/skill-map:explore`, `@frontmatter-detector`). Stripping them is the detector's responsibility, not the normalizer's: the normalizer acts on what the detector considers "the trigger text".

### Worked examples

| `originalTrigger` | `normalizedTrigger` |
|---|---|
| `Hacer Review` | `hacer review` |
| `hacer-review` | `hacer review` |
| `hacer_review` | `hacer review` |
| `  hacer   review  ` | `hacer review` |
| `Clúster` | `cluster` |
| `/MyCommand` | `/mycommand` |
| `@FooDetector` | `@foodetector` |
| `skill-map:explore` | `skill-map:explore` → `skill map:explore` *(hyphen maps to space, colon preserved)* |

Note the last row: colons and slashes pass through untouched. Plugin authors that want stricter normalization (e.g. stripping the `/` prefix on slash commands) apply it inside their detector before emitting the link, not afterwards.

### Stability

The pipeline ordering is **stable** as of the next spec release. Adding a new step at the end is a minor bump; reordering, removing, or changing any existing step (including the character classes in step 4) is a major bump. Implementations MUST produce byte-identical `normalizedTrigger` output for byte-identical input.

---

## Configuration

`.skill-map/settings.json` is the canonical config file for both the CLI and the bundled UI. Each scope keeps its own folder; the loader walks a layered hierarchy and deep-merges per key. The filename, the `.local.json` partner, and the folder convention mirror Claude Code (`.claude/settings.json` + `.claude/settings.local.json`).

### Hierarchy (low → high precedence, last wins)

1. **Library defaults** — compiled into the bundle (`src/config/defaults.json` for the CLI, `ui/src/models/settings.ts` for the UI). Always present; the app must boot with these alone.
2. **User config** — `~/.skill-map/settings.json`. Personal defaults across projects.
3. **User local** — `~/.skill-map/settings.local.json`. Machine-specific overrides; never committed (naming convention only — there is no `~` to gitignore).
4. **Project config** — `<scope>/.skill-map/settings.json`. Team-shared settings; committed.
5. **Project local** — `<scope>/.skill-map/settings.local.json`. Per-developer overrides; gitignored by `sm init`.
6. **Env vars / CLI flags** — point-in-time overrides per invocation.

`sm ui --config <path>` (Step 14) is a separate escape hatch: the supplied file **replaces** layers 2–5 entirely (single-source override; useful for reproducibility, CI, debugging). Defaults still apply underneath, env / flags still wrap on top.

Deep merge at load. Each layer may be a `Partial`; missing keys fall through to the next lower layer. Validated against `spec/schemas/project-config.schema.json` (CLI keys) and `spec/runtime-settings.schema.json` (UI keys, lands at Step 14). Malformed JSON or type-mismatches emit warnings and skip the offending key; the app never crashes on bad config. `--strict-config` flips warnings into fatal errors.

### Runtime delivery to the UI

The bundled UI is a static artifact — it does not read files from disk. The CLI sub-command `sm ui` (Step 14) loads + merges + validates the hierarchy and serves the resulting object as `GET /config.json` over the same HTTP server that hosts the UI bundle. The UI fetches that URL once on boot (via `APP_INITIALIZER`), then reads the data through a signal-backed `RuntimeConfigService`. When the bundle is served by a third party (nginx, S3, Caddy), the operator places a `config.json` next to `index.html`; same contract from the UI's side.

This is the only path by which UI-side keys reach the browser. There is no build-time UI config and no `fileReplacements`. Changing UI settings means editing one of the four files in the hierarchy (or the `--config` override) and restarting the server — see §Step 14 for why hot reload is deferred.

> **Spec migration (landed Step 6.1, 2026-04-27).** The spec previously anchored the config on a single project-root file `.skill-map.json`; it now describes the folder + `.local.json` partner convention canonically. Updated in one changeset: `spec/schemas/project-config.schema.json` description, `spec/db-schema.md` (history.share line), `spec/conformance/coverage.md` (case #6 description). Pre-1.0 minor bump per `spec/versioning.md` — breaking-change tolerance applies to the on-disk filename only; the schema shape is unchanged so consumers who only care about keys and values are unaffected. No backward-compat shim ships: scopes created before 6.5 (`sm init`) didn't have a real loader anyway, and the only known prior fixture (`mock-collection/.claude/commands/init*.md`) is demo content scheduled for refresh together with `sm init`.

### Commands

| Command | Purpose |
|---|---|
| `sm config list` | Effective config. |
| `sm config get <key>` | Single value. |
| `sm config set <key> <value>` | Write to user config (scope-aware). |
| `sm config reset <key>` | Remove override. |
| `sm config show <key> --source` | Reveals origin (default / project / global / env / flag). |

### Notable config keys

All declared in `spec/schemas/project-config.schema.json`. Defaults shown.

- `schemaVersion: 1` — shape version of the config file itself. Bumped on breaking changes to the config schema; consumers use it to detect older configs and apply migration paths.
- `autoMigrate: true` — apply pending kernel + plugin migrations at startup (after auto-backup). `false` → startup fails with exit 2 if migrations are pending.
- `tokenizer: "cl100k_base"` — offline token estimator. Stored alongside counts so consumers know which encoder produced them.
- `adapters: []` — adapter ids to enable, in priority order when multiple match a path. Empty/absent = all registered adapters active.
- `roots: []` — directories (relative to the config file) to scan. Defaults to the scope root.
- `ignore: [...]` — top-level glob patterns excluded from scan, in addition to `.skill-mapignore`.
- `plugins: { <id>: { enabled, config } }` — per-plugin enable/disable overrides and plugin-specific config passed to extensions at load time. Keys are plugin ids; absent means the plugin's installed default (enabled) applies.
- `scan.tokenize: true`, `scan.strict: false`, `scan.followSymlinks: false`.
- `scan.maxFileSizeBytes: 1048576` — 1 MiB floor; oversized files are skipped with an `info` log.
- `history.share: false` — experimental. When `true`, `./.skill-map/skill-map.db` is expected to be committed (team removes it from `.gitignore`). No GC policy for `state_executions` through `v1.0` — the table is append-only (see §Step 7). When demand appears post-`v1.0`, a `history.retention.*` block lands in a later minor bump with concrete defaults and enforcement semantics.
- `jobs.ttlSeconds: 3600` — base duration used when an action manifest omits `expectedDurationSeconds`. Fed into the formula `computed = max(base × graceMultiplier, minimumTtlSeconds)`. Typical for `mode: local` actions where the duration hint is advisory.
- `jobs.graceMultiplier: 3` — multiplier applied to the base duration before the floor check.
- `jobs.minimumTtlSeconds: 60` — TTL floor (never a default). Guarantees no job is claimed with a sub-minute deadline.
- `jobs.perActionTtl: { <actionId>: <seconds> }` — per-action TTL override. Replaces the computed TTL entirely; skips the formula.
- `jobs.perActionPriority: { <actionId>: <integer> }` — per-action priority override (decision #40). Higher runs first; ties break by `createdAt ASC`. Frozen at submit.
- `jobs.retention.completed: 2592000` — 30 days default; `null` → never auto-prune.
- `jobs.retention.failed: null` — never auto-prune; failed jobs kept for post-mortem.
- `i18n.locale: "en"` — experimental.

The default contents of a fresh `.skill-mapignore` file (used by `sm init`) live in the reference impl under `src/config/defaults/` and are **not** a user-visible config key — editing the generated file is the supported override.

### UI-side keys

Declared in `ui/src/models/settings.ts` and shipped via the runtime delivery path above. The interface is `ISkillMapSettings` (compile-time) and will be formalised in `spec/runtime-settings.schema.json` at Step 14 once the contract stabilises.

- `graph.perf.cache: true` — Foblex `[fCache]` toggle. Caches connector / connection geometry across redraws (pan, zoom, drag).
- `graph.perf.virtualization: false` — `*fVirtualFor` over node iteration. Renders only nodes whose bounding box intersects the viewport. Enable above ~300 visible nodes; below that the bookkeeping cost outweighs the gain. Off by default — flip to `true` when the perf HUD inside the graph view shows fps drops on large collections.

These keys cohabit the same `.skill-map/settings.json` as the CLI keys above. They are merged by the same loader, served by `sm ui` over the same `/config.json` HTTP endpoint. The UI ignores keys it does not recognise (graceful forward-compat); the CLI does the same with UI keys (which it doesn't read directly).

---

## CLI surface

Global flags: `-g` scope · `--json` output · `-v`/`-q` · `--no-color` · `-h`/`--help` · `--db <path>` (escape hatch).

Env-var equivalents (Decision #38 + `spec/cli-contract.md §Global flags`): `SKILL_MAP_SCOPE`, `SKILL_MAP_JSON`, `SKILL_MAP_DB`, `NO_COLOR`. Precedence: flag > env > config > default.

`--all` is not a global flag. It is documented only on verbs with meaningful fan-out semantics, such as `sm job submit`, `sm job run`, `sm job cancel`, and `sm plugins enable/disable`.

### Exit codes

Normative across every verb (Decision #38; `spec/cli-contract.md §Exit codes`):

| Code | Meaning |
|---|---|
| `0` | Success, no issues. |
| `1` | Success with issues (rules emitted warnings/errors; pipelines use this to gate). |
| `2` | Generic operational error (bad input, runtime failure, missing binary). |
| `3` | Duplicate job — refused by the content-hash check; existing id reported. |
| `4` | Nonce mismatch on `sm record` — authentication failure, no state mutation. |
| `5` | Not found — node, job, or execution id did not resolve. |
| `6–15` | Reserved for future spec use. MUST NOT be taken by verb-specific codes. |
| `≥16` | Free for implementations to use on a per-verb basis (documented in `sm help <verb>`). |

### Elapsed time

**Elapsed-time reporting is normative** (see `spec/cli-contract.md §Elapsed time`). Every verb that walks the filesystem, hits the DB, spawns a subprocess, or renders a report MUST report its own wall-clock duration: `done in <N>ms | <N.N>s | <M>m <S>s` on stderr (suppressed by `--quiet`); and, when the verb's `--json` payload is a top-level object, an `elapsedMs` integer field. Sub-millisecond informational verbs (`--version`, `--help`, `sm version`, `sm help`, `sm config get/list/show`) are exempt. The grammar and field contract are **stable** from spec v1.0.0 — changing them is a major bump.

### Setup & state

| Command | Purpose |
|---|---|
| `sm init [--no-scan] [--force]` | Bootstrap scope (creates `.skill-map/`, DB, runs first scan). `--no-scan` skips the initial scan. `--force` rewrites an existing config. |
| `sm version` | CLI / kernel / spec / DB schema versions. |
| `sm doctor` | DB integrity, pending migrations, orphan files, plugins in error, LLM runner availability. |
| `sm help [<verb>] [--format human\|md\|json]` | Self-describing introspection. |

### Config

See [Configuration](#configuration).

### Scan

| Command | Purpose |
|---|---|
| `sm scan` | Full scan. |
| `sm scan -n <id>` | Partial (one node). Replaces `sm rescan`. |
| `sm scan --changed` | Incremental (mtime-based). |
| `sm scan --compare-with <path>` | Delta report. |

### Browse

| Command | Purpose |
|---|---|
| `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N]` | Tabular. |
| `sm show <id>` | Detail: weight (bytes + tokens triple-split), frontmatter, links in/out, issues, findings, summary. |
| `sm check` | All current issues (deterministic). |
| `sm findings [--kind ...] [--since ...] [--threshold <n>]` | Probabilistic findings (injection, stale summaries, low confidence). |
| `sm graph [--format ascii\|mermaid\|dot]` | Graph render. |
| `sm export <query> --format json\|md\|mermaid` | Filtered export. |
| `sm orphans` | History rows whose node is missing. |
| `sm orphans reconcile <orphan.path> --to <new.path>` | Forward migration: attach orphan's history rows to a live node after a rename the heuristic missed. |
| `sm orphans undo-rename <new.path> [--from <old.path>] [--force]` | Reverse a medium- or ambiguous-confidence auto-rename. Reads the prior path from the issue's `data_json`; `--from` disambiguates when the issue is `auto-rename-ambiguous`. |

### Actions

| Command | Purpose |
|---|---|
| `sm actions list` | Registered action types. |
| `sm actions show <id>` | Manifest detail. |

### Jobs

See [Job system](#job-system).

### Record (callback)

| Command | Purpose |
|---|---|
| `sm record --id <id> --nonce <n> --status completed --report <path> --tokens-in N --tokens-out N --duration-ms N --model <name>` | Success close. |
| `sm record --id <id> --nonce <n> --status failed --error "..."` | Failure close. |

### History

| Command | Purpose |
|---|---|
| `sm history [-n <id>] [--action <id>] [--status ...] [--since <date>]` | Executions log. |
| `sm history stats` | Aggregates (tokens per action, per month, top nodes). |

### Plugins

See [Plugin system](#plugin-system).

### Audits

| Command | Purpose |
|---|---|
| `sm audit list` | Registered audits. |
| `sm audit run <id>` | Execute, print report. |

### LLM verbs (Step 11)

Shipped at Step 11 per Decision #49. Single-turn — each verb submits one probabilistic job, then renders a finding or structured report. A runner must be available (`sm doctor` reports status; see §Step 10). Exact flag surface locks per verb during Step 11.

| Command | Purpose |
|---|---|
| `sm what <id>` | LLM-produced description of what a node does. Reuses the cached summary when fresh; otherwise submits a `what` job. |
| `sm dedupe` | Find semantically-duplicate nodes across the graph. |
| `sm cluster-triggers` | Group equivalent triggers beyond the deterministic normalizer (Decision #21). |
| `sm impact-of <id>` | Reverse-dependency summary: which nodes rely on this one, directly or transitively. |
| `sm recommend-optimization` | Suggest refactors per node (size, redundancy, structure). Canonical caller for the `skill-optimizer` dual-surface action (Decision #86). |

### Database

See [Persistence](#persistence).

### Server

| Command | Purpose |
|---|---|
| `sm serve [--port N] [--host ...] [--no-open]` | Hono + WebSocket for Web UI. |

### Introspection

- `sm help --format json` — structured surface dump.
- `sm help --format md` — canonical markdown for `context/cli-reference.md` (CI-enforced sync).
- Consumers: docs generator, shell completion, Web UI form generation, IDE extensions, test harness, the `sm-cli` skill (agent integration).

---

## Skills catalog

Single source of truth for every skill-shaped artifact shipped alongside `skill-map`. All use the `/skill-map:` namespace inside host agents (Claude Code today; future hosts register under the same namespace).

| Id | Type | Host | Ships at | Purpose |
|---|---|---|---|---|
| `/skill-map:explore` | Meta-skill (conversational) | Claude Code | Step 11 | Wraps every `sm … --json` verb into a single slash-command. Maintains follow-ups with the user, feeds CLI introspection to the agent, orchestrates multi-step exploration. Replaces the earlier per-verb `explore-*` idea. |
| `/skill-map:run-queue` (slash command) · `sm-cli-run-queue` (npm package) | Skill agent (driving adapter) | Claude Code | Step 10 | Drains the job queue in-session: loops `sm job claim` → Read → [agent reasons] → Write report → `sm record`. Does NOT implement `RunnerPort`; peer of CLI runner. The npm package is the distributable that a user drops into their Claude Code plugin folder; it wraps the skill manifest plus host-specific glue (e.g. `TaskCreate` integration for progress) and registers the slash command. |
| `sm-cli` | Agent integration package | Claude Code (installable) | Step 14 | Feeds `sm help --format json` to the agent so it can compose CLI invocations without hand-maintained knowledge. Mentioned in Decision #65; ships at distribution polish. |
| `skill-optimizer` | Dual-surface action + skill | Claude Code (skill) + any runner (action) | Skill exists before `v0.5.0`; action wrapper Step 10 | Canonical dual-mode example: exists as a Claude Code skill AND is wrapped as a `skill-map` Action in `invocation-template` mode. Serves as the reference pattern for "same capability, two surfaces". |

Naming rules:

- **Slash-command ids** (`/skill-map:<verb>`) are what the user types inside the host.
- **Package ids** (`sm-cli`, `sm-cli-run-queue`) are what the user installs. One package MAY register multiple slash-commands; one slash-command is registered by exactly one package.
- **Host-specific** skills live under `sm-cli-*` namespace. When a second host (Codex, Gemini) lands as an adapter, its skill packages get their own prefix (`sm-codex-*`, `sm-gemini-*`) — the namespace is owned by the host, not by the skill.

Non-skills shipped for context (listed here to prevent confusion, do NOT register as skills):

- **CLI runner loop** — the `sm job run` command itself. Driving adapter (uses `RunnerPort` via `ClaudeCliRunner`). Not a skill.
- **Default plugin pack** — `github-enrichment`, plus TBD detectors/rules. Not skills, but installable via drop-in.

---

## UI (Step 0c prototype → Step 13 full)

### Step 0c — Prototype (Flavor A)

Build order inversion: UI prototype **before** kernel implementation. Mocked JSON fixtures derived from a real on-disk collection of skills / agents / commands / hooks / notes. Iterates design cheaply before committing to kernel API.

Scope:
- Graph view (Foblex Flow) — card-style nodes with title, kind badge, version, triggers, link counts.
- List view with frontmatter-driven columns.
- Inspector panel: weight, summary (mocked), links, issues, findings, 🔄 det + 🧠 prob buttons.
- Filters by kind / stability / issue.
- Simulated event flow: fake run-queue emitting canonical events.

Tech picks locked at Step 0c start:
- Frontend framework: **Angular latest** (standalone components). Always track the latest stable Angular release; upgrades happen explicitly by editing the pinned version in `ui/package.json`, not automatically via caret ranges. (Decision #72, revised twice — see post-0c review below and the dependency-pinning revision dated 2026-04-23.)
- Node-based UI library: **Foblex Flow** (Angular-native). Cards as Angular components with arbitrary HTML.
- Component library: **PrimeNG** (tables, forms, dialogs, menus, overlays).
- Styling: **SCSS scoped per component**. No utility CSS framework (no Tailwind, no PrimeFlex) — avoided overlap with PrimeNG's own theming.
- Workspace: `ui/` as an npm workspace peer of `spec/` and `src/`. The kernel never imports Angular; the UI never imports kernel internals (only typed DTOs from `spec/`).

Post-0c review pass (2026-04-22) — decisions resolved:
- **Decision #72 revised**: Angular pin changed from "pin to v21" to "track latest stable". No major pinning.
- **Decision #72 revised again (2026-04-23)**: dependency policy tightened across the repo. `package.json` at root, `ui/`, and `src/` pin every dependency to an exact version (no `^` / `~`). Reproducible installs and zero-surprise upgrades take priority over automatic patch drift. `spec/` has no dependencies. The policy is revisited the day `src/` flips to public — a published lib may want caret ranges so consumers can dedupe transitive deps. Canonical statement in `AGENTS.md` §Rules for agents working in this repo.
- **DTO gap**: close via codegen (json-schema-to-typescript from `spec/schemas/`) at Step 4 or Step 5. Hand-curated mirrors in `ui/src/models/` and `src/kernel/types/` remain until then.
- **Plugin migrations + SQL parser**: deferred to Step 9 (Plugin author UX). No plugins ship own migrations before that.
- **Plugin API stability (Decision #89)**: extension runtime interfaces (`IAdapter`, `IDetector`, `IRule`, `IRenderer`, `IAudit`) are declared semver-stable at v1.0.0. Pre-v1.0, breaking changes to these interfaces are minor bumps with a changelog note.
- **Link conflict merge (Decision #90)**: when two detectors emit a link for the same (from, to) pair, both rows coexist in `scan_links`. No merge, no dedup. Each detector's link carries its own confidence and source. Consumers that need uniqueness aggregate at read time.

### Step 13 — Full UI (Flavor B)

Vertical slice with real kernel. Same prototype upgraded to consume the actual Hono server.

**Single-port mandate (non-negotiable)**: `sm serve` exposes the SPA, the BFF and the WebSocket under **one listener**. Consumers never need to know two ports exist.

```
sm serve --port 7777
│
├── GET  /api/*     → BFF endpoints (thin wrappers over kernel)
├── WS   /ws        → canonical job / scan / issue events
├── GET  /assets/*  → Angular bundles (JS/CSS/fonts)
└── GET  /*         → fallback to ui/dist/index.html (SPA routing)
```

- **Production**: Hono serves the Angular build via `serveStatic` alongside the API and WS. One process, one port, one command.
- **Development**: Angular dev server with HMR (its own port) proxies `/api` and `/ws` to Hono via `proxy.conf.json`. The SPA still sees a single origin.
- BFF role: **thin proxy** over the kernel. No domain logic. No second DI. Keep it minimal — that is why Hono was chosen over NestJS / Express.

WebSocket `/ws` endpoint:
- Server pushes the canonical event stream from `spec/job-events.md`: job family (stable) + `scan.*` + `issue.*` families (experimental in v0.x).
- UI sends commands (rescan, submit, cancel) on the same channel.
- REST HTTP reserved for discrete CRUD (config, exports).

Inspector panel renders:
```
External (github-enrichment, if applicable):
  stars, last commit, verified ✓/✗

Summary (per-kind summarizer, if run):
  kind-specific summary fields
  (stale) flag if bodyHash diverged

Links:
  incoming (N) and outgoing (M) with kinds

Issues: N     Findings: M
```

---

## Testing strategy

From commit 1. Same rigor as kernel-first.

| Layer | What it tests | When |
|---|---|---|
| Contract | Every registered extension conforms to its kind's schema | Each startup + CI |
| Unit | Each detector / rule / adapter / etc. in isolation | CI + dev |
| Integration | Scanner end-to-end over fixtures | CI |
| Self-scan | `sm scan` on skill-map's own repo | CI (mandatory) |
| CLI | Spawn binary, assert stdout / stderr / exit codes | CI |
| Snapshot | Renderers produce byte-exact output | CI |

Framework: **`node:test`** (built-in, zero deps, Node 24+).

Every extension in `src/extensions/` ships a sibling `*.test.ts`. Missing test → contract check fails → tool does not boot.

**Performance budget**: `sm scan` on 500 MDs completes in ≤ 2s on a modern laptop, enforced by a CI benchmark (lands with Step 4 when the scanner goes end-to-end).

**Conformance cases deferred**: `preamble-bitwise-match` lands in Step 10 alongside `sm job preview` (needs a rendered job file for byte-exact comparison against `spec/conformance/fixtures/preamble-v1.txt`). The case is mandatory before the `v0.8.0` release.

Plugin author testkit: `skill-map/testkit` exports helpers + mock kernel for third-party plugin tests.

---

## Stack conventions

- **Naming**: two rules, both normative and enforced spec-wide (see `spec/README.md` §Naming conventions).
  - **Filesystem artefacts in kebab-case**: every file, directory, enum value, and `issue.ruleId` value — `scan-result.schema.json`, `job-lifecycle.md`, `auto-rename-medium`, `direct-override`. So a value can be echoed into a URL, a filename, or a log key without escaping.
  - **JSON content in camelCase**: every key in a schema, frontmatter block, config file, plugin/action manifest, job record, report, event payload, or API response — `whatItDoes`, `injectionDetected`, `expectedTools`, `conflictsWith`, `docsUrl`, `ttlSeconds`, `runId`. The SQL layer is the sole exception (`snake_case` tables/columns, bridged by Kysely's `CamelCasePlugin`); nothing crosses the kernel boundary as `snake_case`.
- **Runtime**: Node 24+ (required — active LTS since Oct 2025; `node:sqlite` stable; WebSocket built-in; modern ESM loader).
- **Language**: TypeScript strict + ESM.
- **Build**: `tsup` / `esbuild`.
- **CLI framework**: **Clipanion** (pragmatic pick — introspection built-in, used by Yarn Berry).
- **HTTP server**: **Hono** (lightweight, ESM-native). Acts as the BFF for the Angular UI and any future client.
- **WebSocket**: server side uses `hono/ws` + `@hono/node-ws` (co-located with the Hono router so REST and WS share a single listener — single-port mandate). Client side uses the browser-native `WebSocket` (browser) or the Node 24 global `WebSocket` (Node-side tests and consumers — no extra dep). The standalone `ws` library is rejected: it duplicates glue for the HTTP/WS multiplex.
- **Single-port mandate**: `sm serve` exposes SPA + BFF + WS under one listener. Dev uses Angular dev server + proxy; prod uses Hono + `serveStatic`.
- **UI framework**: **Angular ≥ 21** (standalone components). Scaffolded at `^21.0.0`, later pinned to an exact version per the dependency-pinning policy — see §Rules for agents working in this repo in `AGENTS.md`.
- **Dependency versioning policy**: every dependency in `package.json` at root, `ui/`, and `src/` is pinned to an exact version (no `^` / `~`). `spec/` has no dependencies. Reproducibility takes priority over automatic patch drift; upgrades are explicit edits. Revisit if `src/` ever flips to public — published libs may want caret ranges so consumers can dedupe transitive deps.
- **Node-based UI library**: **Foblex Flow**.
- **Component library**: **PrimeNG** + `@primeuix/themes` for theming. The legacy `@primeng/themes` package is deprecated upstream (the registry marks it as `Deprecated. Please migrate to @primeuix/themes`) and is intentionally NOT used.
- **UI styling**: **SCSS scoped per component**. No utility CSS (no Tailwind, no PrimeFlex).
- **UI workspace**: `ui/` as npm workspace peer of `spec/` and `src/`. Kernel is Angular-agnostic; UI imports only typed contracts from `spec/` once those exist — see the DTO gap note below.
- **UI YAML parser**: **`js-yaml`** — locked at Step 0c when the prototype's mock-collection loader first needs to parse frontmatter in the browser. The second candidate (`yaml`) was dropped at pick time; revisit only if the impl-side pick diverges.

### UI-only deps (Step 0c onwards)

These deps live in `ui/package.json` only. The kernel does NOT import them and MUST never gain a transitive path to them — they stay on the UI side of the workspace boundary.

- **`js-yaml`** (+ `@types/js-yaml`) — frontmatter parsing in the browser. Locked above; duplicated here so a reader of §UI-only deps has the full picture.
- **`@dagrejs/dagre`** — hierarchical graph auto-layout. Consumes `{ nodes, edges }`, returns `{ x, y }` per node; rendering stays with Foblex. Picked over the inactive `dagre` package (the `@dagrejs/*` scope is the maintained fork). No viable Angular-native alternative at Step 0c pick time; revisit only if Foblex ships its own layout primitive that covers the same cases.
- **`primeng`** + **`@primeuix/themes`** — already captured in §UI framework.
- **`@foblex/flow`** + peers — already captured in §Node-based UI library.
- **DB**: SQLite via `node:sqlite` (zero native deps).
- **Data-access**: **Kysely + CamelCasePlugin** (typed query builder, not an ORM).
- **Logger**: `pino` (JSON lines).
- **Tokenizer**: `js-tiktoken` (cl100k_base).
- **Semver**: `semver` npm package.
- **File watcher** (Step 7): `chokidar`.
- **Package layout**: npm workspaces — `spec/` (`@skill-map/spec`), `src/` (`@skill-map/cli`, with subpath `exports` for `./kernel` and `./conformance`), `ui/` (private, joins at Step 0c). The `alias/*` glob held un-scoped placeholder packages (`skill-map`, `skill-mapper`) for one publish round; once the names were locked on npm and a `npm deprecate` notice routed users to `@skill-map/cli`, the workspaces were dropped. Further `@skill-map/*` splits deferred until a concrete external consumer justifies them.

### Tech picks deferred (resolve at the step that first needs them)

~~YAML parser (`yaml` vs `js-yaml`)~~ — **resolved at Step 0c: `js-yaml`.** · MD parsing strategy (regex vs `remark`/`unified`) · template engine for job MDs (template literals vs `mustache` vs `handlebars`) · pretty CLI output (`chalk` + `cli-table3` + `ora`) · path globbing (`glob` vs `fast-glob` vs `picomatch`) · diff lib (hand-written vs `deep-diff` vs `microdiff`).

Lock-in-abstract rejected during Step 0b: each pick lands with the step that first requires it, so the decision is made against a concrete use case rather than in the void.

### DTO gap — pending Step 2

The §Architecture section ("The kernel never imports Angular; `ui/` never imports `src/` internals. The sole cross-workspace contract is `spec/` (JSON Schemas + typed DTOs)") promises typed TypeScript DTOs emitted by `@skill-map/spec`. As of Step 1b the promise is still aspirational — `@skill-map/spec` exports only JSON Schemas and `index.json`, no `.d.ts`. Both the ui prototype (under `ui/src/models/`) and the kernel plugin loader (under `src/kernel/types/plugin.ts`) hand-curate local mirrors of the shapes they need. The drift risk is accepted because (a) the mirrors are small — 17 schemas total, with only five kernel-side interfaces exposed by `plugin.ts`; (b) AJV already enforces the real shapes at runtime against the authoritative schemas, so a divergent TS mirror surfaces as a validation error at boot rather than a silent bug. The canonical fix moves to **Step 2**, when the first real adapter/detector/rule arrives as a third consumer and a single source of truth becomes justified against three real consumers instead of two. The pick (e.g. `json-schema-to-typescript` at build, or hand-curated `.d.ts` published via `spec/types/`) lands then. Until Step 2 ships, any type under `ui/src/models/` or `src/kernel/types/` that diverges from its schema is flagged as a review-pass issue at the close of whichever step introduces the divergence.

---

## Execution plan

Sequential build path. Each step ships green tests before the next begins.

> ▶ **Completeness marker (2026-04-27)**: Steps **0a**, **0b**, **0c**, **1a**, **1b**, **1c**, **2**, **3**, **4**, **5**, and **6** are **complete**. Step 6 shipped Config + onboarding across seven sub-steps (6.1 — spec rename `.skill-map.json` → `.skill-map/settings.json` across `project-config.schema.json` description, `db-schema.md` `history.share` reference, and `conformance/coverage.md` row #6; schema shape unchanged so consumers reading values are unaffected; 6.2 — layered config loader at `src/kernel/config/loader.ts` walking defaults → user → user-local → project → project-local → overrides with deep-merge per key, per-key resilience that strips offending values without invalidating siblings, sources map for `sm config show --source`, and `--strict-config` to escalate warnings to thrown errors; 6.3 — `sm config list/get/set/reset/show` replacing five stubs, JSON-first value coercion on `set`, schema re-validation that rejects invalid writes (exit 2), `--source` revealing the winning layer with highest-precedence-descendant resolution for nested objects; 6.4 — `.skill-mapignore` parser at `src/kernel/scan/ignore.ts` wrapping `ignore@7.0.5` (zero-deps, gitignore-spec compliant), bundled defaults file at `src/config/defaults/skill-mapignore` copied into `dist/` via tsup `onSuccess`, new `IIgnoreFilter` plumbed through `IAdapter.walk` and `RunScanOptions.ignoreFilter`, claudeAdapter walker tracks rel-path during recursion to consult the filter for every directory and file; 6.5 — `sm init` scaffolding replacing the stub: creates `.skill-map/{settings.json,settings.local.json,skill-map.db}`, drops a starter `.skill-mapignore`, appends two entries to `.gitignore` (creates if missing, dedupes existing lines, preserves comments), runs first scan inline with `runScanWithRenames` + `persistScanResult` (skipped via `--no-scan`); `-g` switches to `~/.skill-map/` with no `.gitignore` writes; `--force` overwrites; 6.6 — `sm plugins enable/disable` + `config_plugins` storage helpers (`setPluginEnabled`, `getPluginEnabled`, `loadPluginOverrideMap`, `deletePluginOverride`), `resolvePluginEnabled` implementing **DB > settings.json > installed default** precedence (Decision: per-machine override of team baseline), `PluginLoader.resolveEnabled?` callback short-circuiting to new `'disabled'` `TPluginLoadStatus` with manifest preserved + extensions skipped, `sm plugins doctor` treats `disabled` as intentional (no contribution to issue list, no exit-code flip), merge rule documented in `spec/db-schema.md` §`config_plugins`; 6.7 — frontmatter strict mode: per-kind frontmatter schemas (`frontmatter-skill / -agent / -command / -hook / -note`) registered as top-level validators, orchestrator validates after each adapter yield (skipping fence-less files), `frontmatter-invalid` issue at `severity: 'warn'` by default and `'error'` under `--strict` (CLI flag) or `scan.strict: true` (config); incremental scans preserve cached frontmatter issues across passes via `priorFrontmatterIssuesByNode` index so a clean second scan doesn't silently drop the warning; 500-MD perf benchmark moved 2000ms → 2500ms ceiling to absorb the AJV per-file cost (~50-80μs × 500 ≈ 30ms). Step 6 closed: 213 → **303 of 303 tests pass** (+90 across all seven Step 6 sub-steps). **7 changesets** pending in `.changeset/` (`step-6-1-config-folder-rename` through `step-6-7-frontmatter-strict`, all tagged patch). Next step: **Step 7 — Robustness**. Explicitly postponed by design (carried over from Step 5): `preamble-bitwise-match` conformance case (deferred to Step 10, needs `sm job preview`), remaining tech picks (MD renderer, templating, pretty CLI, globbing, diff — each lands at the step that first needs it; MD renderer specifically flagged under Step 13 open picks), `sm db migrate --kernel-only` / `--plugin <id>` flags + plugin migrations with triple protection (deferred to Step 9), URL-synced filter state + bundle-budget full compliance + UI a11y baseline (Decision #74f) all deferred to Step 13. Carried over from prior steps: URL-extraction regex truncates parens (Wikipedia/MDN URLs short-changed) and reference-style markdown links match only on the definition line — both are intentional trade-offs flagged for a future detector polish pass; `SqliteStorageAdapter` can't open `:memory:` because `init()` opens two separate `DatabaseSync` connections (tests use `mkdtempSync` file paths instead). The Step 5 sub-step prose is preserved in the canonical changesets and prior README revisions; condensed here so the marker stays scannable.

> ▶ **Step 4 history (kept for reference, no longer the active marker)**: Step 4 shipped end-to-end in eleven sub-steps: 4.1 — `persistScanResult` driven adapter writes `scan_*` tables (replace-all, transactional) and `ScanCommand` opens `SqliteStorageAdapter` + auto-migrates by default (skipped under `--no-built-ins` for kernel-empty-boot parity); fixed a latent `defaultMigrationsDir()` bug that misresolved the bundled `dist/migrations/` layout. 4.2 — per-node token counts via `js-tiktoken` cl100k_base (lite import + ranks-only for bundle hygiene), `--no-tokens` opt-out, encoder reused once per scan (cold-start ~150–200 ms amortised). 4.3 — `external-url-counter` detector landed as the 4th detector + one entry in `built-ins.ts` (drop-in proof from Step 2); orchestrator partitions http(s) pseudo-links out of `result.links`, increments `node.externalRefsCount`, then drops them — never persisted to `scan_links`, never reach rules. 4.4 — `sm scan -n / --dry-run` (no DB writes at all) and `--changed` (incremental: reuse unchanged nodes by `bodyHash + frontmatterHash`, re-run rules over the merged graph, degrade to full scan with stderr warning when no prior snapshot exists); new `loadScanResult` helper inverts persistence; rejects `--changed --no-built-ins` combination. 4.5 — `sm list / show / check` replaced their stubs with real `scan_*` readers; shared `cli/util/db-path.ts` extracted from `db.ts`; `--issue` filter via SQLite `json_each` over `node_ids_json`; per-column sort defaults (numeric → DESC, textual → ASC); `--sort-by` whitelist prevents SQL injection. 4.6 — self-scan acceptance test (validates live repo against schemas, no error-severity issues, all 5 node kinds asserted modulo `command/hook` tolerated when those dirs are empty) + 500-MD performance benchmark at ~1037 ms vs 2000 ms budget. 4.7 — runtime ScanResult reconciled with `scan-result.schema.json` (silent drift since Step 0c surfaced by the self-scan): `scannedAt` flipped to integer ms, `scope` defaults to `'project'`, `adapters[]` enumerated, `scannedBy { name, version, specVersion }` embedded, `stats.filesWalked / filesSkipped` populated; `roots: minItems 1` enforced; spec was authoritative all along — no spec edits, only runtime catches up; `loadScanResult` synthetic envelope updated to satisfy spec. 4.8 — first bug bundle from manual e2e validation: `sm scan` exit code now matches the spec (1 only on `error`-severity issues; previously 1 on any issue, applied to both human and `--json` paths so `sm scan --json` no longer hides errors); `sm show` prints `External refs: <N>` after the Weight section to close a human/JSON parity gap; `sm scan --changed` no longer drops `supersedes`-inversion links from cached nodes — `originatingNodeOf(link, priorNodePaths)` discriminates between forward `supersedes` (source is originating) and inverted `supersedes` (target is originating, emitted by frontmatter `metadata.supersededBy`); regression invariant codified — full-scan and `--changed`-scan over the same input produce set-equal `links`. 4.9 — second bug bundle: `trigger-collision` rule now detects two nodes advertising the same trigger via `frontmatter.name` (was only firing on case-mismatch invocations between distinct sources); `sm scan` now `PRAGMA wal_checkpoint(TRUNCATE)` after persist so external read-only tools see fresh state without manual intervention. 4.10 — scenario coverage: 10 new regression tests across mutation lifecycle (body-only vs frontmatter-only hash discrimination, external-refs lifecycle, replace-all ID rotation contract), incremental `--changed` interactions with deletion and trigger-collision, and CLI handler-level coverage of `--no-tokens` and `--changed --no-built-ins` rejection. Pure coverage growth, no production code change. 4.11 — empty-scan guard: three layers of defense against the typo-trap where `sm scan -- --dry-run` (with `--` making `--dry-run` a positional root) silently wiped the user's populated DB. Layer 1: `runScan` validates every root path is a real directory; throws on first failure. Layer 2: `ScanCommand` catches the throw, stderr + exit 2. Layer 3: even if a zero-result scan slips through, the CLI refuses to wipe a populated DB without an explicit `--allow-empty` flag. Eight new regression tests cover the kernel-level validation, the CLI exit-code path, the populated-DB refusal, the explicit-wipe override, and the dry-run/no-built-ins guard bypass. Step 4 closed: 88 → **151 of 151 tests pass** (+63 across Step 4). **11 changesets** pending in `.changeset/`. Next step: **Step 5 — History + orphan reconciliation**. Explicitly postponed by design: `preamble-bitwise-match` conformance case (deferred to Step 10, needs `sm job preview`), remaining tech picks (MD renderer, templating, pretty CLI, globbing, diff — each lands at the step that first needs it; MD renderer specifically flagged under Step 13 open picks), `sm db migrate --kernel-only` / `--plugin <id>` flags + plugin migrations with triple protection (deferred to Step 9), URL-synced filter state + bundle-budget full compliance + UI a11y baseline (Decision #74f) all deferred to Step 13. Known follow-ups carried into Step 5+: persisting scan meta (`scope`, `roots`, `scannedAt`) into a `state_scan_meta` table so `loadScanResult` doesn't return synthetic values; `state_scan_meta` is also the future home for cached external-URL pseudo-links if `--changed` ever needs to recompute external counts on cached nodes (today the prior `externalRefsCount` is preserved as-is); URL-extraction regex truncates parens (Wikipedia/MDN URLs short-changed) and reference-style markdown links match only on the definition line — both are intentional trade-offs flagged for a future detector polish pass; `SqliteStorageAdapter` can't open `:memory:` because `init()` opens two separate `DatabaseSync` connections (tests use `mkdtempSync` file paths instead — an in-process refactor to share one connection for `:memory:` is filed for a future cleanup).

> ▶ **Release version scheme**: `v0.1.0` was spent on the Step 0b bootstrap. The impl package (`@skill-map/cli`) was `private: true` through `v0.3.x` and flipped public for the first npm publish during the Step 3 wrap-up, alongside the `alias/*` un-scoped placeholders (`skill-map`, `skill-mapper`) that existed only to defend names against squatters. Two further alias attempts (`skillmap`, `sm-cli`) were intentionally absent from `alias/*`: `skillmap` is auto-protected by npm's name-similarity guard against any third-party publish (since `skill-map` exists), and `sm-cli` was already taken by an unrelated package at the time of the first publish — `sm` is a binary alias of `@skill-map/cli`, not a package name we own. The two surviving placeholders (`skill-map`, `skill-mapper`) were dropped from the workspaces tree once `npm deprecate` notices were in place; the names stay locked on npm at `0.0.2` and the local workspaces are gone. `v0.5.0` is the deterministic offline release, `v0.8.0` adds the optional LLM layer, and `v1.0.0` is the full distributable release. Intermediate `v0.2.0`–`v0.4.x` cover Steps 0c through 9, `v0.5.1`–`v0.7.x` cover Steps 10–11, and `v0.8.1`–`v0.9.x` cover Steps 12–14. Each minor is driven by a changeset, never by a hand bump. Numbers refer to the `@skill-map/cli` (impl) package; `@skill-map/spec` versions independently per decision #77 and may skip entries.

### Step 0a — Spec bootstrap — ✅ complete

- `spec/` scaffolded and public from commit 1.
- `spec/README.md`, `spec/CHANGELOG.md`, `spec/versioning.md`.
- 29 JSON Schemas (draft 2020-12): 11 top-level (`node`, `link`, `issue`, `scan-result`, `execution-record`, `project-config`, `plugins-registry`, `job`, `report-base`, `conformance-case`, `history-stats`), 7 extension schemas under `schemas/extensions/` (`base` + one per kind, validated at plugin load), 6 frontmatter under `schemas/frontmatter/` (`base` + 5 kinds, each extending `base` via `allOf`), 5 summaries under `schemas/summaries/` (each extending `report-base` via `allOf`). Full tree in §Spec as a standard → Repo layout.
- `spec/architecture.md`, `cli-contract.md`, `job-events.md`, `prompt-preamble.md`, `db-schema.md`, `plugin-kv-api.md`, `job-lifecycle.md` (this file shipped as `dispatch-lifecycle.md` through spec v0.1.2; renamed in spec v0.2.0 to match decision #30).
- `spec/interfaces/security-scanner.md` — convention over the Action kind (NOT a 7th extension kind).
- Conformance suite: `basic-scan` + `kernel-empty-boot` cases, `minimal-claude` fixture, verbatim `preamble-v1.txt` (the third case `preamble-bitwise-match` is deferred to Step 10).
- `spec/index.json` — machine-readable manifest with per-file sha256 integrity block (regenerated by `scripts/build-spec-index.mjs`; CI blocks drift via `npm run spec:check`).
- npm package `@skill-map/spec` published via changesets. Current version lives in `spec/package.json` and `spec/CHANGELOG.md` — do not duplicate it in this narrative.

### Step 0b — Implementation bootstrap — ✅ complete

- Repo scaffolding: `package.json`, Node ESM, `node:test` wired.
- Package layout: npm workspaces (`spec/`, `src/`) with subpath `exports` on `@skill-map/cli`. `ui/` joins as a third workspace at Step 0c. An `alias/*` glob workspace later held name-reservation packages (`skill-map`, `skill-mapper`) for one publish round, then was dropped once the names were locked and `npm deprecate` redirected users to `@skill-map/cli`.
- Hexagonal skeleton: port interfaces, adapter stubs, kernel shell.
- Clipanion CLI binary prints version.
- Contract test infrastructure runs conformance suite against impl.
- CI green with 0 real features.
- Remaining tech stack picks (YAML parser, MD parsing, templating, pretty CLI, globbing, diff) are deferred to the step that first needs them — lock-in-abstract rejected.

### Step 0c — UI prototype (Flavor A) — ✅ complete

- **Stack locked**: Angular 21 standalone + Foblex Flow (node-based UI) + PrimeNG + `@primeuix/themes` (the legacy `@primeng/themes` package is deprecated upstream and intentionally avoided) + SCSS scoped (no utility CSS). ✅ landed.
- `ui/` npm workspace created as peer of `spec/` and `src/`. Root `package.json` workspaces array now `["spec", "src", "ui"]`; hoisted single-lockfile install verified. ✅ landed.
- Mock collection at `ui/mock-collection/` — fictional `acme-toolkit` scope with 4 agents, 4 commands, 4 skills, 3 hooks, and 3 notes, all with frontmatter conforming to `spec/schemas/frontmatter/*`. Served as build assets via `angular.json` so the prototype can `fetch('/mock-collection/…')` at runtime, simulating an on-disk scope without wiring a backend. The collection also exercises `supersedes` / `supersededBy`, `requires`, `related`, `@agent` / `#skill` / `/command` tokens in bodies, and external URLs for the future `external-url-counter` detector. ✅ landed.
- No backend. No BFF. Reading the mock collection at runtime stays the rule for the whole step — the specific path (`ui/mock-collection/`) is a prototype implementation detail and is NOT a fixture reused by any kernel test.
- Data pipeline: a `build-mock-index.mjs` prebuild script emits `mock-collection/index.json` deterministically; `CollectionLoaderService` fetches the index, parallel-fetches each `.md`, parses frontmatter with `js-yaml`, classifies kind by directory. A root `FilterStoreService` owns cross-view filter state (text search + kind + stability multi-selects) and exposes an `apply()` projection consumed by every view. `EventBusService` + `ScanSimulatorService` emit a scripted `scan.*` / `issue.*` sequence over the loaded collection so the event-flow surface has something real to display. ✅ landed.
- List view — PrimeNG Table with kind / name / path / version / stability columns, sortable, row-click opens inspector. ✅ landed.
- Inspector — full detail surface: kind + stability tags, metadata grid, kind-specific card (agent.model · command shortcut + args · hook event/condition/blocking/idempotent · skill inputs + outputs), relations as clickable chips (dead-struck-through when the target is not in the loaded set), tools allowlist / allowedTools, external links, raw-markdown body preview. ✅ landed.
- Graph view — Foblex Flow canvas with Dagre TB auto-layout, cards coloured by kind, edges for `supersedes` / `requires` / `related` (dedup'd across both-sides declarations), filter-aware (filtered-out nodes remove themselves and any dangling edges), click-to-inspect, Fit button, legend. ✅ landed.
- Filter bar — shared component mounted in both list and graph views, text search + kind multi-select + stability multi-select + contextual Reset. ✅ landed.
- Simulated event flow — collapsible bottom event-log panel showing `scan.started` / `scan.progress` / `scan.completed` + synthetic `issue.added` for deprecated nodes, auto-scroll, Clear, live "scanning" indicator. Triggered by a Simulate-scan button in the shell topbar. ✅ landed.
- Dark mode toggle — light ↔ dark persisted to localStorage, applies `.app-dark` to the document element (matching the `darkModeSelector` registered in `providePrimeNG`). Icon-only button in the topbar. ✅ landed.
- Roadmap review pass. ✅ landed as part of this section.

**Review-pass decisions (applied 2026-04-22)**:

- **Kind classifier is throwaway**. The path-based classifier in `ui/src/services/collection-loader.ts` is prototype-only: the real classification lives in the claude adapter at Step 2, and the ui-side classifier is deleted when Step 13 consumes the kernel's real scanner output. The duplication is intentional for Step 0c — isolating the UI from the kernel is the whole point of Flavor A.
- **Simulator + event log are throwaway**. `EventBusService` and `ScanSimulatorService` (+ the `EventLog` component) exist only to give the Step 0c prototype something to render. Step 13 replaces both surfaces with the real WebSocket broadcaster consuming `spec/job-events.md` payloads; the simulator file is deleted at that transition. No Decision log row — it is prototype scope, not a locked-in architectural choice.
- **Desktop-only**. Flavor A assumes ≥1024px viewport. No responsive or mobile work. Step 13 may revisit once the full UI's surfaces and interactions are settled.
- **Bundle size is not a Flavor A objective**. Development bundles clock ~1.86MB initial, well above the `angular.json` production budgets (500 KB warn / 1 MB error); those budgets remain armed because they are the right targets for Step 13. Step 0c is `ng serve` / local-dev only, not distributed.
- **Wildcard route fallback**: `**` → `/list`. Bad deep links self-heal to the default view rather than surfacing a 404.
- **Fallback kind**: the loader classifies unknown paths as `note`. It is the catch-all by spec convention ("everything else"); alternatives would require a user choice at Flavor A which is premature.
- **URL-synced filter state: open item.** Filter state lives in memory for Step 0c (ergonomics first). Bookmarkable URLs are deferred to Step 13 once the full-UI routing surface is settled; the option to promote `FilterStore` to URL-first is noted here so the decision has a place to land.

### Step 1 — Kernel skeleton (split into three sub-steps)

The original "Step 1" bundled several independent deliverables (storage, migrations, plugin loader, orchestrator, CLI dispatcher, introspection, self-boot). Splitting keeps each sub-step testable on its own; the boundary between them is a green CI plus the specific acceptance criterion named below. All three must land before Step 2 starts.

#### Step 1a — Storage + migrations — ✅ complete

- SQLite (`node:sqlite`) wired behind `StoragePort` via `SqliteStorageAdapter` (Kysely + `CamelCasePlugin`). Kysely's official SQLite dialect depends on `better-sqlite3` (native — forbidden by Decision #7); the kernel ships a bespoke `NodeSqliteDialect` under `src/kernel/adapters/sqlite/dialect.ts` that reuses Kysely's pure-JS `SqliteAdapter` / `SqliteIntrospector` / `SqliteQueryCompiler` and plugs a minimal Driver on top of `node:sqlite`'s `DatabaseSync`. ✅ landed.
- Kernel migrations in `src/migrations/` (`NNN_snake_case.sql`, up-only, transaction-wrapped). `001_initial.sql` provisions all 11 kernel tables from `db-schema.md` with full CHECK constraints, named indexes, and the unique partial index on `state_jobs` that enforces the job-lifecycle duplicate-detection contract. ✅ landed.
- `config_schema_versions` ledger populated; `PRAGMA user_version` kept in sync. Both writes share the same transaction as the migration itself, so partial success cannot drift the ledger. ✅ landed.
- Auto-apply on startup with auto-backup to `.skill-map/backups/skill-map-pre-migrate-v<N>.db`. WAL checkpoint runs before the file copy so the backup is complete without needing to capture `-wal` / `-shm` sidecars. ✅ landed. `autoMigrate: false` / `autoBackup: false` constructor options handle the Step 6 `autoMigrate` config toggle and the `sm db migrate --no-backup` flag respectively.
- `sm db backup / restore / reset / reset --state / reset --hard / shell / dump / migrate [--dry-run|--status|--to|--no-backup]` operational. Destructive verbs (`restore`, `reset --state`, `reset --hard`) prompt via `readline` unless `--yes` / `--force`. `shell` and `dump` spawn the system `sqlite3` binary with a pointed error on ENOENT. ✅ landed.
- `tsup.config.ts` gained an `onSuccess` hook that copies `src/migrations/` to `dist/migrations/` so the published artifacts find them via `defaultMigrationsDir()`; `src/package.json#files` now includes `migrations/`. ✅ landed.

Acceptance: spin a fresh scope, run `sm db migrate --dry-run`, apply, corrupt a row, restore from backup — round-trip green. ✅ codified in `src/test/storage.test.ts` (the `round-trip: migrate → write → backup → corrupt → restore` case). 24 of 24 tests pass.

**Deferred to Step 1b**: `sm db migrate --kernel-only` and `--plugin <id>` — their surface exists in the spec (CLI contract) but every migration today is a kernel migration, so they would be no-ops. They light up when the plugin loader lands and plugin-authored migrations enter the mix.

#### Step 1b — Registry + plugin loader — ✅ complete

- `Registry` enforcing the 6 kinds + duplicate-id rejection within a kind already landed in Step 0b and remained unchanged — the validation the plugin loader needs sits upstream (in the loader itself), where it has the plugin + file context. ✅ landed.
- `PluginLoader` (`src/kernel/adapters/plugin-loader.ts`) implements drop-in discovery in `<scope>/.skill-map/plugins/*` and `~/.skill-map/plugins/*`, parses `plugin.json`, checks `semver.satisfies(installed @skill-map/spec, manifest.specCompat)` with prerelease-aware matching, dynamic-imports every listed extension, and validates each default export against its `extensions/<kind>.schema.json`. All validation goes through AJV Draft 2020-12 compiled from the schemas published by `@skill-map/spec`. ✅ landed.
- `sm plugins list / show / doctor` operational (`src/cli/commands/plugins.ts`). Enable/disable deferred to Step 6 with `config_plugins`. ✅ landed.
- Three failure modes surface precise diagnostics and the kernel keeps booting: `invalid-manifest` (JSON parse failure or AJV failure against `plugins-registry.schema.json#/$defs/PluginManifest`, including a malformed `specCompat` range), `incompatible-spec` (semver mismatch), `load-error` (missing extension file, dynamic-import failure, missing/unknown `kind`, or extension default export failing its kind schema). ✅ landed.
- Side fix discovered during implementation: the six extension-kind schemas paired `additionalProperties: false` with an `allOf` reference to `base.schema.json` — a Draft 2020-12 composition footgun that made no real extension manifest validatable. Spec patch (2026-04-22) switched the kind schemas to `unevaluatedProperties: false` and dropped closure from base; closed-content enforcement now survives the composition. ✅ landed.

Acceptance: three bogus-plugin scenarios codified in `src/test/plugin-loader.test.ts` (`invalid-manifest` via missing required fields AND malformed JSON, `incompatible-spec` via a `>=999.0.0` compat range, `load-error` via missing extension file AND default export failing its kind schema), plus a green-path case and a mixed scenario proving the kernel keeps going when one plugin in the search path is bad. ✅ 32 of 32 tests pass.

**Deferred to Step 2**: `sm db migrate --kernel-only` and `--plugin <id>` flags. Their CLI surface exists in the spec, but every migration today is a kernel migration; the flags only become meaningful when plugin-authored migrations enter the mix, which depends on Step 2's triple-protection SQL parser + prefix rewriter. Also deferred from the earlier roadmap: typed-DTO emission from `@skill-map/spec` — after building the loader against hand-curated local mirrors, closing the DTO gap requires a third consumer to justify a canonical shape, and Step 2's first real adapter is where that arrives.

#### Step 1c — Orchestrator + CLI dispatcher + introspection — ✅ complete

- Scan orchestrator (`src/kernel/orchestrator.ts`) iterates the registry pipeline (adapters → detectors → rules) end-to-end and emits `scan.started` / `scan.completed` through a `ProgressEmitterPort`. With zero registered extensions the iteration produces a zero-filled valid `ScanResult` — the same outcome the Step 0b stub produced, now from the real code path. `InMemoryProgressEmitter` lands alongside as the default in-process emitter; the WebSocket-backed emitter arrives at Step 13. ✅ landed.
- Concrete extension runtime interfaces (`adapter.walk()`, `detector.detect()`, `rule.evaluate()`) are still not defined — they arrive with the first real extensions at Step 2. The iteration sites carry `TODO(step-2)` markers so the Step 2 drop-in test (add a 4th detector with zero kernel edits) stays honoured.
- Full Clipanion verb registration (`src/cli/commands/stubs.ts`) covers every verb in `cli-contract.md` that doesn't yet have a real implementation. 35 stub classes, each with the contract's declared flags typed correctly and a `category` / `description` / `details` usage block so `sm help` sees the full surface. `execute()` writes a one-liner pointing at the Step that will implement it and returns exit 2. ✅ landed.
- `sm help [<verb>] [--format human|md|json]` operational (`src/cli/commands/help.ts`). `human` delegates to Clipanion's own `cli.usage()` so terminal output matches the built-in exactly; `json` emits the structured surface dump per `cli-contract.md` §Help; `md` emits canonical markdown grouped by category. Single-verb mode (`sm help scan --format json`) emits just the one block. Unknown verb → exit 5; unknown format → exit 2. ✅ landed.
- `context/cli-reference.md` regenerated by `scripts/build-cli-reference.mjs` from `sm help --format md`. Root scripts: `npm run cli:reference` writes, `npm run cli:check` fails on drift. Current reference covers every verb — 290 lines, 6.5KB. ✅ landed.
- Self-boot invariant (`kernel-empty-boot` conformance case) passes end-to-end through the real `bin/sm.mjs` → real `runScan()` path, no longer via the Step 0b stub. ✅ landed.

Acceptance: `sm help` covers every verb in the spec; `context/cli-reference.md` is byte-equal to `sm help --format md` output and `npm run cli:check` blocks drift; `kernel-empty-boot` passes via the real orchestrator. 36 of 36 tests passed at Step 1c close (32 prior + 4 new covering scan event emission, empty-registry orchestrator iteration, and InMemoryProgressEmitter subscribe/unsubscribe). Test count continued to grow through Step 2; see the Step 2 completeness marker for the current total.

### Step 2 — First extension instances — ✅ complete

- Runtime contracts: five interfaces in `src/kernel/extensions/` — `IAdapter` (walk async iterator + classify), `IDetector` (detect with scope hint + emitsLinkKinds allowlist), `IRule` (evaluate over full graph), `IRenderer` (render → string keyed by format), `IAudit` (run → TAuditReport). A plugin's default export IS the runtime instance (manifest fields + methods on the same object). ✅ landed.
- Shared utility `src/kernel/trigger-normalize.ts` implements the six-step pipeline (NFD → strip diacritics → lowercase → separator unification → collapse whitespace → trim) from §Architecture Decision #21. ✅ landed.
- Adapter: **`claude`** — walks `.claude/{agents,commands,hooks,skills}/*.md` + `notes/**/*.md` with a fallback to `note`, parses frontmatter via js-yaml (tolerating malformed YAML), default ignore set (`.git`, `node_modules`, `dist`, `.skill-map`), async iterator so large scopes don't buffer. ✅ landed.
- Detectors: **`frontmatter`** (structured refs from `metadata.supersedes[]` / `supersededBy` / `requires[]` / `related[]`), **`slash`** (`/command` tokens in body with trigger normalization), **`at-directive`** (`@agent` handles in body). Each dedupes on normalized trigger and respects its declared scope. `external-url-counter` remains deferred to Step 4 as the drop-in litmus proof. ✅ landed.
- Rules: **`trigger-collision`** (error — 2+ distinct targets sharing a normalized trigger), **`broken-ref`** (warn — targets that resolve neither by path nor by normalized name), **`superseded`** (info — one per node declaring `metadata.supersededBy`). ✅ landed.
- Renderer: **`ascii`** — plain-text dump grouped by kind then links then issues. ✅ landed.
- Audit: **`validate-all`** — post-scan consistency check via AJV against `node.schema.json` / `link.schema.json` / `issue.schema.json`. Plugin-manifest validation already enforced at load time by the PluginLoader (Step 1b), so this audit only revalidates user content. ✅ landed.
- Actions: 0 shipped (contract available). Deferred per the spec.
- Built-ins registry (`src/extensions/built-ins.ts`) exposes the full set as callable instances (`builtIns()`) and as Registry-ready manifest rows (`listBuiltIns()`). The orchestrator wires the two by accepting a new `RunScanOptions.extensions` field alongside the kernel's registry.
- Orchestrator (`src/kernel/orchestrator.ts`) now iterates the pipeline for real: for each adapter it walks roots and classifies nodes, feeds them through scope-appropriate detectors, collects links, denormalises `linksOutCount` / `linksInCount`, then runs every rule over the graph. Sha256 body/frontmatter hashes + triple-split bytes are computed on the node record. Links whose kind isn't in the detector's declared `emitsLinkKinds` allowlist are silently dropped.
- `sm scan` updated — defaults to the built-in set, exits 1 when the scan surfaces issues (per `cli-contract.md` §Exit codes), exposes `--no-built-ins` for the kernel-empty-boot parity case.
- Acceptance (drop-in proof): the orchestrator iterates `registry.all('detector')` — adding a 4th detector is one new file under `src/extensions/detectors/` + one entry in `built-ins.ts`. Zero kernel edits. Step 4's `external-url-counter` lands as the live proof. ✅ architecturally honoured.
- End-to-end test (`src/test/scan-e2e.test.ts`) against a temp fixture with 3 nodes covering agent + command kinds — asserts node count / kinds / hashes / bytes, the four expected link families (frontmatter.related, slash, at-directive, supersededBy inversion), and the two expected rule issues (broken-ref for the unresolved `@backend-lead`, superseded for `deploy.md`). ✅ landed. Suite total: 88 of 88 tests passing (was 36 before Step 2; +52 new across normalization, claude, detectors, rules, renderer, audit, built-ins, and the e2e).

### Step 3 — UI design refinement — ✅ complete

Iterate the Flavor A prototype's visual design against mock data before committing kernel API surface. Cheap to change now; expensive after Step 4 locks the scan output shape.

- ✅ Dark mode parity: `--sm-*` CSS custom properties for kind accents (5 kinds × border/badge-bg/badge-fg), edge colors (3 types), link badge colors, severity colors. `.app-dark` overrides with dark-appropriate values. All ~40 hardcoded hex colors in graph-view, event-log, and inspector-view replaced.
- ✅ Node card redesign: kind-specific subtitles — agent→model, hook→event, command→shortcut, skill→I/O count. Applied to both graph nodes (new `.f-gnode__subtitle` row, `NODE_HEIGHT` 96→110) and list rows (secondary `.list__cell-detail` line).
- ✅ Connection styling: differentiated `stroke-width` (supersedes 2.5, requires 2, related 1.5). SVG `<marker>` arrowhead definitions added (best-effort — depends on Foblex SVG scope).
- ✅ Inspector layout: reordered cards — Summary (full-width hero with left accent) → Kind-specific → Relations → Metadata → Tools → External → Body. Grid switched from `auto-fit, minmax(320px, 1fr)` to explicit `1fr 1fr` with full-width spans.
- ✅ Responsive baseline: `@media` breakpoints at 1280px and 1024px across topbar (compact gaps, hide tag, wrap nav), filter-bar (smaller min-widths), event-log (collapse grid to 2 columns), inspector (single-column grid), graph (reduce min-height to 400px).
- ✅ Empty / error / loading states: shared `.empty-state` CSS utility classes in `styles.css`. Structured icon+title+description pattern applied to graph (loading, error, no-match), inspector (no-selection, not-found), event-log (no events).
- ✅ Bundle budget: investigated — Aura full-preset (~173kB PrimeNG chunk) is the main contributor; per-component theme imports not supported by PrimeNG v21. Warning threshold raised from 500kB to 600kB for prototype phase. Unused `DividerModule` removed from inspector. Full compliance deferred to Step 13.

### Step 4 — Scan end-to-end — ✅ complete

- ✅ `sm scan` persists `ScanResult` into `<scope>/.skill-map/skill-map.db` (replace-all transactional snapshot across `scan_nodes / scan_links / scan_issues`); auto-migrates on first run; `--no-built-ins` skips persistence (kernel-empty-boot parity).
- ✅ `sm scan -n / --dry-run` skips every DB write (does not even open the adapter unless `--changed` also requires a read).
- ✅ `sm scan --changed` runs incrementally: loads the prior snapshot via `loadScanResult`, reuses nodes whose `bodyHash + frontmatterHash` match, full-processes new / modified files, drops deleted ones, re-runs rules over the merged graph, persists with replace-all. Degrades to a full scan with a stderr warning when no prior snapshot exists. Rejects `--changed --no-built-ins`.
- ✅ `sm list / show / check` read from `scan_*` (replaced their stubs); `--kind`, `--issue`, `--sort-by` (whitelist), `--limit`; per-column default sort direction (numeric → DESC, textual → ASC); `--issue` via SQLite `json_each`.
- ✅ Triple-split bytes + tokens per node (`js-tiktoken` cl100k_base); `--no-tokens` opt-out; encoder reused once per scan.
- ✅ **`external-url-counter` detector** landed as the 4th detector — one new file under `src/extensions/detectors/external-url-counter/` + one entry in `built-ins.ts`. Validates Step 2's drop-in litmus. Emits pseudo-links the orchestrator partitions into `node.externalRefsCount` (never persisted to `scan_links`, never reach rules).
- ✅ `links_out_count`, `links_in_count`, `external_refs_count` denormalised on `scan_nodes`.
- ✅ Self-scan test (mandatory) — validates the live repo against `scan-result.schema.json` top-level + all per-element schemas; asserts no `error`-severity issues; smoke-checks tokens and external refs.
- ✅ 500-MD performance benchmark — measures ~1037 ms vs 2000 ms budget; covered as a `node:test` case alongside the suite.
- ✅ Sub-step 4.7 — runtime ScanResult reconciled with the spec: `scannedAt` integer ms (was ISO string), `scope: 'project' | 'global'`, `adapters[]` enumerated, `scannedBy { name, version, specVersion }`, `stats.filesWalked / filesSkipped`. The spec was authoritative all along; runtime only caught up. `loadScanResult` synthetic envelope updated to satisfy `roots: minItems 1` (returns `['.']` with an inline note that the orchestrator does not consume `roots` from a prior snapshot).
- ✅ Bug fix: `defaultMigrationsDir()` now probes the flat `dist/cli.js` bundle layout before falling back to the source-shaped layout — the prior heuristic silently missed `dist/migrations/` when running the bundled CLI on a fresh DB.
- ✅ Sub-step 4.8 — bundle fix from end-to-end manual validation: (a) `sm scan` exit code now matches `sm check` and the spec (1 only when issues at `error` severity exist; was 1 on any issue, including warn / info — applied to both human and `--json` paths). (b) `sm show` human output now prints `External refs: <N>` after the Weight section; the `--json` output already exposed `externalRefsCount`, the human format had a parity gap. (c) `sm scan --changed` no longer drops `supersedes`-inversion links from cached nodes; the orchestrator's cached-reuse filter now uses `originatingNodeOf(link, priorNodePaths)` which discriminates between forward `supersedes` (where `source` is the originating node) and inverted `supersedes` (where `target` is the originating node, emitted by frontmatter `metadata.supersededBy`) — sufficient because `supersedes` is the only kind with this inversion today; if a future detector adds another inversion case, escalate to a persisted `Link.detectedFromPath` field with a schema bump. Regression invariant: full-scan and `--changed`-scan over the same input now produce set-equal `links`.
- ✅ Sub-step 4.9 — second bundle from a deeper validation pass: (a) `trigger-collision` rule now also detects nodes that *advertise* the same trigger via `frontmatter.name` (e.g. two `command` files both named `deploy` would silently pass before; now they emit one collision issue); the rule's "canonical example" in the doc comment finally behaves as documented. (b) `persistScanResult` now runs `PRAGMA wal_checkpoint(TRUNCATE)` after the replace-all transaction commits so external read-only tools (sqlitebrowser, DBeaver, ad-hoc SQL clients) see fresh state without manual intervention; previously the main `.db` could lag the `.db-wal` arbitrarily on small repos because SQLite's auto-checkpoint threshold (~1000 pages) was rarely crossed.
- ✅ Sub-step 4.10 — scenario coverage from the validation walkthrough: 10 new regression tests across `scan-mutation.test.ts` (new file), `scan-incremental.test.ts`, and `scan-readers.test.ts`. Cover hash discrimination (mutating only the body must keep `frontmatter_hash` byte-equal, and vice versa), external-refs lifecycle (0 → 2 → dedup → invalid URL silently dropped), deletion-driven broken-ref re-evaluation in both full and incremental paths, replace-all ID rotation contract (synthetic `scan_links.id` / `scan_issues.id` may differ between scans; the natural keys `(source, target, kind, normalized_trigger)` are what callers must use as identity), `--no-tokens` flag plumbing through the CLI handler, `--changed --no-built-ins` combination rejection at exit 2, and trigger-collision interaction with `--changed` (collision survives an edit to one advertiser; collision disappears when one advertiser is deleted).
- ✅ Sub-step 4.11 — empty-scan guard against accidental DB wipes. Three layers of defense: (a) `runScan` now validates every entry in `options.roots` exists as a directory; throws on the first failure with a clear message naming the bad path. (b) `ScanCommand` catches that error and surfaces it on stderr with exit code 2 (operational error), without touching the DB. (c) Even if a future bug or weird edge case still produces a zero-result `ScanResult`, the CLI counts existing `scan_*` rows before persisting and refuses to wipe a populated DB without an explicit `--allow-empty` flag. This closes the typo-trap the user hit during validation: `sm scan -- --dry-run` (where `--` made `--dry-run` a positional root that didn't exist) silently wiped the populated sandbox DB. The new flag preserves the legitimate "wipe by scanning an empty fixture" workflow but only when explicit. Six new regression tests cover both the kernel-level and CLI-level paths.

### Step 5 — History + orphan reconciliation

- Execution table `state_executions`.
- `sm history` + filters + `stats`.
- Orphan detection.
- **Automatic rename heuristic**: on scan, when a deleted `node.path` and a newly-seen `node.path` share the same `body_hash`, the scan migrates `state_*` FK rows (executions, jobs, summaries, enrichment) from the old path to the new one at **high** confidence without prompt. `frontmatter_hash`-only match against a **single** candidate → **medium** confidence → emits an `auto-rename-medium` issue (with `data_json.from` + `data_json.to` for machine readback) so the user can inspect / revert. `frontmatter_hash` match against **multiple** candidates → no migration; emits an `auto-rename-ambiguous` issue with `data_json.to` + `data_json.candidates: [...]` so the user can pick via `sm orphans undo-rename --from <old.path>`. Any residual unmatched deletion → `orphan` issue.
- `sm orphans reconcile <orphan.path> --to <new.path>` — forward manual override for semantic-only matches or history repair.
- `sm orphans undo-rename <new.path> [--from <old.path>] [--force]` — reverse a medium- or ambiguous-confidence auto-rename. For `auto-rename-medium`, reads the original path from the issue's `data_json` and migrates `state_*` FKs back (omit `--from`); for `auto-rename-ambiguous`, pass `--from <old.path>` to pick one of the candidates. Resolves the issue; the prior path becomes an `orphan`.

- ✅ Sub-step 5.1 — `scan_meta` table (zone `scan_*`, single-row, CHECK `id = 1`) closes the Step 4.7 follow-up. `persistScanResult` writes the row in the same transaction as the rest of the scan zone; `loadScanResult` reads it and returns real `scope` / `roots` / `scannedAt` / `scannedBy` / `adapters` / `stats.filesWalked` / `stats.filesSkipped` / `stats.durationMs` instead of the synthetic envelope. Synthetic fallback retained for freshly-migrated DBs that have never been scanned. Spec change (additive minor): new table catalog entry in `db-schema.md`. Migration `002_scan_meta.sql`. Test count: 151 → 154.
- ✅ Sub-step 5.2 — Storage helpers in `src/kernel/adapters/sqlite/history.ts`: `insertExecution`, `listExecutions(filter)` (node / action / statuses / sinceMs / untilMs / limit), `aggregateHistoryStats(range, period, topN)` (totals, tokensPerAction, executionsPerPeriod with UTC bucketing, topNodes with tie-break, error rates with all six failure-reason keys always present), and `migrateNodeFks(trx, fromPath, toPath)` covering the three FK shapes (simple column on `state_jobs`, JSON-array on `state_executions.node_ids_json` via `json_each`, composite-PK delete+insert on `state_summaries` / `state_enrichments` / `state_plugin_kvs` with conservative collision resolution preserving the destination row). New domain types `ExecutionRecord` / `HistoryStats` mirror the spec schemas. Test count: 154 → 169.
- ✅ Sub-step 5.3 — `sm history` CLI lands. Real implementation moved out of stubs; flags `-n / --action / --status (csv) / --since / --until / --limit / --json / --quiet` per `cli-contract.md` §History. ISO-8601 inline parser; `--json` array conforms to `execution-record.schema.json`. Shared `src/cli/util/elapsed.ts` (`startElapsed`, `formatElapsed`, `emitDoneStderr`) carries `done in <…>` per §Elapsed time. Test count: 169 → 184.
- ✅ Sub-step 5.4 — `sm history stats` CLI. Period bucketing (UTC `day` / `week` / `month`), top-N nodes, error-rates including all six failure-reason keys (zero-filled). `--json` self-validates against `history-stats.schema.json` before emit (catches drift early). Top-level `elapsedMs` per spec. Test count: 184 → 190.
- ✅ Sub-step 5.5 — Auto-rename heuristic at scan time per `spec/db-schema.md` §Rename detection. New `detectRenamesAndOrphans` orchestrator phase classifies high (body hash match, no issue) / medium (frontmatter hash 1:1, `auto-rename-medium` issue + FK migration) / ambiguous (frontmatter hash N:1, `auto-rename-ambiguous` issue, no migration) / orphan (residual deletion, `orphan` issue, state untouched). 1-to-1 matching enforced; iteration is lex-asc for deterministic output. Body match wins over frontmatter match. New API: `runScanWithRenames` returns `{ result, renameOps[] }`; `runScan` continues to return `ScanResult` only. `persistScanResult(db, result, renameOps?)` applies FK migration via `migrateNodeFks` (5.2) inside the same tx as the scan zone replace-all — atomic per spec. Test count: 184 → 190.
- ✅ Sub-step 5.6 — `sm orphans` verbs land. `sm orphans [--kind orphan|medium|ambiguous] [--json]` lists active issues; `sm orphans reconcile <orphan.path> --to <new.path>` migrates state_* FKs forward and resolves the orphan issue (exit 5 if target node missing or no active orphan); `sm orphans undo-rename <new.path> [--from <old.path>] [--force]` reverses medium/ambiguous auto-renames (reads `data.from` for medium, requires `--from` from `data.candidates` for ambiguous), emits a new `orphan` on the prior path, prompts via readline unless `--force`. `confirm()` helper extracted to `src/cli/util/confirm.ts` so `sm db restore / reset` and `sm orphans undo-rename` share the exact same prompt. Test count: 190 → 201.
- ✅ Sub-step 5.7 — Conformance fixtures for the rename heuristic. Spec change (additive minor): `conformance-case.schema.json` gains `setup.priorScans: Array<{ fixture, flags? }>` so cases can stage a prior snapshot before the main invoke. Two new cases (`rename-high`, `orphan-detection`) and four fixture directories. Runner in `src/conformance/index.ts` extended with `replaceFixture()` helper that wipes every non-`.skill-map/` entry between staging steps so the DB persists across fixture swaps. `coverage.md` row I (Rename heuristic) flips from `🔴 missing` to `🟢 covered`. Conformance suite passing in CI: 1 → 3 cases. Test count: 201 → 203.

- ✅ Sub-step 5.8 — Fire the rename heuristic on every `sm scan`, not just `sm scan --changed`. Decoupled `priorSnapshot` (data) from `enableCache` (behaviour). New `RunScanOptions.enableCache?: boolean` (default `false`) gates cache reuse only; `priorSnapshot` is now always passed by `scan.ts` when the DB has prior nodes. `scan.ts` sets `enableCache: this.changed` so `--changed` keeps its perf win. Behaviour matrix: plain `sm scan` (DB exists) loads prior, no cache, runs heuristic; `sm scan --changed` (DB exists) loads prior, caches, runs heuristic; `--no-built-ins` skips both. CLI e2e test added: write file → scan → delete → scan (no --changed) → assert `orphan` issue emitted. Test count: 203 → 204.
- ✅ Sub-step 5.9 — Orphan persistence across scans. Surfaced during walkthrough: `persistScanResult` did `DELETE FROM scan_issues` on every replace-all, so the `orphan` issue from a deletion-scan disappeared on the very next scan, leaving stranded `state_*` references invisible (and `sm orphans reconcile` impossible because it requires an active orphan issue). New helper `findStrandedStateOrphans(trx, livePaths)` in `kernel/adapters/sqlite/history.ts` sweeps every `state_*` reference (state_jobs.node_id, state_executions.node_ids_json via json_each, state_summaries / state_enrichments / state_plugin_kvs node_id with sentinel `''` skipped) and returns the distinct paths not in the live snapshot. `persistScanResult` calls it after applying renameOps and emits `orphan` issues for paths not already covered by the per-scan heuristic; `result.stats.issuesCount` updated for self-consistency. Self-healing: once state_* no longer references the dead path, the next scan emits no orphan for it. Spec language ("until the user runs `sm orphans reconcile` or accepts the orphan") now backed by behaviour. Test count: 204 → 206.
- ✅ Sub-step 5.10 — Two `sm history` polish fixes from the walkthrough: (a) human-table column widths — previous `formatRow` padded every non-ID column to flat 11 chars, so the 20-char ISO timestamp in STARTED ran into ACTION with zero whitespace; replaced with per-column `COL_WIDTHS` array sized for longest expected content + 2 trailing spaces. (b) `sm history stats --json` `elapsedMs` accuracy — was captured at `stats` construction (BEFORE `loadSchemaValidators()`'s ~100 ms cold load), so JSON reported 10 ms while stderr `done in` reported 111 ms (10× divergence). Re-stamped after validate-before-serialise, gap collapses to ~2 ms. Validator caching itself flagged as out of scope at the time. Test count: 206 → 207.
- ✅ Sub-step 5.11 — `sm history` human renderer shows `failure_reason` inline next to status (`failed (timeout)`, `cancelled (user-cancelled)`); `completed` rows unchanged. STATUS column widened from 12 to 30 chars to fit the longest enum (`cancelled (user-cancelled)` = 26). Test count: 207 → 208.
- ✅ Sub-step 5.12 — `loadSchemaValidators()` cached at module level so subsequent calls in the same process return the same instance for free. Single-shot CLI calls don't benefit (they only call once), but future verbs that validate at multiple boundaries (likely candidates: `sm doctor`, `sm record`, plugin manifest re-checks) get the win without threading a cached bundle through their call stacks. Test-only `_resetSchemaValidatorsCacheForTests()` exported. Test count: 208 → 211.
- ✅ Sub-step 5.13 — `frontmatter_hash` now computed over CANONICAL YAML form (`yaml.dump` with `sortKeys: true`, `lineWidth: -1`, `noRefs: true`, `noCompatMode: true`) instead of raw bytes. Closes the walkthrough finding where `cat <<EOF` and Write-tool output of the SAME logical frontmatter produced different hashes (different trailing-newline / whitespace handling) and demoted what should have been a medium-confidence rename to an `orphan`. New helper `canonicalFrontmatter(parsed, raw)` in `kernel/orchestrator.ts`. Fallback to raw text when the adapter's parse failed silently (so malformed YAML still hashes against itself across rescans). Migration impact: first scan after upgrade sees every file as "frontmatter changed" (cache miss only in `--changed`; otherwise cosmetic — no data loss, no false orphans). Test count: 211 → 213.

> Step 5 closed: 151 → **213 of 213 tests pass** (+62 across Step 5). 0 changesets pending in `.changeset/` — the 25-entry backlog (12 from Step 4 + 13 from Step 5) was drained via Version Packages PR #12 (`@skill-map/spec` → 0.6.0, `@skill-map/cli` → 0.3.2).

### Step 6 — Config + onboarding

- `.skill-map/settings.json` + `.skill-map/settings.local.json` + `.skill-mapignore`. `sm init` scaffolds the folder and adds the `.local.json` to the project's gitignore.
- Loader walks the hierarchy from §Configuration (defaults → `~/.skill-map/settings(.local).json` → `<scope>/.skill-map/settings(.local).json` → env / flags). UI-side keys are read by the same loader but only delivered over HTTP at Step 14.
- `sm init` scaffolding.
- `sm plugins list / enable / disable / show / doctor`.
- Frontmatter schemas enforced (warn by default, `--strict` promotes to error).

### Step 7 — Robustness

- Detector conflict resolution.
- Incremental scan via `chokidar` (prepares live validation).
- Trigger normalization pipeline wired into every detector that emits `link.trigger` (see §Trigger normalization for the full 6-step spec and worked examples).
- Job retention policy enforced via `sm job prune` (drives `jobs.retention.completed` / `jobs.retention.failed`). `state_executions` remains append-only — no GC for history rows through `v1.0` (if demand appears post-`v1.0`, a dedicated `history.retention.*` block will be added).

### Step 8 — Diff + export

- `sm scan --compare-with`, `sm export`, `sm graph`.

### Step 9 — Plugin author UX

- Drop-in plugin discovery (already scaffolded).
- `skill-map/testkit` module exported.
- Plugin API docs.
- Error mode: broken plugin shows clear diagnostic.

### ▶ v0.5.0 — deterministic, offline, zero LLM

---

### Step 10 — Job subsystem + first summarizer

- `state_jobs` table + atomic claim via `UPDATE ... RETURNING id`.
- Job file rendering with kernel-enforced preamble + `<user-content>` delimiters.
- `sm job submit / list / show / preview / claim / run / run --all / status / cancel / prune`.
- `sm record` with nonce authentication.
- CLI runner loop (`sm job run`) + `ClaudeCliRunner` (`claude -p` subprocess) as the default `RunnerPort` impl. Submission and claim MUST succeed even when `claude` is absent; only `sm job run` requires it, and MUST fail fast with a clear error (exit 2) pointing the user at installation docs when the binary is missing.
- `sm doctor` learns to probe LLM runner availability here (lands with the first runner, even though verbs that use it arrive progressively through Step 11).
- Skill agent (`/skill-map:run-queue` + `sm-cli-run-queue` skill package).
- `skill-summarizer` built-in (first summarizer).
- Duplicate detection via `contentHash` + `--force`.
- Per-action TTL + auto-reap.
- Progress events (pretty / `--stream-output` / `--json`).
- `github-enrichment` bundled plugin (hash verification).
- Close conformance case `preamble-bitwise-match` (deferred from Step 0a — needs `sm job preview` to render a job file for byte-exact comparison against `spec/conformance/fixtures/preamble-v1.txt`).

### Step 11 — Remaining summarizers + LLM verbs + findings

- `agent-summarizer`, `command-summarizer`, `hook-summarizer`, `note-summarizer`.
- `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization`.
- `sm findings` CLI verb.
- `/skill-map:explore` meta-skill.
- `state_summaries` is exercised by all five per-kind summarizers (the table lands in Step 10 with `skill-summarizer`; Step 11 fills out the remaining four kinds). `state_enrichments` accepts additional providers beyond `github-enrichment` when they ship, against the stable contract.

### ▶ v0.8.0 — LLM optional layer

---

### Step 12 — Additional renderers

- Mermaid, DOT / Graphviz.
- Subgraph export with filters.

### Step 13 — Full Web UI

- **Hono** BFF with WebSocket `/ws` — thin proxy over the kernel, no domain logic.
- **Single-port mandate**: Hono serves the Angular SPA (`serveStatic` over `ui/dist/browser/`), the REST endpoints, and the WS under one listener. Dev uses Angular dev server + `proxy.conf.json` pointing to Hono for `/api` and `/ws`.
- `sm serve --port N` is the single entry point: one process, one port, one command.
- UI consumes real kernel (Flavor B vertical slice, upgrading Step 0c prototype).
- Inspector panel with enrichment + summary + findings.
- Command submit from UI via WS.
- Wire the `chokidar` watcher introduced in Step 7 into the WS broadcaster so file changes stream to the UI live.

**Open picks deferred from Step 0c review pass** (must land by Step 13 ship):

- **MD body renderer for the inspector** — the Step 0c prototype renders the frontmatter's markdown body as raw text inside a `<pre>`. Picking a library at Step 0c would be lock-in-abstract; the pick lands here with concrete requirements (safe-by-default HTML, GFM coverage, syntax-highlight hook). Candidates to evaluate: `marked`, `markdown-it`, `remark` + `rehype`. Sanitisation approach decided with the pick.
- **Foblex Flow type strictness** — at Step 0c the Foblex API surface is TypeScript-typed but permissive in several places (connectable-side enum aliases, template props). This is a flag, not an action item: if Step 13 needs strict type safety at the integration boundary, re-evaluate alongside any Foblex bump; otherwise stay on the current version line.
- **URL-synced filter state** — `FilterStore` lives in memory at Step 0c. Promote to URL-first here once the full routing surface is settled.
- **Responsive / mobile support** — Flavor A is desktop-only; decide scope here.
- **Bundle budget compliance** — prod budgets in `angular.json` stay armed (500 KB warn / 1 MB error); Step 13 includes the tree-shake + route-splitting pass that brings Flavor B under those.
- **Dark mode**: Step 0c ships a working toggle; Step 13 decides if it grows into a system-preference-aware tri-state and gains palette-level customisation.

### Step 14 — Distribution polish

- **Single npm package**: `@skill-map/cli` ships CLI + UI built (`ui/dist/` copied into the package at publish time). Two `bin` entries — `sm` (short, daily use) and `skill-map` (full name, scripting). Same binary, two aliases. Single version applies to both surfaces; CLI ↔ UI key mismatches degrade gracefully (unknown keys are warned + ignored, never fatal). Versioning details in §Stack conventions.
- **Alias / squat-defense packages** (historical): an `alias/*` glob workspace published two un-scoped placeholders to lock names against third-party squatters: `skill-map` (un-scoped top-level) and `skill-mapper` (lookalike). Each shipped a single `bin` that printed a warning to stderr pointing at `@skill-map/cli` and exited with code 1. They never delegated, never wrapped the real CLI as a dependency, never installed side-effect-free. Once both names were locked at `0.0.2` and a `npm deprecate` notice was attached on each (the official npm-side equivalent of the same redirect message, surfaced at install time and on every `npm view`), the workspaces themselves were dropped from the tree. The `@skill-map/*` scope is already protected by org ownership (the moment `@skill-map/spec` was published).

  Two extra names attempted at first publish that never made it into `alias/*`:

  - **`skillmap`** — npm's anti-squat policy auto-blocks "names too similar to an existing package" once `skill-map` is published. Got E403 with `"Package name too similar to existing package skill-map"`. Net effect: no third party can publish `skillmap` either, so the name is de-facto reserved. Cheaper than maintaining a workspace.
  - **`sm-cli`** — already taken on npm at first-publish time by an unrelated project. Not critical: `sm` is the binary name (alias of `skill-map`), not a package name we ship. The binary is delivered exclusively through `@skill-map/cli`, so a third party owning the `sm-cli` name does not affect the skill-map ecosystem.

  Lesson for future placeholder additions: `npm view <name>` before creating the workspace to detect both occupied names and likely anti-squat collisions; only commit a workspace if the name is publishable. And: a workspace is only worth keeping while you might re-publish it. Once the redirect lives in `npm deprecate`, the local workspace is dead weight — drop it.
- **`sm ui` sub-command**: serves the bundled UI on a static HTTP server. Loads + merges the settings hierarchy from §Configuration, validates, and serves the result as `GET /config.json` from the same origin. UI fetches once at boot. Flags: `--cwd <path>`, `--port <num>`, `--host <iface>`, `--config <path>` (single-source override of layers 2–5), `--print-config` (emit the merged settings to stdout and exit, for debugging), `--strict-config` (warnings become fatal), `--open` (launch the browser).
- **Settings loader** lives in the kernel and is shared across sub-commands: `loadSettings({ cwd, explicitConfigPath?, strict? }) → ISkillMapSettings`. Pure, stateless, fully testable. Same loader used by `sm config get/set/list` and by the dev wrapper that emulates the runtime delivery path under `ng serve`.
- **`spec/runtime-settings.schema.json`**: formalises the UI-side contract. Replaces the manual TS type guards with AJV validation. Decouples the UI bundle version from the CLI bundle version: as long as both adhere to the schema, mixing minor versions across them is safe.
- **No hot reload** in the v1.0 surface. Editing settings requires a restart of `sm ui`. SSE / WebSocket reload is a separate decision, deferred until a real use case appears.
- **Publishing workflow**: GitHub Actions for release automation + changelog generation + conventional commits.
- **Documentation site**: **Astro Starlight** (static, minimal infra, good DX).
- **Plugin API reference**: JSDoc → Starlight auto-generated.
- **LLM-discoverable docs surface** (Decision #89): generate `/llms.txt` and `/llms-full.txt` at the root of `skill-map.dev` following the [llmstxt.org](https://llmstxt.org) standard. The short file lists curated entry points (README, spec contracts, CLI reference, plugin author guide); the full file inlines the same content for one-shot ingestion. Both are emitted by `scripts/build-site.mjs` from authoritative sources (`spec/`, `context/cli-reference.md`, `ROADMAP.md`) so they cannot drift. Once the spec freezes at `v1.0.0`, register the project on [context7](https://context7.com) — it indexes public repos with a usable `llms.txt` and serves them through the `context7` MCP that AI agents already consume. Net effect: any LLM-driven workflow (Claude Code, Cursor, ChatGPT browse, etc.) finds skill-map docs without scraping the schemas. Pre-`v1.0.0` is intentionally too early — the spec is still moving and we'd be teaching context7 a stale shape.
- `mia-marketplace` entry.
- Claude Code plugin wrapper — a skill that invokes `sm` from inside Claude Code (`skill-optimizer` is the canonical dual-surface example: exists as a Claude Code skill AND as a skill-map Action via invocation-template mode).
- Telemetry opt-in.
- Compatibility matrix (kernel ↔ plugin API ↔ spec).
- Breaking-changes / deprecation policy.
- `sm doctor` diagnostics for user installs (verifies the install, reads the merged settings, confirms each hierarchy layer is parseable).
- **Launch polish on `skill-map.dev`**: the domain is already live (Railway-deployed Caddy + DNS at Vercel, serving `/spec/v0/**` schemas). The landing source lives in `web/` (editable HTML/CSS/JS, copied into `site/` by `scripts/build-site.mjs`). The build now also performs (a) i18n via `data-i18n` markers — content rendered once into `/index.html` (en) and `/es/index.html` (es), `web/i18n.json` itself excluded from the build output, (b) per-language `{{CANONICAL_URL}}` substitution, (c) generation of `robots.txt` and `sitemap.xml` (with `xhtml:link hreflang` alternates) at the site root. Base SEO surface landed 2026-04-26 ahead of schedule: per-language `<title>` + `<meta name="description">`, `<link rel="canonical">`, full Open Graph (title / description / url / image / locale + locale:alternate), Twitter cards (`summary_large_image`, `@crystian` as site/creator), JSON-LD `SoftwareApplication` with translated `description`, `theme-color`, `color-scheme`. The 1200×630 OG image asset (`web/img/og-image.png`) is in place and copied verbatim into the site at build time, so social previews render with the proper card. Step 14 still adds HTTP redirects, Astro Starlight docs, and registration on JSON Schema Store once `v0 → v1` ships.

#### Distribution flow (end-to-end)

How a single package travels from this repo to a consumer's project:

```
   ┌────────────────────────────────────┐
   │   skill-map repo (this monorepo)   │
   │   ─────────────────────────────    │
   │   spec/         → @skill-map/spec  │
   │   src/          → @skill-map/cli   │
   │   ui/           → built and copied │
   │                   into src/dist/ui │
   │                   at publish time  │
   │   alias/<name>/ → name placeholders│
   │                   (skill-map, etc.)│
   │                                    │
   │   Versioned by changesets;         │
   │   integrity hashes enforced.       │
   └─────────────────┬──────────────────┘
                     │  release workflow
                     │  (Version Packages PR → merge)
                     │  changeset publish
                     ▼
   ┌────────────────────────────────────┐
   │   npm registry                     │
   │   ─────────────────────────────    │
   │   @skill-map/spec  (schemas+types) │
   │   @skill-map/cli   (CLI + UI dist) │
   │   skill-map        (deprecated)    │
   │   skill-mapper     (deprecated)    │
   └─────────────────┬──────────────────┘
                     │  npm i -g @skill-map/cli
                     │  (or `npx @skill-map/cli …`)
                     ▼
   ┌────────────────────────────────────┐
   │   consumer machine                 │
   │   ─────────────────────────────    │
   │   $PATH: sm, skill-map             │
   │   node_modules/@skill-map/cli/     │
   │   ├── dist/         CLI bundle     │
   │   └── ui/           UI bundle      │
   │                                    │
   │   .skill-map/                      │  ← user-supplied
   │   ├── settings.json       optional │
   │   ├── settings.local.json optional │
   │   └── plugins/<id>/       drop-in  │
   └─────────────────┬──────────────────┘
                     │  sm ui [--port N] [--config path]
                     │  (also: sm scan, sm check, …)
                     ▼
   ┌────────────────────────────────────┐
   │   sm ui process                    │
   │   ─────────────────────────────    │
   │   loadSettings() walks the         │
   │   hierarchy, deep-merges, validates│
   │                                    │
   │   static HTTP server on            │
   │   localhost:<port> :               │
   │     GET /              → ui/*.html │
   │     GET /assets/*      → ui/assets │
   │     GET /config.json   → merged    │
   │                          settings  │
   └─────────────────┬──────────────────┘
                     │  browser open
                     ▼
   ┌────────────────────────────────────┐
   │   Angular bundle (in browser)      │
   │   ─────────────────────────────    │
   │   APP_INITIALIZER fetch /config    │
   │   merge over compile-time defaults │
   │   render graph + filters + HUD     │
   │                                    │
   │   No build tooling at runtime.     │
   │   No file system reads.            │
   └────────────────────────────────────┘
```

The UI bundle is **agnostic to who serves it** — Step 14 ships `sm ui` as the canonical server, but a third-party host (nginx, S3, Caddy) that places a `config.json` next to `index.html` works identically. Same HTTP contract, zero coupling between the UI and the CLI runtime.

### ▶ v1.0.0 — full distributable

---

## Decision log

Canonical index of every locked-in decision. Each row carries a stable number so the rest of the repo — `spec/`, `AGENTS.md`, commits, PR descriptions, changesets — can cite a single anchor (e.g. *"per Decision #74d"*) instead of paraphrasing the rationale.

Conventions:

- **Numbering is sparse on purpose**. Sub-items (`74a`…`74e`) land where they belong thematically rather than at the end of the list; gaps are reserved for future rows on the same topic.
- **Thematic groups, not chronology**. Rows are grouped by domain (Architecture, Persistence, Jobs, Plugins, UI, etc.). Reading a single group gives you every decision on that surface.
- **Most entries have a narrative counterpart** elsewhere in this `ROADMAP.md` or in `spec/` — the table row is the one-liner, the narrative section is the rationale. If an entry is table-only, its row states the "why" in full.
- **Source of truth for AI agents**. `ROADMAP.md` is above `AGENTS.md` in the project authority order, and this Decision log is where every agent should look up locked-in rationale. `AGENTS.md` carries only operational rules (persona activation, agent workflow, spec-editing checklist); it does **not** duplicate the decision table. Citations from `AGENTS.md`, commits, PRs, or changesets that reference a decision MUST use the `#N` anchor here (e.g. *"per Decision #74d"*) rather than paraphrasing. The spec still wins over both.
- **Immutability, with one narrow exception**. Rows are not edited away once locked — a changed decision gets a new row and the old row flips to "superseded by #N" with a date. That keeps history auditable instead of rewriting it. **Exception**: a row MAY be deleted if it was **born redundant** (never stated anything the surrounding rows did not already say; duplicated from the outset rather than revised). The deletion note goes in the changeset or commit that removes the row. Numbering stays sparse by design (§Conventions), so a gap is acceptable. This exception does NOT apply to a row that was once canonical and later superseded — that still uses the supersede-by-new-row path.

Decisions from working sessions 2026-04-19 / 20 / 21 plus pre-session carry-over.

### Architecture

| # | Item | Resolution |
|---|---|---|
| 1 | Target runtime | Node 24+ required (active LTS). **Enforcement**: (a) runtime guard in `bin/sm.mjs` fails fast with a human message and exit code 2 before any import — guarantees clear UX on Node 20 / 22; (b) `engines.node: ">=24.0"` in `package.json` gives npm an `EBADENGINE` warning (non-blocking unless the user sets `engine-strict=true`); (c) `sm version` and `sm doctor` both report the detected Node; (d) `tsup.target: "node24"` matches the runtime floor at build time. |
| 2 | Kernel-first principle | Non-negotiable from commit 1. All 6 extension kinds wired. |
| 3 | Architecture pattern | **Hexagonal (ports & adapters)** — named explicitly. |
| 4 | Kernel-as-library | CLI, Server, Skill are peer wrappers over the same kernel lib. |
| 5 | Package layout | npm workspaces: `spec/` (`@skill-map/spec`), `src/` (`@skill-map/cli`), `ui/` (private, joins at Step 0c). An `alias/*` glob workspace held un-scoped placeholders for name-squat defence (`skill-map`, `skill-mapper`) for one publish round; both names are now locked on npm with a `npm deprecate` redirect to `@skill-map/cli` and the local workspaces are gone. Two further alias names (`skillmap`, `sm-cli`) were attempted but not added: `skillmap` is auto-blocked by npm's anti-squat policy, `sm-cli` was already owned by an unrelated package. Changesets manage the bumps. |
| 6 | `sm` LLM dependency | **Zero**. `sm` never makes LLM calls. LLM lives in runner process. |

### Data and persistence

| # | Item | Resolution |
|---|---|---|
| 7 | DB engine | SQLite via **`node:sqlite`** (zero native deps). |
| 8 | Data-access layer | **Kysely + CamelCasePlugin**. Typed query builder, not ORM. |
| 9 | Two scopes | Project (`./.skill-map/skill-map.db`) and global (`~/.skill-map/skill-map.db`). `-g` toggles scan scope; DB follows. |
| 10 | Three zones | `scan_*` regenerable, `state_*` persistent, `config_*` user-owned. |
| 11 | Table naming | Plural, `snake_case`, zone prefix required. Plugin: `plugin_<normalized_id>_<table>`. |
| 12 | Column conventions | PK `id`, FK `<singular>_id`, timestamps INTEGER ms suffix `_at`, hashes `_hash`, JSON `_json`, counts `_count`, booleans `is_`/`has_`. |
| 13 | Enum values | Plain column + CHECK, kebab-case lowercase values. |
| 14 | Migration format | `.sql` files, `NNN_snake_case.sql`, up-only, auto-wrapped in transaction. |
| 15 | Version tracking | `PRAGMA user_version` + `config_schema_versions` multi-scope. |
| 16 | Auto-apply + auto-backup | At startup. Backup to `.skill-map/backups/` before any migration. |
| 17 | DB naming boundary | Conventions are invisible to kernel/CLI/server — only adapter knows. |

### Nodes and graph

| # | Item | Resolution |
|---|---|---|
| 18 | Node ID | Relative file path (not injected UUID) through `v1.0`. Through `v1.0`, `sm` does not write user node files; post-`v1.0` write-back may introduce controlled writes and a sibling frontmatter UUID. |
| 19 | Link (ex-edge) | Identity = `(from, to)` tuple. Sources preserved in `sources[]`. Merge by strength. |
| 20 | Confidence | 3 levels (high/medium/low). Each detector declares explicitly. |
| 21 | Trigger normalization | 6-step pipeline: NFD → strip diacritics → lowercase → unify hyphen/underscore/space → collapse whitespace → trim. `link.trigger` carries both `originalTrigger` (display) and `normalizedTrigger` (equality / collision key). Full contract and worked examples in §Trigger normalization. |
| 22 | External URL handling | **Count only** on `scan_nodes.external_refs_count`. No separate table. No liveness check through `v1.0`. |
| 23 | Reference counts | Denormalized columns: `links_out_count`, `links_in_count`, `external_refs_count`. |
| 24 | Orphan reconciliation | `body_hash` match → high confidence auto-rename (no issue, no prompt). `frontmatter_hash` match against a single candidate → medium, emits `auto-rename-medium` issue with `data_json.from/to`. `frontmatter_hash` match against multiple candidates → no migration, emits `auto-rename-ambiguous` issue with `data_json.to` + `data_json.candidates[]`. No match → `orphan` issue. Manual verbs: `sm orphans reconcile <orphan.path> --to <new.path>` (forward, attach orphan to live node) and `sm orphans undo-rename <new.path> [--from <old.path>] [--force]` (reverse a medium/ambiguous auto-rename; needs `--from <old.path>` for ambiguous). |
| 25 | Tokens + bytes | Triple-split per node (frontmatter / body / total). Tokenizer column. |

### Frontmatter

| # | Item | Resolution |
|---|---|---|
| 26 | Frontmatter catalog | Full field catalog across identity / authorship / versioning / provenance / taxonomy / lifecycle / integration / display / documentation / kind-specific. |
| 27 | Validation default | Warn (permissive). `--strict` flag promotes to error. |
| 28 | Provenance fields | `metadata.source` (canonical URL) + `metadata.sourceVersion` (tag or SHA). Consumed by `github-enrichment`. |
| 29 | Per-surface visibility | Rendering-config decision, resolved during Step 0c prototype. Not a blocker. |

### Jobs and runners

| # | Item | Resolution |
|---|---|---|
| 30 | Job (ex-dispatch) | Renamed. Tables `state_jobs`. Artifact "job file". |
| 31 | Job file | Single flat folder `.skill-map/jobs/<id>.md`. No maildir. State in DB. |
| 32 | Atomic claim | `UPDATE ... RETURNING id` via SQLite ≥3.35. Zero-row return = another runner won; retry. |
| 33 | Nonce | In job file frontmatter. Required by `sm record` for callback auth. Never in user files. |
| 34 | CLI runner loop + `ClaudeCliRunner` + Skill agent | **CLI runner loop** = the `sm job run` driving command that claims, spawns a runner, and records (driving adapter, peer of Server / Skill); does NOT implement `RunnerPort`. **`ClaudeCliRunner`** = default `RunnerPort` impl (driven adapter) that spawns a `claude -p` subprocess per item; `MockRunner` is the test fake. **Skill agent** = in-session via `sm job claim` + Read + agent + Write + `sm record` (driving adapter, peer of CLI / Server); also does NOT implement `RunnerPort`. Both driving adapters share the kernel primitives `claim` + `record`. |
| 35 | Sequential execution | Jobs run sequentially within a single runner (no pool, no scheduler) through `v1.0`. Event schema carries `runId` + `jobId` so true in-runner parallelism lands as a non-breaking post-`v1.0` extension. |
| 36 | Prompt injection mitigation | User-content delimiters + auto-prepended preamble (kernel-enforced). |
| 37 | Job concurrency (same action, same node) | Refuse duplicate with `--force` override. Content hash over action+version+node hashes+template hash. |
| 38 | Exit codes | `0` ok · `1` issues · `2` error · `3` duplicate · `4` nonce-mismatch · `5` not-found. `6–15` reserved for future spec use. `≥16` free for verb-specific use. |
| 39 | TTL resolution (three steps) | Normative in `spec/job-lifecycle.md §TTL resolution`. (1) **Base duration** = action manifest `expectedDurationSeconds` OR config `jobs.ttlSeconds` (default `3600`). (2) **Computed** = `max(base × graceMultiplier, minimumTtlSeconds)` (defaults `3` and `60`; the floor is a floor, never a default). (3) **Overrides** (later wins, skips the formula): `jobs.perActionTtl.<actionId>`, then `sm job submit --ttl <n>`. Frozen on `state_jobs.ttlSeconds` at submit. Negative or zero overrides rejected with exit `2`. |
| 40 | Job priority | `state_jobs.priority` (INTEGER, default `0`). Higher runs first; ties broken by `createdAt ASC`. Negatives allowed. Set via manifest `defaultPriority`, user config `jobs.perActionPriority.<id>`, or CLI `--priority <n>` (later wins). Frozen at submit. |
| 41 | Auto-reap | At start of every `sm job run`. Rows in `running` with expired TTL (`claimedAt + ttlSeconds × 1000 < now`) transition to `failed` with `failureReason = abandoned`. Rowcount reported as `run.reap.completed.reapedCount`. |
| 42 | Atomicity edge cases | Per-scenario policy: missing file → failed(job-file-missing); orphan file → reported by doctor, user prunes; edited file → by design. |

### Actions and summarizers

| # | Item | Resolution |
|---|---|---|
| 43 | Action execution modes | `local` (code in plugin) + `invocation-template` (prompt for LLM runner). |
| 44 | Summarizer pattern | Action per node-kind. `skill-summarizer`, `agent-summarizer`, `command-summarizer`, `hook-summarizer`, `note-summarizer`. 5 schemas in spec. `v0.8.0` ships all 5: `skill-summarizer` at Step 10, the remaining four at Step 11. `v0.5.0` ships none — the LLM layer starts after the deterministic release. |
| 45 | Default prob-refresh | Adapter declares `defaultRefreshAction` per kind. UI "🧠 prob" button submits this. |
| 46 | Report base schema | All probabilistic reports extend `report-base.schema.json`. Contains `confidence` (metacognition) + `safety` (input assessment). |
| 47 | Safety object | Sibling of confidence: `injectionDetected`, `injectionType` (direct-override / role-swap / hidden-instruction / other), `contentQuality` (clean / suspicious / malformed). |
| 48 | Conversational verbs | One-shot CLI + `/skill-map:explore` meta-skill. No multi-turn jobs in kernel. |
| 49 | LLM verbs | Ambitious set shipped at Step 11: `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization`. All single-turn. `v0.5.0` ships none — deterministic verbs only. |
| 50 | `sm findings` verb | New. Separate from `sm check` (deterministic). Queries probabilistic findings stored in DB. |

### Plugins

| # | Item | Resolution |
|---|---|---|
| 51 | Drop-in | Default. No `add`/`remove` verbs. User drops files. `enable`/`disable` persisted. |
| 52 | specCompat | `semver.satisfies(specVersion, plugin.specCompat)`. Fail → `disabled` with reason `incompatible-spec`. |
| 53 | Storage dual mode | Mode A (KV via `ctx.store`) and Mode B (dedicated tables, plugin declares). **A plugin MUST declare exactly one storage mode.** Mixing is forbidden; a plugin that needs KV-like and relational access uses mode B and implements KV rows as a dedicated table. |
| 54 | Mode B triple protection | Prefix enforcement + DDL validation + scoped connection wrapper. Guards accidents, not hostile plugins. |
| 55 | Tool permissions per node | Frontmatter carries two top-level arrays (mirroring Claude Code conventions): `tools[]` — **allowlist**, the host MUST restrict the node to exactly these tools when present (matches Claude subagent `tools`); `allowedTools[]` — **pre-approval**, tools that don't require a per-use permission prompt while the node is active (matches Claude skill `allowed-tools`). Both live on `base` so every kind inherits them. Kind-specific interpretation: agents use the allowlist to lock spawned subagents; skills typically populate `allowedTools[]` to opt into silent execution; other kinds use them as declarative hints. `expectedTools` on action manifests (not frontmatter) is a separate field with distinct semantics (hint from the action template to the runner). |
| 56 | Default plugin pack | Pattern confirmed. Contents TBD. Only `github-enrichment` firm commitment. Security scanner as spec'd interface for third-parties. |

### Enrichment

| # | Item | Resolution |
|---|---|---|
| 57 | Enrichment scope | GitHub only through `v1.0.0`. Skills.sh dropped (no public API). npm dropped. `github-enrichment` is the only bundled enrichment action — it ships at Step 10. Other providers land post-`v1.0` against the same stable contract. |
| 58 | Hash verification | Explicit declaration + compare. No reverse-lookup (no API). |
| 59 | GitHub idempotency | SHA pin + branch resolution cache + optional ETag. |
| 60 | Targeted fan-out | No dedicated enrichment verb. Uses `sm job submit <action> --all`. `--all` is not global; it is explicitly documented only on verbs with meaningful fan-out semantics: `sm job submit`, `sm job run`, `sm job cancel`, and `sm plugins enable/disable`. Unsupported verbs reject unknown `--all` normally. |
| 61 | `state_enrichments` table | Dedicated. `node_id + provider_id` PK. |

### CLI and introspection

| # | Item | Resolution |
|---|---|---|
| 62 | CLI framework | **Clipanion** (pragmatic, introspection built-in). |
| 63 | Introspection | `sm help --format json \| md`. Consumers: docs, completion, UI, agents. |
| 64 | CLI reference doc | Auto-generated at `context/cli-reference.md`, CI-enforced sync. |
| 65 | `sm-cli` skill | Ships with tool. Feeds introspection JSON to agent. |
| 66 | Scan unification | Single `sm scan` with `-n`, `--changed`, `--compare-with`. No `sm rescan`. |
| 67 | Progress events | 3 output modes (pretty / `--stream-output` / `--json`). Canonical event list in `spec/job-events.md`. |
| 68 | Task UI integration | Host-specific skill, not CLI output mode. Ships `sm-cli-run-queue` for Claude Code. |
| 69 | `sm doctor` | Checks DB, migrations, LLM runner availability, job-file consistency. |

### UI

| # | Item | Resolution |
|---|---|---|
| 70 | Build order inversion | Step 0c UI prototype before kernel implementation. Flavor A mocked, Flavor B in Step 13. |
| 71 | Live sync protocol | **WebSocket** (bidirectional). REST HTTP for discrete CRUD only. |
| 72 | Frontend framework | **Angular ≥ 21** (standalone components). Locked at Step 0c; `ui/package.json` pins `^21.0.0`. Replaces original SolidJS pick — driven by Foblex Flow being the only Angular-native node-based UI library in the market. Major bumps revisited case-by-case, not automatic. |
| 73 | Node-based UI library | **Foblex Flow** — chosen for card-style nodes with arbitrary HTML, active maintenance, and Angular-native design. Replaces Cytoscape.js (which was dot/graph-oriented, not card-oriented). |
| 74 | Component library | **PrimeNG** for tables, forms, dialogs, menus, overlays. |
| 74a | UI styling | **SCSS scoped per component**. No utility CSS framework (no Tailwind, no PrimeFlex) — PrimeFlex is in maintenance mode, Tailwind overlaps with PrimeNG theming. Utilities come back later only if real friction appears. |
| 74b | UI workspace layout | `ui/` is an npm workspace peer of `spec/` and `src/`. Kernel stays Angular-agnostic; UI imports only typed contracts from `spec/`. No cross-import from `src/` into `ui/` or vice versa. |
| 74c | BFF mandate | Single-port: `sm serve` exposes SPA + REST + WS under one listener. Dev uses Angular dev server with `proxy.conf.json` → Hono for `/api` and `/ws`; prod uses Hono + `serveStatic`. |
| 74d | BFF framework | **Hono**, thin proxy over the kernel. No domain logic, no second DI. NestJS considered and rejected as over-engineered for a single-client BFF. |
| 74e | WebSocket library | Server: `hono/ws` + `@hono/node-ws` — co-located with the Hono router, same listener as REST (single-port). Client: browser-native `WebSocket` or Node 24 global `WebSocket` — no extra dep. `ws` rejected (duplicates multiplex glue). |
| 74f | UI accessibility baseline | **Audited at Step 13 close, not Step 0c.** The Flavor A prototype carries basic semantics (labels, alt, focus) but does not commit to a WCAG level; its component composition differs enough from Flavor B (full UI) that auditing now is re-work. The baseline target (WCAG 2.1 AA) and the audit tooling (axe-core, keyboard walk) lock when Step 13 ships. |
| 74g | Graph auto-layout library | **`@dagrejs/dagre`** — hierarchical layout consumed by the graph view. UI-only dep; the kernel does not import it. Picked over the inactive `dagre` package (the `@dagrejs/*` scope is the maintained fork). Revisit only if Foblex ships an in-house layout primitive that covers the same cases. |
| 75 | Det vs prob refresh | Two buttons per node in UI, two verbs in CLI, two distinct pipes. |

### Spec

| # | Item | Resolution |
|---|---|---|
| 76 | Spec as standard | Public from commit 1. JSON Schemas + conformance suite + prose contracts. |
| 77 | Spec versioning | Independent from CLI. The current reference roadmap stabilizes both tracks at `v1.0.0`, but future spec and CLI versions can diverge. Stability tags per field. |
| 78 | `@skill-map/spec` npm pkg | Publishable independently. |

### Tooling

| # | Item | Resolution |
|---|---|---|
| 79 | Logger | `pino` JSON lines. |
| 80 | Tokenizer | `js-tiktoken` with `cl100k_base`. ~90% accurate for Claude. Column stores tokenizer name. |
| 81 | Test framework | `node:test` (built-in). Migration to Vitest only if pain emerges. |
| 82 | Build | `tsup` / `esbuild`. |
| 83 | HTTP server | Hono. |
| 84 | License | **MIT**. |
| 85 | Documentation site | **Astro Starlight** at Step 14. |
| 86 | `skill-optimizer` coexistence | Kept as a Claude Code skill AND wrapped as a skill-map Action (invocation-template mode). Dual surface. Canonical example of the dual-mode action pattern. |
| 87 | Domain | `skill-map.dev` — live today (Railway + Caddy, DNS via Vercel). `$id` scheme `https://skill-map.dev/spec/v0/<path>.schema.json`; bumps to `v1` at the first stable release. Landing page + SEO + Starlight docs deferred to Step 14. |
| 88 | ID format family | Base shape `<prefix>-YYYYMMDD-HHMMSS-XXXX` (UTC timestamp + 4 lowercase hex chars), with one optional `<mode>` segment on runs. Prefixes: `d-` jobs (`state_jobs.id`), `e-` execution records (`state_executions.id`), `r-[<mode>-]` runs (`runId` on progress events). Canonical `<mode>` values: `ext` (external Skill claims), `scan` (scan runs), `check` (standalone issue recomputations). Without `<mode>`, `r-YYYYMMDD-HHMMSS-XXXX` denotes the CLI runner's own loop. New `<mode>` values are additive-minor; removing or repurposing one is a major spec bump. Human-readable, sortable, collision-safe for single-writer. |
| 89 | LLM-discoverable docs (`llms.txt` + context7) | Step 14 ships `/llms.txt` (curated index) and `/llms-full.txt` (concatenated full text) at `skill-map.dev`, generated from `spec/`, `context/cli-reference.md`, and `ROADMAP.md` by `scripts/build-site.mjs` so they cannot drift from the source of truth. Format follows [llmstxt.org](https://llmstxt.org). After `v1.0.0` lands, register the public repo on [context7](https://context7.com) so AI agents using the `context7` MCP can pull skill-map docs with a single call. Pre-`v1.0.0` registration is rejected — context7 caches the indexed shape and would freeze a moving spec. The `llms.txt` files themselves can ship earlier (Step 13 / 14 prep) since they regenerate on every build. |

### LLM participation summary

| Steps | LLM usage |
|---|---|
| 0a–9 | **None**. Fully deterministic. Tool works end-to-end without any LLM. |
| 10–11 | **Optional**. Adds semantic intelligence via jobs + summarizers. Graceful offline degradation when no runner available. |
| 12–14 | **Optional**, consumed by renderers and UI. |
| 15+ (post-v1) | Likely expanded (write-back suggestions, auto-fix). |

**Invariant**: the LLM is **never required**. Users who can't or don't want to use an LLM still get a complete, useful tool through step 9.

### Gaps still open

- **Per-surface frontmatter visibility** — resolves during Step 0c prototype.
- **Remaining tech stack picks** (YAML parser, MD parsing, templating, pretty CLI libs, globbing, diff) — each lands with the step that first requires it (see §Tech picks deferred).
- **`## Stability` sections on prose docs — closed.** Every contract prose doc (`architecture.md`, `cli-contract.md`, `db-schema.md`, `job-events.md`, `job-lifecycle.md`, `plugin-kv-api.md`, `prompt-preamble.md`, `interfaces/security-scanner.md`) now ends with a `## Stability` section per the AGENTS.md rule. The three meta docs (`README.md`, `CHANGELOG.md`, `versioning.md`) are foundation/meta, not contracts — the rule explicitly does not apply. Reviewing every `Stability: experimental` tag remains on the pre-`spec-v1.0.0` freeze pass, but that is a separate audit and not a gap.

---

## Deferred beyond v1.0

- **Step 15+ — Write-back**. Edit / create / refactor from UI. Git-based undo. Detectors become bidirectional.
- **Step 16+ — Test harness**. Dry-run / real execution / subprocess — scope TBD.
- **Step 17+ — Richer workflows**. Node-pipe API, JSON declarative workflows, visual DAG.
- **Step 18+ — Additional lenses**. Obsidian-vault, docs-site.
- **Step 19+ — More adapters**. Codex, Gemini, Copilot, generic.
- **Step 20+ — URL liveness plugin**. Network HEAD checks, `broken-external-ref` rule.
- **Step 21+ — Schema v2 + migration tooling**. When breaking changes on the JSON output become necessary.
- **Step 22+ — Density / token-economy plugin**. Drop-in bundle that closes the loop between *identifying* token-heavy nodes and *recovering* the value. Ships a deterministic rule `oversized-node` (threshold on `scan_nodes.tokens_total`, per-kind configurable via plugin KV) plus cheap-filter proxies for information density — Shannon entropy over tokens, or a gzip-ratio substitute for a coarser signal. Summarizers emit a probabilistic finding `low-information-density` when they detect repetition without added signal. An audit `density-audit` walks the candidates and pipes them into `skill-optimizer` (Decision #86, canonical dual-surface action) via `sm job submit`. Cheap-filter + expensive-verifier: determinist proxies pre-filter for free, the LLM summarizer confirms before committing tokens. Exactly the drop-in story the plugin architecture was designed to support — zero kernel changes, pure composition of Rule + Finding + Audit + Action.
- **npm + other registry enrichment plugins**. When registries publish documented APIs.
- **ETag / conditional GET** for GitHub enrichment. Bandwidth optimization.
- **Governance / RFC process**. When external contributors appear.
- **Claude Code hook auto-record**. A PostToolUse hook that auto-calls `sm record` after an action completes. Partial coverage already via the Skill agent; full auto-record hook deferred.
- **Adversarial testing suite** for prompt injection. Fixtures with known payloads.
- **Parallel job execution**. Event schema already supports demuxing by id.
- **Multi-turn conversational jobs in DB**. If a strong case appears.
- **Plugin signing / hash verification**. Post v1.0 distribution hardening.
- **Telemetry (opt-in)**. Know which detectors / audits are used in the wild.
- **`.ts` migrations** (escape hatch for SQL-impossible data transforms).

---

## Discarded (explicitly rejected)

- **Cursor support** — excluded by user.
- **Remote scope** (scanning GitHub repos as a source) — local only.
- **Diff / history** of graph across commits.
- **Sync with live systems** — detecting what is enabled vs on disk.
- **Query language** — arbitrary queries over the graph.
- **MCP server as the primary interface** — excessive infra for a local tool.
- **Hook-based activation** — this is manual inspection, not automatic.
- **Python** — Node ESM preferred for unification with future web server.
- **`br` / beads task tracking** — experimental project, no formal tracking.
- **Custom snapshot system for undo** — use Git directly when write-back lands.
- **Full ORMs** (Prisma, Drizzle, TypeORM) — incompatible with hand-written `.sql` migrations.
- **Soft deletes** (`deleted_at` columns) — real deletes + backups.
- **Audit columns** (`created_by`, `updated_by`) — irrelevant in single-user; git audit covers team case.
- **Lookup tables for enums** — CHECK constraints sufficient.
- **`sm db reset --nuke`** — too destructive given drop-in plugins are user-placed code.
- **`sm job reap` as explicit verb** — auto-reap on `sm job run` is sufficient.
- **Skills.sh enrichment** — see §Enrichment (dropped; no public API after investigation).
- **URL liveness in the core product** — post-`v1.0` plugin if demand appears.
- **Multi-turn jobs in the kernel** — kernel stays single-turn; conversation lives in agent skill.
- **`skill-manager` / `skillctl` naming** — `skill-map` preserved.
- **Per-verb `explore-*` skills** — single `/skill-map:explore` meta-skill.
