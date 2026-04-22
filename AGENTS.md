# AGENTS.md

Operating manual for AI agents working on **skill-map**. Day-to-day agent guidance only; the product overview lives in `README.md` and the full design narrative in `ROADMAP.md`.

**Authority order when sources disagree**: `spec/` > `ROADMAP.md` > `AGENTS.md`. Spec is always source of truth for the standard. ROADMAP.md is the canonical design narrative and planning authority. AGENTS.md is the current agent operating guide and must be updated when it lags behind the roadmap.

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

## Rules for agents working in this repo

- **Never run `git push`** — pushing is manual.
- **Never commit automatically** — completing work ≠ commit. Commit only when explicitly asked.
- **Never bump versions manually** — every PR that touches a workspace (`spec/` and `src/` today, `ui/` later) ships a `.changeset/*.md` (`npm run changeset`). The release workflow opens a "Version Packages" PR; merging it bumps versions and publishes. See `CONTRIBUTING.md`.
  - **Exception — README badges**: the hardcoded `spec-vX.Y.Z` and `impl-vX.Y.Z` badges in `README.md` and `README.es.md` must be bumped manually alongside the Version Packages PR. Keep both READMEs in sync. See the "README badges — manual version bump" section in `CONTRIBUTING.md`.
- **Regenerate `spec/index.json` after any `spec/` change** — `npm run spec:index`. CI runs `npm run spec:check` and fails on drift. The integrity block is deterministic; do not hand-edit.
- **Keep `ROADMAP.md` in sync** — `ROADMAP.md` is a living document, not a one-shot artifact. Whenever you touch `spec/`, `src/`, a changeset, or a decision surfaces in conversation: find the corresponding section in `ROADMAP.md` and update it in the same change (examples, decision table, execution plan, last-updated line, completeness marker). The authority order (`spec/` > `ROADMAP.md` > `AGENTS.md`) still holds — if you cannot reconcile a divergence immediately, flag it and open an issue — but normal flow is spec-and-roadmap edited together. Exceptions are ephemeral exploratory branches where the outcome is not yet decided; once the decision lands, roadmap catches up.
- **All artifacts in English** — code, commits, PRs, docs. Conversation language follows the activation rule at the top.
- **Paths**: prefer relative over absolute in bash commands and agent prompts.
- **Temp files**: use `.tmp/` (project-local, gitignored), not `/tmp/` or `/var/tmp/`. This applies to every temp path an AI agent writes, including intermediate files for `awk`, `sed`, `diff`, `grep`, piped scripts, and extracted snippets. If `.tmp/` does not exist, create it (`mkdir -p .tmp`). Never write a temp file outside the repo.
- **Every feature**: update `spec/` first, then `src/`. No impl feature without a matching spec change.
- **CI green, always** — extensions ship with tests or do not boot.
- **When AGENTS.md and ROADMAP.md disagree**: ROADMAP.md wins (it is the canonical design narrative and planning authority). AGENTS.md should be updated to match. When `spec/` and either disagree, spec wins.

## Rules for AI agents editing `spec/`

1. **Spec is the source of truth**. When spec and `ROADMAP.md` disagree, spec wins. ROADMAP is the design narrative; it may lag.
2. **Every normative change → `spec/CHANGELOG.md` entry** in the `[Unreleased]` section, classified as patch / minor / major per `spec/versioning.md`.
3. **Breaking changes → major bump required**. Do not sneak breaking changes into a minor. The semver policy in `versioning.md` is strict — read it before any structural change.
4. **Update spec first, then `src/`**. The inverse is a policy violation caught in review. If a proposed feature cannot land in spec (because the shape isn't clear yet), it is not ready for implementation.
5. **JSON Schema files MUST parse**. CI enforces this via the `validate` job.
6. **Never hand-edit `conformance/fixtures/preamble-v*.txt`**. The text in `prompt-preamble.md` is authoritative; regenerate fixtures from it.
7. **Cross-schema references**: use relative paths in `$ref` (e.g. `"base.schema.json"`, `"../report-base.schema.json"`). Do NOT use absolute URLs in `$ref` — those are reserved for `$id`.
8. **Prose docs follow the convention**: each ends with a `## Stability` section stating what is stable as of v1.0.0 and what bump is required for future changes.
9. **Schemas under `schemas/frontmatter/*` extend `base.schema.json` via `allOf`**. Schemas under `schemas/summaries/*` extend `../report-base.schema.json` via `allOf`. Do not copy fields; reference them.
10. **Conformance tests** (`spec/conformance/cases/`) MUST exist for every schema before spec v1.0.0 ships. Missing conformance case → missing release.

## Maintenance checklist (apply on any `spec/` PR)

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

## Further reading

- `README.md` — product overview, philosophy, repo layout, specification surface, glossary pointers.
- `ROADMAP.md` — design narrative, decisions, execution plan, stack conventions, persistence, testing, rejected proposals. The completeness marker flags the last fully-done step.
- `spec/` — normative standard: JSON Schemas, prose contracts (`architecture.md`, `cli-contract.md`, `job-lifecycle.md`, `job-events.md`, `prompt-preamble.md`, `db-schema.md`, `plugin-kv-api.md`), conformance suite.
- `CONTRIBUTING.md` — PR workflow, changeset rules.
- `CLAUDE.md` — single-line pointer (`@AGENTS.md`) so Claude Code and Codex pick up this file under either filename.
