# skill-map

> Design document and execution plan for `skill-map`. Architecture, decisions, phases, deferred items, and open questions. Target: distributable product (not personal tool). Versioning policy, plugin security, i18n, onboarding docs, and compatibility matrix all apply.

**Last updated**: 2026-05-03.


## Project overview

The project description, problem statement, target audience, and philosophy live in the README. Both language variants carry the same content:

- **English (default)**: [README.md](./README.md).
- **Español**: [README.es.md](./README.es.md).

Each README also ships a short essentials-only glossary with a pointer back to the full [§Glossary](#glossary) below. This document (`ROADMAP.md`) is the design narrative — architecture decisions, execution plan, decision log, and deferred work — and sits beneath the READMEs; it is maintained in English only.

**Status**: Phase A (deterministic kernel + CLI) and Step 14 (Web UI: 14.1–14.7 — baseline + bundle hard cut + responsive scope + demo smoke test) are shipped, closing `v0.6.0`. Three public packages on npm: `@skill-map/spec`, `@skill-map/cli`, `@skill-map/testkit`. **Next**: Phase B opens with the job subsystem (Step 10), the first probabilistic extensions (Step 11), and the **initial UI hand-off for the probabilistic layer (Step 16)** — read-only surfaces in the inspector + a findings page — shipping `v0.8.0`. **Phase C** (`v1.0.0`) deepens the UI with **verbs as interactive flows (Step 17)** alongside Formatters (12), multi-host adapters (13), and distribution polish (15) — which also wires the deferred 14.7 publish carry-over (e2e smoke already wired via validate; public-site `web/demo/` deploy still pending). The canonical completeness marker lives in §Execution plan below.

---

## Table of contents

1. [Project overview](#project-overview) — status, language variants, document scope.
2. [Glossary](#glossary) — canonical vocabulary (domain, extensions, modes, architecture, jobs, states, plugins, refresh, safety, enrichment, scope, CLI/UI).
3. [Visual roadmap](#visual-roadmap) — ASCII timeline of every Step.
4. [Spec as a standard](#spec-as-a-standard) — repo layout, properties, distribution.
5. [Architecture: Hexagonal (Ports & Adapters)](#architecture-hexagonal-ports--adapters) — layering, ports, adapters, package layout.
6. [Persistence](#persistence) — scopes, zones (`scan_*` / `state_*` / `config_*`), naming, data-access, migrations, DB management.
7. [Job system](#job-system) — model, lifecycle, TTL, duplicate prevention, runners, nonce, preamble, atomicity, concurrency, events, `sm job` surface.
8. [Plugin system](#plugin-system) — six kinds, drop-in install, loading, qualified ids, Provider catalog, Extractor channels, scan cache, Hook trigger set, storage modes, triple protection, default pack.
9. [Summarizer pattern](#summarizer-pattern) — schemas, storage, probabilistic refresh, report base.
10. [Frontmatter standard](#frontmatter-standard) — base (universal), per-kind (Provider-owned), validation tiers, DB denormalization.
11. [Enrichment](#enrichment) — two enrichment models, hash verification, stale tracking, refresh commands.
12. [Reference counts](#reference-counts) — link-count denormalization.
13. [Trigger normalization](#trigger-normalization) — six-step pipeline, examples.
14. [Configuration](#configuration) — file hierarchy, key reference.
15. [CLI surface](#cli-surface) — every verb, the `sm` binary contract, exit codes.
16. [Skills catalog](#skills-catalog) — built-in and bundled skills.
17. [UI (Step 0c prototype → Step 14 full)](#ui-step-0c-prototype--step-14-full) — Flavor A → Flavor B + the Hono BFF.
18. [Testing strategy](#testing-strategy) — pyramid, coverage targets.
19. [Stack conventions](#stack-conventions) — runtime, language, deps, formatting.
20. [Execution plan](#execution-plan) — Step-by-step status with the completeness marker.
21. [Decision log](#decision-log) — every architectural decision (numbered, current count: 122).
22. [Deferred beyond v1.0](#deferred-beyond-v10) — Steps and features intentionally pushed past the first stable release.
23. [Discarded (explicitly rejected)](#discarded-explicitly-rejected) — proposals considered and dropped.

> **Step vs Phase glossary**: a **Step** (e.g. `Step 9`, `Step 14.4.b`) is an atomic feature milestone — one PR or a tightly-related sequence. A **Phase** (e.g. `Phase A`, `Phase B`, `Phase C`) is a multi-Step release target. Phase A = `v0.5.0` (deterministic kernel + CLI), Phase B = `v0.8.0` (job subsystem + LLM verbs), Phase C = `v1.0.0` (surface + distribution). Execution prose mixes both: `Step 14 ships v0.6.0 inside Phase C` is correct shorthand.

---

## Glossary

> Canonical vocabulary of the project. The rest of the roadmap uses these terms without ambiguity.

### Domain and graph

| Concept | Description |
|---|---|
| **Node** | Markdown file representing a unit (skill, agent, command, hook, note). Identified by path relative to the scope root. |
| **Link** | Directed relation between two nodes (replaces the term "edge"). Carries `kind` (invokes / references / mentions / supersedes), confidence (high / medium / low), and sources (which Extractors produced it). |
| **Issue** | Problem emitted by a deterministic rule when evaluating the graph. Has severity (warn / error). |
| **Finding** | Result emitted by probabilistic analysis (summarizer, LLM verb), persisted in the DB. Covers injection detection, low confidence, stale summaries. |
| **Node kind** | Category of a node: skill / agent / command / hook / note. Field `node.kind` in the spec. Distinct from **link kind** (value of `link.kind`) and **extension kind** (plugin category, see next table). All three are polysemic specializations of the generic term "kind"; the prefix is used when context is not obvious. |

### Extensions (6 extension kinds)

"Extension kind" is the category of a plugin piece, distinct from **node kind** in the previous table. The ecosystem exposes six, and they form the stable kernel contract. Four kinds are dual-mode (deterministic / probabilistic — see §Execution modes below); two are deterministic-only because they sit at the system boundaries.

| Concept | Description |
|---|---|
| **Provider** | Extension kind. Recognizes a platform (claude, codex, gemini, generic), classifies each file into its node kind, and declares its `kinds` catalog (per-kind frontmatter `schema` + `defaultRefreshAction` + `ui` presentation block) plus its `explorationDir`. **Deterministic-only**. |
| **Extractor** | Extension kind. Reads a node's body and emits work through three callbacks: `ctx.emitLink(link)`, `ctx.enrichNode(partial)`, `ctx.store.write(...)`. **Dual-mode**: deterministic Extractors run during scan; probabilistic Extractors invoke an LLM and run only as queued jobs. |
| **Rule** | Extension kind. Evaluates the graph and emits issues. **Dual-mode**: deterministic Rules run in `sm check`; probabilistic Rules run only as queued jobs (opt-in via `sm check --include-prob`). |
| **Action** | Extension kind. Operation executable over one or more nodes. **Dual-mode**: `deterministic` (plugin code, in-process) or `probabilistic` (rendered prompt the runner executes against an LLM). |
| **Formatter** | Extension kind. Serializes the graph into ascii / mermaid / dot / json. **Deterministic-only** (snapshot diffability). |
| **Hook** | Extension kind. Reacts declaratively to one of eight curated lifecycle events (`scan.started`, `scan.completed`, `extractor.completed`, `rule.completed`, `action.completed`, `job.spawning`, `job.completed`, `job.failed`). **Dual-mode**. Reaction-only: a Hook cannot mutate, block, or steer the pipeline. |

### Execution modes

The dual-mode capability is the meta-property that lets the same extension model scale from `pre-commit` (deterministic only) to nightly enrichment (deterministic + probabilistic). Mode is a property of the extension as a whole, not of an individual call.

| Concept | Description |
|---|---|
| **Deterministic mode** | Pure code. Same input → same output, every run. Runs synchronously inside `sm scan` / `sm check`. Fast, free, CI-safe. |
| **Probabilistic mode** | Calls an LLM through the kernel's `RunnerPort` (`ClaudeCliRunner`, `MockRunner`, third-party runners). Output may vary across runs. NEVER participates in `sm scan`; dispatches as a queued job (`sm job submit <kind>:<id>`). The kernel rejects probabilistic extensions that try to register scan-time hooks at load time. |
| **Per-kind capability** | Four kinds are dual-mode (declared in manifest's `mode` field): **Extractor**, **Rule**, **Action**, **Hook** (Action requires the field; the others default to `deterministic`). Two kinds are deterministic-only because they sit at the system boundaries: **Provider** (filesystem-to-graph) and **Formatter** (graph-to-string). The `mode` field MUST NOT appear on Provider or Formatter manifests. |

The full normative contract lives in [`spec/architecture.md`](./spec/architecture.md) §Execution modes.

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
| **Extension** | One of the 6 categories (provider, extractor, rule, action, formatter, hook) a plugin contributes. |
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

Mirrors the interactive timeline on `skill-map.dev` (driven by `web/app.js` `PHASES`). Five phases (0 / A / B / C / D); 0 ships highlights, A/B/C ship numbered steps, D ships sketches.

```text
═══════════════════════════════════════════════════════════════════════════
  PHASE 0 · DEFINITION (project shape and the standard)
═══════════════════════════════════════════════════════════════════════════
● Hexagonal architecture · kernel + ports + adapters + 6 plugin kinds
● Persistence model · 2 scopes × 3 zones
● Job subsystem · atomic claim, nonce, kernel-enforced preamble
● Plugin model · 2 storage modes, triple protection
● Frontmatter standard · universal base · provider-owned kind schemas
● Trigger normalization · 6-step pipeline
● Config hierarchy · defaults → global → project → local → env
● Versioning policy · changesets, independent semver per package
● Spec as a standard · separable from reference impl
● 29 schemas + 9 prose contracts + conformance suite
● 117 architectural decisions, logged
● @skill-map/spec published on npm
  ────────────────────────────────────────────────────────────────────────
   ▶ @skill-map/spec released

═══════════════════════════════════════════════════════════════════════════
  PHASE A · DETERMINISTIC CORE (scan, model, query — no LLM)
═══════════════════════════════════════════════════════════════════════════
●  0b   Implementation bootstrap     workspace, kernel shell, CLI binary, conformance harness, CI green
●  0c   UI prototype (Flavor A)      Angular + Foblex Flow + PrimeNG, mock collection, list / graph / inspector
●  1a   Storage + migrations         SQLite via node:sqlite, kernel migrations, auto-backup, sm db * verbs
●  1b   Registry + plugin loader     six kinds enforced, drop-in discovery, sm plugins list/show/doctor
●  1c   Orchestrator + dispatcher    scan skeleton, full Clipanion verb registration, sm help, autogen reference
●  2    First extensions             claude provider · 3 extractors · 3 rules · ASCII formatter · validate-all
●  3    UI design refinement         node cards, connection styling, inspector layout, dark mode parity
●  4    Scan end-to-end              sm scan persists · per-node tokens · external-url-counter · --changed · sm list/show/check
●  5    History + orphans            scan_meta · sm history + stats · auto-rename heuristic · sm orphans · canonical-YAML hash
●  6    Config + onboarding          settings(.local).json · 6-layer loader · sm config * · .skillmapignore · sm init · scan strict
●  7    Robustness                   sm watch + chokidar · link-conflict rule · sm job prune · trigger normalization
●  8    Diff + export                sm graph · sm scan compare-with · sm export with mini query language
●  9    Plugin author UX             plugin runtime · plugin migrations · @skill-map/testkit on npm · author guide + reference plugin
  ────────────────────────────────────────────────────────────────────────
   ▶ YOU ARE HERE — Steps 0–9 + 14.1–14.7 complete · v0.6.0 ready (CI/publish wiring deferred to Step 15). Phase B opens with Step 10 (job subsystem) next.
  ────────────────────────────────────────────────────────────────────────
   ▶ skill-map@0.5 · testkit@0.2

═══════════════════════════════════════════════════════════════════════════
  PHASE B · LLM AS AN OPTIONAL LAYER (summaries, semantic verbs)
═══════════════════════════════════════════════════════════════════════════
●  9.6  Foundation refactors         Open node kinds · storage port promotion (5 namespaces) · universal enrichment · incremental scan cache
○  10a  Queue infrastructure         state_jobs + content-addressed state_job_contents · atomic claim · sm job submit/list/show/preview/claim/cancel/status · sm record + nonce
○  10b  LLM runner                   ClaudeCliRunner + MockRunner · ctx.runner injection · sm job run full loop · sm doctor runner probe · /skill-map:run-queue Skill agent
○  10c  First probabilistic ext      skill-summarizer · extension-mode-derivation + preamble-bitwise-match · github-enrichment plugin
○  11a  Per-kind summarizers         agent · command · hook · note
○  11b  Semantic LLM verbs           sm what · sm dedupe · sm cluster-triggers · sm impact-of · sm recommend-optimization · sm findings
○  11c  /skill-map:explore meta      cross-extension orchestration over the queue + summaries
○  16   UI: LLM surfaces v1          Inspector summary/enrichment/findings cards (read-only) · /findings page · per-card refresh · cost surfacing · BFF endpoints
  ────────────────────────────────────────────────────────────────────────
   ▶ target: v0.8.0 — LLM optional layer + initial UI hand-off

═══════════════════════════════════════════════════════════════════════════
  PHASE C · SURFACE & DISTRIBUTION (formatters, full web UI, single-binary release)
═══════════════════════════════════════════════════════════════════════════
○  12   Additional formatters        Mermaid · DOT/Graphviz · subgraph export with filters
○  13   Multi-host adapters          Codex · Gemini · Copilot · generic provider · per-host sm-<host>-* skill namespace · adapter conformance
○  14a  Web UI: BFF + transport      Hono BFF · WebSocket /ws · single-port mandate · Angular SPA + REST + WS under one listener · sm serve --port N
○  14b  Web UI: Flavor B slice       Inspector with enrichment + summaries + findings · command submit from UI · chokidar live updates · MD body renderer pick
○  14c  Web UI: polish & budgets     URL-synced filter state · responsive scope · bundle budget · dark mode tri-state · Foblex types reassessment
○  17   UI: LLM surfaces v2          Verbs as flows (what · dedupe · cluster-triggers · impact-of · recommend-optimization) · queue inspector · findings management · cost dashboard · settings + plugins page · WCAG AA pass
○  15a  Single package distrib       @skill-map/cli with UI bundled · sm + skill-map binary aliases · sm ui sub-command · settings loader + runtime-settings schema
○  15b  Documentation site           Astro Starlight · plugin API reference (JSDoc → Starlight) · llms.txt + llms-full.txt · skill-map.dev launch · context7
○  15c  Release infrastructure       GH Actions release + changelog · telemetry opt-in · compatibility matrix · breaking-changes policy · sm doctor diagnostics · Claude Code wrapper
  ────────────────────────────────────────────────────────────────────────
   ▶ target: v1.0.0 — full distributable

═══════════════════════════════════════════════════════════════════════════
  PHASE D · REAL-TIME (pending — watch execution as it happens)
═══════════════════════════════════════════════════════════════════════════
○       Event stream                 live WebSocket from the kernel to the UI
○       Execution snapshot           immutable audit of every run
○       Real-time exploration        watch agents and skills as they run
○       Marketplace ?                plugin discovery and distribution — to evaluate
═══════════════════════════════════════════════════════════════════════════

  Rule: the LLM is never required. Product is complete offline through Phase A.
```

---

## Spec as a standard

`skill-map` is a reusable standard, not only a tool. The **spec** is separated from the **reference implementation** from day zero. Anyone can build a UI, a CLI, a VSCode extension, or an entirely new implementation (any language) using only `spec/`, without reading the reference source.

### Repo layout

```
skill-map/
├── spec/                          ← source of truth for the STANDARD (25 schemas + 7 prose contracts + plugin author guide)
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
│   ├── plugin-author-guide.md     ← drop-in plugin authoring contract (manifest, six kinds, storage modes)
│   ├── schemas/                   ← 25 JSON Schemas, draft 2020-12, camelCase keys
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
│   │   ├── api/                             ← BFF wire envelopes (Step 14.2)
│   │   │   └── rest-envelope.schema.json    ← 1 envelope schema
│   │   ├── extensions/                      ← one per extension kind (loaded at plugin load)
│   │   │   ├── base.schema.json             ┐
│   │   │   ├── provider.schema.json         │
│   │   │   ├── extractor.schema.json        │ 7 extension schemas
│   │   │   ├── rule.schema.json             │ (base + 6 kinds)
│   │   │   ├── action.schema.json           │
│   │   │   ├── formatter.schema.json        │
│   │   │   └── hook.schema.json             ┘
│   │   ├── frontmatter/                     ← universal-only; per-kind schemas live in the Provider that declares them
│   │   │   └── base.schema.json             ← 1 universal frontmatter schema
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
├── scripts/                      ← build-site.js · build-spec-index.js · check-changeset.js · check-coverage.js
├── web/                          ← editable landing source (HTML/CSS/JS); copied into site/ at build
├── site/                         ← generated public site (Caddy on Railway)
│
├── spec/                         ← workspace #1, published as @skill-map/spec
│   └── (see previous §Repo layout tree)
│
├── src/                          ← workspace #2, published as @skill-map/cli
│   ├── package.json              ← { "name": "@skill-map/cli",
│   │                                  "bin": { "sm": "bin/sm.js", "skill-map": "bin/sm.js" },
│   │                                  "exports": { ".", "./kernel", "./conformance" } }
│   ├── kernel/                   Registry, Orchestrator, domain types, ports, use cases
│   ├── cli/                      Clipanion commands, thin wrappers over kernel
│   ├── conformance/              Contract runner (loads a spec case, asserts against binary)
│   ├── extensions/               Built-in extensions (empty until Step 2; user plugins drop in at `<scope>/.skill-map/plugins/`)
│   ├── test/                     node:test + tsx loader (*.test.ts)
│   ├── bin/sm.js                CLI entry, imports from ../dist/cli
│   ├── index.ts                  Package entry (re-exports)
│   ├── server/         [Step 14] Hono + WebSocket, thin wrapper over kernel
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

The kernel never imports Angular; `ui/` never imports `src/` internals. The sole cross-workspace contract is `spec/` (JSON Schemas + typed DTOs). At Step 14 the Hono BFF inside `src/server/` exposes kernel operations over HTTP/WS, and `sm serve` serves the built Angular SPA from the same listener (single-port mandate).

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
- **Non-job families (experimental, v0.x)**: `scan.*` (`scan.started`, `scan.progress`, `scan.completed`) and `issue.*` (`issue.added`, `issue.resolved`). Shipped at Step 14 with the WebSocket broadcaster; shapes lock when promoted to `stable` in a later minor bump.

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

### Six plugin kinds

| Kind | Role | Modes | Reads | Writes |
|---|---|---|---|---|
| **Provider** | Knows a platform: declares its kinds + their schemas + globs, classifies paths to kinds. | det only | filesystem | none directly |
| **Extractor** | Extracts data from a parsed node body — emits links, enriches the node, or persists custom data. | det / prob | one node | `links`, enrichment layer, or plugin's own table |
| **Rule** | Cross-node reasoning over the merged graph; emits issues. | det / prob | full graph | `issues` |
| **Action** | Operates on one or more nodes; the only kind that mutates source files. | det / prob | one or more nodes | filesystem (det) or rendered prompt to runner (prob) |
| **Formatter** | Serializes the graph to a string output (ASCII / Mermaid / DOT / JSON / custom). | det only | full graph | stdout (string) |
| **Hook** | Reacts to a curated set of kernel lifecycle events; declarative subscriber. | det / prob | event payload + node + job result | side effects (notifications, integrations, cascades) |

The six extension kinds are Provider, Extractor, Rule, Action, Formatter, Hook. The kernel ships `validate-all` as a Rule (post-scan AJV revalidation against the spec schemas); there is no Suite, Enricher, or composer kind — composition is explicit at the verb / Hook level.

### Drop-in installation

No `add` / `remove` verbs. User drops files in:
- `<scope>/.skill-map/plugins/<plugin-id>/` (project)
- `~/.skill-map/plugins/<plugin-id>/` (global)

**Rule (added in v0.8.0)**: the directory name MUST equal the manifest's `id` field. Mismatch → `invalid-manifest`. This eliminates same-root id collisions by filesystem construction. Cross-root collisions (project vs global, or built-in vs user-installed) produce a new status `id-collision` — both involved plugins are blocked, no precedence magic, the user resolves by renaming.

Layout:
```
<plugin-id>/
├── plugin.json              ← manifest
├── extensions/
│   ├── foo.extractor.js
│   ├── foo.hook.js
│   └── ...
├── conformance/             ← per-plugin conformance suite (Provider + others optional)
│   ├── cases/
│   └── fixtures/
├── schemas/                 ← Provider-only: per-kind frontmatter schemas
│   └── ...
└── migrations/              ← only if storage mode dedicated
    └── 001_initial.sql
```

Manifest:
```json
{
  "id": "my-cluster-plugin",
  "version": "1.0.0",
  "specCompat": "^0.8.0",
  "extensions": [
    "extensions/foo.extractor.js",
    "extensions/foo.hook.js"
  ],
  "storage": {
    "mode": "kv"
  }
}
```

Pre-`v1.0.0`, `specCompat` pins a **minor range** per `versioning.md` §Pre-1.0. Narrow pins are the defensive default because minor bumps MAY carry breaking changes while the spec is `0.y.z`. Once the spec ships `v1.0.0`, manifests move to `"^1.0.0"`.

### Loading

On boot or `sm plugins list`:
1. Walk `<scope>/.skill-map/plugins/*` and `~/.skill-map/plugins/*`.
2. For each candidate plugin: read `plugin.json`; verify `directory == manifest.id` (else `invalid-manifest`); check global id uniqueness (else `id-collision` for both involved); run `semver.satisfies(specVersion, plugin.specCompat)` (else `incompatible-spec`).
3. Dynamic-import each extension. Validate against the kind schema. Register in the kernel under the qualified id `<plugin-id>/<extension-id>` per kind.
4. If plugin has storage mode dedicated: kernel provisions tables (prefix-enforced) and runs migrations.

The status set is now six: `loaded`, `disabled`, `incompatible-spec`, `invalid-manifest`, `load-error`, `id-collision`.

### Extension ids are qualified

Every extension is registered as `<plugin-id>/<extension-id>` per kind. Cross-extension references (`defaultRefreshAction`, CLI flags, dispatch identifiers) all use the qualified form. ESLint pattern (`plugin-name/rule-name`); two plugins can safely ship extensions with the same short id. Built-ins also qualify — the Claude Provider's walker becomes `claude/walk` (final id during implementation).

### Provider declares its kinds and their schemas

A Provider's manifest now carries a `kinds` map declaring every kind it emits, the schema for that kind's frontmatter, and the default refresh action:

```jsonc
{
  "id": "claude",
  "kind": "provider",
  "kinds": {
    "skill":   { "schema": "./schemas/skill.schema.json",   "defaultRefreshAction": "..." },
    "agent":   { "schema": "./schemas/agent.schema.json",   "defaultRefreshAction": "..." },
    "hook":    { "schema": "./schemas/hook.schema.json",    "defaultRefreshAction": "..." },
    "command": { "schema": "./schemas/command.schema.json", "defaultRefreshAction": "..." },
    "note":    { "schema": "./schemas/note.schema.json",    "defaultRefreshAction": "..." }
  }
}
```

The spec keeps only `frontmatter/base.schema.json` (universal). Per-kind schemas are no longer normative artifacts of the spec; each Provider owns its kind catalog. A future Cursor Provider would declare `mcp-server`, `mode`, etc. and ship its own schemas.

### Extractor's three persistence channels

The Extractor receives in its `ctx`:
- `ctx.emitLink(link)` → kernel persists in the `links` table.
- `ctx.enrichNode(partial)` → kernel persists in a separate enrichment layer (see §Enrichment for staleness rules).
- `ctx.store.write(table, row)` → plugin's own table `plugin_<id>_*`.

The plugin chooses which channels it uses, possibly multiple in one `extract()` call. There is no `type` field; the plugin id is the natural namespace. Dual-mode (`mode: 'deterministic'` default, `mode: 'probabilistic'` opt-in). Det runs in `sm scan` Phase 1.3; prob dispatches as a job (`sm job submit extractor:<plugin-id>/<ext-id>` or via `sm refresh`).

Optional `applicableKinds: ['skill', 'agent']` filter in the manifest lets the kernel skip invocation for non-applicable nodes (saves CPU for det, LLM cost for prob). Default absent = applies to all kinds. Optional `outputSchema` per `store.write` table (or per KV namespace) declares a JSON Schema; the kernel runs AJV validation on every write and throws on shape violations. Default absent = permissive.

### Incremental scan cache, per Extractor

A new table `scan_extractor_runs(node_path, extractor_id, body_hash_at_run, ran_at)` lets the orchestrator skip re-running an Extractor on a node when both (a) `node.body_hash` is unchanged and (b) that specific Extractor already ran against the same hash. When a new Extractor is registered between scans, only the new one runs against cached nodes; when an Extractor is unregistered, its links / enrichments are cleaned without invalidating the rest. Critical for prob — re-running LLM Extractors against unchanged bodies is the difference between a free and a paid scan.

### Hook trigger set

The Hook manifest declares one or more `triggers` from the curated hookable set:

1. `scan.started` — pre-scan setup.
2. `scan.completed` — post-scan reaction.
3. `extractor.completed` — aggregated per-Extractor outputs and duration.
4. `rule.completed` — aggregated per-Rule outputs and severities.
5. `action.completed` — Action executed on a node.
6. `job.spawning` — pre-spawn of a runner subprocess (gating).
7. `job.completed` — most common trigger; notifications, integrations, future cascades.
8. `job.failed` — alerts, retry triggers.

Other lifecycle events (`scan.progress` per node, `run.reap.*`, `job.claimed`, `model.delta`, `job.callback.received`, `run.started`, `run.summary`) are intentionally not hookable — too verbose, too internal, or already covered by another trigger. Declaring an unsupported trigger in a manifest is `invalid-manifest` at load time.

Hooks support declarative `filter` blocks per trigger; the kernel validates that the fields used in the filter are valid for the declared triggers (cross-field validation). Dual-mode (`mode: 'deterministic'` default).

### Storage modes

Plugin declares in manifest:

| Mode | Declaration | API | Backing |
|---|---|---|---|
| **A — KV** | `"storage": { "mode": "kv" }` | `ctx.store.{get,set,list,delete}` scoped by `plugin_id` | Kernel table `state_plugin_kvs(plugin_id, node_id, key, value_json, updated_at)`. Per spec `db-schema.md`, plugin-owned serialized values use the standard `_json` suffix. |
| **B — Dedicated** | `"storage": { "mode": "dedicated", "tables": [...], "migrations": [...] }` | Scoped `Database` wrapper | Kernel-provisioned tables `plugin_<normalized_id>_<table>` |

Each table (Mode B) or the KV namespace (Mode A) MAY declare an `outputSchema` for write-side validation (see Extractor section above).

### Triple protection (mode B)

1. **Prefix enforcement**: kernel injects `plugin_<id>_` into every DDL. Plugin cannot create un-prefixed tables.
2. **DDL validation**: reject FK to kernel tables, triggers on kernel tables, `DROP`/`ALTER` of kernel tables, `ATTACH`, global PRAGMAs.
3. **Scoped connection**: plugin receives a `Database` wrapper, not raw handle. Wrapper rejects cross-namespace queries at runtime.

Honest note: drop-in plugins are user-placed code; protection guards accidents, not hostile plugins. Post-v1.0 evaluates signing.

### Plugin commands

| Command | Purpose |
|---|---|
| `sm plugins list` | Auto-discovered from folders. Status column shows one of six values. |
| `sm plugins show <id>` | Manifest + compat status. |
| `sm plugins enable <id> \| --all` | Toggle one or every discovered plugin on (persisted in `config_plugins`). |
| `sm plugins disable <id> \| --all` | Toggle one or every discovered plugin off without deleting. |
| `sm plugins doctor` | Revalidate specCompat, exit 1 on any non-loaded / non-disabled plugin. |
| `sm conformance run [--scope spec\|provider:<id>\|all]` | Run conformance suites — spec only, a specific provider, or everything. |
| `sm check --include-prob` | Opt-in flag: `sm check` also runs probabilistic Rules, dispatched as jobs and awaited synchronously. Combines with `--rules <ids>` and `-n <node>`. |

### Default plugin pack

The reference impl bundles built-ins for each kind: one Provider (`claude`), several Extractors (`slash`, `at-directive`, `import`), several Rules (`trigger-collisions`, `dangling-refs`, `link-conflict`, `validate-all`), at least one Action, one Formatter (`ascii`). Hooks ship as needed for first-party integrations.

`github-enrichment` remains the firm commitment for the Action lineup (needed for hash verify property). Third-party plugins (Snyk, Socket) install post-`v1.0` against `spec/interfaces/security-scanner.md`.

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

Skill-map AGGREGATES vendor specs, it does not curate them. The base schema declares only what every node, on every Provider, MUST carry to participate in the graph. Vendor-specific fields (Anthropic Claude Code, Cursor, Continue, …) live in the Provider that emits the kind. A Provider's per-kind schema is a verbatim mirror of the vendor's documented frontmatter — skill-map does not pick a subset, does not rename fields, does not re-shape values. When the vendor evolves their schema, the Provider's mirror evolves with it; drift detection vs upstream docs is a deferred follow-up.

Cross-vendor research (Cursor, Continue, Aider, Copilot, Windsurf, Cline, Roo, Anthropic Claude Code, 2026-05) confirmed `description` is the only field universal across the indexable ecosystems; `name` is universal among formats with explicit identifiers (some vendors use the filename as identity, not a frontmatter field). All other fields — `tools`, `model`, `globs`, etc. — are vendor idiosyncrasy.

Spec artifact: `spec/schemas/frontmatter/base.schema.json`. Per-kind schemas ship with the Provider that declares each kind — the Claude Provider declares `skill` / `agent` / `command` / `note`, ships the corresponding `*.schema.json` files under its own `schemas/` folder, and references them via the `kinds` map in its manifest. A different Provider (Cursor, Cline, custom runner) brings its own kind catalog and its own schemas; the kernel does not opine on the kind list.

### Base (universal — lives in spec)

**Two fields, both required**:

- `name` — short human-readable identifier (`string`, `minLength: 1`).
- `description` — one-to-three-sentence description (`string`, `minLength: 1`).

The base declares `additionalProperties: true` so vendor-specific fields and skill-map annotation fields flow through validation silently — formal validation of those happens in the per-kind extension (vendor fields) or in a future skill-map annotation schema (annotation fields, see §Skill-map annotation fields below).

This is intentionally minimal. Earlier versions of the base carried a richer field set (`type`, `author`, `authors`, `license`, `tools`, `allowedTools`, `metadata.{version, stability, supersedes, …}`); Step 9.5 (2026-05) trimmed it after the cross-vendor research showed those fields were either Claude-specific (`tools`, `allowedTools`) or skill-map-invented (`metadata.*`) — neither is universal, neither belongs in the universal base. Decision #55 (which justified `tools`/`allowedTools` at base "to mirror Claude Code's frontmatter shape") is superseded by the absorb-verbatim principle.

### Kind-specific (lives in the Provider that declares the kind)

The Claude Provider's catalog mirrors Anthropic's official docs verbatim. Per-kind schema files extend `base.schema.json` via `allOf` + `$ref`; all declare `additionalProperties: true` so future Anthropic additions do not break consumers.

| Kind | Schema file | Anthropic source | Fields beyond `name`+`description` |
|---|---|---|---|
| `agent` | `claude/schemas/agent.schema.json` | https://code.claude.com/docs/en/agents.md | 14 fields: `tools[]`, `disallowedTools[]`, `model`, `permissionMode` (enum), `maxTurns`, `skills[]`, `mcpServers[]`, `hooks` (object), `memory` (enum: `user` \| `project` \| `local`), `background`, `effort` (enum: `low` \| `medium` \| `high` \| `xhigh` \| `max`), `isolation` (enum: `worktree`), `color` (enum of 8), `initialPrompt`. |
| `skill` | `claude/schemas/skill.schema.json` | https://code.claude.com/docs/en/skills.md | Thin `allOf` extension of `skill-base.schema.json`. No skill-only fields today. |
| `command` | `claude/schemas/command.schema.json` | https://code.claude.com/docs/en/skills.md | Thin `allOf` extension of `skill-base.schema.json`. Per Anthropic: "custom commands have been merged into skills" — the frontmatter is identical. The schemas are split (rather than aliased) because skill-map differentiates the two kinds in `IProviderKind.ui` (color, icon, label) and may diverge them on the schema side as Anthropic evolves. No command-only fields today. |
| (`skill-base`) | `claude/schemas/skill-base.schema.json` | https://code.claude.com/docs/en/skills.md | NOT a kind — shared base for `skill` and `command`. 13 fields: `when_to_use`, `argument-hint`, `arguments` (`string` \| `string[]`), `disable-model-invocation`, `user-invocable`, `allowed-tools` (`string` \| `string[]`), `model`, `effort`, `context` (enum: `fork`), `agent`, `hooks`, `paths` (`string` \| `string[]`), `shell` (enum: `bash` \| `powershell`). |
| `note` | `claude/schemas/note.schema.json` | (skill-map fallback) | No extra fields. Catches any markdown that doesn't match a more specific Claude path. |

**Hook kind dropped** in Step 9.5. `.claude/hooks/*.md` is not a Claude Code convention — Anthropic hooks live in `settings.json` or as sub-objects of agent/skill frontmatter (https://code.claude.com/docs/en/hooks.md), never as standalone markdown files. The previous `hook` kind (with skill-map-invented fields `event`, `condition`, `blocking`, `idempotent`) was a fiction; files at `.claude/hooks/*.md` now classify as `note` (the fallback).

A future Cursor / Cline / custom Provider declares its own kinds and ships the matching schemas. The kernel calls `provider.kinds[<kind>].schema` during Phase 1.2 (Parse) of the scan after validating universal fields against `base`.

### Provider auxiliary schemas

Step 9.5 introduced an optional runtime-only field on `IProvider`: `schemas?: unknown[]`. It lets a Provider declare schemas that are not themselves a per-kind schema but are referenced via `$ref` from per-kind schemas. The Claude Provider uses it to ship `skill-base.schema.json` (referenced by both `skill.schema.json` and `command.schema.json`). The kernel pre-registers these auxiliary schemas with AJV before compiling per-kind validators so cross-file `$ref` resolves cleanly. The field is implementation-only (TypeScript-side); the public manifest schema (`provider.schema.json`) is unchanged.

### Validation — three-tier model

The kernel validates frontmatter on a graduated dial; tighter is opt-in.

| Tier | Mechanism | Behavior on unknown / non-conforming fields |
|---|---|---|
| **0 — Default permissive** | `additionalProperties: true` on `base.schema.json` and per-kind schemas | Field passes silently, persists in `node.frontmatter`, available to Extractors / Rules / Actions / Formatters. |
| **1 — Built-in `unknown-field` rule** | Deterministic Rule shipped with the kernel | Emits issue severity `warning` for every key outside the documented catalog (base + the matched kind's schema). Always active. |
| **2 — Strict mode** | `project-config.json` with `"strict": true` (already in `project-config.schema.json`); also via `--strict` flag on `sm scan` / `sm check` | Promotes **all** frontmatter warnings to `error`. CI fails with exit code 1. |

The model is documented explicitly in `spec/plugin-author-guide.md`. No "schema-extender" plugin kind exists; users who want custom validation write a deterministic Rule, and `--strict` makes it CI-blocking automatically.

### DB denormalization

High-query fields stored as columns on `scan_nodes`: `stability`, `version`, `author`. These are read from `frontmatter.metadata.{stability, version, author}` when present — note that since Step 9.5 the `metadata` block is no longer formally declared in the base schema; it rides on `additionalProperties: true`. The denormalization layer accepts this transitional shape (the data still flows through fine) until the deferred annotation-home decision lands. Everything else lives in `frontmatter_json`. Provider-declared kinds map to whatever columns the Provider migrates into the kernel-owned schema; today the Claude Provider's kinds are baked into the kernel's `nodes` table — when other Providers join, the column set is reviewed for either widening or moving kind-specific fields out of denormalized columns.

### Skill-map annotation fields — pending home

Today's `metadata.{version, stability, supersedes, requires, conflictsWith, provides, related, tags, category, keywords, created, updated, released, source, sourceVersion, icon, color, priority, hidden, docsUrl, readme, examplesUrl, github, homepage, linkedin, twitter}` plus `type`, `author`, `authors`, `license` are NOT vendor-defined — they are skill-map's own annotation layer (or general markdown convention). Their final formal home is a deferred decision (see ROADMAP §Step 9.5 deferred section): sidecar files under `.skill-map/annotations/<full-path>.yml` (preferred direction, pending mastication) vs an in-frontmatter `skillMap: {}` block. Until the decision lands, those fields ride on `additionalProperties: true` and the kernel reads them best-effort from `frontmatter.*` for denormalization. The auto-memory file `memory/project_spec_base_cleanup_deferred.md` carries the full orphan list as a recovery point.

---

## Enrichment

Two enrichment models coexist: (a) the GitHub provenance enrichment (a remote-fetch Action backed by `state_enrichments`) and (b) the universal Extractor enrichment layer for any plugin that wants to add data to a node. Both ride together; the rules below describe each.

### Two enrichment models

**Model A — Provenance enrichment (GitHub today, more registries post-v1.0)**: a remote fetch that reconciles the local `body_hash` against the canonical source. Lives in its own table `state_enrichments` keyed by `(node_id, provider_id)`. Invoked via `sm job submit github-enrichment [-n <id>] [--all]`. Concerned with verification and idempotency, not with adding interpretation.

**Model B — Plugin-driven node enrichment via Extractors (added in v0.8.0)**: any Extractor that wants to add structured data to a node calls `ctx.enrichNode(partial)` from its `extract()`. The kernel persists the partial in the dedicated `node_enrichments` table (one row per `(node, extractor)` pair, with `body_hash_at_enrichment` for staleness tracking). The author's `frontmatter` is **never overwritten** — it is immutable from any Extractor's perspective, det or prob. Every consumer (Rule, Formatter, UI) receives a merged view: `node.merged.<field>` combines author + enrichment; `node.frontmatter.<field>` is author-only.

If an Extractor wants to persist data that does NOT fit canonical Node shape (embeddings, version strings, owner mappings, anything else), it uses `ctx.store.write(table, row)` instead — that lives in the plugin's own table `plugin_<id>_*`, outside this enrichment model. The boundary between `enrichNode` (canonical, kernel-aware) and `store.write` (custom, plugin-owned) is a soft rule revisited post-v1.0 (see Decision log).

### Hash verification (idempotency, Model A)

Three layers:

1. **SHA pin**: if `metadata.sourceVersion` is a full commit SHA, the plugin resolves to immutable raw URL `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`. Deterministic.
2. **Tag / branch resolution**: if `sourceVersion` is a tag, branch, or absent, the plugin queries GitHub API for the current commit SHA. Stores `resolvedSha` in `state_enrichments.data_json`. Next refresh compares SHA; only re-fetches if changed.
3. **ETag / `If-None-Match`** (post-`v1.0`): saves bandwidth within rate limit.

### Stale tracking (Model B, prob only)

Probabilistic Extractors that emit via `enrichNode` store `body_hash_at_enrichment_time` alongside each enrichment record. When `sm scan` detects `node.body_hash` differs from the recorded hash, the enrichment is **flagged `stale: true` — not deleted**. The data stays recoverable; the consumer decides what to show.

- **Rules / `sm check` / CI decisions**: exclude stale by default. Automation never makes decisions on outdated LLM outputs.
- **UI / `sm show <node>`**: shows stale records with a marker so humans see what to refresh.

Deterministic Extractor enrichments do not need stale flags — they regenerate via the per-Extractor scan cache (see §Plugin system, "Incremental scan cache").

### Refresh commands

- `sm refresh --stale` → batch re-runs every prob Extractor whose enrichments are stale. CI cron, nightly maintenance.
- `sm refresh <node>` → granular; runs all `applicableKinds`-matching prob Extractors against one node.
- **No** `sm scan --refresh-stale`. Mixing det scan with prob refresh in one command violates the "prob never runs in scan" rule.

### State storage

Model A keeps the legacy table:

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

`verified: true` if local `body_hash` matches the hash computed over remote raw content. `false` with implicit `locallyModified: true` on mismatch.

Model B adds a parallel layer (final table / column shape decided in PR — candidate: a `node_enrichments(node_path, extractor_id, body_hash_at_enrichment, value_json, stale, fetched_at)` table that mirrors A's pattern but keys on the qualified Extractor id). The kernel materializes the `node.merged` view by joining `nodes` + `node_enrichments`.

### Invocation

- Model A: `sm job submit github-enrichment [-n <id>] [--all]`. Targeted fan-out via `--all`.
- Model B: an Extractor manifest with `mode: 'probabilistic'` is dispatched via `sm job submit extractor:<plugin-id>/<ext-id>` or via `sm refresh`. Det Extractors run automatically inside `sm scan`.

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

Extractors that emit invocation-style links (slashes, at-directives, command names) populate a `link.trigger` block with two fields. Field shape in `spec/schemas/link.schema.json`; normative pipeline in `spec/architecture.md §Extractor · trigger normalization`.

- `originalTrigger` — the exact text the Extractor saw in the source, byte-for-byte. Used for display in `sm show` and the UI.
- `normalizedTrigger` — the output of the pipeline below. Used for equality and collision detection (the `trigger-collision` rule keys on this field).

Both are always present on every trigger-bearing link. Never mutate one without the other.

### Pipeline (Decision #21, normative)

Applied at Extractor output time, in exactly this order:

1. **Unicode NFD** — decompose into canonical form so combining marks separate from their base characters.
2. **Strip diacritics** — remove every combining mark in the Unicode category `Mn` (Nonspacing_Mark).
3. **Lowercase** — ASCII and Unicode lowercase via locale-independent mapping.
4. **Separator unification** — map every hyphen (`-`), underscore (`_`), and run of whitespace to a single space.
5. **Collapse whitespace** — runs of two or more spaces become one.
6. **Trim** — remove leading and trailing whitespace.

Non-letter/non-digit characters outside the separator set (e.g. `/`, `@`, `:`, `.`) are **preserved** — they are often part of the invocation syntax (`/skill-map:explore`, `@frontmatter-extractor`). Stripping them is the Extractor's responsibility, not the normalizer's: the normalizer acts on what the Extractor considers "the trigger text".

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

Note the last row: colons and slashes pass through untouched. Plugin authors that want stricter normalization (e.g. stripping the `/` prefix on slash commands) apply it inside their Extractor before emitting the link, not afterwards.

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

`sm ui --config <path>` (Step 15) is a separate escape hatch: the supplied file **replaces** layers 2–5 entirely (single-source override; useful for reproducibility, CI, debugging). Defaults still apply underneath, env / flags still wrap on top.

Deep merge at load. Each layer may be a `Partial`; missing keys fall through to the next lower layer. Validated against `spec/schemas/project-config.schema.json` (CLI keys) and `spec/runtime-settings.schema.json` (UI keys, lands at Step 15). Malformed JSON or type-mismatches emit warnings and skip the offending key; the app never crashes on bad config. `--strict` flips warnings into fatal errors.

### Runtime delivery to the UI

The bundled UI is a static artifact — it does not read files from disk. The CLI sub-command `sm ui` (Step 15) loads + merges + validates the hierarchy and serves the resulting object as `GET /config.json` over the same HTTP server that hosts the UI bundle. The UI fetches that URL once on boot (via `APP_INITIALIZER`), then reads the data through a signal-backed `RuntimeConfigService`. When the bundle is served by a third party (nginx, S3, Caddy), the operator places a `config.json` next to `index.html`; same contract from the UI's side.

This is the only path by which UI-side keys reach the browser. There is no build-time UI config and no `fileReplacements`. Changing UI settings means editing one of the four files in the hierarchy (or the `--config` override) and restarting the server — see §Step 15 for why hot reload is deferred.

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
- `ignore: [...]` — top-level glob patterns excluded from scan, in addition to `.skillmapignore`.
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

The default contents of a fresh `.skillmapignore` file (used by `sm init`) live in the reference impl under `src/config/defaults/` and are **not** a user-visible config key — editing the generated file is the supported override.

### UI-side keys

Declared in `ui/src/models/settings.ts` and shipped via the runtime delivery path above. The interface is `ISkillMapSettings` (compile-time) and will be formalised in `spec/runtime-settings.schema.json` at Step 15 once the contract stabilises.

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
| `sm tutorial [--force]` | Materialize the `sm-tutorial` tester walkthrough as `sm-tutorial.md` in the cwd. Runs in any directory (no `.skill-map/` required); the file is consumed by the matching Claude Code skill when the tester loads it with `ejecutá @sm-tutorial.md`. `--force` overwrites an existing `sm-tutorial.md`. |
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
| `sm-cli` | Agent integration package | Claude Code (installable) | Step 15 | Feeds `sm help --format json` to the agent so it can compose CLI invocations without hand-maintained knowledge. Mentioned in Decision #65; ships at distribution polish. |
| `skill-optimizer` | Dual-surface action + skill | Claude Code (skill) + any runner (action) | Skill exists before `v0.5.0`; action wrapper Step 10 | Canonical dual-mode example: exists as a Claude Code skill AND is wrapped as a `skill-map` Action in `invocation-template` mode. Serves as the reference pattern for "same capability, two surfaces". |

Naming rules:

- **Slash-command ids** (`/skill-map:<verb>`) are what the user types inside the host.
- **Package ids** (`sm-cli`, `sm-cli-run-queue`) are what the user installs. One package MAY register multiple slash-commands; one slash-command is registered by exactly one package.
- **Host-specific** skills live under `sm-cli-*` namespace. When a second host (Codex, Gemini) lands as an adapter, its skill packages get their own prefix (`sm-codex-*`, `sm-gemini-*`) — the namespace is owned by the host, not by the skill.

Non-skills shipped for context (listed here to prevent confusion, do NOT register as skills):

- **CLI runner loop** — the `sm job run` command itself. Driving adapter (uses `RunnerPort` via `ClaudeCliRunner`). Not a skill.
- **Default plugin pack** — `github-enrichment`, plus TBD Extractors/Rules. Not skills, but installable via drop-in.

---

## UI (Step 0c prototype → Step 14 full)

### Step 0c — Prototype (Flavor A)

Build order inversion: UI prototype **before** kernel implementation. Mocked JSON fixtures derived from a real on-disk collection of skills / agents / commands / hooks / notes. Iterates design cheaply before committing to kernel API.

Scope:
- Graph view (Foblex Flow) — card-style nodes with title, kind badge, version, triggers, link counts.
- List view with frontmatter-driven columns.
- Inspector panel: weight, summary (mocked), links, issues, findings, 🔄 det + 🧠 prob buttons.
- Filters by kind / stability / issue.
- Simulated event flow: fake run-queue emitting canonical events.

Tech picks locked at Step 0c start:
- Frontend framework: **Angular latest** (standalone components). Always track the latest stable Angular release; upgrades happen explicitly by editing the pinned version in `ui/package.json`, not automatically via caret ranges. (Decision #72.)
- Node-based UI library: **Foblex Flow** (Angular-native). Cards as Angular components with arbitrary HTML.
- Component library: **PrimeNG** (tables, forms, dialogs, menus, overlays).
- Styling: **SCSS scoped per component**. No utility CSS framework (no Tailwind, no PrimeFlex) — avoided overlap with PrimeNG's own theming.
- Workspace: `ui/` as an npm workspace peer of `spec/` and `src/`. The kernel never imports Angular; the UI never imports kernel internals (only typed DTOs from `spec/`).

Decisions on the table for §Step 0c:

- **Decision #72**: Angular pin tracks the latest stable release. Upgrades happen explicitly by editing `ui/package.json`; no caret ranges.
- **Dependency pinning policy**: `package.json` at root, `ui/`, and `src/` pin every dependency to an exact version (no `^` / `~`). Reproducible installs and zero-surprise upgrades take priority over automatic patch drift. `spec/` has no dependencies. The policy is revisited the day `src/` flips to public — a published lib may want caret ranges so consumers can dedupe transitive deps. Canonical statement in `AGENTS.md` §Rules for agents working in this repo.
- **DTO gap**: closed via codegen (json-schema-to-typescript from `spec/schemas/`) at Step 4 or Step 5. Hand-curated mirrors in `ui/src/models/` and `src/kernel/types/` until then.
- **Plugin migrations + SQL parser**: ship at Step 9 (Plugin author UX).
- **Plugin API stability (Decision #89)**: extension runtime interfaces (`IProvider`, `IExtractor`, `IRule`, `IAction`, `IFormatter`, `IHook`) declare semver-stable at v1.0.0. Pre-v1.0 changes to these interfaces are minor bumps with a changelog note.
- **Link conflict merge (Decision #90)**: when two Extractors emit a link for the same (from, to) pair, both rows coexist in `scan_links`. No merge, no dedup. Each Extractor's link carries its own confidence and source. Consumers that need uniqueness aggregate at read time.

### Step 14 — Full UI (Flavor B)

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
| Unit | Each Extractor / Rule / Provider / etc. in isolation | CI + dev |
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
- **WebSocket**: server side uses the official `upgradeWebSocket` re-exported from `@hono/node-server@2.x` paired with the canonical `ws` Node WebSocket library (`ws@8.20.0`); both share the single Hono listener — single-port mandate. Client side uses the browser-native `WebSocket` (browser) or the Node 24 global `WebSocket` (Node-side tests and consumers — no extra dep needed beyond the server-side `ws`).
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

The §Architecture section ("The kernel never imports Angular; `ui/` never imports `src/` internals. The sole cross-workspace contract is `spec/` (JSON Schemas + typed DTOs)") promises typed TypeScript DTOs emitted by `@skill-map/spec`. As of Step 1b the promise is still aspirational — `@skill-map/spec` exports only JSON Schemas and `index.json`, no `.d.ts`. Both the ui prototype (under `ui/src/models/`) and the kernel plugin loader (under `src/kernel/types/plugin.ts`) hand-curate local mirrors of the shapes they need. The drift risk is accepted because (a) the mirrors are small — 17 schemas total, with only five kernel-side interfaces exposed by `plugin.ts`; (b) AJV already enforces the real shapes at runtime against the authoritative schemas, so a divergent TS mirror surfaces as a validation error at boot rather than a silent bug. The canonical fix moves to **Step 2**, when the first real Provider/Extractor/Rule arrives as a third consumer and a single source of truth becomes justified against three real consumers instead of two. The pick (e.g. `json-schema-to-typescript` at build, or hand-curated `.d.ts` published via `spec/types/`) lands then. Until Step 2 ships, any type under `ui/src/models/` or `src/kernel/types/` that diverges from its schema is flagged as a review-pass issue at the close of whichever step introduces the divergence.

---

## Execution plan

Sequential build path. Each step ships green tests before the next begins.

### Step inventory at a glance

Closed Steps — green checkmark below means "ships green tests, lives in the released code path":

- ✅ **0a** — Spec bootstrap (JSON Schemas, prose contracts, conformance suite skeleton).
- ✅ **0b** — Implementation bootstrap (CLI scaffold, kernel skeleton, first verb).
- ✅ **0c** — UI prototype (Flavor A — Angular SPA against mock collection).
- ✅ **1a / 1b / 1c** — Storage + migrations / Plugin loader / Orchestrator + CLI dispatcher.
- ✅ **2** — First extension instances (Claude Provider, three Extractors, three Rules, ASCII Formatter, validate-all).
- ✅ **3** — UI design refinement (PrimeNG, layout, theming).
- ✅ **4** — Scan end-to-end (`sm scan` writes `scan_*` tables; tokens; incremental; self-scan; bug bundles).
- ✅ **5** — History + orphan reconciliation (`state_executions`, rename heuristic, history verbs).
- ✅ **6** — Config + onboarding (layered config, `.skillmapignore`, `sm init`, plugin enable/disable).
- ✅ **7** — Robustness (chokidar watcher, `link-conflict` Rule, `sm job prune`).
- ✅ **8** — Diff + export (`sm graph`, `sm scan compare-with`, `sm export`).
- ✅ **9** — Plugin author UX (runtime wiring, plugin migrations, `@skill-map/testkit`, plugin author guide, reference plugin).

In-progress — Step 14 (Full Web UI), shipping `v0.6.0`:

- ✅ **14.1** — `sm serve` + Hono BFF skeleton (single-port, loopback-only).
- ✅ **14.2** — REST read-side endpoints + envelope schema.
- ✅ **14.3** — Live mode (DataSourcePort + REST adapter) + demo build pipeline (StaticDataSource + markdown renderer + `web/demo/`).
- ✅ **14.4** — WebSocket broadcaster + chokidar wiring + scan event emission + reactive UI (CollectionLoader auto-refresh + EventLog).
- ✅ **14.5** — Inspector polish (markdown body card + linked-nodes panel + per-card refresh hooks) + provider-driven kind presentation (`IProviderKind.ui` + `kindRegistry` envelope).
- ✅ **14.6** — Foblex strict types pass + dark-mode tri-state (auto/light/dark) + bundle-budget tightening (warning **650 kB** / error **800 kB**, with a defensive `analyze` build configuration and a root `ui:bundle-analyze` script for source-map-explorer reports). The "≤ 500 kB initial" hard cut moved to 14.7 — see below.
- ✅ **14.7** — Bundle initial-chunk hard cut (≤ 500 kB via lazy Aura preset), responsive-scope decision (mobile guard below 768px: full-screen friendly message replaces the shell entirely; 768px–1023px renders the desktop layout as-is), and demo smoke test (`e2e/` workspace, Playwright + Chromium, three specs including the never-fetches-`/api/*` regression guard). The e2e smoke now runs automatically via the root `validate` orchestrator (e2e workspace's `prevalidate` runs `demo:build` + `install:browsers`, then Playwright). The public-site update moved to Step 15 (release pipeline). (URL-synced filter state already closed at 14.3.)

Next (resumes wave 2 after Step 14 closes; ships `v0.8.0`):

- ⏸ **9.5** — Spec base cleanup: absorb provider verbatim, slim the universal frontmatter base. Pre-wave-2 prerequisite — closes before Step 10 starts so the summarizer pipeline ships against a stable annotation shape.
- ⏸ **10** — Job subsystem + first probabilistic extension (`skill-summarizer`). Phase 0 (`IAction` runtime contract) landed and dormant; Phases A–G paused.
- ⏸ **11** — Remaining probabilistic extensions + LLM verbs + findings.
- 🔮 **16** — Web UI: LLM surfaces v1 (initial). Render the probabilistic outputs Steps 10–11 emit — replaces the "Available in v0.8.0" empty-state placeholders shipped in 14.3 inspector with read-only surfaces for `state_summaries` / `state_enrichments` / `findings`. UI does not orchestrate jobs at this stage.

Phase C (`v1.0.0` target):

- 🔮 **12** — Additional Formatters (Mermaid, DOT, subgraph export with filters).
- 🔮 **13** — Multi-host Providers (Codex, Gemini, Copilot, generic).
- 🔮 **17** — Web UI: LLM surfaces v2 (deeper). Promote LLM verbs into interactive UI flows — `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization` become panels / wizards rather than CLI verbs reflected in summaries. Job orchestration surface (queue inspector, retries, cancellations) is part of this Step.
- 🔮 **15** — Distribution polish (single-package, docs site, release infra).

Per-Step prose with full context lives below; closed Steps preserve their decision rationale and test counts in their dedicated section.

> ▶ **Completeness marker (2026-05-03)**: Steps **0a–9**, **14.1–14.4**, **14.5 (a + b + c + d)**, and **14.6** are complete; **14.7** is in flight, with the bundle hard cut, responsive-scope decision, and the demo smoke test already landed. Remaining 14.7 work: CI wiring for `npm run demo:build` and the public-site update. 14.6 shipped the Foblex Flow strict-types pass (connection `fType` / `fBehavior` / marker `type` migrated from string literals to the `EFConnectionType` / `EFConnectionBehavior` / `EFMarkerType` enums), the dark-mode tri-state (`auto` / `light` / `dark` with live `prefers-color-scheme` listening, persisted via a single `localStorage` slot), and a defensive bundle-budget tightening (warning 650 kB) before 14.7 dropped the threshold to the roadmap target (warning **500 kB** / error **650 kB**). The 14.7 bundle hard cut moved the `@primeuix/themes/aura` preset out of the eager chunk via `provideAppInitializer` (`providePrimeNG({})` empty + dynamic-imported preset applied via `PrimeNG.setThemeConfig` before first render); single-landing impact was −108 kB on the initial total (594 kB → **485 kB**), so the speculative (b) "native theme-toggle button" and (c) "lazy `primeng/config` core" sub-tasks were dropped. The Playwright initializer revealed an NG0203 trap — `inject()` MUST be called synchronously before any `await` inside a `provideAppInitializer` factory; the post-await call loses Angular's injection context and the app silently never boots. The factory now captures `inject(PrimeNG)` first, then awaits the dynamic import. Responsive scope landed as a **mobile guard below 768px**: a CSS-only full-screen overlay (`pi-desktop` icon, friendly "Looks like you're on a small screen" copy) replaces the shell entirely below the breakpoint — the broken desktop layout is never shown, since the previous sticky-banner-over-broken-shell shape was rejected after testing. Between 768px and 1023px the desktop shell renders as-is (compact topbar, may look tight); ≥1024px is the design target. Demo smoke test ships as a new `e2e/` private workspace (Playwright 1.59.1, Chromium-only, deps-free Node static server under `/demo/`); three specs cover: boots-without-console-errors-in-demo-mode, never-fetches-`/api/*` (the regression guard the roadmap asks for explicitly), and the three-views routing. **Next**: public-site update (deferred to the Step 15 release pipeline). The CI wiring landed earlier via the root `validate` orchestrator (e2e workspace runs `demo:build` + Playwright through its `prevalidate` + `validate` scripts). Together with 14.6, 14.7 closes `v0.6.0` (deterministic kernel + CLI + Web UI). Wave 2 (job subsystem + LLM layer) resumes after Step 14 closes and ships `v0.8.0`.

### Step 0a — Spec bootstrap — ✅ complete

- `spec/` scaffolded and public from commit 1.
- `spec/README.md`, `spec/CHANGELOG.md`, `spec/versioning.md`.
- 29 JSON Schemas (draft 2020-12): 11 top-level (`node`, `link`, `issue`, `scan-result`, `execution-record`, `project-config`, `plugins-registry`, `job`, `report-base`, `conformance-case`, `history-stats`), 7 extension schemas under `schemas/extensions/` (`base` + one per kind, validated at plugin load), 6 frontmatter under `schemas/frontmatter/` (`base` + 5 kinds, each extending `base` via `allOf`), 5 summaries under `schemas/summaries/` (each extending `report-base` via `allOf`). Full tree in §Spec as a standard → Repo layout.
- `spec/architecture.md`, `cli-contract.md`, `job-events.md`, `prompt-preamble.md`, `db-schema.md`, `plugin-kv-api.md`, `job-lifecycle.md`.
- `spec/interfaces/security-scanner.md` — convention over the Action kind (NOT a 7th extension kind).
- Conformance suite: `basic-scan` + `kernel-empty-boot` cases, `minimal-claude` fixture, verbatim `preamble-v1.txt` (the third case `preamble-bitwise-match` is deferred to Step 10).
- `spec/index.json` — machine-readable manifest with per-file sha256 integrity block (regenerated by the spec workspace's `npm run spec` script; CI blocks drift via the root `validate` orchestrator, which runs the spec workspace's `spec:check`).
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
- Mock collection at `ui/mock-collection/` — fictional `acme-toolkit` scope with 4 agents, 4 commands, 4 skills, 3 hooks, and 3 notes, all with frontmatter conforming to `spec/schemas/frontmatter/*`. Served as build assets via `angular.json` so the prototype can `fetch('/mock-collection/…')` at runtime, simulating an on-disk scope without wiring a backend. The collection also exercises `supersedes` / `supersededBy`, `requires`, `related`, `@agent` / `#skill` / `/command` tokens in bodies, and external URLs for the future `external-url-counter` Extractor. ✅ landed.
- No backend. No BFF. Reading the mock collection at runtime stays the rule for the whole step — the specific path (`ui/mock-collection/`) is a prototype implementation detail and is NOT a fixture reused by any kernel test.
- Data pipeline: a `build-mock-index.js` prebuild script emits `mock-collection/index.json` deterministically; `CollectionLoaderService` fetches the index, parallel-fetches each `.md`, parses frontmatter with `js-yaml`, classifies kind by directory. A root `FilterStoreService` owns cross-view filter state (text search + kind + stability multi-selects) and exposes an `apply()` projection consumed by every view. `EventBusService` + `ScanSimulatorService` emit a scripted `scan.*` / `issue.*` sequence over the loaded collection so the event-flow surface has something real to display. ✅ landed.
- List view — PrimeNG Table with kind / name / path / version / stability columns, sortable, row-click opens inspector. ✅ landed.
- Inspector — full detail surface: kind + stability tags, metadata grid, kind-specific card (agent.model · command shortcut + args · hook event/condition/blocking/idempotent · skill inputs + outputs), relations as clickable chips (dead-struck-through when the target is not in the loaded set), tools allowlist / allowedTools, external links, raw-markdown body preview. ✅ landed.
- Graph view — Foblex Flow canvas with Dagre TB auto-layout, cards coloured by kind, edges for `supersedes` / `requires` / `related` (dedup'd across both-sides declarations), filter-aware (filtered-out nodes remove themselves and any dangling edges), click-to-inspect, Fit button, legend. ✅ landed.
- Filter bar — shared component mounted in both list and graph views, text search + kind multi-select + stability multi-select + contextual Reset. ✅ landed.
- Simulated event flow — collapsible bottom event-log panel showing `scan.started` / `scan.progress` / `scan.completed` + synthetic `issue.added` for deprecated nodes, auto-scroll, Clear, live "scanning" indicator. Triggered by a Simulate-scan button in the shell topbar. ✅ landed.
- Dark mode toggle — light ↔ dark persisted to localStorage, applies `.app-dark` to the document element (matching the `darkModeSelector` registered in `providePrimeNG`). Icon-only button in the topbar. ✅ landed.
- Roadmap review pass. ✅ landed as part of this section.

**Review-pass decisions**:

- **Kind classifier is throwaway**. The path-based classifier in `ui/src/services/collection-loader.ts` is prototype-only: the real classification lives in the claude adapter at Step 2, and the ui-side classifier is deleted when Step 14 consumes the kernel's real scanner output. The duplication is intentional for Step 0c — isolating the UI from the kernel is the whole point of Flavor A.
- **Simulator + event log are throwaway**. `EventBusService` and `ScanSimulatorService` (+ the `EventLog` component) exist only to give the Step 0c prototype something to render. Step 14 replaces both surfaces with the real WebSocket broadcaster consuming `spec/job-events.md` payloads; the simulator file is deleted at that transition. No Decision log row — it is prototype scope, not a locked-in architectural choice.
- **Desktop-only**. Flavor A assumes ≥1024px viewport. No responsive or mobile work. Step 14 may revisit once the full UI's surfaces and interactions are settled.
- **Bundle size is not a Flavor A objective**. Development bundles clock ~1.86MB initial, well above the `angular.json` production budgets (500 KB warn / 1 MB error); those budgets remain armed because they are the right targets for Step 14. Step 0c is `ng serve` / local-dev only, not distributed.
- **Wildcard route fallback**: `**` → `/list`. Bad deep links self-heal to the default view rather than surfacing a 404.
- **Fallback kind**: the loader classifies unknown paths as `note`. It is the catch-all by spec convention ("everything else"); alternatives would require a user choice at Flavor A which is premature.
- **URL-synced filter state — closed at 14.3.** `FilterUrlSyncService` (Step 14.3) now bridges `FilterStoreService` and the router query string for `search` / `kinds` / `stabilities` / `hasIssues`, so deep links round-trip and filter state survives a hard reload. Originally an open item flagged here at Step 0c.

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
- The six extension-kind schemas use `unevaluatedProperties: false` (rather than `additionalProperties: false`) on top of an `allOf` reference to `base.schema.json` — closed-content enforcement that survives the Draft 2020-12 composition footgun where `additionalProperties: false` + `allOf` would make no real extension manifest validatable. ✅ landed.

Acceptance: three bogus-plugin scenarios codified in `src/test/plugin-loader.test.ts` (`invalid-manifest` via missing required fields AND malformed JSON, `incompatible-spec` via a `>=999.0.0` compat range, `load-error` via missing extension file AND default export failing its kind schema), plus a green-path case and a mixed scenario proving the kernel keeps going when one plugin in the search path is bad. ✅ 32 of 32 tests pass.

**Deferred to Step 2**: `sm db migrate --kernel-only` and `--plugin <id>` flags. Their CLI surface exists in the spec, but every migration today is a kernel migration; the flags only become meaningful when plugin-authored migrations enter the mix, which depends on Step 2's triple-protection SQL parser + prefix rewriter. Also deferred from the earlier roadmap: typed-DTO emission from `@skill-map/spec` — after building the loader against hand-curated local mirrors, closing the DTO gap requires a third consumer to justify a canonical shape, and Step 2's first real adapter is where that arrives.

#### Step 1c — Orchestrator + CLI dispatcher + introspection — ✅ complete

- Scan orchestrator (`src/kernel/orchestrator.ts`) iterates the registry pipeline (Providers → Extractors → Rules) end-to-end and emits `scan.started` / `scan.completed` through a `ProgressEmitterPort`. With zero registered extensions the iteration produces a zero-filled valid `ScanResult` — the same outcome the Step 0b stub produced, now from the real code path. `InMemoryProgressEmitter` lands alongside as the default in-process emitter; the WebSocket-backed emitter arrives at Step 14. ✅ landed.
- Concrete extension runtime interfaces (`provider.classify()`, `extractor.extract()`, `rule.evaluate()`) are still not defined — they arrive with the first real extensions at Step 2. The iteration sites carry `TODO(step-2)` markers so the Step 2 drop-in test (add a 4th Extractor with zero kernel edits) stays honoured.
- Full Clipanion verb registration (`src/cli/commands/stubs.ts`) covers every verb in `cli-contract.md` that doesn't yet have a real implementation. 35 stub classes, each with the contract's declared flags typed correctly and a `category` / `description` / `details` usage block so `sm help` sees the full surface. `execute()` writes a one-liner pointing at the Step that will implement it and returns exit 2. ✅ landed.
- `sm help [<verb>] [--format human|md|json]` operational (`src/cli/commands/help.ts`). `human` delegates to Clipanion's own `cli.usage()` so terminal output matches the built-in exactly; `json` emits the structured surface dump per `cli-contract.md` §Help; `md` emits canonical markdown grouped by category. Single-verb mode (`sm help scan --format json`) emits just the one block. Unknown verb → exit 5; unknown format → exit 2. ✅ landed.
- `context/cli-reference.md` regenerated by the CLI workspace's `reference` script (delegates to `src/scripts/build-reference.js`) from `sm help --format md`. Workspace scripts: `npm run reference --workspace=@skill-map/cli` writes, `npm run reference:check --workspace=@skill-map/cli` fails on drift. Current reference covers every verb — 290 lines, 6.5KB. ✅ landed.
- Self-boot invariant (`kernel-empty-boot` conformance case) passes end-to-end through the real `bin/sm.js` → real `runScan()` path, no longer via the Step 0b stub. ✅ landed.

Acceptance: `sm help` covers every verb in the spec; `context/cli-reference.md` is byte-equal to `sm help --format md` output and the CLI workspace's `reference:check` blocks drift; `kernel-empty-boot` passes via the real orchestrator. 36 of 36 tests passed at Step 1c close (32 prior + 4 new covering scan event emission, empty-registry orchestrator iteration, and InMemoryProgressEmitter subscribe/unsubscribe). Test count continued to grow through Step 2; see the Step 2 completeness marker for the current total.

### Step 2 — First extension instances — ✅ complete

- Runtime contracts: five interfaces in `src/kernel/extensions/` — `IAdapter` (walk async iterator + classify), `IDetector` (detect with scope hint + emitsLinkKinds allowlist), `IRule` (evaluate over full graph), `IRenderer` (render → string keyed by format), `IAudit` (run → TAuditReport). A plugin's default export IS the runtime instance (manifest fields + methods on the same object). ✅ landed.
- Shared utility `src/kernel/trigger-normalize.ts` implements the six-step pipeline (NFD → strip diacritics → lowercase → separator unification → collapse whitespace → trim) from §Architecture Decision #21. ✅ landed.
- Provider: **`claude`** — walks `.claude/{agents,commands,hooks,skills}/*.md` + `notes/**/*.md` with a fallback to `note`, parses frontmatter via js-yaml (tolerating malformed YAML), default ignore set (`.git`, `node_modules`, `dist`, `.skill-map`), async iterator so large scopes don't buffer. ✅ landed.
- Detectors: **`frontmatter`** (structured refs from `metadata.supersedes[]` / `supersededBy` / `requires[]` / `related[]`), **`slash`** (`/command` tokens in body with trigger normalization), **`at-directive`** (`@agent` handles in body). Each dedupes on normalized trigger and respects its declared scope. `external-url-counter` remains deferred to Step 4 as the drop-in litmus proof. ✅ landed.
- Rules: **`trigger-collision`** (error — 2+ distinct targets sharing a normalized trigger), **`broken-ref`** (warn — targets that resolve neither by path nor by normalized name), **`superseded`** (info — one per node declaring `metadata.supersededBy`). ✅ landed.
- Formatter: **`ascii`** — plain-text dump grouped by kind then links then issues. ✅ landed.
- Rule: **`validate-all`** — post-scan consistency check via AJV against `node.schema.json` / `link.schema.json` / `issue.schema.json`. Plugin-manifest validation already enforced at load time by the PluginLoader (Step 1b), so this Rule only revalidates user content. ✅ landed.
- Actions: 0 shipped (contract available). Deferred per the spec.
- Built-ins registry (`src/extensions/built-ins.ts`) exposes the full set as callable instances (`builtIns()`) and as Registry-ready manifest rows (`listBuiltIns()`). The orchestrator wires the two by accepting a new `RunScanOptions.extensions` field alongside the kernel's registry.
- Orchestrator (`src/kernel/orchestrator.ts`) now iterates the pipeline for real: for each Provider it walks roots and classifies nodes, feeds them through scope-appropriate Extractors, collects links, denormalises `linksOutCount` / `linksInCount`, then runs every Rule over the graph. Sha256 body/frontmatter hashes + triple-split bytes are computed on the node record. Links whose kind isn't in the Extractor's declared `emitsLinkKinds` allowlist are silently dropped.
- `sm scan` updated — defaults to the built-in set, exits 1 when the scan surfaces issues (per `cli-contract.md` §Exit codes), exposes `--no-built-ins` for the kernel-empty-boot parity case.
- Acceptance (drop-in proof): the orchestrator iterates `registry.all('extractor')` — adding a 4th Extractor is one new file under `src/built-in-plugins/extractors/` + one entry in `built-ins.ts`. Zero kernel edits. Step 4's `external-url-counter` lands as the live proof. ✅ architecturally honoured.
- End-to-end test (`src/test/scan-e2e.test.ts`) against a temp fixture with 3 nodes covering agent + command kinds — asserts node count / kinds / hashes / bytes, the four expected link families (frontmatter.related, slash, at-directive, supersededBy inversion), and the two expected Rule issues (broken-ref for the unresolved `@backend-lead`, superseded for `deploy.md`). ✅ landed. Suite total: 88 of 88 tests passing (was 36 before Step 2; +52 new across normalization, claude, Extractors, Rules, Formatter, validate-all, built-ins, and the e2e).

### Step 3 — UI design refinement — ✅ complete

Iterate the Flavor A prototype's visual design against mock data before committing kernel API surface. Cheap to change now; expensive after Step 4 locks the scan output shape.

- ✅ Dark mode parity: `--sm-*` CSS custom properties for kind accents (5 kinds × border/badge-bg/badge-fg), edge colors (3 types), link badge colors, severity colors. `.app-dark` overrides with dark-appropriate values. All ~40 hardcoded hex colors in graph-view, event-log, and inspector-view replaced.
- ✅ Node card redesign: kind-specific subtitles — agent→model, hook→event, command→shortcut, skill→I/O count. Applied to both graph nodes (new `.f-gnode__subtitle` row, `NODE_HEIGHT` 96→110) and list rows (secondary `.list__cell-detail` line).
- ✅ Connection styling: differentiated `stroke-width` (supersedes 2.5, requires 2, related 1.5). SVG `<marker>` arrowhead definitions added (best-effort — depends on Foblex SVG scope).
- ✅ Inspector layout: reordered cards — Summary (full-width hero with left accent) → Kind-specific → Relations → Metadata → Tools → External → Body. Grid switched from `auto-fit, minmax(320px, 1fr)` to explicit `1fr 1fr` with full-width spans.
- ✅ Responsive baseline: `@media` breakpoints at 1280px and 1024px across topbar (compact gaps, hide tag, wrap nav), filter-bar (smaller min-widths), event-log (collapse grid to 2 columns), inspector (single-column grid), graph (reduce min-height to 400px).
- ✅ Empty / error / loading states: shared `.empty-state` CSS utility classes in `styles.css`. Structured icon+title+description pattern applied to graph (loading, error, no-match), inspector (no-selection, not-found), event-log (no events).
- ✅ Bundle budget: investigated — Aura full-preset (~173kB PrimeNG chunk) is the main contributor; per-component theme imports not supported by PrimeNG v21. Warning threshold raised from 500kB to 600kB for prototype phase. Unused `DividerModule` removed from inspector. Full compliance deferred to Step 14.

### Step 4 — Scan end-to-end — ✅ complete

- ✅ `sm scan` persists `ScanResult` into `<scope>/.skill-map/skill-map.db` (replace-all transactional snapshot across `scan_nodes / scan_links / scan_issues`); auto-migrates on first run; `--no-built-ins` skips persistence (kernel-empty-boot parity).
- ✅ `sm scan -n / --dry-run` skips every DB write (does not even open the adapter unless `--changed` also requires a read).
- ✅ `sm scan --changed` runs incrementally: loads the prior snapshot via `loadScanResult`, reuses nodes whose `bodyHash + frontmatterHash` match, full-processes new / modified files, drops deleted ones, re-runs rules over the merged graph, persists with replace-all. Degrades to a full scan with a stderr warning when no prior snapshot exists. Rejects `--changed --no-built-ins`.
- ✅ `sm list / show / check` read from `scan_*` (replaced their stubs); `--kind`, `--issue`, `--sort-by` (whitelist), `--limit`; per-column default sort direction (numeric → DESC, textual → ASC); `--issue` via SQLite `json_each`.
- ✅ Triple-split bytes + tokens per node (`js-tiktoken` cl100k_base); `--no-tokens` opt-out; encoder reused once per scan.
- ✅ **`external-url-counter` Extractor** landed as the 4th Extractor — one new file under `src/built-in-plugins/extractors/external-url-counter/` + one entry in `built-ins.ts`. Validates Step 2's drop-in litmus. Emits pseudo-links the orchestrator partitions into `node.externalRefsCount` (never persisted to `scan_links`, never reach Rules).
- ✅ `links_out_count`, `links_in_count`, `external_refs_count` denormalised on `scan_nodes`.
- ✅ Self-scan test (mandatory) — validates the live repo against `scan-result.schema.json` top-level + all per-element schemas; asserts no `error`-severity issues; smoke-checks tokens and external refs.
- ✅ 500-MD performance benchmark — measures ~1037 ms vs 2000 ms budget; covered as a `node:test` case alongside the suite.
- ✅ Sub-step 4.7 — runtime ScanResult reconciled with the spec: `scannedAt` integer ms (was ISO string), `scope: 'project' | 'global'`, `adapters[]` enumerated, `scannedBy { name, version, specVersion }`, `stats.filesWalked / filesSkipped`. The spec was authoritative all along; runtime only caught up. `loadScanResult` synthetic envelope updated to satisfy `roots: minItems 1` (returns `['.']` with an inline note that the orchestrator does not consume `roots` from a prior snapshot).
- ✅ Bug fix: `defaultMigrationsDir()` now probes the flat `dist/cli.js` bundle layout before falling back to the source-shaped layout — the prior heuristic silently missed `dist/migrations/` when running the bundled CLI on a fresh DB.
- ✅ Sub-step 4.8 — bundle fix from end-to-end manual validation: (a) `sm scan` exit code now matches `sm check` and the spec (1 only when issues at `error` severity exist; was 1 on any issue, including warn / info — applied to both human and `--json` paths). (b) `sm show` human output now prints `External refs: <N>` after the Weight section; the `--json` output already exposed `externalRefsCount`, the human format had a parity gap. (c) `sm scan --changed` no longer drops `supersedes`-inversion links from cached nodes; the orchestrator's cached-reuse filter now uses `originatingNodeOf(link, priorNodePaths)` which discriminates between forward `supersedes` (where `source` is the originating node) and inverted `supersedes` (where `target` is the originating node, emitted by frontmatter `metadata.supersededBy`) — sufficient because `supersedes` is the only kind with this inversion today; if a future Extractor adds another inversion case, escalate to a persisted `Link.detectedFromPath` field with a schema bump. Regression invariant: full-scan and `--changed`-scan over the same input now produce set-equal `links`.
- ✅ Sub-step 4.9 — (a) `trigger-collision` Rule detects nodes that *advertise* the same trigger via `frontmatter.name` (two `command` files both named `deploy` emit one collision issue). (b) `persistScanResult` runs `PRAGMA wal_checkpoint(TRUNCATE)` after the replace-all transaction commits so external read-only tools (sqlitebrowser, DBeaver, ad-hoc SQL clients) see fresh state without waiting on SQLite's auto-checkpoint threshold (~1000 pages, rarely crossed on small repos).
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

- `.skill-map/settings.json` + `.skill-map/settings.local.json` + `.skillmapignore`. `sm init` scaffolds the folder and adds the `.local.json` to the project's gitignore.
- Loader walks the hierarchy from §Configuration (defaults → `~/.skill-map/settings(.local).json` → `<scope>/.skill-map/settings(.local).json` → env / flags). UI-side keys are read by the same loader but only delivered over HTTP at Step 15.
- `sm init` scaffolding.
- `sm plugins list / enable / disable / show / doctor`.
- Frontmatter schemas enforced (warn by default, `--strict` promotes to error).

### Step 7 — Robustness

- Trigger normalization pipeline wired into every Extractor that emits `link.trigger`. ✅ already-landed (cabled into `slash`, `at-directive`, `external-url-counter` at Steps 3–4 with `src/kernel/trigger-normalize.ts` + worked-example test fixtures in `src/kernel/trigger-normalize.test.ts`; no dedicated sub-step). The 6-step pipeline contract lives in §Trigger normalization above.
- Sub-step 7.1 ✅ — incremental scan via `chokidar` watcher. `sm watch [roots...]` (and `sm scan --watch` alias) subscribes to the same roots `sm scan` walks, applies the same ignore chain, and triggers an incremental scan after each debounced batch. Debounce window configurable via `scan.watch.debounceMs` (default 300ms). Reuses the existing `scan.*` non-job events; emits one ScanResult per batch under `--json` (ndjson). Closes cleanly on SIGINT/SIGTERM with exit 0; per-batch issues do not flip the watcher exit code (only operational errors during initial setup exit 2). Lays the groundwork for Step 14's WS broadcaster (the same watcher will fan out to UI clients live).
- Sub-step 7.2 ✅ — Extractor conflict resolution. Two pieces. **(a)** New built-in Rule `link-conflict` (`src/built-in-plugins/rules/link-conflict/`): groups `scan_links` rows by `(source, target)` and emits one `warn` Issue per pair where the set of distinct `kind` values has size ≥ 2; `data` carries `{ source, target, variants: [{ kind, sources, confidence }, ...] }`. Cross-Extractor AGREEMENT (single kind across multiple Extractors) is silent by design — confirming the happy path would generate massive noise on real graphs. Severity is `warn`, not `error`: the Rule cannot pick which kind is correct, so per `cli-contract.md` §Exit codes the verb stays exit 0. **(b)** `sm show` pretty link aggregation: human Formatter now groups `linksOut` / `linksIn` by `(endpoint, kind, normalizedTrigger)` and prints one row per group with the union of Extractor ids in a `sources:` field; section header reports raw + unique counts (`Links out (12, 9 unique)`); `(×N)` suffix when N Extractors emit the same logical link. `--json` output stays raw rows (Decision #90 untouched — storage keeps one row per Extractor). UI inspector aggregation explicitly **deferred to Step 14**: the current Flavor A renders `metadata.{related, requires, supersedes, provides, conflictsWith}` chips directly from the frontmatter, not from `scan_links`; when Flavor B lands (Hono BFF + WS + full link panel from scan), the aggregation logic from `src/cli/commands/show.ts` will need to be ported.
- Sub-step 7.3 ✅ — `sm job prune` real implementation. Reads `jobs.retention.{completed,failed}` from layered config; for each non-null policy deletes `state_jobs` rows in that terminal status with `finished_at < Date.now() - policySeconds * 1000` and unlinks the matching MD files in `.skill-map/jobs/`. `--orphan-files` adds a second pass that scans `.skill-map/jobs/` and unlinks MD files whose absolute path is not referenced by any `state_jobs.file_path`; runs after retention so freshly-pruned files don't double-count. `--dry-run` reports what would be pruned without touching DB or FS; `--json` emits `{ dryRun, retention: { completed: { policySeconds, deleted, files }, failed: {...} }, orphanFiles }`. **`state_executions` is NOT touched** — append-only through `v1.0` per `spec/db-schema.md`. Pruning runs ONLY on explicit `sm job prune` invocation; no implicit GC during normal verbs (per `spec/job-lifecycle.md` §Retention and GC). DB-missing → exit 2 with a clear message; file-unlink failures (already missing, permission denied) are swallowed silently — a stale file path doesn't fail the verb.

### Step 8 — Diff + export

Sub-stepped: 8.1 `sm graph`, 8.2 `sm scan --compare-with`, 8.3 `sm export`.

- **8.1 — `sm graph [--format <name>]`** ✅ — replaces the long-standing stub. Reads the persisted graph through `loadScanResult` and renders via any registered Formatter (built-ins only at v0.5.0; plugin Formatters plug in at Step 9). Default `--format ascii`; `mermaid` / `dot` deferred to Step 12 and surface here automatically once they ship as built-ins. Exit 5 on unknown format or missing DB; exit 0 on the empty-DB zero-graph case (graph is a read-side reporter, not a guard). Trailing newline normalisation makes the verb safe to pipe.
- **8.2 — `sm scan --compare-with <path>`** ✅ — new flag on `sm scan`. Loads + AJV-validates a saved `ScanResult` dump, runs a fresh scan in memory using the same wiring (built-ins, layered config, ignore filter, strict mode), computes a delta via the new `computeScanDelta` kernel helper, emits pretty (default) or `--json`. Identity contract recorded in `src/kernel/scan/delta.ts`: nodes by `path`, links by `(source, target, kind, normalizedTrigger)` (mirrors `sm show` aggregation + Step 7.2 `link-conflict`), issues by `(ruleId, sorted nodeIds, message)` (mirrors `spec/job-events.md` §issue.* diff key). Nodes get a `changed` bucket annotated with `'body'` / `'frontmatter'` / `'both'`; links and issues only have `added` / `removed` because identity already covers semantic change. Exit 0 on empty delta, 1 on non-empty (CI-friendly), 2 on dump load / validation errors. Combo rejections: `--changed`, `--no-built-ins`, `--allow-empty`, `--watch`. Never touches the DB.
- **8.3 — `sm export <query> --format <json|md|mermaid>`** ✅ — replaces the stub. Mini query language (whitespace-separated `key=value`, AND across keys, comma-separated values OR within a key): `kind` (skill / agent / command / hook / note), `has` (`issues` today; `findings` / `summary` reserved for Steps 10 / 11), `path` (POSIX glob with `*` / `**`). New kernel module `src/kernel/scan/query.ts` exports `parseExportQuery` + `applyExportQuery` + `IExportQuery` + `IExportSubset` + `ExportQueryError` (pure, no IO; zero-dep micro-glob → RegExp). Subset semantics: nodes pass under AND-of-filters; links require BOTH endpoints in scope (closed subgraph — boundary edges would confuse focused-view with focused-and-neighbours); issues survive when ANY of their `nodeIds` is in scope (cross-cutting issues like `trigger-collision` stay visible). Formats `json` and `md` real today; `mermaid` exits 5 with a Step-12 pointer (Formatter plug-in lands as a built-in there). Exit 5 on bad format / bad query / missing DB. Step 8 fully closed.

### Step 9 — Plugin author UX

The last deterministic-half step before wave 2 begins. Drop-in plugin discovery already exists from Step 1b/6.6 (the `sm plugins` introspection verbs); Step 9 turns plugins into first-class participants of the read-side pipeline, ships a testkit so authors can unit-test their extensions in isolation, documents the contract, and lights up plugin migrations with the triple-protection rule. Sub-steps:

- **9.1 — Plugin runtime wiring** ✅ — drop-in plugins discovered under `<scope>/.skill-map/plugins/<id>/` now participate in the analysis pipeline. New helper `loadPluginRuntime(opts)` at `src/cli/util/plugin-runtime.ts` centralises discovery, layers the enabled-resolver (settings.json baseline + DB override `config_plugins`), buckets loaded extensions into the per-kind shape the orchestrator + graph Formatter registry consume, and turns failure modes into stderr-ready diagnostic strings. `sm scan`, `sm watch` (and the `sm scan --watch` alias), `sm scan --compare-with`, and `sm graph` each gained a symmetric `--no-plugins` flag for kernel-empty-boot parity. Failed plugins (`incompatible-spec` / `invalid-manifest` / `load-error`) emit one stderr warning each; the kernel keeps booting on a bad plugin. Disabled plugins drop out silently (intent already covered by `sm plugins list`). Plugin loader bug fixed: the AJV validator now strips function-typed properties from a plugin's runtime export before checking the extension-kind schema, because the kind schemas use `unevaluatedProperties: false` and would otherwise reject every real plugin shipping `extract` / `format` / `evaluate` methods (built-ins were unaffected — they never traverse the loader). `sm export --format` deliberately left out of 9.1: its formats (`json`, `md`, `mermaid`) are hand-rolled today, not Formatter-backed; flipping it to consult the Formatter registry is a future enhancement, not on the Step 9 critical path. **5 new tests at `src/test/plugin-runtime.test.ts`** cover Extractor contribution, `--no-plugins` opt-out on both scan and graph, broken-manifest tolerance, and plugin-Formatter selection. Test count 389 → **394 of 394 tests pass**.
- **9.2 — Plugin migrations + `sm db migrate --kernel-only` / `--plugin <id>`** ✅ — implements the long-deferred flags from `spec/cli-contract.md:304` and `spec/db-schema.md:321`. Plugins declaring `storage.mode === 'dedicated'` ship migrations under `<plugin-dir>/migrations/NNN_<name>.sql` (same convention as kernel migrations); the runner records them in `config_schema_versions` under `(scope='plugin', owner_id=<plugin-id>)`. Each migration runs inside its own transaction, ledger insert in the same transaction so partial failure rolls back cleanly. Triple protection: pragmatic regex validator rejects any DDL or DML whose target name doesn't match `plugin_<normalizedId>_*`. Whitelist of allowed statements (`CREATE` / `DROP` / `ALTER` over `TABLE` / `INDEX` / `TRIGGER` / `VIEW`, plus `INSERT` / `UPDATE` / `DELETE` on prefixed objects); forbidden keywords (`BEGIN` / `COMMIT` / `ROLLBACK` / `PRAGMA` / `ATTACH` / `DETACH` / `VACUUM` / `REINDEX` / `ANALYZE`) abort validation; schema qualifiers other than `main.` are rejected; comments stripped first so `-- CREATE TABLE evil;` and `/* … */` blocks can't smuggle hidden DDL. Layer 1 validates every pending file before anything runs, Layer 2 re-validates immediately before each apply (TOCTOU defense), Layer 3 sweeps `sqlite_master` after each plugin's batch and reports objects outside the prefix as intrusions (exit 2; ledger advances for clean migrations so the breach is loud, not silent). New modules: `src/kernel/adapters/sqlite/plugin-migrations-validator.ts` (pure, no IO) and `src/kernel/adapters/sqlite/plugin-migrations.ts` (runner mirroring the kernel shape). `DbMigrateCommand` learns `--kernel-only` (skip plugin pass) and `--plugin <id>` (run only that plugin, skip kernel pass), mutually exclusive. `--status` summary now lists kernel + per-plugin ledgers. Plugin discovery reuses `loadPluginRuntime` from 9.1 so the enabled-resolver layering (settings.json + DB override) stays in lock-step with `sm plugins list`. 43 new tests across `plugin-migrations-validator.test.ts` (34 unit cases over normalization, comment stripping, statement splitting, prefix enforcement, intrusion detection) and `plugin-migrations.test.ts` (9 integration cases over green-path apply, Layer 1 abort, idempotent re-run, dry-run, `--kernel-only`, `--plugin <id>`, missing-id exit 5, mutual exclusion, `--status` formatting). Test count 394 → **437 of 437 tests pass**.
- **9.3 — `@skill-map/testkit`** ✅ — landed as a separate workspace + npm package (Arquitecto's pick: independent versioning over subpath). Surface: `node` / `link` / `issue` / `scanResult` builders (spec-aligned defaults, override per field); `makeDetectContext` / `makeRuleContext` / `makeRenderContext` / `detectContextFromBody` per-kind context factories; `makeFakeStorage` (in-memory KV stand-in matching the Storage Mode A `ctx.store` surface) and `makeFakeRunner` (queue + history `RunnerPort` stand-in for probabilistic extensions, marked `experimental` until Step 10 finalizes the contract); `runDetectorOnFixture` / `runRuleOnGraph` / `runRendererOnGraph` high-level helpers (most plugin tests reduce to one line). Collateral on `@skill-map/cli`: `src/kernel/index.ts` re-exports the extension-kind interfaces (`IDetector`, `IRule`, `IRenderer`, `IAdapter`, `IAudit` and their context shapes) so plugin authors can type-check against the same surface the kernel consumes. Workspace ships its own `tsup` build (5 KB runtime + 10 KB types) and pins every dep at exact versions; `@skill-map/cli` is marked external so testkit stays a thin layer over the user's installed cli version. Independent test runner (`npm test --workspace=@skill-map/testkit`). 30 new tests cover builder defaults + overrides, context shapes, KV stand-in semantics, fake-runner queueing / history / reset, and the three run helpers. Total project tests 437 → **467 of 467** (437 cli + 30 testkit).
- **9.4 — Plugin author guide + reference plugin + diagnostics polish** ✅ — closes Step 9. New `spec/plugin-author-guide.md` (prose, no schema) covering discovery roots, manifest anatomy, the six extension kinds with worked examples (Extractor / Rule / Formatter in full; Provider / Action / Hook flagged for Step 10 expansion), `kv` vs `dedicated` storage with cross-links to `plugin-kv-api.md` + the 9.2 triple-protection rule, `specCompat` strategy (narrow pre-1.0, `^1.0.0` post-1.0), dual-mode posture, testkit usage, the five plugin statuses, Stability section. `spec/package.json#files` updated; `spec/index.json` regenerated (57 → 58 hashed files). Reference plugin under `examples/hello-world/` (Arquitecto's pick: in the principal repo) — `plugin.json` + `extensions/greet-detector.js` (one Extractor emitting `references` links per `[[greet:<name>]]` token; legacy `greet-detector.js` filename pending the code-side rename PR) + README with three-step "try it locally" recipe + `test/greet-detector.test.js` (assertions using `@skill-map/testkit`, runnable via `node --test` without a build step). Verified end-to-end: the plugin loads cleanly under `sm plugins list`, contributes links to the persisted scan, and the testkit-based test passes. Diagnostics polish on `PluginLoader.reason`: each failure-mode message now carries an actionable hint — `invalid-manifest` names the manifest path + points at the schema; `incompatible-spec` suggests two remediations; `load-error` (file not found) includes the absolute resolved path; `load-error` (unknown kind / missing kind) lists the valid kinds; `load-error` (extension schema fails) names the per-kind schema file. **6 new tests** under `test/plugin-loader.test.ts` (`Step 9.4 diagnostics polish` describe block) assert each hint shape is present without pinning the full wording. Step 9 closed: 437 → **443 cli + 30 testkit = 473 of 473 tests pass**. Step 9 (in total) shipped 4 sub-steps and turned `skill-map` plugins from "discovered but inert" into a first-class authoring surface with documentation, tests, and a working reference plugin.

### Step 9.5 — Spec base cleanup: absorb provider verbatim — pending

> ⏸ **Pre-wave-2 prerequisite.** Realigns `spec/schemas/frontmatter/base.schema.json` and the Claude Provider's per-kind schemas with the architectural principle "skill-map aggregates, does not curate vendor specs". The current base universal carries Claude-specific fields (`tools`, `allowedTools` — Decision #55) and the Claude Provider's `agent.schema.json` captures only `model` of Anthropic's documented 16 agent fields. Both are inversions of the right ownership boundary. Closes before Step 10 starts so the `skill-summarizer` pipeline ships against a stable annotation shape. Decision surfaced in conversation 2026-05-04 — full reasoning informed by cross-vendor research (Cursor, Continue, Aider, Copilot, Windsurf, Cline, Roo: no shared vocabulary exists; `description` is the only universal field) and Anthropic stability scan (~1.3 fields/month growth, no documented deprecations, `additionalProperties: true` keeps absorption resilient).

#### Scope

1. **Trim `base.schema.json`** to `name` (required) + `description` (required), `additionalProperties: true`. The previously-promoted fields (`type`, `author`, `authors`, `license`, `tools`, `allowedTools`, `metadata`) leave the formal base. They are NOT removed from existing files; they pass through validation silently because of `additionalProperties: true`.
2. **Absorb Anthropic's agent verbatim** into `src/built-in-plugins/providers/claude/schemas/agent.schema.json`. The 11 missing fields (`tools`, `disallowedTools`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`) join the existing `model`. Schema stays `additionalProperties: true` so future Anthropic additions do not break consumers.
3. **Same pattern for skill / command / hook**: `claude/skill.schema.json` declares `tools` plus `allowed-tools` (hyphenated, per Anthropic's skill spec) at root in addition to its existing `inputs` / `outputs`. Command and hook absorb whatever Anthropic documents on their respective pages.
4. **Update TS types** in `ui/src/models/node.ts` and any kernel-side mirror.
5. **Update fixtures + tests**. Conformance fixtures (`minimal-claude`) keep the same content; their field placement changes only if any field was relying on base validation that no longer happens.
6. **Regenerate `spec/index.json`** (`npm run spec --workspace=@skill-map/spec`). `context/cli-reference.md` should not change (no CLI surface affected).
7. **Changesets** for `@skill-map/spec` and `@skill-map/cli` — both minor bumps (greenfield breaking permitted pre-1.0 per `spec/versioning.md` §Pre-1.0).
8. **Decision #55 superseded.** The "top-level on purpose — mirrors Claude Code's own frontmatter shape" rationale is reversed: cross-vendor research showed Claude Code is an **aggressive superset**, not a shared standard — 11 of its 16 agent fields have no analog in any other vendor researched. Mirror was the wrong motivation. New decision (next number in the table) records the inversion + the absorb-verbatim principle. The §Frontmatter standard section (above) is rewritten as part of this Step to reflect the new shape.

#### Deferred — pending mastication

Where the **skill-map annotation block** lives (today's `metadata` plus `type`, `author`, `authors`, `license` — none of which Anthropic owns) is **deliberately not decided in this Step**. Three options on the table:

1. **Sidecar files** under `.skill-map/annotations/<full-path>.yml` mirroring the node path. Vendor file stays 100% pure → zero LLM-contamination risk when Claude Code or any third-party tool slurps the agent file into its context (delegation listings, `Read` tool, MCP resources expose the whole file). Author writes the annotation in a separate file alongside the markdown.
2. **`skillMap: {}` block at root of the same frontmatter**. Single-file authoring, but every byte in the frontmatter is potential LLM-context contamination.
3. **Hybrid** — sidecar as default, in-frontmatter fallback for ergonomic exceptions.

Conversation 2026-05-04 leans toward option 1 (Arquitecto pending masticación on tradeoffs). Until that decision lands, the orphan fields ride on `additionalProperties: true` with no formal validation. The auto-memory file `memory/project_spec_base_cleanup_deferred.md` carries the explicit list of orphan fields to surface when the decision returns — do not lose that context.

#### Why before Step 10

Step 10 (`skill-summarizer` and the Job subsystem) emits per-kind summaries against the shapes that exist at scan time. Today the kernel's denormalizations point at `metadata.{stability, version, author}`; if the annotation home moves mid-Step-10 the summarizers ship against a shape that is not final. Closing the cleanup before LLM work starts avoids re-targeting the summarizer pipeline.

#### Acceptance

- `base.schema.json` declares only `name` + `description` as required, `additionalProperties: true`, no `type` / `author` / `authors` / `license` / `tools` / `allowedTools` / `metadata` properties.
- `claude/agent.schema.json` declares all 16 Anthropic agent fields with appropriate types/enums, `additionalProperties: true`.
- `claude/skill.schema.json` declares `tools` and `allowed-tools` (hyphenated, per Anthropic's skill spec) plus the existing kind-specifics.
- `npm run validate` (root orchestrator) passes.
- Conformance fixtures still produce identical scan output (frontmatter validation is permissive, so no regression on existing files).
- Changesets present for `@skill-map/spec` and `@skill-map/cli`.
- §Frontmatter standard section in this ROADMAP rewritten to reflect the new base + provider boundary.
- Decision #55 marked superseded with a forward link to the new decision.

### ▶ v0.5.0 — deterministic kernel + CLI (offline, zero LLM)

---

> 🔀 **Execution order**: between v0.5.0 and v0.8.0 the build order diverges from numeric Step order. Steps keep their stable numbers (so commits, changesets, and citations don't churn), but the actual sequence is: Step 14 (Web UI) executes immediately after v0.5.0 and ships v0.6.0, then wave 2 (Steps 10 → 11) resumes and ships v0.8.0. Steps 12–13 follow. Rationale: validating the deterministic kernel end-to-end against a real UI before adding LLM cost / probabilistic surfaces. See Decision #118.

### Step 10 — Job subsystem + first probabilistic extension (wave 2 begins)

> ⏸ **Paused**: Phase 0 (`IAction` runtime contract) shipped; Phases A–G resume after Step 14 closes. Step 14 (Web UI) lands first so the deterministic kernel can be seen end-to-end before LLM costs land. Phase 0 stays dormant in the kernel; no new wave-2 work until v0.6.0 (deterministic + Web UI) ships. See Decision #118.

This is where **wave 2 — probabilistic extensions** begins. Steps 0–7 shipped the deterministic half of the dual-mode model (the Claude Provider, three Extractors, three Rules + the `validate-all` Rule, the ASCII Formatter, all running synchronously inside `sm scan` / `sm check`). Step 10 turns on the second half: queued jobs, LLM runner, and the first probabilistic extension (`skill-summarizer`, an Action of `mode: 'probabilistic'`). The kernel surface (`ctx.runner`, the queue, the preamble, the safety/confidence contract on outputs) is what unlocks every subsequent probabilistic extension across all four dual-mode kinds — Extractor, Rule, Action, Hook.

**Storage decision (B2 — DB-only, content-addressed)**: rendered job content lives in a new `state_job_contents` table keyed by `content_hash`; report payloads live inline in `state_executions.report_json`. There are no `.skill-map/jobs/<id>.md` or `.skill-map/reports/<id>.json` filesystem artifacts. Multiple jobs that resolve to the same `content_hash` (retries, `--force` reruns, fan-outs that happen to render identically) share one content row, so DB-only does not blow up storage on heavy users. The decision lands as a spec change ahead of the implementation phases below; see `.changeset/job-subsystem-db-only-content.md` for the full diff and rationale.

The work splits into seven phases that ship as separate changesets:

- **Phase 0 — `IAction` runtime contract**. New `src/kernel/extensions/action.ts` mirroring `extensions/action.schema.json`. Plugin loader accepts `kind: 'action'`. Manifest validation tests. No runtime invocation yet (the dispatcher lands with the queue in Phase A).
- **Phase A — Queue infrastructure**. Storage helpers for `state_jobs` + `state_job_contents` (insert in one transaction, content-addressed dedup via `INSERT OR IGNORE`). TTL resolution + priority resolution + `contentHash` computation. Real bodies for `sm job submit / list / show` (fan-out + duplicate detection + `--force` + `--ttl` + `--priority`, no rendering yet).
- **Phase B — Preamble render + `sm job preview`**. Kernel helper produces preamble + `<user-content>` + interpolated body, persists to `state_job_contents`. Real body for `sm job preview` (reads from DB). Closes conformance case `preamble-bitwise-match` (deferred from Step 0a).
- **Phase C — Atomic claim + cancel + status + reap**. `UPDATE ... RETURNING id` claim primitive. Real bodies for `sm job claim` (with `--json` returning `{id, nonce, content}` per the Skill-agent handover contract), `sm job cancel`, `sm job status`. Reap runs at the start of every `sm job run`.
- **Phase D — `sm record` + nonce auth**. Validate id + nonce, parse `--report` (path or `-` stdin), validate report payload against `reportSchemaRef`, transition the job, write `state_executions` with `report_json` inline. Exit-code matrix (3, 4, 5).
- **Phase E — `RunnerPort` impls + `sm job run` + `ctx.runner`**. `ClaudeCliRunner` (subprocess + temp-file dance for the `claude -p` interface; missing binary → exit 2). `MockRunner` for tests. Full `sm job run` loop (reap → claim → spawn → record). `sm doctor` learns to probe runner availability. `ctx.runner` plumbed through invocation contexts (per `spec/architecture.md` §Execution modes).
- **Phase F — `skill-summarizer` built-in + `state_summaries` write-through**. First probabilistic Action. Its existence proves the full pipeline (manifest with `mode: 'probabilistic'`, kernel routing through `RunnerPort`, prompt rendering, `sm record` callback, `state_summaries` upsert). Real bodies for `sm actions list / show`.
- **Phase G — Conformance, Skill agent, events, polish**. New conformance case `extension-mode-routing` (a probabilistic Action dispatched as a queued job; a deterministic Action invoked in-process — verifies dispatch routing matches manifest `mode`). `/skill-map:run-queue` + `sm-cli-run-queue` Skill agent package. Job event emission per `spec/job-events.md` (`run.*`, `job.*`, `model.*`, `run.reap.*`). `github-enrichment` bundled plugin (hash verification). ROADMAP + `coverage.md` updated.

Phase 0 has already landed in code (staged/committed under separate concerns); the rest land in order, each with its own changeset, build verification, and tests.

### Step 11 — Remaining probabilistic extensions + LLM verbs + findings

Continuation of wave 2: the rest of the per-kind summarizers, the high-leverage LLM verbs that consume them, and the `findings` surface that probabilistic Rules / Audits emit into.

- Per-kind probabilistic summarizers (Actions): `agent-summarizer`, `command-summarizer`, `hook-summarizer`, `note-summarizer`.
- `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization` — verbs that wrap probabilistic extensions and the queue.
- `sm findings` CLI verb.
- `/skill-map:explore` meta-skill.
- `state_summaries` is exercised by all five per-kind summarizers (the table lands in Step 10 with `skill-summarizer`; Step 11 fills out the remaining four kinds). `state_enrichments` accepts additional providers beyond `github-enrichment` when they ship, against the stable contract.

### Step 16 — Web UI: LLM surfaces v1 (initial)

First UI hand-off for the probabilistic layer. Steps 10 and 11 fill `state_summaries`, `state_enrichments`, and the `findings` table; this Step makes that data visible without re-architecting any view.

- **Inspector view** — replace the three `<sm-empty-state>` placeholders shipped at 14.3 (enrichment / summary / findings) with real cards driven by per-node REST endpoints. New BFF endpoints land alongside: `GET /api/nodes/:pathB64/summary`, `/enrichments`, `/findings`. Schemas extend the `rest-envelope` from 14.2.
- **Findings page** — new `/findings` route: filterable list (by severity, ruleId, node) with deep-link to inspector, mirroring the existing list-view shape. No bulk actions yet — that lives in Step 17.
- **Per-card refresh hooks** — the inspector's per-card refresh pattern from 14.5 extends to summary/enrichment cards so a re-summarize on the kernel side flows through without a full page reload.
- **Read-only stance** — the UI does not start jobs, retry them, or cancel them at this stage. All orchestration stays CLI-side. The job-event WebSocket from 14.4 already broadcasts `summarize.*` / `enrich.*` events; the inspector subscribes for the in-progress shimmer indicator only.
- **Token / cost surfacing** — when a summary carries token counts (`IReportSafety` and the per-summary metadata from `spec/schemas/summaries/*`) display them in the card footer. No aggregation across the collection — that is Step 17.
- **Out of scope**: action buttons that trigger summarization, the dedupe/cluster/impact verbs, the queue inspector. Those are Step 17 work.

Acceptance: every probabilistic table that Step 11 closes has a read-only surface in the UI; no `<sm-empty-state placeholder text "Available in v0.8.0">` survives in the codebase. Smoke test (Playwright, added at 14.7) updates to assert the new endpoints answer in demo mode (data baked into `web/demo/data.json` by the demo build script).

### ▶ v0.8.0 — LLM optional layer

---

### Step 12 — Additional Formatters

- Mermaid, DOT / Graphviz.
- Subgraph export with filters.

### Step 13 — More adapters

Promotes the long-deferred multi-host scope into Phase C so v1.0 ships supporting more than the Claude ecosystem out of the box. Each adapter recognises its host's on-disk layout, classifies files into the six extension kinds, and feeds the same scan pipeline — no kernel changes, pure composition over the `AdapterPort`.

- **Codex adapter** — file layout, frontmatter conventions, slash invocations.
- **Gemini adapter** — Google's agent file shape, Gemini-CLI conventions.
- **Copilot adapter** — GitHub Copilot's prompt / instruction surface.
- **Generic adapter** — convention-light fallback driven entirely by frontmatter (`name`, `kind`, `triggers`); the bare-minimum contract for any future host or for users with a custom layout. Doubles as the reference implementation in the adapter author guide that ships at Step 9.
- Each adapter ships its own `sm-<host>-*` skill namespace (host owns its prefix; see §Skills catalog).
- Conformance: each adapter must classify the four worked examples in `spec/conformance/cases/adapters/` (added when this step is scheduled) and round-trip the trigger set through `trigger-normalize` without surprises.

### Step 14 — Full Web UI

> Step 14 ships v0.6.0 (deterministic + Web UI) before wave 2 resumes (Decision #118). Loopback-only through 14.x; multi-host serve + auth deferred (Decision #119).

Foundational invariants (locked at the pivot, hold across all sub-steps):

- **Hono** BFF with WebSocket `/ws` — thin proxy over the kernel, no domain logic. Pinned exact version per AGENTS.md dep-pinning rule.
- **Single-port mandate**: Hono serves the Angular SPA (`serveStatic` over `ui/dist/ui/browser/` in dev, or the package-bundled `<package>/dist/ui/` in installed mode), the REST endpoints, and the WS under one listener. Dev uses Angular dev server + `proxy.conf.json` pointing to Hono for `/api` and `/ws`.
- `sm serve --port N` is the single entry point: one process, one port, one command. Default port `4242`, default host `127.0.0.1` (never `0.0.0.0`).
- UI consumes real kernel via a `DataSourcePort` abstraction with two impls (`RestDataSource` for live mode, `StaticDataSource` for the demo).
- **Demo mode is a first-class output**: the Angular bundle ships under `web/demo/` for the public site, reading a precomputed JSON dataset (no backend, no `sm` install). Mode discriminator at build time via `<meta name="skill-map-mode" content="live|demo">`.
- BFF lives at `src/server/` (peer of `src/cli/`, not under `src/cli/adapters/` — Hono is a driver, not a kernel port impl). Same kernel-boundary rules apply (no `console.*`, no `process.cwd / homedir`, all i18n via `tx()`).

The work splits into seven sub-steps that ship as separate changesets:

- **14.1 — `sm serve` + Hono BFF skeleton**. New `src/server/` (`index.ts`, `app.ts`, `static.ts`, `ws.ts`, `options.ts`, `paths.ts`) plus `src/server/i18n/server.texts.ts`. Move `ServeCommand` from `src/cli/commands/stubs.ts:294` to a real `src/cli/commands/serve.ts`. Flag surface: `--port` (default `4242`), `--host` (default `127.0.0.1`, refuses non-loopback combined with `--dev-cors`), `--scope project|global`, `--db <path>`, `--no-built-ins`, `--no-plugins`, `--open` / `--no-open`, `--dev-cors`, `--ui-dist <path>` (hidden, used by demo build + tests). Single-port wiring order: `/api/*` (skeleton) → `/ws` (no-op handler — broadcaster lands at 14.4) → `serveStatic` at `/*` rooted at `resolveDefaultUiDist(runtimeCtx)` (three-branch resolver: explicit `--ui-dist` → package-bundled `<package>/dist/ui/` for installed mode → upward walk for `ui/dist/ui/browser/` in monorepo dev) → SPA fallback. Graceful shutdown on SIGINT/SIGTERM. Exit codes: 0 clean shutdown, 2 bind failure / missing UI bundle / bad flag, 5 `--db` not found. Boot succeeds even when the DB is missing — `/api/health` reports `db: missing` so the SPA renders an empty-state CTA instead of failing the connection. Spec edit: `spec/cli-contract.md` `sm serve` row extended with the new flag set + new `### Server` subsection skeleton (filled at 14.2).
- **14.2 — REST read-side endpoints + DataSource contract**. Endpoint catalogue: `GET /api/health` (`{ok, schemaVersion, specVersion, implVersion, scope, db: 'present'|'missing'}`), `GET /api/scan` (latest persisted ScanResult; `?fresh=1` runs in-memory scan without persisting), `GET /api/nodes?kind=&hasIssues=&path=&limit=&offset=`, `GET /api/nodes/:pathB64` (base64url-encoded path; helper `encodeNodePath` / `decodeNodePath`), `GET /api/links?kind=&from=&to=`, `GET /api/issues?severity=&ruleId=&node=`, `GET /api/graph?format=ascii|json|md`, `GET /api/config`, `GET /api/plugins`. All read-only at 14.2; mutations come post-v0.6.0. Wire schema: `/api/scan` returns `ScanResult` 1:1 with `scan-result.schema.json` (byte-equal to `sm scan --json`); list endpoints use a thin envelope `{schemaVersion, kind, items, filters, counts}`. New schema `spec/schemas/api/rest-envelope.schema.json` (additive minor for spec). Query adapter `src/server/query-adapter.ts` reuses `parseExportQuery` from `src/kernel/scan/query.ts` — one grammar, two transports (URL params + `sm export` mini-query). Error envelope mirrors `cli-contract.md --json` shape: `{ok: false, error: {code, message, details}}` with codes `not-found` / `bad-query` / `db-missing` / `internal`. HTTP mapping: 400 `bad-query`, 404 `not-found`, 500 `internal` / `db-missing`. Hono `onError` funnels through `formatErrorMessage` from `src/cli/util/error-reporter.ts`.
- **14.3 — UI vertical slice (Flavor B) + DataSourcePort + demo build pipeline**. Angular DataSource abstraction at `ui/src/services/data-source/`: `data-source.port.ts` (interface with `health` / `loadScan` / `listNodes` / `getNode` / `listLinks` / `listIssues` / `loadGraph` / optional `events()`), `rest-data-source.ts` (live mode), `static-data-source.ts` (demo mode), `data-source.factory.ts` (switches on injected `MODE` token), `path-codec.ts` (base64url mirror of the server helper). Mode discriminator: `<meta name="skill-map-mode" content="live|demo">` read once at bootstrap by `runtime-mode.ts`; default `live` in `ui/src/index.html`, patched to `demo` by the demo build script. `CollectionLoaderService` migrates to consume `DataSourcePort`. **Files dying at 14.3** (per Step 0c throwaway markers): `event-bus.ts`, `scan-simulator.ts`, `mock-links.ts`, `mock-summary.ts`. **Survives + adapts**: `FilterStoreService` (gains URL sync via new `FilterUrlSyncService` — closes the open pick from §1699), `ThemeService` (untouched). Inspector gains three `<sm-empty-state>` placeholders for enrichment / summary / findings with copy "Available in v0.8.0". MD renderer pick: **`markdown-it@14.x` + DOMPurify@3.x** (pinned exact); reasoning recorded in Decision #120. New `ui/src/services/markdown-renderer.ts` runs DOMPurify before `bypassSecurityTrustHtml`. Lazy-load the graph view (Foblex Flow + dagre is the heaviest chunk) and `markdown-it` on first inspector render to keep bundle headroom; the 500 KB warning threshold flip is deferred to 14.6 explicitly to avoid blocking 14.3 on a tree-shake side-quest. **Demo build pipeline** (cross-cutting): relocate `ui/mock-collection/` → `ui/fixtures/demo-scope/` (clearer naming — no longer a runtime data source). New `web/scripts/build-demo-dataset.js` runs `sm scan --json` over the fixture, emits `web/demo/data.json` (full ScanResult) + `web/demo/data.meta.json` (pre-derived per-endpoint envelopes so the StaticDataSource never re-runs `applyExportQuery` in the browser). New `scripts/patch-demo-mode.js` rewrites `<meta name="skill-map-mode">` and `<base href="/demo/">` (hardcoded sub-path; configurability deferred until a second deployment forces it). Top-level `npm run demo:build` orchestrates: `npm run build --workspace=ui` → `node web/scripts/build-demo-dataset.js` → `cp -R ui/dist/browser/. web/demo/` → `node scripts/patch-demo-mode.js`. `web/scripts/build-site.js` gains a dependency on `demo:build` so the public site always ships a fresh demo. Demo banner copy: *"You are viewing a static demo of skill-map's UI. Run `npx @skill-map/cli serve` for the full experience."* (dismissible). Event log component renders empty state in demo mode (no canned events at 14.3 — the `EventStreamPort` is wired at 14.4).
- **14.4 — WS broadcaster + chokidar wiring + live events**. `WsEventStreamService` connects to `/ws` and pushes scan events live. The chokidar watcher from Step 7.1 plugs into the broadcaster: each debounced batch runs `runScanWithRenames` + `persistScanResult` (server-side persistence, **same behavior as `sm watch` — Decision #121: a server with stale DB is a footgun**) and fans out the resulting `scan.*` events over WS. WS auth: **loopback-only assumption** (Decision #119) — no nonce per-connection through 14.x. Multi-host + auth design re-opens post-v0.6.0 alongside the dashboard / non-loopback story. Splits into 14.4.a (BFF: broadcaster + watcher + composition-root lifecycle + `--no-watcher` flag + spec `WebSocket protocol` subsection) and 14.4.b (UI: `WsEventStreamService` consuming `/ws` + reconnect / re-seed flow + event-log integration).
- **14.5 — Inspector polish**. Anything from the original Inspector spec that didn't fit into 14.3 (relation chips upgraded to consume real `scan_links` aggregation per Step 7.2, kind-specific cards rendering server-validated frontmatter, dead-link indicators wired to `/api/nodes/:pathB64` 404 responses).
- **14.6 — Foblex strict types + dark-mode tri-state + bundle-budget tightening**. Three landings: (a) Foblex Flow strict-typing pass — `<f-connection [fType]>` / `[fBehavior]` and `<f-connection-marker-arrow [type]>` switched from string literals to property bindings against `EFConnectionType.SEGMENT` / `EFConnectionBehavior.FIXED` / `EFMarkerType.END_ALL_STATES`, so a future enum rename surfaces at compile time. (b) Dark-mode grows into a system-preference-aware tri-state (`auto` / `light` / `dark`) with `(prefers-color-scheme: dark)` listened live in `auto` mode; the user-chosen mode (not the resolved theme) persists to localStorage. App-shell theme toggle cycles `auto → light → dark → auto` with `pi-desktop` / `pi-sun` / `pi-moon` icons. (c) Bundle-budget tightening — `angular.json` warning lowered from 600 kB → 650 kB AND error from 1 MB → 800 kB (defensive, ~56 kB headroom over today's 594 kB initial). New `analyze` configuration in `angular.json` enables non-hidden vendor sourcemaps without touching `production`; root `npm run bundle-analyze --workspace=ui` script runs `source-map-explorer` against the analyze build for reproducible composition reports. Source-map-explorer added as exact-pinned root devDep (`source-map-explorer@2.5.3`). The original "≤ 500 kB hard cut" target moved to 14.7: investigation traced 110 kB of the 417 kB eager chunk to PrimeNG/Aura provider wiring (`providePrimeNG` core 56 kB + `@primeuix/themes/aura` preset 54 kB) and 275 kB to baseline `@angular`; closing the 95 kB gap requires `provideAppInitializer`-driven lazy preset loading + a native theme-toggle button + lazy `primeng/config` — invasive bootstrap surgery that warrants its own iteration rather than blocking the 14.6 polish landings.
- **14.7 — Responsive scope + production polish + bundle hard cut (✅ early) + `web/` demo publish + smoke test**. Bundle hard cut **landed first** and unblocked the rest: `providePrimeNG({})` is now empty at bootstrap, `provideAppInitializer` dynamic-imports `@primeuix/themes/aura` and feeds it through `PrimeNG.setThemeConfig({ theme: { preset, options: { darkModeSelector: '.app-dark' } } })` before first render. Angular awaits the initializer promise during bootstrap so there is no flash of unstyled content. Single-change delta: −108 kB on the initial total (594 kB → 485 kB). The `angular.json` initial budget tightened from 650 kB to **500 kB warning / 650 kB error** to match the roadmap target. The originally-planned (b) native `<button>` theme toggle and (c) lazy `primeng/config` core sub-cuts were dropped — (a) alone cleared the gap, and dropping them keeps the visual contract of the shell unchanged. Reproducible composition reports remain available via `npm run bundle-analyze --workspace=ui` (added in 14.6). Remaining work: responsive scope decision (whether to support tablet / mobile beyond the current ≥1024px assumption), demo smoke test (Playwright pick + script that loads `web/demo/index.html`, asserts `MODE === 'demo'`, exercises list / inspector / graph / filter, fails if any UI surface tries to fetch `/api/...`), wire `npm run demo:build` into the CI / publish flow, and the public site update.

### ▶ v0.6.0 — deterministic kernel + CLI + Web UI

---

### Step 17 — Web UI: LLM surfaces v2 (deeper)

Builds on Step 16 (Phase B) once the probabilistic outputs are stable in the UI. Promotes LLM **verbs** into interactive flows — the user no longer has to drop to a terminal for the high-leverage analyses.

- **Verb panels** — one panel per kernel verb shipped at Step 11. Initial set:
  - `sm what <node>` → "What does this node do?" inspector tab driven by the existing summary cache + an on-demand re-run button.
  - `sm dedupe` → cluster view that highlights near-duplicate nodes (semantic distance from the per-kind summarizer's vector or a dedicated dedupe extension).
  - `sm cluster-triggers` → grouped view of trigger overlap across agents / commands / hooks, with drill-down to per-trigger conflicts.
  - `sm impact-of <change>` → "if I touch this node, what else moves?" propagation view that uses `state_links` + transitive closure.
  - `sm recommend-optimization` → opinionated wizard that walks the user through suggested rewrites (token budget, redundancy collapse, missing fields).
- **Job orchestration UI** — queue inspector that lists in-flight + recent jobs (id, kind, started, status, retries, elapsed, owner). Action affordances: cancel a running job, retry a failed one, requeue a finished one. Drives the BFF mutation endpoints that 14.x deferred — REST verbs + WebSocket back-pressure feedback.
- **Findings management** — the read-only findings list from Step 16 grows acknowledge / dismiss / snooze / re-evaluate states. Persistence via `state_findings_status` (new table — spec edit). Bulk actions land here, not in Step 16.
- **Cost / token dashboards** — collection-wide aggregation of LLM spend (per provider, per kind, per time window). Populates from `state_summaries` token counts + `state_executions` history.
- **Settings + plugins page** — new `/settings` route in the shell (nav entry alongside Graph / List / Inspector). Lists every discovered plugin with its current status (`loaded` / `disabled` / `incompatible-spec` / `invalid-manifest` / `load-error` / `id-collision`), version, kind(s), scope (built-in / user-global / project), and manifest summary. Reads from `GET /api/plugins` (already exposed at 14.2). Toggle affordance via new `POST /api/plugins/:id/enable` and `/disable` — first real BFF mutations beyond job control, persisted in `config_plugins` (the same table `sm plugins enable/disable` writes to). Same auth model as the queue inspector (loopback-only through v0.6.0; multi-host + auth re-opens per Decision #119). Settings hierarchy viewer is a stretch — show the merged `settings.json` with per-key provenance (which of the 6 layers won) so users can debug "why is this on?" without digging through five files. Out of scope: editing the settings file from the UI (deferred indefinitely — restart-to-apply contract per §Configuration).
- **PrimeNG components added** — Step 17 likely pulls in `Drawer`, `Dialog`, `DataTable`, `Toast`, `OverlayPanel`. Each addition updates `ui:bundle-analyze` to confirm the eager budget still holds (lazy-load on first open is the default — only the shell topbar lives in the eager chunk).
- **A11y pass** — full WCAG AA pass for the verb flows (live regions for job status updates, focus trapping in dialogs, keyboard shortcuts for the queue inspector). Lighter passes were enough at 14.x; verb flows are interaction-heavy and warrant the audit.

Acceptance: every CLI verb shipped at Step 11 has a UI flow that does not require the user to know the verb name. The job subsystem is observable + steerable from the UI without going back to the terminal.

---

### Step 15 — Distribution polish

- **Single npm package**: `@skill-map/cli` ships CLI + UI built (`ui/dist/` copied into the package at publish time). Two `bin` entries — `sm` (short, daily use) and `skill-map` (full name, scripting). Same binary, two aliases. Single version applies to both surfaces; CLI ↔ UI key mismatches degrade gracefully (unknown keys are warned + ignored, never fatal). Versioning details in §Stack conventions.
- **Alias / squat-defense packages** (historical): an `alias/*` glob workspace published two un-scoped placeholders to lock names against third-party squatters: `skill-map` (un-scoped top-level) and `skill-mapper` (lookalike). Each shipped a single `bin` that printed a warning to stderr pointing at `@skill-map/cli` and exited with code 1. They never delegated, never wrapped the real CLI as a dependency, never installed side-effect-free. Once both names were locked at `0.0.2` and a `npm deprecate` notice was attached on each (the official npm-side equivalent of the same redirect message, surfaced at install time and on every `npm view`), the workspaces themselves were dropped from the tree. The `@skill-map/*` scope is already protected by org ownership (the moment `@skill-map/spec` was published).

  Two extra names attempted at first publish that never made it into `alias/*`:

  - **`skillmap`** — npm's anti-squat policy auto-blocks "names too similar to an existing package" once `skill-map` is published. Got E403 with `"Package name too similar to existing package skill-map"`. Net effect: no third party can publish `skillmap` either, so the name is de-facto reserved. Cheaper than maintaining a workspace.
  - **`sm-cli`** — already taken on npm at first-publish time by an unrelated project. Not critical: `sm` is the binary name (alias of `skill-map`), not a package name we ship. The binary is delivered exclusively through `@skill-map/cli`, so a third party owning the `sm-cli` name does not affect the skill-map ecosystem.

  Lesson for future placeholder additions: `npm view <name>` before creating the workspace to detect both occupied names and likely anti-squat collisions; only commit a workspace if the name is publishable. And: a workspace is only worth keeping while you might re-publish it. Once the redirect lives in `npm deprecate`, the local workspace is dead weight — drop it.
- **`sm ui` sub-command**: serves the bundled UI on a static HTTP server. Loads + merges the settings hierarchy from §Configuration, validates, and serves the result as `GET /config.json` from the same origin. UI fetches once at boot. Flags: `--cwd <path>`, `--port <num>`, `--host <iface>`, `--config <path>` (single-source override of layers 2–5), `--print-config` (emit the merged settings to stdout and exit, for debugging), `--strict` (warnings become fatal), `--open` (launch the browser).
- **Settings loader** lives in the kernel and is shared across sub-commands: `loadSettings({ cwd, explicitConfigPath?, strict? }) → ISkillMapSettings`. Pure, stateless, fully testable. Same loader used by `sm config get/set/list` and by the dev wrapper that emulates the runtime delivery path under `ng serve`.
- **`spec/runtime-settings.schema.json`**: formalises the UI-side contract. Replaces the manual TS type guards with AJV validation. Decouples the UI bundle version from the CLI bundle version: as long as both adhere to the schema, mixing minor versions across them is safe.
- **No hot reload** in the v1.0 surface. Editing settings requires a restart of `sm ui`. SSE / WebSocket reload is a separate decision, deferred until a real use case appears.
- **Publishing workflow**: GitHub Actions for release automation + changelog generation + conventional commits. **Carry-over from 14.7**: the same workflow wires `npm run validate --workspace=skill-map-e2e` (Playwright + Chromium against the demo bundle in `web/demo/`) into the release pipeline so a regression that activates the live-mode `RestDataSource` under demo never reaches the public site. Chromium install in CI uses Playwright's official action with cache on `~/.cache/ms-playwright/` keyed by the resolved `@playwright/test` version pinned in `e2e/package.json`.
- **Public-site `web/demo/` deploy** (carry-over from 14.7): wire the existing `npm run web:build` (which already chains `npm run demo:build` per Step 14.3) into the release pipeline so the deployed site at `skill-map.dev/demo/` ships the latest demo bundle on every release. The demo bundle already passes through the e2e smoke gate above before publish.
- **Documentation site**: **Astro Starlight** (static, minimal infra, good DX).
- **Plugin API reference**: JSDoc → Starlight auto-generated.
- **LLM-discoverable docs surface** (Decision #89): generate `/llms.txt` and `/llms-full.txt` at the root of `skill-map.dev` following the [llmstxt.org](https://llmstxt.org) standard. The short file lists curated entry points (README, spec contracts, CLI reference, plugin author guide); the full file inlines the same content for one-shot ingestion. Both are emitted by `web/scripts/build-site.js` from authoritative sources (`spec/`, `context/cli-reference.md`, `ROADMAP.md`) so they cannot drift. Once the spec freezes at `v1.0.0`, register the project on [context7](https://context7.com) — it indexes public repos with a usable `llms.txt` and serves them through the `context7` MCP that AI agents already consume. Net effect: any LLM-driven workflow (Claude Code, Cursor, ChatGPT browse, etc.) finds skill-map docs without scraping the schemas. Pre-`v1.0.0` is intentionally too early — the spec is still moving and we'd be teaching context7 a stale shape.
- `mia-marketplace` entry.
- Claude Code plugin wrapper — a skill that invokes `sm` from inside Claude Code (`skill-optimizer` is the canonical dual-surface example: exists as a Claude Code skill AND as a skill-map Action via invocation-template mode).
- Telemetry opt-in.
- Compatibility matrix (kernel ↔ plugin API ↔ spec).
- Breaking-changes / deprecation policy.
- `sm doctor` diagnostics for user installs (verifies the install, reads the merged settings, confirms each hierarchy layer is parseable).
- **Launch polish on `skill-map.dev`**: the domain is live (Railway-deployed Caddy + DNS at Vercel, serving `/spec/v0/**` schemas). The landing source lives in `web/` (editable HTML/CSS/JS, copied into `site/` by `web/scripts/build-site.js`). The build performs (a) i18n via `data-i18n` markers — content rendered once into `/index.html` (en) and `/es/index.html` (es), `web/i18n.json` itself excluded from the build output, (b) per-language `{{CANONICAL_URL}}` substitution, (c) generation of `robots.txt` and `sitemap.xml` (with `xhtml:link hreflang` alternates) at the site root. SEO surface in place: per-language `<title>` + `<meta name="description">`, `<link rel="canonical">`, full Open Graph (title / description / url / image / locale + locale:alternate), Twitter cards (`summary_large_image`, `@crystian` as site/creator), JSON-LD `SoftwareApplication` with translated `description`, `theme-color`, `color-scheme`. The 1200×630 OG image asset (`web/img/og-image.png`) is in place and copied verbatim into the site at build time, so social previews render with the proper card. Step 15 still adds HTTP redirects, Astro Starlight docs, and registration on JSON Schema Store once `v0 → v1` ships.

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

The UI bundle is **agnostic to who serves it** — Step 15 ships `sm ui` as the canonical server, but a third-party host (nginx, S3, Caddy) that places a `config.json` next to `index.html` works identically. Same HTTP contract, zero coupling between the UI and the CLI runtime.

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
| 1 | Target runtime | Node 24+ required (active LTS). **Enforcement**: (a) runtime guard in `bin/sm.js` fails fast with a human message and exit code 2 before any import — guarantees clear UX on Node 20 / 22; (b) `engines.node: ">=24.0"` in `package.json` gives npm an `EBADENGINE` warning (non-blocking unless the user sets `engine-strict=true`); (c) `sm version` and `sm doctor` both report the detected Node; (d) `tsup.target: "node24"` matches the runtime floor at build time. |
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
| 20 | Confidence | 3 levels (high/medium/low). Each Extractor declares explicitly. |
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
| 45 | Default prob-refresh | Provider declares `defaultRefreshAction` per kind (in its `kinds` map). UI "🧠 prob" button submits this. |
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
| 70 | Build order inversion | Step 0c UI prototype before kernel implementation. Flavor A mocked, Flavor B in Step 14. |
| 71 | Live sync protocol | **WebSocket** (bidirectional). REST HTTP for discrete CRUD only. |
| 72 | Frontend framework | **Angular ≥ 21** (standalone components). Locked at Step 0c; `ui/package.json` pins `^21.0.0`. Replaces original SolidJS pick — driven by Foblex Flow being the only Angular-native node-based UI library in the market. Major bumps revisited case-by-case, not automatic. |
| 73 | Node-based UI library | **Foblex Flow** — chosen for card-style nodes with arbitrary HTML, active maintenance, and Angular-native design. Replaces Cytoscape.js (which was dot/graph-oriented, not card-oriented). |
| 74 | Component library | **PrimeNG** for tables, forms, dialogs, menus, overlays. |
| 74a | UI styling | **SCSS scoped per component**. No utility CSS framework (no Tailwind, no PrimeFlex) — PrimeFlex is in maintenance mode, Tailwind overlaps with PrimeNG theming. Utilities come back later only if real friction appears. |
| 74b | UI workspace layout | `ui/` is an npm workspace peer of `spec/` and `src/`. Kernel stays Angular-agnostic; UI imports only typed contracts from `spec/`. No cross-import from `src/` into `ui/` or vice versa. |
| 74c | BFF mandate | Single-port: `sm serve` exposes SPA + REST + WS under one listener. Dev uses Angular dev server with `proxy.conf.json` → Hono for `/api` and `/ws`; prod uses Hono + `serveStatic`. |
| 74d | BFF framework | **Hono**, thin proxy over the kernel. No domain logic, no second DI. NestJS considered and rejected as over-engineered for a single-client BFF. |
| 74e | WebSocket library | Server: official `upgradeWebSocket` from `@hono/node-server@2.x` + canonical `ws@8` (Node WebSocket lib); both share the single Hono listener — single-port mandate. Client: browser-native `WebSocket` or Node 24 global `WebSocket` — no extra dep beyond the server-side `ws`. |
| 74f | UI accessibility baseline | **Audited at Step 14 close, not Step 0c.** The Flavor A prototype carries basic semantics (labels, alt, focus) but does not commit to a WCAG level; its component composition differs enough from Flavor B (full UI) that auditing now is re-work. The baseline target (WCAG 2.1 AA) and the audit tooling (axe-core, keyboard walk) lock when Step 14 ships. |
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
| 85 | Documentation site | **Astro Starlight** at Step 15. |
| 86 | `skill-optimizer` coexistence | Kept as a Claude Code skill AND wrapped as a skill-map Action (invocation-template mode). Dual surface. Canonical example of the dual-mode action pattern. |
| 87 | Domain | `skill-map.dev` — live today (Railway + Caddy, DNS via Vercel). `$id` scheme `https://skill-map.dev/spec/v0/<path>.schema.json`; bumps to `v1` at the first stable release. Landing page + SEO + Starlight docs deferred to Step 15. |
| 88 | ID format family | Base shape `<prefix>-YYYYMMDD-HHMMSS-XXXX` (UTC timestamp + 4 lowercase hex chars), with one optional `<mode>` segment on runs. Prefixes: `d-` jobs (`state_jobs.id`), `e-` execution records (`state_executions.id`), `r-[<mode>-]` runs (`runId` on progress events). Canonical `<mode>` values: `ext` (external Skill claims), `scan` (scan runs), `check` (standalone issue recomputations). Without `<mode>`, `r-YYYYMMDD-HHMMSS-XXXX` denotes the CLI runner's own loop. New `<mode>` values are additive-minor; removing or repurposing one is a major spec bump. Human-readable, sortable, collision-safe for single-writer. |
| 89 | LLM-discoverable docs (`llms.txt` + context7) | Step 15 ships `/llms.txt` (curated index) and `/llms-full.txt` (concatenated full text) at `skill-map.dev`, generated from `spec/`, `context/cli-reference.md`, and `ROADMAP.md` by `web/scripts/build-site.js` so they cannot drift from the source of truth. Format follows [llmstxt.org](https://llmstxt.org). After `v1.0.0` lands, register the public repo on [context7](https://context7.com) so AI agents using the `context7` MCP can pull skill-map docs with a single call. Pre-`v1.0.0` registration is rejected — context7 caches the indexed shape and would freeze a moving spec. The `llms.txt` files themselves can ship earlier (Step 14 / 14 prep) since they regenerate on every build. |

### LLM participation summary

| Steps | LLM usage |
|---|---|
| 0a–9 | **None**. Fully deterministic. Tool works end-to-end without any LLM. |
| 10–11 | **Optional**. Adds semantic intelligence via jobs + summarizers. Graceful offline degradation when no runner available. |
| 12–14 | **Optional**, consumed by Formatters and UI. |
| 15+ (post-v1) | Likely expanded (write-back suggestions, auto-fix). |

**Invariant**: the LLM is **never required**. Users who can't or don't want to use an LLM still get a complete, useful tool through step 9.

### Gaps still open

- **Per-surface frontmatter visibility** — resolves during Step 0c prototype.
- **Remaining tech stack picks** (YAML parser, MD parsing, templating, pretty CLI libs, globbing, diff) — each lands with the step that first requires it (see §Tech picks deferred).
- **`## Stability` sections on prose docs — closed.** Every contract prose doc (`architecture.md`, `cli-contract.md`, `db-schema.md`, `job-events.md`, `job-lifecycle.md`, `plugin-kv-api.md`, `prompt-preamble.md`, `interfaces/security-scanner.md`) now ends with a `## Stability` section per the AGENTS.md rule. The three meta docs (`README.md`, `CHANGELOG.md`, `versioning.md`) are foundation/meta, not contracts — the rule explicitly does not apply. Reviewing every `Stability: experimental` tag remains on the pre-`spec-v1.0.0` freeze pass, but that is a separate audit and not a gap.

### Plugin model

| # | Item | Resolution |
|---|---|---|
| 102 | Plugin kind: **Provider** owns a platform | Reasons: Terraform / Pulumi / Backstage precedent (a "provider" plugin owns a platform's resource types); avoids collision with the hexagonal "adapter" used internally for `RunnerPort.adapter` / `StoragePort.adapter`; Provider's job is to declare its kind catalog, not just classify paths. |
| 103 | Per-kind frontmatter schemas live with the Provider that declares them | Spec keeps only `frontmatter/base.schema.json` (universal). The Claude-specific schemas (`skill` / `agent` / `command` / `hook` / `note`) live in the Claude Provider's own `schemas/` directory and are declared via the Provider's `kinds` map. Future Providers bring their own kind catalogs. Conformance fixtures live with them (Decision #115). |
| 104 | No `Audit` kind (composition is explicit) | A composer-and-reporter mega-kind would have dual personality. The kernel's reporter use case (`validate-all`) is just a Rule. Users compose Rules + Actions explicitly via CLI flags or simple scripts. |
| 105 | Custom field UX is three-tier; no schema-extender kind | Tier 0: `additionalProperties: true` (already in base). Tier 1: built-in `unknown-field` Rule emits warnings. Tier 2: `project-config.json` `"strict": true` promotes warnings to errors (CI-blocking). The model already exists implicitly; A.4 only adds an explicit consolidated section in `plugin-author-guide.md`. No seventh "schema-extender" kind. |
| 106 | Plugin id is globally unique; directory name MUST equal id | The plugin's directory name MUST match its manifest `id` (else `invalid-manifest`). Cross-root collisions (project vs global, or built-in vs user-installed) yield a new status `id-collision` for both involved plugins (no precedence magic — user resolves by renaming). The id is the namespace for tables, registry, dispatch. The plugin status set grows from five to six (`loaded`, `disabled`, `incompatible-spec`, `invalid-manifest`, `load-error`, `id-collision`). |
| 107 | Extension ids qualified `<plugin-id>/<ext-id>` | Registry keys all extensions by the qualified id per kind. Cross-extension references (`defaultRefreshAction`, CLI flags, dispatch identifiers) use the qualified form. ESLint pattern. Built-ins also qualify. |
| 108 | Plugin kind: **Extractor**, with three persistence channels | Three persistence APIs exposed in `ctx`: `emitLink` (kernel `links` table), `enrichNode` (kernel enrichment layer, see #109), `store.write` (plugin's own `plugin_<id>_*` table). Plugin chooses which channels to use; no `type` field; plugin id is the natural namespace for custom-storage data. Dual-mode (det / prob). The Extractor kind absorbs what would otherwise be a separate "Enricher" kind. |
| 109 | Enrichment is a universal separate layer; frontmatter is immutable | All `enrichNode` outputs — det and prob alike — live in a layer separate from the author's `frontmatter`. The author's content is **never overwritten** from any Extractor. Stale tracking via `body_hash_at_enrichment_time` applies to prob enrichments only (det regenerates via the cache, #110). Stale records are excluded from automation by default and shown to humans with a marker. Refresh via `sm refresh --stale` (batch) or `sm refresh <node>` (granular). |
| 110 | Fine-grained Extractor scan cache: `scan_extractor_runs` | New table `scan_extractor_runs(node_path, extractor_id, body_hash_at_run, ran_at)`. Cache hit only when, for every currently-registered Extractor, a matching row exists. Adding an Extractor runs only the new one on cached nodes; removing one cleans only its outputs. Critical for prob (LLM cost) and for stable behavior across plugin changes. |
| 111 | Optional `applicableKinds` filter on Extractor manifest | `applicableKinds: ['skill', 'agent']` declares which kinds the Extractor applies to. Default absent = applies to all kinds (forgetting the field doesn't break the plugin). Kernel filters fail-fast before invoking `extract()`. Unknown kind in the list emits a warning in `sm plugins doctor` (not blocking — kind may appear when its Provider is installed). |
| 112 | Optional `outputSchema` for plugin custom storage writes | Plugin manifest declares a JSON Schema per `dedicated` table or per KV namespace. Kernel AJV-validates every `store.write` (or `store.set`) against the schema; throws on violation. Default absent = permissive. `emitLink` and `enrichNode` keep their kernel-managed universal validation regardless. |
| 113 | Plugin kind: **Formatter** serializes the graph | Aligns with industry tooling (ESLint formatter, Mocha reporter, Pandoc writer). Contract: `format(ctx) → string`. Deterministic-only. |
| 114 | Plugin kind: **Hook** added (sixth kind) | Hook reacts to a curated set of 8 lifecycle events: `scan.started`, `scan.completed`, `extractor.completed`, `rule.completed`, `action.completed`, `job.spawning`, `job.completed`, `job.failed`. Other lifecycle events (`scan.progress` per-node, `model.delta`, `run.reap.*`, `job.claimed`, `job.callback.received`, `run.started`, `run.summary`) are deliberately not hookable — too verbose, too internal, or already covered. Manifest declares `triggers[]` (validated against the hookable set) and optional `filter` (cross-field validated against trigger payloads). Dual-mode. The kind enables Slack / notification / integration plugins and future cascades. The UI's WebSocket update path remains kernel-internal (`ProgressEmitterPort` → Server → `/ws`); no Hook required for that path. |
| 115 | Conformance fixture relocation | Spec `/conformance/` keeps only kernel-agnostic cases (boot invariant, link / issue / scan-result shape, preamble verbatim, atomic-claim race, etc.). Claude-specific fixtures (`minimal-claude`, `orphan-*`, `rename-high-*`) and the cases that depend on them (`basic-scan`, `orphan-detection`, `rename-high`) move to `src/extensions/providers/claude/conformance/`. Each Provider gains responsibility for its own conformance suite. New verb `sm conformance run [--scope spec\|provider:<id>\|all]`. CI runs spec + every built-in Provider's suite. |
| 116 | `sm check --include-prob` opt-in flag | Default `sm check` runs only det Rules (CI-safe, status quo unchanged). The flag dispatches prob Rules as jobs and awaits synchronously by default; `--async` returns job ids without waiting. Combines with `--rules <ids>` and `-n <node>` for granularity. Output marker (`(prob)` or icon) on prob issues. Does not extend to `sm scan` (prob never runs in scan) or `sm list` (no use case yet). |
| 117 | Six post-1.0 deferrals | (a) Cross-plugin queries / generic table access — single mechanism covers CLI, UI, and cross-plugin reads; (b) Storage as pluggable driven adapter (Postgres alongside SQLite, etc.); (c) Runner as pluggable driven adapter (Claude CLI / OpenAI / Anthropic API direct / mock); (d) Per-extension runner override; (e) `storage.mode: 'external'` for plugins managing their own infra (Pinecone, Redis, vector DBs); (f) Plug-in boundaries review for the soft `enrichNode` vs `store.write` rule. All deferred to let real ecosystem usage inform the design. |

### Web UI strategy

| # | Item | Resolution |
|---|---|---|
| 118 | **Step 14 promoted ahead of wave 2** | Step 14 (Web UI) executes immediately after v0.5.0 and ships v0.6.0 (deterministic kernel + CLI + Web UI). Wave 2 (Steps 10–11) resumes after v0.6.0 and ships v0.8.0 (LLM optional layer). Step 10 Phase 0 (`IAction` runtime contract) already landed; Phases A–G stay paused in the kernel. Steps keep their stable numbers (commits / changesets cite by number, not order). Rationale: validating the deterministic kernel end-to-end against a real UI before adding LLM cost / probabilistic surfaces de-risks the larger investment and gives the project a publishable demo (see #119) for the public site. |
| 119 | **Loopback-only `sm serve` through v0.6.0; multi-host + auth deferred** | `sm serve` defaults to `127.0.0.1`; non-loopback `--host` rejected when combined with `--dev-cors`. WS has no per-connection auth through 14.x — loopback is the implicit guarantee. Multi-host serve (executive dashboards, public deployments, IP / domain-based hosting) plus the auth model needed to support it (probably reusing the `sm record` nonce shape) re-opens post-v0.6.0 as a separate decision. The `--host` flag plumbing is in place at 14.1 but documented as development-only. |
| 120 | **MD body renderer: `markdown-it` + DOMPurify** | Picked at 14.3 over `marked` (deprecated sanitizer, ships unsafe by default) and `remark` + `rehype` (9–12 transitive deps would push the bundle past the 500 KB warning budget). `markdown-it@14.x` is one dep + DOMPurify (~80 KB minified gzipped together), GFM via plugins, documented sanitizer pipeline (`html: false` + DOMPurify on output), active maintenance. Pinned exact per AGENTS.md dep rule. Closes the open pick from §1701. |
| 121 | **`sm serve` watcher persists each batch (Decision pinned)** | When the chokidar watcher (Step 7.1) feeds the WS broadcaster at 14.4, each debounced batch runs `runScanWithRenames` + `persistScanResult` on the server's DB — same behavior as `sm watch`. Read-only watcher rejected: a server with stale DB while a sibling `sm` writes is a footgun (other clients see divergent state, the demo dataset would never refresh in long-running deployments, two pipelines diverge silently). One server, one DB, one pipeline. |
| 122 | **Demo mode is a first-class output of the build** | The Angular bundle ships under `web/demo/` for the public site, runs without backend, reads precomputed JSON. Mode discriminator: build-time `<meta name="skill-map-mode" content="live|demo">` over runtime probe (visible flash, dual UX) and dual `ng build` configurations (artifact duplication). One Angular bundle, one switched `<meta>`. Demo dataset generated by `web/scripts/build-demo-dataset.js` running `sm scan --json` over `fixtures/demo-scope/`; pre-derived per-endpoint envelopes ship alongside the full ScanResult so the StaticDataSource never re-implements `applyExportQuery` in the browser. `<base href="/demo/">` hardcoded; configurability deferred until a second deployment forces it. |
| 123 | **Bare `sm` defaults to `sm serve`, not help** | Bare invocation (`sm` with no arguments) starts the Web UI server when a `.skill-map/` project exists in the cwd; when no project is found, prints a one-line hint pointing to `sm init` / `sm --help` on stderr and exits with code 2. `sm --help` and `sm -h` continue to print top-level help. Rationale: the daily-use path for users (open the UI on the current project) deserves the shortest invocation; help is an introspection action best gated behind an explicit flag. Implemented by intercepting empty argv in `entry.ts` (no Clipanion `Command.Default` on `RootHelpCommand` anymore). Spec and `cli-contract.md §Binary` updated; conformance suite unaffected (no case asserted bare-sm = help). |

---

## Deferred beyond v1.0

- **Step 16+ — Write-back**. Edit / create / refactor from UI. Git-based undo. Detectors become bidirectional.
- **Step 17+ — Test harness**. Dry-run / real execution / subprocess — scope TBD.
- **Step 18+ — Richer workflows**. Node-pipe API, JSON declarative workflows, visual DAG.
- **Step 19+ — Additional lenses**. Docs-site, additional providers.
- **Step 20+ — URL liveness plugin**. Network HEAD checks, `broken-external-ref` rule.
- **Step 21+ — Schema v2 + migration tooling**. When breaking changes on the JSON output become necessary.
- **Step 22+ — Density / token-economy plugin**. Drop-in bundle that closes the loop between *identifying* token-heavy nodes and *recovering* the value. Ships a deterministic Rule `oversized-node` (threshold on `scan_nodes.tokens_total`, per-kind configurable via plugin KV) plus cheap-filter proxies for information density — Shannon entropy over tokens, or a gzip-ratio substitute for a coarser signal. Summarizers emit a probabilistic finding `low-information-density` when they detect repetition without added signal. A Hook on `rule.completed` (filtered to the `oversized-node` Rule) walks the flagged candidates and pipes them into `skill-optimizer` (Decision #86, canonical dual-surface Action) via `sm job submit`. Cheap-filter + expensive-verifier: deterministic proxies pre-filter for free, the LLM summarizer confirms before committing tokens. Exactly the drop-in story the plugin architecture was designed to support — zero kernel changes, pure composition of Rule + Finding + Hook + Action.
- **Step 23+ — Built-in graph formatters: Mermaid + DOT + JSON**. Today only `ascii` ships in `src/built-in-plugins/formatters/`. The public site copy (`pe.formatter.brief` in `web/i18n.json`) advertises Mermaid (for READMEs), DOT (for Graphviz), and JSON (for pipelines) as common targets — those are the next built-in Formatter plugins to land so the site copy reflects shipped reality. Pure deterministic. No spec change required — Formatter is already a stable extension kind.
- **npm + other registry enrichment plugins**. When registries publish documented APIs.
- **ETag / conditional GET** for GitHub enrichment. Bandwidth optimization.
- **Governance / RFC process**. When external contributors appear.
- **Claude Code hook auto-record**. A PostToolUse hook that auto-calls `sm record` after an action completes. Partial coverage already via the Skill agent; full auto-record hook deferred.
- **Adversarial testing suite** for prompt injection. Fixtures with known payloads.
- **Parallel job execution**. Event schema already supports demuxing by id.
- **Multi-turn conversational jobs in DB**. If a strong case appears.
- **Plugin signing / hash verification**. Post v1.0 distribution hardening.
- **Telemetry (opt-in)**. Know which Extractors / Actions are used in the wild.
- **`.ts` migrations** (escape hatch for SQL-impossible data transforms).
- **`sm graph --root <node-path>` (focused subgraph render)**. Today `sm graph` always renders the whole collection through the chosen formatter; on large scopes the user has no way to focus on "what does THIS node connect to". Surface a `--root` flag that scopes the render to the transitive closure (in + out edges) of the named node, with `--depth N` to bound the walk. Useful for inspector-style flows from the CLI without round-tripping through `sm export`.
- **`sm conformance run --format json` (machine-readable conformance output)**. Today the runner prints a human summary; CI pipelines that want to gate on per-case results have to parse the prose. Add `--format json` returning `{ scope, cases: [{ id, status, durationMs, message? }], totals }`, mirroring the JSON shape of `sm version` / `/api/health`.

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
