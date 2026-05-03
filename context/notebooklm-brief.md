# skill-map — Project Brief for NotebookLM

> A functional overview of the project: what it is, why it exists, the state of the work today, the plugin philosophy, the design choices behind it, and where it is going. Written as podcast-ready raw material — not as user documentation.

---

## 1. What skill-map is, in one sentence

**skill-map is a graph explorer for Markdown-based AI-agent ecosystems.** It takes the pile of skills, agents, slash commands, hooks, and notes that anyone using Claude Code, Codex, Gemini, or Copilot inevitably accumulates, and turns it into a navigable graph: who invokes whom, which triggers collide, what is alive, what is obsolete, what can be deleted without breaking anything.

Two surfaces today: a CLI named `sm` (the primary interface) and a web UI prototype. The CLI is fully deterministic and works completely offline. An optional LLM layer is planned on top, but the product is designed so it is **never required** — the binary itself never talks to a model.

---

## 2. The problem it solves

Anyone who works with AI agents long enough ends up with dozens — sometimes hundreds — of Markdown files scattered across folders. Skills here, agents there, custom commands somewhere else, hooks that fire on conditions, notes that document context. Nobody has visibility into:

- What exists and where it lives.
- Who invokes whom — the dependencies and cross-references between files.
- Which triggers overlap (two skills both claiming the slash command `/deploy`).
- What is alive vs obsolete, recently used vs years stale.
- What can be safely deleted.
- When each skill was last optimized, validated, or summarized.

No official tool — Anthropic, Cursor, GitHub, skills.sh — covers this. Obsidian comes the closest, but Obsidian treats files as *notes*, not as *executables with inputs, outputs, tools, and triggers*. The framing skill-map's author uses is **"Obsidian for AI agents, not for notes"**.

---

## 3. Who it's for

- Power users of Claude Code (or any other agent framework) who maintain several plugins, skills, or commands of their own.
- Teams that share skill collections and need auditing, naming consistency, ownership clarity.
- Plugin and action authors who want to test and validate their work against a real graph.
- Developers who want to build their own tooling on top of the graph — through the CLI, JSON output, or by writing a plugin.

---

## 4. How it works, functionally

There are five layers, designed as concentric rings:

1. **The deterministic scanner.** Walks the filesystem, parses Markdown frontmatter, runs Extractors that extract references between files, runs Rules that flag deterministic problems (broken references, trigger collisions, superseded nodes), and emits structured graph data — nodes, links, issues. Every single piece of this is deterministic, offline, byte-reproducible.

2. **The optional LLM layer (planned).** Consumes the deterministic graph and adds semantic intelligence: it validates ambiguous references, clusters equivalent triggers, compares similar nodes, summarizes them per kind, answers questions over the graph. Crucially, this layer is *external*. The `sm` binary never touches an LLM directly. The LLM lives in a separate runner process; `sm` only renders prompts and records the results.

3. **The CLI (`sm`).** Every operation in the system is reachable from the command line. List, show, check, scan, history, orphans, plugins, db management, and — eventually — jobs, summaries, exports, diffs.

4. **The web UI.** A graph view, a list view, an inspector panel. The Step 0c prototype is already shipped against mocked data, and the full integration with the kernel is planned for the v1.0 release. The UI consumes the same kernel API as the CLI — they are peers, not stacked layers.

5. **The plugin system.** Drop-in. Anyone can add new Providers, Extractors, Rules, Actions, Formatters, or Hooks without touching the kernel. This is the part that deserves its own section — see below.

---

## 5. The plugin philosophy — *anyone can add data and behavior*

This is the heart of the project. From day one, the kernel is **empty of platform knowledge**. There is no built-in concept of "this is a Claude file" or "this is a Codex file" inside the core. Every recognizer, every Extractor, every Rule, every Formatter lives outside the kernel — even the official ones. They are all extensions, exposed through the same six-category contract that third-party plugins use.

**The six extension kinds** (this set is stable and frozen as the kernel contract):

1. **Provider** — recognizes a platform (Claude, Codex, Gemini, generic) and classifies each file into its kind: skill, agent, command, hook, note.
2. **Extractor** — reads a node's body and extracts links: invokes, references, mentions, supersedes.
3. **Rule** — evaluates the graph and emits deterministic problems (issues).
4. **Action** — an executable operation over one or more nodes. Can run locally (plugin code) or as a rendered prompt sent to an LLM.
5. **Formatter** — serializes the graph (ASCII, Mermaid, DOT, JSON).
6. **Hook** — reacts declaratively to lifecycle events (`scan.started`, `scan.completed`, `extractor.completed`, `rule.completed`, `action.completed`, `job.spawning`, `job.completed`, `job.failed`).

