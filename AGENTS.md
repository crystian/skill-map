# AGENTS.md

Vendor-neutral guidance for AI agents working on **skill-map**. Derived from `ROADMAP.md` — read it for full design context and decision history.

## Language & Persona Activation (READ FIRST)

**This is a strict gate. Evaluate the user's FIRST message before doing anything else.**

- **IF** the user's first message contains a Spanish greeting ("hola", "buenas", "qué tal", "buen día", "buenos días", "buenas tardes", "buenas noches", or any obvious Spanish-language opener):
  - Switch into the **Arquitecto persona** (see "Arquitecto persona" section below). Respond in Spanish from that message onward.
- **ELSE** (message is in English or any other language, with or without greeting):
  - **Do NOT activate the Arquitecto persona.** Respond in the user's language. Use default Claude behavior and tone. Do not call yourself "Claudio". Do not use the Spanish greeting response. Do not address the user by any persona name.
  - This applies even if later messages contain Spanish words — the first message sets the mode for the whole session.

**Always apply (both modes):**

- **Paths**: prefer relative paths over absolute paths in bash commands and agent prompts.
- **Temp files**: use `.tmp/` (project-local) instead of `/tmp/`.
- **Language in artifacts**: code, commits, PRs, and all documentation in English — regardless of conversation language.

## Arquitecto persona (only when activated per rule above)

- Informal, español argentino, respuestas cortas y directas, evitar ambigüedad.
- El usuario se llama "Arquitecto", vos sos "Claudio". No seas condescendiente; advertirle si pide algo incorrecto, tanto en lo funcional como técnico.
- Saludo de respuesta: "Hola Arquitecto! Que vamos a hacer hoy?"
- **Options format**: when presenting choices with "o/or", ALWAYS use numbered lists so the user can reply with just a number.

## Project

**skill-map** (binary: `sm`) maps, inspects, and manages collections of interrelated Markdown files — skills, agents, commands, hooks, and docs that compose AI-agent ecosystems (Claude Code, Codex, Gemini, Copilot, Obsidian vaults, docs sites).

Functions as a graph explorer: detects cross-references, trigger overlaps, obsolete or duplicated nodes, and runs actions over selected nodes.

**Status**: pre-implementation. Design and execution plan consolidated in `ROADMAP.md`.

**Target**: distributable product (not personal tool). Versioning, i18n, plugin security, onboarding docs, compatibility matrix all in scope.

## Philosophy (non-negotiable)

- **CLI-first** — everything the UI does is reachable from the CLI.
- **Deterministic by default** — LLM is optional, never required. Tool works fully offline through step 8.
- **Kernel-first from commit 1** — the kernel contains no platform knowledge, no detector, no rule. Everything lives as an extension.
- **Tests from commit 1** — full pyramid (contract, unit, integration, self-scan, CLI, snapshot). Missing test → extension does not boot.
- **Platform-agnostic** — first adapter is Claude Code; architecture supports any MD ecosystem.
- **Spec as a public standard** — `spec/` is separated from the reference implementation from day zero. Third parties can build alternative implementations using only the spec.

## Architecture: Kernel + Extensions

Six extension kinds, all first-class in the kernel from day zero:

| Kind | Role |
|---|---|
| Detector | Extracts signals from MDs (`@`, slash, wikilinks, frontmatter, etc.) |
| Adapter | Recognizes a platform and defines its domain (claude, codex, gemini, obsidian-vault, generic) |
| Rule | Produces issues over the graph (trigger collisions, broken refs, etc.) |
| Action | Executable action over a node (`local` or `invocation-template` mode) |
| Audit | Hardcoded workflow (`validate-all`, `find-duplicates`, etc.) |
| Renderer | Serializes the graph (ascii, mermaid, dot, json) |

**Kernel boundary**: types, registry, orchestrator, storage, CLI dispatcher. With all extensions removed, the kernel must still boot and return an empty graph.

**Litmus test**: adding a second detector (or any kind) = drop-in file, zero kernel changes.

## Repo layout (target)

```
skill-map/
├── spec/                   source of truth for the STANDARD
│   ├── README.md
│   ├── CHANGELOG.md        independent from tool changelog
│   ├── schemas/            JSON Schemas (8 total)
│   ├── conformance/        test suite the spec demands
│   └── versioning.md
├── src/                    reference implementation (the CLI)
│   └── extensions/         built-in extensions (ship with the binary)
├── skills/                 skill-optimizer (meta-skill) and _template
└── scripts/                validate-skills.py, etc.
```

## MVP floor (not locked)

1. 4 CLI verbs: `sm scan`, `sm list`, `sm show`, `sm check`
2. All 6 extension kinds wired in the kernel
3. Instances shipped:
   - 1 Adapter: `claude`
   - 3 Detectors: `frontmatter`, `slash`, `at-directive`
   - 3 Rules: `trigger-collision`, `broken-ref`, `superseded`
   - 0 Actions (contract available for third parties)
   - 1 Audit: `validate-all`
   - 1 Renderer: `ascii`
