[![lang: EN](https://img.shields.io/badge/lang-English-blue)](./README.md)
[![lang: ES](https://img.shields.io/badge/lang-Espa%C3%B1ol-lightgrey)](./README.es.md)

# skill-map

[![npm](https://img.shields.io/npm/v/@skill-map/spec?color=cb3837&logo=npm&label=%40skill-map%2Fspec)](https://www.npmjs.com/package/@skill-map/spec)
[![spec](https://img.shields.io/badge/spec-v0.4.0-8A2BE2)](./spec/)
[![impl](https://img.shields.io/badge/impl-v0.2.0-5D3FD3)](./src/)
[![JSON Schema](https://img.shields.io/badge/JSON_Schema-2020--12-005571?logo=json)](https://json-schema.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/crystian/skill-map/ci.yml?branch=main&logo=github&label=CI)](https://github.com/crystian/skill-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Angular](https://img.shields.io/badge/Angular-21-DD0031?logo=angular&logoColor=white)](https://angular.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

> Map, inspect, and manage collections of interconnected Markdown files — especially skills, agents, commands, hooks, and notes that compose AI-agent ecosystems.

**Status**: Steps **0a** (spec bootstrap) and **0b** (reference-implementation bootstrap) are **complete**. The `@skill-map/spec` npm package is live (version tracked in [`spec/package.json`](./spec/package.json) and [`spec/CHANGELOG.md`](./spec/CHANGELOG.md)); the `skill-map` CLI ships a stub scan verb and boots cleanly. Next up: **Step 0c — UI prototype**. See [ROADMAP.md](./ROADMAP.md) for the completeness marker and full execution plan.

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
4. **Web UI** (prototype in Step 0c with mocked data; full integration at `v1.0`) consumes the same kernel and offers visual navigation, inspector, and execution. The prototype does **not** ship in `v0.5.0`.
5. **Plugin system** (drop-in, kernel + extensions) lets third parties add detectors, rules, actions, adapters, or renderers without touching the kernel.

## Philosophy

- **CLI-first** — everything the UI does is reachable from the command line.
- **Deterministic by default** — the LLM is optional, never required. The product works offline.
- **Kernel-first from commit 1** — the core contains no platform knowledge or specific detectors. Everything lives as an extension.
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
- **Extension kinds** (six, stable) — **Adapter** (platform recognizer), **Detector** (link extractor), **Rule** (issue producer), **Action** (executable operation), **Audit** (deterministic workflow), **Renderer** (graph serializer).
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
├── scripts/                   build-site.mjs · build-spec-index.mjs · check-changeset.mjs · check-coverage.mjs
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

The `ui/` workspace joins as a third peer at Step 0c (Angular SPA + Foblex Flow + PrimeNG).

## Links

- Full design and roadmap: [ROADMAP.md](./ROADMAP.md)
- Full glossary: [ROADMAP §Glossary](./ROADMAP.md#glossary)
- Spec surface and maintenance rules: [AGENTS.md](./AGENTS.md) (section "Spec bootstrap status")
- Spec changelog: [spec/CHANGELOG.md](./spec/CHANGELOG.md) (versioned independently from this repo)
- Spanish version of this README: [README.es.md](./README.es.md)
- License: [MIT](./LICENSE)

## License

MIT © Crystian
