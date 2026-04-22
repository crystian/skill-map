---
"@skill-map/spec": minor
---

Align `spec/index.json` with the manifest changes declared in the `0.3.0` changelog (they had been documented but never written to the file), and fix two small referential drifts surfaced in the same audit pass.

**`spec/index.json`** — closes the gap between what `0.3.0` notes promised and what actually shipped:

- `specVersion` top-level field renamed to `indexPayloadVersion`. The old name collided semantically with `specPackageVersion` and with every other use of `specVersion` in the spec (compat logic, `scan-result.specVersion`, `sm help --format json`). `indexPayloadVersion` describes the shape of `index.json` itself and bumps only when this manifest's structure changes — pinned at `0.0.1` today. **This is the breaking rename already announced in the `0.3.0` release notes.**
- `schemas.topLevel` gains `history-stats` (shape for `sm history stats --json`, already referenced from `cli-contract.md` §History and hashed under `integrity.files`).
- New `schemas.extensions` subsection listing the 7 kind-manifest schemas (`base`, `adapter`, `detector`, `rule`, `action`, `audit`, `renderer`) — already required by `architecture.md` §Extension kinds for load-time manifest validation and already present under `schemas/extensions/`.

**`spec/versioning.md` §Change process step 4** — the parenthetical `(see CLAUDE.md: "Every feature: update spec/ first, then src/")` was stale. `CLAUDE.md` has been a bare `@AGENTS.md` pointer since the 18d0c20 dedup; the rule itself lives in `AGENTS.md`. Reference fixed.

**`spec/CHANGELOG.md` 0.3.0 entry** — text-only renumber of "decision #40a" → "decision #40". The sub-letter was a leftover from an unreleased draft; the roadmap Decision log uses `40` as the canonical anchor (see companion ROADMAP edit).

Classification: minor per §Pre-1.0 (`0.Y.Z`). The `specVersion → indexPayloadVersion` rename is breaking for any consumer that read the old field, but the old name never shipped alongside a file that spelled it `indexPayloadVersion` — the rename is being applied here for the first time, not re-applied. The `topLevel`/`extensions` additions are purely additive.
