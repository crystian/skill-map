---
"@skill-map/spec": patch
---

Refresh the `spec/README.md` §Repo layout tree so it matches reality.

The previous tree was frozen at the Step 0a snapshot and listed only 20 schemas (9 top-level + 6 frontmatter + 5 summaries) plus outdated `(Step 0a phase N)` annotations. The actual spec ships 29 schemas (11 top-level + 7 extension + 6 frontmatter + 5 summaries) and the package adds `index.json` and `package.json`.

Changes:

- Show the full set of 29 JSON Schemas with a brace grouping per bucket, making the counts and the `allOf` inheritance (frontmatter kinds → base; summaries → report-base) legible at a glance.
- Add the missing top-level schemas `conformance-case.schema.json` and `history-stats.schema.json`.
- Add the whole `schemas/extensions/` folder (base + one per extension kind) — validated at plugin load.
- List `package.json` and `index.json` explicitly so external readers know they are published assets.
- Drop `(Step 0a phase N)` annotations — Step 0a is complete, the marker is noise.
- Under `conformance/cases/`, note `basic-scan` and `kernel-empty-boot` as the two shipped cases and point at `../ROADMAP.md` for the deferred `preamble-bitwise-match` case.
- Under `interfaces/`, clarify that `security-scanner.md` is a convention over the Action kind, NOT a 7th extension kind — the six kinds remain locked.

Classification: patch. Editorial prose only — no normative schema, rule, or contract changes. Companion updates to `ROADMAP.md` (repo layout + package layout) ship alongside; they are outside the spec package and do not need a changeset.
