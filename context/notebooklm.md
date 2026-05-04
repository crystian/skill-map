# Skill-Map — Notebook LM Markdown

> Source document for Notebook LM: contains the definition, functional scope, project status, and extension architecture of **skill-map**, ready to be turned into a podcast episode.

---

## What is skill-map?

Skill-map is a **visual graph explorer** for your collection of Markdown files — the *skills*, *agents*, *commands*, *hooks*, and notes that make up an AI agent ecosystem (Claude Code, Codex, Gemini, Copilot, and others). It's CLI-first, fully offline, and can optionally consult an LLM when you want semantic analysis.

The core idea is simple. When you work with AI agents you end up accumulating dozens — sometimes hundreds — of Markdown files that invoke each other. At some point, **nobody has visibility into what references what, what overlaps, what got orphaned, or how many tokens you're spending on each one**. Skill-map turns that mess into a navigable graph: you open it in the browser, see the full network, and understand in seconds what used to take hours of blindly reading folders.

If you had to sum it up in one phrase: *"From chaotic ecosystem to predictable agents."*

---

## The map is the heart of the product

The visualization isn't an add-on — it's the main proposition. Skill-map renders your collection as an **interactive map in the browser**:

- **Nodes colored by type** (skill, agent, command, hook, note) so the brain can tell them apart without reading.
- **Connections differentiated by relationship**: `invokes` (one skill calls another), `references` (cited by name), `mentions` (appears in the body), `supersedes` (this replaces that).
- **Automatic layout** with Dagre, smooth pan and zoom thanks to Foblex Flow.
- **Expandable cards** inside each node: you see the frontmatter, the stats (bytes, tokens, incoming and outgoing links), a body preview, and the open issues without leaving the graph.

Skill-map gives you **three views** over the same dataset:

1. **List** — filterable, sortable table, ideal when you're looking for something specific by name.
2. **Graph** — the interactive map. This is where you spend time when exploring relationships.
3. **Inspector** — per-node detail view: metadata, Markdown render of the body, linked-nodes panel, per-card refresh.

The graph updates **live**: you run `sm watch`, edit a file in your editor, and the changes travel over WebSocket to the browser and reflect instantly. No refresh needed.

If you want to try it without installing anything, there's a **free demo at `skill-map.dev/demo/`** that runs entirely in the browser, on synthetic data.

---

## What does it do today?

- Detects **trigger collisions** — two skills competing for the same input.
- Lists **orphans** — files nothing references that you can probably delete.
- Measures **per-node weight** in bytes and tokens, so you can see at a glance where your LLM budget is going.
- Maps **external references** — URLs, npm packages cited, dependencies outside the repo.
- Detects **superseded** — a new skill that replaces an older one that's still active, with auto-rename heuristics and propagation.
- Persists everything in **SQLite**, with separate tables for history (`state_*`) and regenerable snapshots (`scan_*`).
- Configurable in **layers** (defaults → global → project → local → environment variables), with `.skillmapignore` to exclude and `sm init` to bootstrap a project from scratch.
- **Integrated Web UI** (`sm serve`) with single-port Hono BFF, Angular SPA, tri-state dark mode (auto / light / dark per system preference), initial bundle under 500 KB.
- **Watch mode**: `sm watch` or `sm serve` follow disk changes with chokidar and emit events.
- **Mini export language** for `sm export` — filters by type, by path, by stability.
- **Three public npm packages**: `@skill-map/spec`, `@skill-map/cli`, `@skill-map/testkit`.

Everything above works **without an LLM**. The LLM enters as an opt-in layer in the next phase.

---

## Status: active beta

Skill-map is in **beta** — pre-1.0, under very active development. The trajectory splits into three public phases:

- **Phase A (✅ closed)** — Deterministic core + CLI + baseline Web UI. This is what's real, installable, and useful today. Closes version `v0.6.0`.
- **Phase B (next)** — The LLM layer as opt-in. Job subsystem with *atomic claim* and *nonce*, first probabilistic extension (a *summarizer* that turns a skill into a structured brief), per-type summarizers, and semantic verbs like `sm what` (what does this skill do), `sm dedupe` (find semantic duplicates), `sm cluster-triggers` (group overlapping triggers), `sm impact-of` (if I touch this, what moves), `sm recommend-optimization` (ideas to reduce tokens or redundancy). The UI gains read-only cards for *summaries*, *enrichments*, and *findings*. Targets `v0.8.0`.
- **Phase C (1.0 target)** — Additional formatters (Mermaid for README, DOT/Graphviz for CI), multi-host providers (Codex, Gemini, Copilot, generic), deeper UI with the LLM verbs turned into interactive flows, queue inspector, cost dashboard, and final distribution as a single npm package with the UI bundled inside. Targets `v1.0.0`.

More than **117 architectural decisions** were documented in the roadmap before the first commit. The public spec includes 29 JSON Schemas, prose contracts, and a conformance suite in the `@skill-map/spec` package. Pre-1.0 means versions move, but behavior and spec are committed toward a deliberate, stabilizing `1.0.0` — not an accident.