4. JSON output with `schemaVersion: 1`
5. History + `sm record` CLI
6. **No web UI. No LLM layer. No workflows beyond audits.**

## Execution plan (summary)

| Phase | Steps | Ships | LLM |
|---|---|---|---|
| A — Core deterministic | 0–8 | **v0.1.0** (CUT 1) | none |
| B — LLM layer (optional) | 9–10 | **v0.5.0** (CUT 2) | optional |
| C — UI + distribution | 11–13 | **v1.0.0** (CUT 3) | optional |
| D — Deferred | 14+ | on demand | varies |

Full step-by-step in `ROADMAP.md §Execution plan`.

## Stack conventions

- **Runtime**: Node ESM — CLI, scanner, server, detectors.
- **Language**: TypeScript strict.
- **Build**: `tsup` or `esbuild` → JS, distributed via npm (`npm i -g sm` / `npx sm`).
- **CLI binary**: `sm` (primary), `skill-map` long alias.
- **Config we author**: JSON (workflows, plugin manifests, cache).
- **Config we parse**: native format of the source (YAML frontmatter, JSON manifests).
- **Shell**: avoided unless unavoidable (only to invoke `git` or similar).
- **Tests**: `node:test` (built-in, zero deps). Migrate to Vitest only if pain emerges.
- **Logging**: `pino` (JSON lines).
- **Schemas**: JSON Schema is source of truth in `spec/`, Zod types derived in impl.

## Persistence

Three stores in `~/.skill-map/`:

| Store | File | Nature | Regenerable |
|---|---|---|---|
| Plugins registry | `plugins.json` | Config | No |
| Nodes cache | `cache.json` | Derived (last scan) | Yes |
| Execution history | `history.json` | Append-only log | No |

Per-repo `.skill-map/history.json` takes precedence over the global one (enables team-shared audit history).

**Node ID**: relative file path from repo root. Survives frontmatter renames; breaks on file moves (rare enough). Migration to UUID-in-frontmatter lands with write-back (Phase 1+).

## Testing (non-negotiable)

Pyramid: contract, unit, integration, self-scan, CLI, snapshot.

Mandatory for MVP:
1. Contract tests for the 6 kinds.
2. **Self-scan test** — `sm scan` on skill-map's own repo produces valid graph, no critical issues.
3. Adapter conformance against controlled fixtures.
4. Detector isolation (MD input → expected edges).
5. Rule isolation (mini graph → expected issues).
6. JSON schema validation (scanner output vs `schemaVersion: 1`).
7. CLI smoke tests for all MVP verbs.

**Per-extension rule**: every extension in `src/extensions/` ships a sibling `*.test.mjs`. Missing test → contract check fails → tool does not boot.

**Performance budget**: 500 MDs in ≤ 2s on a modern laptop, enforced by a CI benchmark.

## Decisions already locked

- License: MIT.
- Repo: standalone (own git history, own release cycle, own `mia-marketplace` entry).
- Logging: `pino` JSON lines.
- Naming: Node, Action, Audit (not Task / Workflow).
- `skill-optimizer` kept as Claude Code skill **and** wrapped as `skill-map` Action (dual surface).
- First adapter: `claude` only.
- MVP audit set: only `validate-all`.
- Documentation site: Astro Starlight, implemented at Step 13.
- Triggers normalization: NFD → strip diacritics → lowercase → hyphen/underscore → space → collapse whitespace → trim. Edges keep both `originalTrigger` and `normalizedTrigger`.

## Explicitly rejected (do not propose)

Cursor support, remote scanning, graph diff across commits, live-system sync, query language, invocation metrics, MCP server as primary interface, hook-based activation, Python runtime, `br` task tracking, custom snapshot system for undo (use Git directly).

## Rules for agents working in this repo

- **Never run `git push`** — pushing is manual.
- **Never commit automatically** — completing work ≠ commit. Commit only when explicitly asked.
- **Never bump versions manually** — CI (`.github/workflows/bump-version.yml`) handles it.
- **All artifacts in English** — code, commits, PRs, docs. Conversation language follows `CLAUDE.md` activation rule.
- **Paths**: prefer relative over absolute in bash commands and agent prompts.
- **Temp files**: use `.tmp/` (project-local), not `/tmp/`.
- **Every feature**: update `spec/` first, then `src/`. No impl feature without spec change.
- **CI green, always** — extensions ship with tests or do not boot.

## Further reading

- `ROADMAP.md` — design, decisions, deferred items, open questions, phase-by-phase plan.
- `CLAUDE.md` — conversation conventions and persona activation.
- `CONTRIBUTING.md` — contribution checklist.
- `skills/skill-optimizer/` — reference meta-skill (do not restructure without approval).
