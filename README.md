[![lang: EN](https://img.shields.io/badge/lang-English-blue)](./README.md)
[![lang: ES](https://img.shields.io/badge/lang-Espa%C3%B1ol-lightgrey)](./README.es.md)

# skill-map

[![npm](https://img.shields.io/npm/v/@skill-map/spec?color=cb3837&logo=npm&label=%40skill-map%2Fspec)](https://www.npmjs.com/package/@skill-map/spec)
[![spec](https://img.shields.io/badge/spec-v0.12.0-8A2BE2)](./spec/)
[![impl](https://img.shields.io/badge/impl-v0.10.0-5D3FD3)](./src/)
[![JSON Schema](https://img.shields.io/badge/JSON_Schema-2020--12-005571?logo=json)](https://json-schema.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/crystian/skill-map/ci.yml?branch=main&logo=github&label=CI)](https://github.com/crystian/skill-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Angular](https://img.shields.io/badge/Angular-21-DD0031?logo=angular&logoColor=white)](https://angular.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

> Map, inspect, and manage collections of interconnected Markdown files — especially skills, agents, commands, hooks, and notes that compose AI-agent ecosystems.

**Status**: Steps **0a–9 are complete** (spec, kernel, plugin loader, full CLI surface, plugin author UX). **Step 14 — Full Web UI** is in progress: sub-steps 14.1 (Hono BFF skeleton), 14.2 (REST read-side endpoints), 14.3 (live + demo modes), and 14.4 (WebSocket broadcaster + reactive UI) have shipped; 14.5–14.7 (polish + bundle budgets + responsive scope) still pending. Ships **v0.6.0 — deterministic kernel + CLI + Web UI** (per Decision #118). Wave 2 (job subsystem + probabilistic extensions) resumes after Step 14 closes and ships v0.8.0. The `@skill-map/spec` and `@skill-map/cli` npm packages are live (versions tracked in `spec/package.json` and `src/package.json`); `@skill-map/testkit` joined as the third public package. See [ROADMAP.md](./ROADMAP.md) for the completeness marker and full execution plan.

## In a sentence

A graph explorer for Markdown-based AI-agent ecosystems (Claude Code, Codex, Gemini, Copilot, and others). It detects cross-file references, trigger collisions, orphans, external dependencies, and token/byte weight. CLI-first, fully deterministic offline, with an optional LLM layer for semantic analysis.

## The problem it solves

Developers working with AI agents accumulate dozens of skills, agents, commands, and loose documents. Nobody has visibility into:

- What exists and where it lives.
- Who invokes whom (dependencies, cross-references).
- Which triggers overlap or step on each other.
- What is alive vs obsolete.
- What can be deleted without breaking anything.
- When each skill was last optimized or validated.

No official tool (Anthropic, Cursor, GitHub, skills.sh) covers this. Obsidian offers note management but does not semantically understand that a file is an executable skill. `skill-map` fills that gap.

## Who it's for

- Advanced users of Claude Code (or other agents) who maintain several plugins / skills of their own.
- Teams that share skill collections and need auditing.
- Plugin / action authors who want to test and validate their work.
- Developers who want to build tooling on top of the graph (via CLI, JSON, or plugins).

## How it works (high level)

1. **Deterministic scanner** walks files, parses frontmatter, detects references, and emits structured graph data (nodes, links, issues).
2. **Optional LLM layer** consumes that data and adds semantic intelligence: validates ambiguous references, clusters equivalent triggers, compares nodes, answers questions.
3. **`sm` CLI** exposes every operation. It is the primary surface.
4. **Web UI** — an Angular SPA bundled with the CLI and launched via **`sm serve`** (default `http://127.0.0.1:4242`, loopback-only). It consumes the same kernel through a Hono BFF (REST read-side endpoints + a WebSocket `/ws` channel for live scan events) and offers graph navigation, list view, inspector, and a live event log. A standalone demo bundle with mocked data ships at **`skill-map.dev/demo/`** so anyone can try the UI in-browser without installing the CLI.
5. **Plugin system** (drop-in, kernel + extensions) lets third parties add Providers, Extractors, Rules, Actions, Formatters, or Hooks without touching the kernel.

## Two execution modes — the meta-architecture

Most plugin systems pick a side: ESLint and Prettier are deterministic-only; LangChain agents are probabilistic-only. **skill-map is both, on the same plugin model.**

Every analytical extension declares one of two modes:

- **`deterministic`** — pure code. Same input → same output, every run. Fast, free, reproducible. Runs synchronously inside `sm scan` / `sm check`. CI-safe.
- **`probabilistic`** — invokes an LLM through the kernel's `RunnerPort`. Output may vary. Cost and latency are non-trivial. Runs only as a queued job (`sm job submit <kind>:<id>`), never during scan.

Four of the six extension kinds support both modes (Extractor, Rule, Action, Hook). The remaining two are deterministic-only (Provider, Formatter) because they sit at the boundaries — filesystem-to-graph and graph-to-string — where reproducibility is essential.

This is what unlocks the workflow:

- **Pre-commit / CI** runs deterministic extensions only. Milliseconds per check, no network, no LLM cost.
- **Nightly / on-demand** runs probabilistic extensions through the queue. Same scan snapshot, deeper analysis, costs proportional to demand.
- **The community** can publish a deterministic Extractor today and a probabilistic counterpart tomorrow without redesigning anything. Same `ctx`, same registry, same loader.

The full normative contract lives in [`spec/architecture.md`](./spec/architecture.md) §Execution modes.

## Philosophy

- **CLI-first** — everything the UI does is reachable from the command line.
- **Deterministic by default** — the LLM is optional, never required. The product works offline.
- **Kernel-first from commit 1** — the core contains no platform knowledge or specific Providers. Everything lives as an extension.
- **Hexagonal architecture** (ports & adapters) — the kernel is pure; the adapters (CLI, Server, Skill, SQLite, FS, Plugins, Runner) are swappable.
- **Tests from commit 1** — full pyramid (contract, unit, integration, self-scan, CLI, snapshot). Every extension ships with its test or does not boot.
- **Platform-agnostic** — the first adapter is Claude Code, but the architecture supports any MD ecosystem.
- **Distributable** — semantic versioning, docs, plugin security, marketplace — designed for external users, not only the author.
- **Public standard** — the spec (JSON Schemas + conformance suite + contracts) lives in `spec/`. Anyone can build an alternative UI, an implementation in another language, or complementary tooling consuming only the spec.
- **`sm` never touches an LLM** — the binary is pure template rendering + DB + filesystem. The LLM lives in the external runner process.

## Differences from Obsidian (closest competitor)

Obsidian maps notes, not executables. `skill-map`:

1. Understands skills / agents as **actionable units** (executables with inputs, outputs, tools, triggers).
2. **CLI-first and headless** — runs in CI, pipelines, shell scripts. Obsidian is GUI-first.
3. **AI-semantic layer** integrated into the core (summarizers, probabilistic verbs), not a third-party plugin.
4. **Executable actions** — run actions over a selected node (optimize, validate, compare) via jobs.
5. **Official testkit** for plugin authors — something Obsidian does not have.

Positioning framing: *"Obsidian for AI agents, not for notes"*. The other candidate features (DataView, Templater, Graph View with filters) are already covered by Obsidian plugins — we do not compete there.

## Glossary (essentials)

Full vocabulary in [ROADMAP §Glossary](./ROADMAP.md#glossary).

- **Node** — a Markdown file the scanner tracks (skill, agent, command, hook, note); identified by path relative to the scope root.
- **Link** — a directed relation between two nodes (`invokes` / `references` / `mentions` / `supersedes`).
- **Issue** — deterministic problem emitted by a rule.
- **Finding** — probabilistic analysis output (injection detection, low confidence, stale summary).
- **Extension kinds** (six, stable) — **Provider** (platform recognizer), **Extractor** (link extractor), **Rule** (issue producer), **Action** (executable operation), **Formatter** (graph serializer), **Hook** (lifecycle reactor).
- **Kernel** — pure domain core; imports no platform knowledge.
- **Port** — interface the kernel declares (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`).
- **Job** — runtime instance of an Action over one or more nodes; lives in `state_jobs`.
- **Plugin** — drop-in bundle registering extensions at `<scope>/.skill-map/plugins/<id>/`.
- **Scope** — `project` (default, scans the current repo; DB at `./.skill-map/skill-map.db`) or `global` (opt-in via `-g`; DB at `~/.skill-map/skill-map.db`).

## Specification

The specification lives in [`spec/`](./spec/) and is the source of truth. It is separated from the reference implementation from day zero so third parties can build alternative implementations using only `spec/`.

- Canonical URL: **[skill-map.dev](https://skill-map.dev)** (schemas served at `https://skill-map.dev/spec/v0/<path>.schema.json`).
- npm package: [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec) (live; version tracked in `spec/package.json` and `spec/CHANGELOG.md`).
- Contents:
  - 29 JSON Schemas (draft 2020-12): 11 top-level (`node`, `link`, `issue`, `scan-result`, `execution-record`, `project-config`, `plugins-registry`, `job`, `report-base`, `conformance-case`, `history-stats`) + 7 extension schemas (`base` + one per extension kind) + 6 frontmatter (`base` + 5 node kinds) + 5 summaries.
  - 7 prose contracts: `architecture`, `cli-contract`, `job-lifecycle`, `job-events`, `prompt-preamble`, `db-schema`, `plugin-kv-api`.
  - 1 interface: `security-scanner` (convention over the Action kind, not a 7th extension kind).
  - Conformance suite: fixtures (`minimal-claude`, `preamble-v1.txt`) + 2 cases (`basic-scan`, `kernel-empty-boot`); `preamble-bitwise-match` deferred to Step 10.

## Repo layout

```
skill-map/                     npm workspaces root (private)
├── spec/                      specification — published as @skill-map/spec
├── src/                       reference implementation — published as skill-map (bins: sm, skill-map)
├── scripts/                   build-site.js · build-spec-index.js · check-changeset.js · check-coverage.js
├── site/                      generated public site output (served by Caddy on Railway)
├── .changeset/                changesets config + pending release notes (one file per change)
├── .github/workflows/         ci.yml (spec validate + build-test) · release.yml
├── Dockerfile                 Caddy-based image deployed to Railway
├── Caddyfile                  serves schemas at the canonical URLs
├── AGENTS.md                  agent conventions + current bootstrap status
├── CLAUDE.md                  persona activation (pointer to AGENTS.md)
├── CONTRIBUTING.md            PR workflow + changeset rules
├── README.md                  this file (English landing)
├── README.es.md               Spanish mirror of this file
└── ROADMAP.md                 design narrative (decisions, phases, deferred)
```

The `ui/` workspace ships the Angular SPA (Foblex Flow for the graph view + PrimeNG components). It is bundled into `@skill-map/cli` and served by `sm serve` via a Hono BFF; `@skill-map/testkit` joined as a third published peer of `spec` and `src`.

## Links

- Full design and roadmap: [ROADMAP.md](./ROADMAP.md)
- Full glossary: [ROADMAP §Glossary](./ROADMAP.md#glossary)
- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Agent operating manual: [AGENTS.md](./AGENTS.md)
- Spec overview: [spec/README.md](./spec/README.md)
- Spec changelog: [spec/CHANGELOG.md](./spec/CHANGELOG.md) (versioned independently)
- Spec versioning policy: [spec/versioning.md](./spec/versioning.md)
- Architecture (ports & adapters): [spec/architecture.md](./spec/architecture.md)
- CLI contract: [spec/cli-contract.md](./spec/cli-contract.md)
- CLI reference (auto-generated): [context/cli-reference.md](./context/cli-reference.md)
- Foblex Flow operating guide: [.claude/skills/foblex-flow/SKILL.md](./.claude/skills/foblex-flow/SKILL.md) — rules, patterns, full API reference. Invoke via `/foblex-flow` when working on the graph view.
- Reference implementation: [src/README.md](./src/README.md)
- Spanish version of this README: [README.es.md](./README.es.md)
- License: [MIT](./LICENSE)

## Star history

[![Star History Chart](https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left)](https://www.star-history.com/?repos=crystian%2Fskill-map&type=timeline&legend=top-left)

## License

MIT © Crystian