---

## Designed to be extended: six plugin types

The skill-map kernel is **deliberately ignorant**. It doesn't know what a Claude skill is, nor how a command is invoked, nor what rule to validate. All that knowledge lives in **extensions** loaded as drop-in plugins: drop a folder under `.skill-map/plugins/<id>/` and the kernel picks it up.

There are **six extension types**, no more:

### 1. Provider

Recognizes a platform. Knows the *on-disk layout* of a specific host and how to classify files into the six node types.

There's a Provider today for **Claude Code** that understands skills live in `~/.claude/skills/`, agents in `~/.claude/agents/`, commands in `~/.claude/commands/`. Coming in phase C: **Codex**, **Gemini**, **Copilot**, and a **generic Provider** driven by frontmatter for unofficial cases. A Provider is always deterministic — file classification doesn't admit ambiguity.

### 2. Extractor

Reads a Markdown file and extracts the **links** that produce the graph. Each Extractor looks at a different surface of the file:

- A **frontmatter** extractor reads fields like `uses`, `triggers`, `requires`.
- A **slash-commands** extractor detects `/skill-name`-style mentions in the body.
- An **at-directives** extractor detects `@agent-name`.
- An **external URLs** extractor counts how many references leave the repository (useful for auditing dependencies).

They can be deterministic (regex and parsing) or probabilistic (an LLM identifies implicit mentions a regex can't capture). Each Extractor declares its mode.

### 3. Rule

Produces **deterministic issues** over the graph. Some that ship included:

- `trigger-collision` — two skills competing for the same input.
- `broken-ref` — a link to a node that doesn't exist.
- `superseded` — a skill that claims to replace another, and the other is still active.
- `link-conflict` — two Extractors disagreeing about the same link.

Rules run inside `sm scan` and `sm check`. They can also be probabilistic: for example, a Rule that evaluates prose quality or detects semantic redundancy between two skills.

### 4. Action

This is the **only** plugin type that touches disk. An Action executes an operation over one or more nodes:

- In **deterministic** mode, it's direct code: rename a trigger, adjust a frontmatter field, move a file between folders.
- In **probabilistic** mode, it's a prompt that an LLM executes through the *job subsystem* — with *atomic claim* (two workers can't pick up the same job), *nonce* (each job verifies its authority before writing), and a *preamble* enforced by the kernel to guarantee context and format.

Actions are what turns skill-map into a **management** tool, not just observation.

### 5. Formatter

Serializes the graph to an external format. Today there's an **ASCII** Formatter to print the graph in the terminal. Coming in phase C: **Mermaid** (to embed diagrams in `README.md` and docs), **DOT / Graphviz** (to integrate with CI or external tooling), and **subgraph export with filters**. Formatters are always deterministic — graph representation has to be reproducible.

### 6. Hook

Reacts to **kernel lifecycle events**. There's a curated set of events a Hook can subscribe to: `scan.started`, `scan.completed`, `issue.added`, `issue.resolved`, `job.started`, `job.completed`.

A Hook can, for example, **notify Slack** when a high-severity issue appears, **write an audit log** after each scan, or **sync metadata** with an external ticketing system. They can be deterministic or probabilistic (an LLM evaluating event relevance before deciding to notify).

---

## The official testkit

Alongside the CLI we publish `@skill-map/testkit`, a dedicated package so that **any plugin author** can write tests against a stable contract. It ships drop-in fixtures, helpers to build an expected `ScanResult`, and mock runners for deterministic tests.

The premise is simple: **if your plugin doesn't pass the testkit tests, the kernel doesn't load it**. This prevents a broken plugin from contaminating the user's graph and keeps the "drop-in" promise risk-free.

---

## Why does it matter?

Skill-map looks at a problem that grows quietly. Markdown collections that drive AI agents start out tidy and, six months later, they're a tangle. Three user types feel that pain first:

- **Teams and platform architects** maintaining shared skill collections across multiple projects. They need auditing, deduplication, and onboarding new members without having to read 200 files.
- **Authors of skills, agents, and plugins** who want to detect duplicates, redundancies, and optimization opportunities before publishing.
- **People debugging** an invocation that went wrong — tracing from the trigger the user said to the skill that won the match, in real time.

And because the spec is **public and separable** from the reference implementation, anyone can build a second implementation, an alternative UI, or complementary tooling consuming only `@skill-map/spec`. That gives the standard a longer life than the project that originated it.

---

## Resources

- Official site: <https://skill-map.dev>
- Live demo in the browser, no install: <https://skill-map.dev/demo/>
- GitHub repository: <https://github.com/crystian/skill-map>
- npm packages: `@skill-map/spec`, `@skill-map/cli`, `@skill-map/testkit`
- License: MIT (Apache accepted on skill contributions)

To get started:

```bash
npm i -g @skill-map/cli
cd your/project
sm
```

That last `sm` opens the Web UI at `http://127.0.0.1:4242` with the watcher running. Edit any `.md` in the project and the graph updates live in the browser.
