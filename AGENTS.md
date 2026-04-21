# AGENTS.md

Operating manual for AI agents working on **skill-map**. `ROADMAP.md` is the canonical design narrative and decision history; this file is the day-to-day guidance.

**Authority order when sources disagree**: `spec/` > `AGENTS.md` > `ROADMAP.md`. Spec is always source of truth for the standard. AGENTS.md is the current operating rules. ROADMAP.md is narrative and may lag behind both.

## Language & Persona Activation (READ FIRST)

**This is a strict gate. Evaluate the user's FIRST message before doing anything else.**

- **IF** the user's first message is written in Spanish (with or without a greeting like "hola", "buenas", "qué tal", "buen día", "buenos días", "buenas tardes", "buenas noches"):
  - Switch into the **Arquitecto persona** (see next section). Respond in Spanish from that message onward.
- **ELSE** (message is in English or any other language):
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

**skill-map** (binary: `sm`; long alias `skill-map`) maps, inspects, and manages collections of interrelated Markdown files — skills, agents, commands, hooks, and notes that compose AI-agent ecosystems (Claude Code, Codex, Gemini, Copilot, Obsidian vaults, docs sites).

Functions as a graph explorer: detects cross-references, trigger overlaps, obsolete or duplicated nodes, and runs actions over selected nodes.

**Status**: Steps **0a** (spec bootstrap) and **0b** (reference-implementation bootstrap) are **complete**. Next up: **0c — UI prototype**. See the completeness marker in `ROADMAP.md §Execution plan`.

**Target**: distributable product (not personal tool). Versioning, i18n, plugin security, onboarding docs, compatibility matrix all in scope.

## Philosophy (non-negotiable)

- **CLI-first** — everything the UI does is reachable from the CLI.
- **Deterministic by default** — LLM is optional, never required. Tool works fully offline through step 8.
- **Kernel-first from commit 1** — the kernel contains no platform knowledge, no detector, no rule. Everything lives as an extension.
- **Tests from commit 1** — full pyramid (contract, unit, integration, self-scan, CLI, snapshot). Missing test → extension does not boot.
- **Platform-agnostic** — first adapter is Claude Code; architecture supports any MD ecosystem.
- **Spec as a public standard** — `spec/` is separated from the reference implementation from day zero. Third parties can build alternative implementations using only the spec.
- **`sm` never touches an LLM** — the binary is pure template rendering + DB + filesystem. The LLM lives in the runner process.

## Architecture: Hexagonal (ports & adapters)

The architecture is **Hexagonal (Ports & Adapters)** — named explicitly, locked in ROADMAP decision #3.

