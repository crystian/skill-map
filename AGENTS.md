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

## Spec bootstrap status

Step 0a is **in progress**. The `spec/` tree is partially populated. Work was done collaboratively with `Arquitecto` (owner) across focused review phases. Any AI agent that modifies or extends `spec/` MUST read this section first.

### What exists (done)

- **Foundation** (`spec/README.md`, `spec/CHANGELOG.md`, `spec/versioning.md`) — full.
- **JSON Schemas** (`spec/schemas/`) — 20 files, all JSON Schema **draft 2020-12**:
  - 9 top-level: `node`, `link`, `issue`, `scan-result`, `execution-record`, `project-config`, `plugins-registry`, `job`, `report-base`.
  - 6 frontmatter: `base` + `skill` / `agent` / `command` / `hook` / `note` (kind schemas extend base via `allOf`).
  - 5 summaries: `skill` / `agent` / `command` / `hook` / `note` (all extend `report-base` via `allOf`).
- **Prose docs** (all 7): `architecture.md`, `cli-contract.md`, `dispatch-lifecycle.md`, `job-events.md`, `prompt-preamble.md`, `db-schema.md`, `plugin-kv-api.md`.
- **Interfaces**: `spec/interfaces/security-scanner.md` (convention over the Action kind; no new extension kind).
- Placeholder dirs: `spec/conformance/{cases,fixtures}/`.

### What's pending (closes Step 0a)

- Conformance stub: a minimal fixture set (one MD per kind) + 1–2 declarative cases under `spec/conformance/cases/`.
- `@skill-map/spec` npm package skeleton: `spec/package.json` with `name`, `exports` for schemas, `files` whitelist.
- Domain provisioning for `skill-map.dev` so that `$id` URLs resolve. Scheduled right after this bootstrap commit.

### Conventions locked during bootstrap (do NOT change unilaterally)

- **Casing**: camelCase for every JSON key (domain types, config files, plugin manifests, reports). File names remain kebab-case. Rationale discussed and decided — JS/TS ecosystem, JSON Schema self-convention, Kysely `CamelCasePlugin` alignment.
- **`$id` scheme**: `https://skill-map.dev/spec/v0/<path>.schema.json`. `v0` stays until the first stable cut; then bumps to `v1`. Domain not yet provisioned — registration is a follow-up.
- **Schema dialect**: JSON Schema 2020-12 everywhere.
- **Identity**: `node.path` is the canonical node identifier in v0 (relative path from scope root). A sibling `id` field (UUID in frontmatter) lands with write-back, post-v1.
- **Required frontmatter**: `name`, `description`, `metadata`, `metadata.version`. Everything else optional.
- **Permissive-shape / strict-rule split**: frontmatter schemas use `additionalProperties: true` because user-authored — policy (`unknown-field` rule) is separate from shape. Summary schemas use `additionalProperties: false` because kernel controls the output shape and strictness catches model hallucinations.
- **Execution record id**: `e-YYYYMMDD-HHMMSS-XXXX`. Run id: `r-YYYYMMDD-HHMMSS-XXXX`. Job id: `d-YYYYMMDD-HHMMSS-XXXX`. Same shape, different prefix per scope.
- **Exit codes**: 0 ok / 1 issues / 2 error / 3 duplicate / 4 nonce-mismatch / 5 not-found. 6–15 reserved.
- **Deprecation window**: 3 minors between `stable → deprecated` and removal.
- **Stability tags**: inline in schema `description` and in prose as `**Stability: experimental**`. No dedicated machine-readable field.
- **Prompt preamble**: the text in `prompt-preamble.md` is **verbatim normative** — byte-for-byte reproducible, hashed into `promptTemplateHash`, conformance suite will store it as `conformance/fixtures/preamble-v1.txt`.
- **Escape of `</user-content>` inside user content**: insert zero-width space before `>` (`</user-content&#x200B;>`). Reversed only for display, never when hashing.
- **Storage mode per plugin**: exactly one (`kv` OR `dedicated`). Mixing is forbidden. A plugin that needs both KV-like and relational access uses mode B and implements KV-style rows as a dedicated table.
- **Security scanners**: convention over the Action kind (id prefix `security-`, report extends `report-base` with `scanner` / `findings` / `stats`). NOT a new extension kind — the six kinds remain locked. Marked `Stability: experimental` across v0.x.
- **Exit codes extended**: 4 = nonce-mismatch, 5 = not-found (on top of ROADMAP's 0/1/2/3). 6–15 reserved for future spec use. ≥16 free for verb-specific use.
- **Env vars normativos**: `SKILL_MAP_SCOPE`, `SKILL_MAP_JSON`, `SKILL_MAP_DB`, `NO_COLOR`. Precedence: flag > env > config > default.

### Rules for AI agents editing `spec/`

1. **Spec is the source of truth**. When spec and `ROADMAP.md` disagree, spec wins. ROADMAP is the design narrative; it may lag.
2. **Every normative change → `spec/CHANGELOG.md` entry** in the `[Unreleased]` section, classified as patch / minor / major per `spec/versioning.md`.
3. **Breaking changes → major bump required**. Do not sneak breaking changes into a minor. The semver policy in `versioning.md` is strict — read it before any structural change.
4. **Update spec first, then `src/`**. The inverse is a policy violation caught in review. If a proposed feature cannot land in spec (because the shape isn't clear yet), it is not ready for implementation.
5. **JSON Schema files MUST parse**. Run `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"` after every edit. A future conformance CI job will enforce this.
6. **Never hand-edit `conformance/fixtures/preamble-v*.txt`**. The text in `prompt-preamble.md` is authoritative; regenerate fixtures from it.
7. **Cross-schema references**: use relative paths in `$ref` (e.g. `"base.schema.json"`, `"../report-base.schema.json"`). Do NOT use absolute URLs in `$ref` — those are reserved for `$id`.
8. **Prose docs follow the convention**: each ends with a `## Stability` section stating what is stable as of v1.0.0 and what bump is required for future changes.
9. **Schemas under `schemas/frontmatter/*` extend `base.schema.json` via `allOf`**. Schemas under `schemas/summaries/*` extend `../report-base.schema.json` via `allOf`. Do not copy fields; reference them.
10. **Conformance tests** (`spec/conformance/cases/`) MUST exist for every schema before the spec cuts v1.0.0. Missing conformance case → missing release.

### Maintenance checklist (apply on any `spec/` PR)

- [ ] JSON Schema files parse.
- [ ] `$id` is present, uses the canonical scheme, matches file path.
- [ ] Any new required field has a migration note in CHANGELOG.
- [ ] camelCase for JSON keys; kebab-case for file names.
- [ ] Stability tag set where non-obvious (`experimental` / `stable` / `deprecated`).
- [ ] `CHANGELOG.md` updated under `[Unreleased]` with the correct classification.
- [ ] If the preamble text changed: conformance fixture regenerated and tests re-run.
- [ ] Prose doc ends with a `## Stability` section.
- [ ] No absolute URL in `$ref`.
- [ ] Extends `base` / `report-base` via `allOf` where applicable; no field duplication.

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
