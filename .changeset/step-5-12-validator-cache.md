---
"@skill-map/cli": patch
---

Step 5.12 — `loadSchemaValidators()` now caches the compiled validator
set at module level. Before: every call paid ~100 ms cold to read +
AJV-compile 17 schemas (plus 8 supporting `$ref` targets). After: the
first call costs the same; every subsequent call in the same process
returns the same instance for free.

For a one-shot CLI like `sm history stats --json`, this is a no-op
(only one call per process). The win shows up once a future verb
validates at multiple boundaries — likely candidates: `sm doctor`,
`sm record`, plugin manifest re-checks, the audit pipeline. Lays the
groundwork without forcing those callers to thread a cached
validators bundle through their call stacks.

Test-only escape hatch `_resetSchemaValidatorsCacheForTests()`
exported so tests can re-trigger the cold load deterministically. The
public `loadSchemaValidators` signature is unchanged.

Test count: 208 → 211 (+3 in `kernel/adapters/schema-validators.test.ts`).
