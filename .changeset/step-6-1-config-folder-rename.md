---
"@skill-map/spec": patch
---

Step 6.1 — Spec migration: rename the canonical config file from
`.skill-map.json` (single project-root file) to `.skill-map/settings.json`
inside the `.skill-map/` scope folder, with a sibling `.skill-map/settings.local.json`
partner for machine-specific overrides. Aligns the spec with the layered
config hierarchy described in the roadmap (library defaults → user → user-local
→ project → project-local → env / flags).

**Spec change (breaking, minor under pre-1.0 versioning policy)**:

- `spec/schemas/project-config.schema.json` description updated to point at
  `.skill-map/settings.json` and explicitly mention the `.local.json` partner
  and the layered-merge contract. The schema *shape* (keys, types, validation
  rules) is unchanged — only the on-disk filename moves. Consumers that read
  values without caring about the source path are unaffected; consumers that
  hard-code the filename must update.
- `spec/db-schema.md` §Scopes: `history.share: true` reference updated to
  `.skill-map/settings.json`.
- `spec/conformance/coverage.md` row #6 description updated to reference the
  new path and the optional `settings.local.json` overlay.

**Why minor (not major) at pre-1.0**: per `spec/versioning.md` §Pre-1.0,
breaking changes ARE allowed in minor bumps while the spec is `0.y.z`. The
shape of the data is unchanged; only the file name on disk moves.

**No backward-compat shim**: there is no real implementation of the loader
yet (lands in 6.2), so no live consumer reads `.skill-map.json` today. The
only known prior reference is the demo `mock-collection/.claude/commands/init*.md`
fixture, which is updated together with `sm init` in 6.5.

**Runtime change**: none in 6.1 — pure spec edit. The matching loader,
`sm init`, and `sm config` verbs land in subsequent sub-steps.

**Roadmap update**: `ROADMAP.md` §Configuration "Spec migration" call-out
flipped from "pending" to "landed Step 6.1, 2026-04-27".

Test count: unchanged (213 → 213 — spec-only edit).
