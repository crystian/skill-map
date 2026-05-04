# Spec editing rules

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before editing anything under `spec/`.

## Rules for AI agents editing `spec/`

1. **Spec is the source of truth**. When spec and `ROADMAP.md` disagree, spec wins. ROADMAP is the design narrative; it may lag.
2. **Every normative change → `spec/CHANGELOG.md` entry** in the `[Unreleased]` section, classified as patch / minor / major per `spec/versioning.md`.
3. **Breaking changes → major bump required (post-v1.0.0)**. Do not sneak breaking changes into a minor once the spec hits v1.0.0. **Pre-1.0 exception**: while the spec is `0.Y.Z`, breaking changes ship as minor bumps per `versioning.md` § Pre-1.0 (also restated in AGENTS.md §Rules for agents working in this repo). Either way, classify the change correctly in `CHANGELOG.md`.
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
- [ ] `npm run spec --workspace=@skill-map/spec` run; `spec/index.json` reflects the change.