**Drop-in installation.** No `sm plugins add` command. The user creates a folder under `<project>/.skill-map/plugins/<plugin-id>/` (or globally under `~/.skill-map/plugins/`), drops a `plugin.json` manifest and the extension files, and the next time the kernel boots it discovers them. That's it.

**Two storage modes.** Plugins that need to persist data have two options. Mode A (KV) gives them a key-value store backed by a kernel-owned table. Mode B (Dedicated) lets them declare their own tables with their own migrations — but the kernel enforces a triple protection layer: it rewrites every DDL to inject a `plugin_<id>_` prefix, validates that no plugin can touch kernel tables, and hands the plugin a scoped database wrapper instead of raw access. This guards against accidents — not against malicious plugins, since drop-in code is user-placed by definition. Plugin signing is a post-v1.0 conversation.

**Spec compatibility.** Each plugin manifest declares which spec version it works against (`specCompat: "^0.4.0"`). At load time, the kernel checks compatibility. Incompatible plugins are disabled with a clear reason — they don't crash the boot.

**Why this matters.** The drop-in proof was demonstrated in Step 4, when the project shipped a fourth Extractor (`external-url-counter`) by adding one new file under `src/built-in-plugins/extractors/` and one entry in the built-ins registry. **Zero kernel edits.** That is the litmus test the architecture was designed to pass: a third party can extend the system without forking it.

---

## 6. Design philosophy — what makes it different

- **CLI-first.** Everything the UI does is reachable from the command line. The CLI runs in CI, in pipelines, in shell scripts. The UI is a peer, not a wrapper.

- **Deterministic by default.** The product works fully offline through Phase A (`v0.5.0`). The LLM layer is additive, optional, and never required. The author was explicit about this: the `sm` binary is pure template rendering, database access, and filesystem operations.

- **Kernel-first from commit one.** No platform knowledge in the core. Everything is an extension. This is enforced by the conformance suite — there is a test case (`kernel-empty-boot`) that boots the kernel with zero registered extensions and asserts it produces a valid empty scan.

