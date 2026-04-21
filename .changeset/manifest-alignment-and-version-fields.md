---
"@skill-map/spec": minor
---

Manifest alignment pass on `spec/index.json`: expose already-normative schemas, rename the payload-shape field, and add a stable version field consumers can rely on.

- **Rename `specVersion` → `indexPayloadVersion`** (breaking). The old name collided semantically with every other use of `specVersion` (compat logic in `versioning.md`, `scan-result.specVersion`, `sm help --format json`). The field describes the shape of `index.json` itself, not the spec a caller implements.
- **New `specPackageVersion`** top-level field, auto-populated by `scripts/build-spec-index.mjs` from `spec/package.json.version`. This is the source of truth for "which `@skill-map/spec` release is this", previously missing from the manifest — consumers had to read `package.json` separately, and `sm version` was incorrectly reporting the payload-shape version as the spec version.
- **`schemas.topLevel`** gains `history-stats` (shape for `sm history stats --json`, already referenced in `cli-contract.md` §History).
- **New `schemas.extensions` subsection** lists the 7 kind-manifest schemas (`base`, `adapter`, `detector`, `rule`, `action`, `audit`, `renderer`) already required by `architecture.md` §Extension kinds for load-time manifest validation.
- **CHANGELOG fix** on the `[Unreleased]` v0.1.0 line: "10 event types" → "11 canonical event types plus one synthetic `emitter.error`". Text-only correction on a shipped release.
- **README example** updated to show both fields side-by-side so the distinction is obvious to first-time consumers.
- **Integrity block** regenerated.

No schema contents change. The schema files and their normative status are unchanged since 0.1.0; the index now enumerates them all and uses unambiguous field names.

**Migration for consumers**: any caller that reads `specIndex.specVersion` MUST switch to `specIndex.specPackageVersion` (for the release) or `specIndex.indexPayloadVersion` (for the manifest shape). The rename is the source of the `minor` bump rather than `patch` — pre-1.0 minors MAY contain breaking changes per `versioning.md` §Pre-1.0.

Classification: minor per §Pre-1.0. One breaking rename + two additive fields + two additive schema subsections. The reference impl's `sm version` is updated in the same release to read `specPackageVersion`, so `sm version` now reports the actual npm package version (was the payload-shape version, a latent bug).