The kernel accepts **ports** (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`) and imports neither SQLite, fs, nor subprocess directly.

Driving adapters (primary, consume the kernel): CLI, Server (Hono BFF), Skill.
Driven adapters (secondary, implement a port): SQLite storage, FS, Plugin loader, LLM runner.

### Six extension kinds

| Kind | Role |
|---|---|
| Detector | Extracts signals from MDs (`@`, slash, wikilinks, frontmatter, etc.) |
| Adapter | Recognizes a platform and defines its domain (claude, codex, gemini, obsidian-vault, generic) |
| Rule | Produces issues over the graph (trigger collisions, broken refs, etc.) |
| Action | Executable action over a node (`local` or `invocation-template` mode) |
| Audit | Hardcoded workflow (`validate-all`, `find-duplicates`, etc.) |
| Renderer | Serializes the graph (ascii, mermaid, dot, json) |

**Kernel boundary**: types, registry, orchestrator, storage, CLI dispatcher. With all extensions removed, the kernel must still boot and return an empty graph (enforced by conformance case `kernel-empty-boot`).

**Litmus test**: adding a second detector (or any kind) = drop-in file, zero kernel changes.

## Repo layout

### Actual (Step 0b complete)

```
skill-map/
├── spec/                   published as @skill-map/spec
│   ├── README.md
│   ├── CHANGELOG.md        independent from tool changelog
│   ├── versioning.md
│   ├── architecture.md     prose contracts (7 total)
│   ├── cli-contract.md
│   ├── job-lifecycle.md
│   ├── job-events.md
│   ├── prompt-preamble.md
│   ├── db-schema.md
│   ├── plugin-kv-api.md
│   ├── schemas/            21 JSON Schemas (draft 2020-12)
│   ├── conformance/        suite: cases + fixtures
│   ├── interfaces/         security-scanner convention
│   └── index.json          machine-readable manifest
├── src/                    published as skill-map (bins: sm, skill-map)
│   ├── kernel/             ports, types, registry, orchestrator
│   ├── cli/                Clipanion v4 commands
│   ├── conformance/        contract runner
│   ├── extensions/         built-in extensions (empty until Step 2)
│   ├── test/               node:test + tsx (pattern: *.test.ts)
│   └── bin/sm.mjs          CLI shim
├── scripts/                build-site.mjs · build-spec-index.mjs · check-changeset.mjs
├── site/                   generated public website (served by Railway)
├── .changeset/             changesets configuration
└── .github/workflows/      ci.yml (spec validate + build-test) · release.yml
```

### Target (upcoming steps)

- **Step 0c** adds `ui/` — Angular SPA as an npm workspace peer of `spec/` and `src/`.
- **Step 12** adds `src/server/` — Hono BFF with WebSocket, served by `sm serve`.
- **`src/migrations/`** and per-plugin `migrations/` folders land with Step 1 (SQLite).

**Workspace boundary**: the kernel in `src/` never imports Angular; the UI in `ui/` never imports `src/` internals. The only contract between them is `spec/` (JSON Schemas + typed DTOs). At Step 12, the Hono BFF inside `src/server/` exposes kernel operations over HTTP/WS, and `sm serve` serves the built Angular SPA from the same listener (single-port mandate).

## MVP floor (not locked)

1. 4 CLI verbs: `sm scan`, `sm list`, `sm show`, `sm check`.
2. All 6 extension kinds wired in the kernel.
3. Instances shipped:
   - 1 Adapter: `claude`.
   - 3 Detectors: `frontmatter`, `slash`, `at-directive`.
   - 3 Rules: `trigger-collision`, `broken-ref`, `superseded`.
   - 0 Actions (contract available for third parties).
   - 1 Audit: `validate-all`.
   - 1 Renderer: `ascii`.
4. JSON output with `schemaVersion: 1`.
5. History + `sm record` CLI.
6. **No web UI shipped in v0.1.0** (the Step 0c Angular prototype is a pre-MVP design validation, not released). **No LLM layer. No workflows beyond audits.**

## Execution plan (summary)

| Phase | Steps | Ships | LLM |
|---|---|---|---|
| A — Core deterministic | 0–8 | **v0.1.0** (CUT 1) | none |
| B — LLM layer (optional) | 9–10 | **v0.5.0** (CUT 2) | optional |
| C — UI + distribution | 11–13 | **v1.0.0** (CUT 3) | optional |
| D — Deferred | 14+ | on demand | varies |

Full step-by-step in `ROADMAP.md §Execution plan`. The completeness marker there flags the last fully-done step.

## Stack conventions

### Kernel / CLI / BFF (`src/`)

- **Runtime**: Node ≥ 24 (active LTS; `node:sqlite` stable; built-in WebSocket).
- **Language**: TypeScript strict + ESM; `verbatimModuleSyntax: true`.
- **Build**: `tsup` (esbuild) → `dist/` ESM + `.d.ts`.
- **Distribution**: npm package name is **`skill-map`** (not `sm`). Install: `npm i -g skill-map` or `npx skill-map`. After install, both `sm` and `skill-map` are available as binaries.
- **CLI framework**: **Clipanion v4** (introspection built-in, used by Yarn Berry).
- **BFF framework**: **Hono** (thin proxy over the kernel, no domain logic). NestJS rejected as over-engineered for a single-client BFF.
- **Single-port mandate**: `sm serve` exposes the Angular SPA, the REST API, and the WebSocket under one listener. Dev uses Angular dev server + `proxy.conf.json` → Hono for `/api` and `/ws`; prod uses Hono + `serveStatic`.
- **DB**: SQLite via `node:sqlite` (zero native deps).
- **Data-access**: **Kysely + CamelCasePlugin** (typed query builder, not an ORM). Consumers see camelCase domain types; the adapter handles the `snake_case ↔ camelCase` mapping.
- **Config we author**: JSON (workflows, plugin manifests, cache).
- **Config we parse**: native format of the source (YAML frontmatter, JSON manifests).
- **Shell**: avoided unless unavoidable (only to invoke `git` or similar).
- **Tests**: `node:test` (built-in, zero deps) + `tsx` loader. Pattern: `test/**/*.test.ts`. Migrate to Vitest only if pain emerges.
- **Logging**: `pino` (JSON lines).
- **Schemas**: JSON Schema is source of truth in `spec/`; Zod types derived in impl.

### UI (`ui/`, from Step 0c)

- **Framework**: **Angular** (latest stable, standalone components, SCSS, routing).
- **Node-based UI library**: **Foblex Flow** (Angular-native) for the graph view. Cards are Angular components with arbitrary HTML (title, kind badge, version, triggers, link counts).
- **Component library**: **PrimeNG** (tables, forms, dialogs, menus, overlays).
- **Styling**: SCSS **scoped per component**. **No utility CSS** (no Tailwind, no PrimeFlex). PrimeFlex is in maintenance mode; Tailwind overlaps with PrimeNG theming. Utilities return only if real friction appears.
- **i18n**: deferred (English-only until there is a reason otherwise).
- **Tests**: Angular defaults (Jasmine/Karma or Vitest — TBD when scaffolding).
- **Isolation rule**: `ui/` must not import from `src/`. Contracts flow through `spec/` (typed DTOs + JSON Schemas).

## Persistence

Single **SQLite** database per scope. No JSON stores.

| Scope | Scans | DB location |
|---|---|---|
| **project** (default) | current repo | `./.skill-map/skill-map.db` |
| **global** (`-g`) | `~/.claude/` and similar | `~/.skill-map/skill-map.db` |

### Three zones per scope

| Zone | Nature | Regenerable | Examples |
|---|---|---|---|
| `scan_*` | last scan result | yes — `sm scan` truncates and repopulates | `scan_nodes`, `scan_links`, `scan_issues` |
| `state_*` | persistent operational data | no — must back up | `state_jobs`, `state_executions`, `state_summaries`, `state_enrichment`, `state_plugin_kv` |
| `config_*` | user-owned configuration | no | `config_plugins`, `config_preferences`, `config_schema_versions` |

Backups preserve `state_*` + `config_*`. `scan_*` regenerates on demand.

### Conventions

- Tables: `snake_case`, **plural**, zone prefix required.
- Plugin tables: `plugin_<normalized_id>_<table>`. Normalization = lowercase + `[^a-z0-9]` → `_` + collapse runs + trim.
- Columns: `snake_case`; PK `id`; FK `<singular>_id`; timestamps `INTEGER` ms suffix `_at`; hashes `_hash`; JSON `_json`; counts `_count`; booleans `is_` / `has_`.
- Enum values: kebab-case lowercase with CHECK constraint. No lookup tables.
- Migrations: `.sql` files, `NNN_snake_case.sql`, up-only, auto-wrapped in a transaction. Kernel migrations in `src/migrations/`; plugin migrations in `<plugin-dir>/migrations/`.
- Version tracking: `PRAGMA user_version` (fast check) + `config_schema_versions(scope, version, description, applied_at)` (multi-scope).
- Auto-apply on startup with auto-backup (`.skill-map/backups/skill-map-pre-migrate-v<N>.db`). Config flag `autoMigrate: true` default.

### Node identity

`node.path` (relative file path from scope root) is the canonical node identifier in v0. Survives frontmatter renames; breaks on file moves (rare enough). A sibling `id` field (UUID in frontmatter) lands with write-back, post-v1.

## Testing (non-negotiable)

Pyramid: contract, unit, integration, self-scan, CLI, snapshot.

Mandatory for MVP:
1. Contract tests for the 6 kinds.
2. **Self-scan test** — `sm scan` on skill-map's own repo produces a valid graph, no critical issues.
3. Adapter conformance against controlled fixtures.
4. Detector isolation (MD input → expected edges).
5. Rule isolation (mini graph → expected issues).
6. JSON Schema validation (scanner output vs `schemaVersion: 1`).
7. CLI smoke tests for all MVP verbs.

**Per-extension rule**: every extension in `src/extensions/` ships a sibling `*.test.ts` file. Missing test → contract check fails → tool does not boot.

**Performance budget**: 500 MDs in ≤ 2s on a modern laptop, enforced by a CI benchmark.

## Decisions already locked

- License: MIT.
- Repo: standalone (own git history, own release cycle, own `mia-marketplace` entry).
- Logging: `pino` JSON lines.
- Naming: Node, Action, Audit (not Task / Workflow).
- `skill-optimizer` kept as a Claude Code skill **and** wrapped as a `skill-map` Action (dual surface).
- First adapter: `claude` only.
- MVP audit set: only `validate-all`.
- Documentation site: Astro Starlight, implemented at Step 13.
- Triggers normalization: NFD → strip diacritics → lowercase → hyphen/underscore → space → collapse whitespace → trim. Edges keep both `originalTrigger` and `normalizedTrigger`.
- **DB engine**: SQLite via `node:sqlite`.
- **Data-access**: Kysely + CamelCasePlugin.
- **CLI framework**: Clipanion v4.
- **UI framework**: Angular (latest stable, standalone). Replaces the earlier SolidJS lean.
- **Node-based UI library**: Foblex Flow. Replaces Cytoscape.js (which was graph-oriented, not card-oriented).
- **UI component library**: PrimeNG.
- **UI styling**: SCSS scoped per component. No Tailwind, no PrimeFlex.
- **UI workspace**: `ui/` as an npm workspace peer of `spec/` and `src/`.
- **BFF framework**: Hono (thin proxy over kernel). NestJS rejected.
- **Single-port**: SPA + REST + WS served from one listener via `sm serve`.
- **Versioning**: changesets manage `@skill-map/spec` and `skill-map` separately. Never bump versions by hand.

## Explicitly rejected (do not propose)

Cursor support · remote scanning · graph diff across commits · live-system sync · query language · invocation metrics · MCP server as primary interface · hook-based activation · Python runtime · `br` task tracking · custom snapshot system for undo (use Git directly) · NestJS for the BFF · Tailwind or PrimeFlex as utility CSS on top of PrimeNG · full ORMs (Prisma, Drizzle, TypeORM) · soft deletes (`deleted_at` columns) · audit columns (`created_by` / `updated_by`) · lookup tables for enums · `sm db reset --nuke` · Skills.sh enrichment · URL liveness in MVP · multi-turn jobs in MVP · `skill-manager` / `skillctl` naming · per-verb `explore-*` skills.

## Spec bootstrap status

Step 0a (spec) and Step 0b (reference implementation bootstrap) are **done**. Any AI agent that modifies or extends `spec/` MUST read this section first.

### Spec surface (Step 0a)

- **Foundation**: `spec/README.md`, `spec/CHANGELOG.md`, `spec/versioning.md`.
- **21 JSON Schemas** (draft 2020-12):
  - 10 top-level: `node`, `link`, `issue`, `scan-result`, `execution-record`, `project-config`, `plugins-registry`, `job`, `report-base`, `conformance-case`.
  - 6 frontmatter: `base` + `skill` / `agent` / `command` / `hook` / `note` (kind schemas extend `base` via `allOf`).
  - 5 summaries: `skill` / `agent` / `command` / `hook` / `note` (all extend `report-base` via `allOf`).
- **7 prose docs**: `architecture.md`, `cli-contract.md`, `job-lifecycle.md`, `job-events.md`, `prompt-preamble.md`, `db-schema.md`, `plugin-kv-api.md`.
- **Interfaces**: `spec/interfaces/security-scanner.md` (convention over the Action kind; no new extension kind).
- **Conformance suite**:
  - `fixtures/minimal-claude/` — 5 MDs, one per kind.
  - `fixtures/preamble-v1.txt` — verbatim preamble text, byte-identical to `prompt-preamble.md` source.
  - `cases/basic-scan.json` — scan `minimal-claude` → 5 nodes, 0 issues.
  - `cases/kernel-empty-boot.json` — kernel boot invariant (disable all adapters / detectors / rules → empty, zero-filled ScanResult). Implemented and passing.
- **`@skill-map/spec` npm package** — published via changesets. Current version lives in `spec/package.json` and `spec/CHANGELOG.md`; do not duplicate it in prose.
- **Spec index** (`spec/index.json`): machine-readable manifest of the spec surface. Regenerated with `npm run spec:index` (generator: `scripts/build-spec-index.mjs`). CI runs `npm run spec:check` and fails on drift. The integrity block (sha256 per file) is deterministic — do not hand-edit.
- **Public site**: Railway deploys the repo-root `Dockerfile` (Caddy). `scripts/build-site.mjs` copies every `.schema.json` to `site/spec/v0/...` and validates each `$id` equals the served URL. DNS at Vercel points `skill-map.dev` at Railway. The site is **live**.

### Kernel shell + CLI (Step 0b)

- **Workspace**: root `package.json` with npm workspaces (`spec`, `src`). Changesets (`.changeset/`, `ci.yml`, `release.yml`) manage versioning.
- **Kernel** (`src/kernel/`): 5 port interfaces, `Registry` over the 6 extension kinds, `createKernel()`, `runScan()` stub. Domain types (`Node`, `Link`, `Issue`, `ScanResult`) aligned with spec schemas.
- **CLI** (`src/cli/`): Clipanion v4 binary wired. `sm --version`, `sm --help`, `sm scan [roots...] [--json]` all functional. `bin/sm.mjs` drops a shebang into `dist/cli.js`.
- **Build**: `tsup` (esbuild) produces ESM `dist/` + `.d.ts`. `tsconfig.json` strict with `verbatimModuleSyntax`.
- **Tests** (`src/test/`): `node:test` + `tsx` loader. Green across Registry, `createKernel`, `runScan` stub, CLI spawn, and the conformance runner.
- **Contract runner** (`src/conformance/index.ts`): reads a case JSON, provisions a tmp scope (copies fixture when present), invokes the binary, evaluates six assertion types (`exit-code`, `json-path`, `file-exists`, `file-contains-verbatim`, `file-matches-schema`, `stderr-matches`). `file-matches-schema` is NYI until Step 2 (ajv lands with rules).
- **Conformance case** `kernel-empty-boot` is implemented and passes end-to-end against the stub CLI.
- **CI**: `.github/workflows/ci.yml` runs (a) spec validate (`npm run spec:check` + JSON parse + `build-site.mjs`) and (b) build-test (typecheck + tsup + `node:test`).

### Explicitly postponed

- **`preamble-bitwise-match` conformance case** — moved to **Step 9** (requires `sm job preview` to render a job file; the job system lands at Step 9).
- **Remaining tech stack picks** (YAML parser, MD parser, templating, pretty CLI, globbing, diff) — deferred to the step that first needs them. Lock-in-abstract rejected.

### Conventions locked during bootstrap (do NOT change unilaterally)

- **Casing**: camelCase for every JSON key (domain types, config files, plugin manifests, reports). File names remain kebab-case. Rationale: JS/TS ecosystem, JSON Schema self-convention, Kysely `CamelCasePlugin` alignment.
- **`$id` scheme**: `https://skill-map.dev/spec/v0/<path>.schema.json`. `v0` stays until the first stable cut; then bumps to `v1`. Domain is live (Railway-deployed Caddy; DNS via Vercel).
- **Schema dialect**: JSON Schema 2020-12 everywhere.
- **Identity**: `node.path` is the canonical node identifier in v0 (relative path from scope root). A sibling `id` field (UUID in frontmatter) lands with write-back, post-v1.
- **Required frontmatter**: `name`, `description`, `metadata`, `metadata.version`. Everything else optional.
- **Permissive-shape / strict-rule split**: frontmatter schemas use `additionalProperties: true` because user-authored — policy (`unknown-field` rule) is separate from shape. Summary schemas use `additionalProperties: false` because the kernel controls the output shape and strictness catches model hallucinations.
- **ID formats**: execution record `e-YYYYMMDD-HHMMSS-XXXX`. Run `r-YYYYMMDD-HHMMSS-XXXX`. Job `d-YYYYMMDD-HHMMSS-XXXX`. Same shape, different prefix per scope.
- **Exit codes**: `0` ok · `1` issues · `2` error · `3` duplicate · `4` nonce-mismatch · `5` not-found. `6–15` reserved for future spec use. `≥16` free for verb-specific use.
- **Deprecation window**: 3 minors between `stable → deprecated` and removal.
- **Stability tags**: inline in schema `description` and in prose as `**Stability: experimental**`. No dedicated machine-readable field.
- **Prompt preamble**: the text in `prompt-preamble.md` is **verbatim normative** — byte-for-byte reproducible, hashed into `promptTemplateHash`, stored in the conformance suite as `conformance/fixtures/preamble-v1.txt`.
- **Escape of `</user-content>` inside user content**: insert a zero-width space before `>` (`</user-content&#x200B;>`). Reversed only for display, never when hashing.
- **Storage mode per plugin**: exactly one (`kv` OR `dedicated`). Mixing is forbidden. A plugin that needs both KV-like and relational access uses mode B and implements KV-style rows as a dedicated table.
- **Security scanners**: convention over the Action kind (id prefix `security-`, report extends `report-base` with `scanner` / `findings` / `stats`). NOT a new extension kind — the six kinds remain locked. Marked `Stability: experimental` across v0.x.
- **Env vars**: `SKILL_MAP_SCOPE`, `SKILL_MAP_JSON`, `SKILL_MAP_DB`, `NO_COLOR`. Precedence: flag > env > config > default.

### Rules for AI agents editing `spec/`

1. **Spec is the source of truth**. When spec and `ROADMAP.md` disagree, spec wins. ROADMAP is the design narrative; it may lag.
2. **Every normative change → `spec/CHANGELOG.md` entry** in the `[Unreleased]` section, classified as patch / minor / major per `spec/versioning.md`.
3. **Breaking changes → major bump required**. Do not sneak breaking changes into a minor. The semver policy in `versioning.md` is strict — read it before any structural change.
4. **Update spec first, then `src/`**. The inverse is a policy violation caught in review. If a proposed feature cannot land in spec (because the shape isn't clear yet), it is not ready for implementation.
5. **JSON Schema files MUST parse**. CI enforces this via the `validate` job.
6. **Never hand-edit `conformance/fixtures/preamble-v*.txt`**. The text in `prompt-preamble.md` is authoritative; regenerate fixtures from it.
7. **Cross-schema references**: use relative paths in `$ref` (e.g. `"base.schema.json"`, `"../report-base.schema.json"`). Do NOT use absolute URLs in `$ref` — those are reserved for `$id`.
8. **Prose docs follow the convention**: each ends with a `## Stability` section stating what is stable as of v1.0.0 and what bump is required for future changes.
9. **Schemas under `schemas/frontmatter/*` extend `base.schema.json` via `allOf`**. Schemas under `schemas/summaries/*` extend `../report-base.schema.json` via `allOf`. Do not copy fields; reference them.
10. **Conformance tests** (`spec/conformance/cases/`) MUST exist for every schema before the spec cuts v1.0.0. Missing conformance case → missing release.

### Maintenance checklist (apply on any `spec/` PR)

- [ ] JSON Schema files parse.
- [ ] `$id` is present, uses the canonical scheme, matches the file path.
- [ ] Any new required field has a migration note in `spec/CHANGELOG.md`.
- [ ] camelCase for JSON keys; kebab-case for file names.
- [ ] Stability tag set where non-obvious (`experimental` / `stable` / `deprecated`).
- [ ] `spec/CHANGELOG.md` updated under `[Unreleased]` with the correct classification.
- [ ] If the preamble text changed: conformance fixture regenerated and tests re-run.
- [ ] Prose doc ends with a `## Stability` section.
- [ ] No absolute URL in `$ref`.
- [ ] Extends `base` / `report-base` via `allOf` where applicable; no field duplication.
- [ ] `npm run spec:index` run; `spec/index.json` reflects the change.

## Rules for agents working in this repo

- **Never run `git push`** — pushing is manual.
- **Never commit automatically** — completing work ≠ commit. Commit only when explicitly asked.
- **Never bump versions manually** — every PR that touches a workspace (`spec/` and `src/` today, `ui/` later) ships a `.changeset/*.md` (`npm run changeset`). The release workflow opens a "Version Packages" PR; merging it bumps versions and publishes. See `CONTRIBUTING.md`.
- **Regenerate `spec/index.json` after any `spec/` change** — `npm run spec:index`. CI runs `npm run spec:check` and fails on drift. The integrity block is deterministic; do not hand-edit.
- **All artifacts in English** — code, commits, PRs, docs. Conversation language follows the activation rule at the top.
- **Paths**: prefer relative over absolute in bash commands and agent prompts.
- **Temp files**: use `.tmp/` (project-local, gitignored), not `/tmp/` or `/var/tmp/`. This applies to every temp path an AI agent writes, including intermediate files for `awk`, `sed`, `diff`, `grep`, piped scripts, and extracted snippets. If `.tmp/` does not exist, create it (`mkdir -p .tmp`). Never write a temp file outside the repo.
- **Every feature**: update `spec/` first, then `src/`. No impl feature without a matching spec change.
- **CI green, always** — extensions ship with tests or do not boot.
- **When AGENTS.md and ROADMAP.md disagree**: AGENTS.md wins (it's the current operating manual). ROADMAP.md keeps the narrative and may lag. When `spec/` and either disagree, spec wins.

## Further reading

- `ROADMAP.md` — design narrative, decisions, deferred items, phase-by-phase plan. The completeness marker there flags the last fully-done step.
- `CLAUDE.md` — single-line pointer (`@AGENTS.md`) so Claude Code and Codex pick up this file under either filename.
- `CONTRIBUTING.md` — contribution checklist.
- `README.md` — public landing page.
