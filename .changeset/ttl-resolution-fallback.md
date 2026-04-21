---
"@skill-map/spec": patch
---

Clarify the TTL resolution procedure in `spec/job-lifecycle.md`.

The previous text defined the formula as `ttlSeconds = max(expectedDurationSeconds × graceMultiplier, minimumTtlSeconds)` and said the precedence chain was `global default → manifest → user config → flag`. Two problems:

- When `expectedDurationSeconds` is absent from the manifest (typical for `mode: local` actions), the formula is undefined. The existing config key `jobs.ttlSeconds` was documented elsewhere as a "global fallback" but never tied into the formula.
- The word "precedence" collapsed three distinct mechanisms — base value selection, formula application, and full override — into one list, so `minimumTtlSeconds` (a floor, never a default) appeared as the first entry of a "later wins" chain.

This patch rewrites the §TTL precedence section as §TTL resolution, split into three explicit steps:

1. **Base duration**: manifest `expectedDurationSeconds` OR config `jobs.ttlSeconds` (default `3600`).
2. **Computed TTL**: `max(base × graceMultiplier, minimumTtlSeconds)`.
3. **Overrides** (later wins, skips formula): `jobs.perActionTtl.<actionId>`, then `--ttl` flag.

Five worked examples added. Negative / zero overrides are rejected at submit time (exit 2). A Stability note states the procedure is locked going forward — new override sources are minor, formula-shape changes are major. The §Submit checklist step 5 now references the new §TTL resolution section instead of inlining a broken one-liner.

Classification: patch. No field or schema changed. Every existing manifest and config combination resolves to the same TTL except for the previously-undefined case (manifest without `expectedDurationSeconds`), which was silently implementation-defined; the new text makes the `jobs.ttlSeconds` fallback normative. Companion prose updates land in `ROADMAP.md §TTL per action` and §Notable config keys.
