[![lang: EN](https://img.shields.io/badge/lang-English-blue)](./README.md)
[![lang: ES](https://img.shields.io/badge/lang-Espa%C3%B1ol-lightgrey)](./README.es.md)

# skill-map

> A graph explorer for the Markdown files that drive your AI agents.

[![npm](https://img.shields.io/npm/v/@skill-map/spec?color=cb3837&logo=npm&label=%40skill-map%2Fspec)](https://www.npmjs.com/package/@skill-map/spec)
[![CI](https://img.shields.io/github/actions/workflow/status/crystian/skill-map/ci.yml?branch=main&logo=github&label=CI)](https://github.com/crystian/skill-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

## In a sentence

From chaotic ecosystem to predictable agents — a graph explorer for Markdown-based AI-agent ecosystems (Claude Code, Codex, Gemini, Copilot, and others). Detects collisions, orphans, semantic duplicates, and bloated skills on a single graph, with static and optional semantic (LLM) analysis.

![skill-map UI](https://skill-map.dev/img/screenshot-1.png)

## The problem it solves

Developers working with AI agents accumulate dozens of skills, agents, commands, and loose documents. Nobody has visibility into:

- How much each Markdown file costs in tokens — invisible until you measure it, expensive at scale.
- What exists and where it lives.
- Who invokes whom (dependencies, cross-references).
- Which triggers overlap or step on each other.
- What is alive vs obsolete.
- What can be deleted without breaking anything.
- When each skill was last optimized or validated.

No official tool (Anthropic, Cursor, GitHub, skills.sh) covers this. `skill-map` fills that gap.

## Who it's for

- **Teams and platform architects** — multiple projects, multiple agents, divergent copies of the same skill. One scan puts the whole hive in the same graph.
- **Authors** — skill, agent, or command creators who want to spot duplicates, redundancies, and optimization opportunities before publishing.
- **Agent debuggers** — when the agent picked the wrong invocation, follow the path from the trigger phrase to the skill that won the match, in real time.
- **Tool builders** — anyone wiring CLI, JSON output, or plugins on top of the graph.

## How it works (high level)

1. **Deterministic scanner** walks files, parses frontmatter, detects references, and emits structured graph data (nodes, links, issues).
2. **Optional LLM layer** consumes that data and adds semantic intelligence: validates ambiguous references, clusters equivalent triggers, compares nodes, answers questions.
3. **`sm` CLI** is the primary surface — every operation reachable from the command line. Bare `sm` opens the Web UI directly.
4. **Web UI** — bundled with the CLI, launched in one command. The graph updates live as you edit any `.md` file. A standalone [demo](https://skill-map.dev/demo/) runs in-browser without installing anything.
5. **Plugin system** (drop-in, kernel + extensions) lets third parties add Providers, Extractors, Rules, Actions, Formatters, or Hooks without touching the kernel.

## Two execution modes

Every analytical extension declares one of two modes: **`deterministic`** (pure code, fast, free, runs inside `sm scan` / `sm check`, CI-safe) or **`probabilistic`** (calls an LLM through the kernel, runs as a queued job — never during scan). Same plugin model, two cost profiles. Run deterministic in pre-commit; let probabilistic catch up on-demand or nightly.

Full contract: [`spec/architecture.md`](./spec/architecture.md) §Execution modes.

## Philosophy

- **CLI-first** — everything the UI does is reachable from the command line.
- **Deterministic by default** — the LLM is optional, never required. The product works offline.
- **Public standard** — the spec (JSON Schemas + conformance suite + contracts) lives in `spec/`. Anyone can build an alternative UI, an implementation in another language, or complementary tooling consuming only the spec.
- **Platform-agnostic** — the first adapter is Claude Code, but the architecture supports any MD ecosystem.

Architecture details (hexagonal kernel, ports & adapters) live in [`spec/architecture.md`](./spec/architecture.md).

## Quick start

```bash
npm i -g @skill-map/cli
cd your/project
sm init
sm
```

That last `sm` opens the Web UI on `http://127.0.0.1:4242` with the watcher running. Edit any `.md` file in the project and the graph updates live in your browser.

Want to try it without installing? Open the [live demo](https://skill-map.dev/demo/).

## Interactive tutorial (recommended)

If you use [Claude Code](https://claude.ai/code), the fastest way to evaluate skill-map is the bundled interactive tutorial — about **7 minutes** for the demo, with an optional 30-min deep dive afterwards.

```bash
mkdir try-skill-map && cd try-skill-map
sm tutorial             # writes sm-tutorial.md into the empty dir
claude                  # open Claude Code in the same dir
# Then, in the Claude prompt:
run @sm-tutorial.md
```

Claude takes over from there: drops a fixture, walks you through `sm init`, opens the Web UI, edits files in front of your eyes, and shows the watcher reacting live (including how `.skillmapignore` hides files in real time). You see the full flow before pointing it at your real project — no commitment, fully reversible.

## Glossary

- **Node** — a Markdown file the scanner tracks (skill, agent, command, hook, note).
- **Link** — a directed relation between two nodes (`invokes` / `references` / `mentions` / `supersedes`).
- **Issue** — a deterministic problem emitted by a rule (broken link, trigger collision, orphan).
- **Plugin** — drop-in bundle that adds extensions without touching the kernel.

Full vocabulary in [ROADMAP §Glossary](./ROADMAP.md#glossary).

## Specification

The spec is the source of truth and lives in [`spec/`](./spec/) — separated from the reference implementation since day zero, so third parties can build alternative implementations using only `spec/`.

- Canonical URL: **[skill-map.dev](https://skill-map.dev)** (schemas at `https://skill-map.dev/spec/v0/<path>.schema.json`).
- npm package: [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec).
- Contents: JSON Schemas (draft 2020-12) + prose contracts + conformance suite. Full inventory in [`spec/README.md`](./spec/README.md).

## Repo layout

```
skill-map/                     npm workspaces root (private)
├── spec/                      specification — published as @skill-map/spec
├── src/                       reference implementation — published as @skill-map/cli (bins: sm, skill-map)
├── ui/                        Angular SPA (graph, list, inspector) — bundled into @skill-map/cli
├── web/                       public site (skill-map.dev) — hosts the demo bundle
├── scripts/                   build & validation scripts (spec index, CLI reference, demo dataset, …)
├── ...
├── AGENTS.md                  agent operating manual
└── ROADMAP.md                 design narrative (decisions, phases, deferred)
```

## Links

- Website: [skill-map.dev](https://skill-map.dev/)
- Full design and roadmap: [ROADMAP.md](./ROADMAP.md)
- Full glossary: [ROADMAP §Glossary](./ROADMAP.md#glossary)
- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Spec overview: [spec/README.md](./spec/README.md)
- Architecture (ports & adapters): [spec/architecture.md](./spec/architecture.md)
- CLI contract: [spec/cli-contract.md](./spec/cli-contract.md)
- CLI reference (auto-generated): [context/cli-reference.md](./context/cli-reference.md)
- Reference implementation: [src/README.md](./src/README.md)
- Spanish version of this README: [README.es.md](./README.es.md)
- License: [MIT](./LICENSE)

## Acknowledgements

The graph view that gives skill-map its identity is built on [**Foblex Flow**](https://flow.foblex.com) — an excellent Angular flow library that handles nodes, connectors, pan, and zoom. Huge thanks to the Foblex team.

Also standing on the shoulders of [Angular](https://angular.dev), [PrimeNG](https://primeng.org), [Hono](https://hono.dev), and [Kysely](https://kysely.dev).

## Star history

[![Star History Chart](https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left)](https://www.star-history.com/?repos=crystian%2Fskill-map&type=timeline&legend=top-left)

---

Made with ❤️&nbsp; by [Crystian](https://github.com/crystian/) · [LinkedIn](https://www.linkedin.com/in/crystian/)