- **Hexagonal architecture (Ports & Adapters).** The kernel declares interfaces (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`), and adapters implement them. The CLI, the future server, and the future Skill agent are all *driving* adapters. SQLite, the filesystem, the plugin loader, and the LLM runner are *driven* adapters. Each one is swappable: there are in-memory variants for tests, real implementations for production. The kernel never imports SQLite, never imports `fs`, never spawns a subprocess directly.

- **Tests from commit one.** Every layer ships with unit, contract, integration, and self-scan tests. Every extension ships with a test or does not boot. The current suite is over 200 tests and grows with every step.

- **Public standard.** The specification — JSON Schemas plus prose contracts plus a conformance suite — lives in its own package (`@skill-map/spec`) and is published on npm independently from the implementation. Anyone can build an alternative UI, an alternative CLI in another language, or complementary tooling consuming **only the spec**, without ever reading the reference source.

- **Pinned dependencies, no caret ranges.** Every dependency is locked to an exact version. Reproducible installs across contributors and CI.

- **No hacks — read the official docs first.** A repo-level rule: when integrating a third-party library, read its setup docs before writing code. If something doesn't work as expected, re-read the docs before inventing workarounds. Symptoms like "I had to add custom CSS to make this render" are red flags that a setup step was skipped.

---

## 7. The author's process — *plan first, code later*

This is the part that should land in the podcast as a personal moment.

The author of skill-map has **24 years of experience as a developer**. He's built a lot of things. And he was deliberate about not starting this one the way he's started most others.

**Before the first line of code was written, he spent roughly ten hours planning.** Not coding. Not scaffolding. Not setting up tooling. Just thinking, drawing boxes, writing the specification, arguing with himself about decisions, listing what would *not* be in scope.

The output of those ten hours is the `spec/` directory — 29 JSON Schemas, seven prose contracts (architecture, CLI contract, job lifecycle, job events, prompt preamble, database schema, plugin KV API), a conformance suite with fixtures and cases, and a versioning policy. **The specification existed before the implementation.** It is the source of truth, and when the spec and the implementation disagree, the spec wins by policy.

This is unusual. Most projects start with a sketch and grow features. skill-map started with a frozen surface — extension kinds, port interfaces, table zones (`scan_*` regenerable, `state_*` persistent, `config_*` user-owned), naming conventions, and the rule that breaking changes require a major version bump even pre-1.0. Then the implementation was built to match.

The result is a codebase where the kernel has been refactored repeatedly without breaking any consumer, because every consumer talks to the spec, not to the kernel. The plugin system was *designed in* from the first commit, not retrofitted. The split between deterministic core and optional LLM layer was a planning decision, not an emergent constraint.

The author's own statement, which is worth quoting nearly verbatim: *I spent about ten hours planning before writing a single line of code.*

---

## 8. Current state — where the project is in April 2026

skill-map is in active development. The `@skill-map/spec` package is live on npm. The implementation package (`@skill-map/cli`) is published. The web UI prototype is shipped against mock data.

**Roadmap in three phases:**

- **Phase A — Deterministic core (no LLM).** Steps 0a through 9. Target: `v0.5.0`. The product is fully functional and offline at this milestone — scan, list, show, check, history, orphans, config, diff, export, plugin authoring. **Steps 0 through 5 are complete as of April 26, 2026.** That covers spec bootstrap, implementation bootstrap, UI prototype, storage and migrations, plugin loader, orchestrator and CLI dispatcher, the first set of built-in extensions, scan end-to-end, and history with orphan reconciliation including an automatic rename heuristic. Currently 204 tests passing.

- **Phase B — Job subsystem and LLM verbs.** Steps 10 and 11. Target: `v0.8.0`. Adds the optional LLM layer: job submission, atomic claim, nonce-authenticated callbacks, the prompt-injection mitigation preamble, the first summarizers (one per node kind), probabilistic verbs (`sm what`, `sm cluster-triggers`, `sm findings`), and the `/skill-map:explore` meta-skill that lets a user converse with the graph from inside an LLM session.

- **Phase C — Surface and distribution.** Steps 12, 13, 14. Target: `v1.0.0`. Extra renderers (Mermaid, DOT, subgraph export), full web UI with WebSocket live events, command submission from the UI, distribution polish — releases, docs site, marketplace, telemetry opt-in, compatibility matrix.

---

## 9. The future — beyond v1.0

The author has explicitly listed work that is *deferred past v1.0* — not because it's unimportant, but because it shouldn't gate the first stable release:

- **Write-back from the UI.** Edit, create, refactor nodes from the graph view. Git-based undo. Extractors become bidirectional — they currently *read* references; they would also *write* them.
- **More platform Providers.** Codex, Gemini, Copilot, generic. Today the only Provider is Claude, but the architecture supports any Markdown ecosystem.
- **Density and token-economy plugin.** A drop-in bundle that closes the loop between *identifying* token-heavy nodes (deterministic Rule) and *recovering* the value (LLM-backed summarizer optimizer). This is a perfect plugin demonstration: zero kernel changes, pure composition of Rule + Finding + Action.
- **URL liveness plugin.** Network HEAD checks for external links — kept out of the core because it requires a network and would compromise the offline-by-default principle.
- **Schema v2 with migration tooling.** When breaking changes to the JSON output become necessary.
- **Test harness for plugin authors.** Dry-run, real execution, subprocess execution.
- **Richer workflows.** Node-pipe API, JSON declarative workflows, visual DAG.
- **Plugin signing and hash verification.** Distribution hardening.
- **Telemetry, opt-in.** Visibility into which Extractors and Actions are used in the wild.
- **Marketplace.** Once external plugin authors appear in volume.

There is also an explicit *discarded* list — things the author has decided are out of scope and will not be revisited: Cursor support, scanning remote repos as a source, a query language over the graph, MCP as the primary interface, hook-based activation (this is manual inspection, not reactive), Python (Node ESM preferred for unification with the future web server), full ORMs (incompatible with hand-written SQL migrations), soft deletes (real deletes plus backups), audit columns, lookup tables for enums.

---

## 10. The takeaway, for the podcast

skill-map is what happens when a 24-year-veteran developer takes ten hours to plan before writing any code, and then builds the result.

It's a CLI-first, deterministic, offline-capable graph explorer for Markdown ecosystems — but the more interesting story is *how* it's built. Spec before code. Kernel empty by design. Hexagonal architecture from commit one. Plugins as a first-class extension surface, not a retrofit. An optional LLM layer that the binary itself never touches. A public standard published independently from the implementation, so anyone can build an alternative.

It's also a working answer to a real problem: the AI-agent ecosystem has produced no tool for managing the very files it produces — the skills, the agents, the commands, the hooks. skill-map fills that gap, and it is positioned to be **the standard** for that gap, not just one more tool.

The current milestone, v0.5.0, will make it fully usable offline. The next, v0.8.0, will add semantic intelligence as an optional layer. v1.0 will polish distribution. After that, write-back, more adapters, and the marketplace.

The plugin system is the centerpiece. **Anyone can add data. Anyone can add behavior. The kernel stays empty.**
