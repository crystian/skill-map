---
"@skill-map/cli": patch
---

Step 6.2 — Layered config loader for `.skill-map/settings.json`. Walks the
six canonical layers (defaults → user → user-local → project → project-local
→ overrides), deep-merges per key, validates each layer against the
`project-config` JSON schema, and is resilient per-key: malformed JSON,
schema violations, and type mismatches emit warnings and skip the offending
input without invalidating the rest of the layer. Strict mode (`--strict`,
wired in 6.3+) re-routes every warning to a thrown `Error`.

**Runtime change**:

- `src/config/defaults.json` — bundled defaults derived from `project-config.schema.json`
  property descriptions (autoMigrate, tokenizer, scan.*, jobs.*, history.share, i18n.locale).
- `src/kernel/config/loader.ts` — `loadConfig(opts)` entry point. Returns
  `{ effective, sources, warnings }`:
    - `effective` — fully merged `IEffectiveConfig`.
    - `sources` — `Map<dotPath, layerName>` so `sm config show --source` (6.3)
      can answer who set what.
    - `warnings` — accumulated diagnostics; empty when the load was clean.
- Layer dedup: when `scope === 'global'`, project layers (4/5) resolve to
  the same files as user layers (2/3) and are skipped to avoid double-merging
  the same source.
- Deep-merge semantics: nested objects merge per key; arrays replace whole;
  `null` values are preserved (e.g. `jobs.retention.failed`).
- Schema-failure handling: AJV errors are walked once; `additionalProperties`
  errors strip the unknown key, type/const/etc. errors strip the offending
  leaf. The cleaned object is then merged so a single bad value never
  invalidates the rest of the layer.
- No CLI surface yet — `sm config` verbs (6.3) and `--strict` flag
  (6.3+) consume this loader; the API is internal until then.

**Tests**: `src/test/config-loader.test.ts` covers defaults application,
five-layer precedence, override layer, global-scope dedup, deep-merge
nested objects + array replacement + null preservation, malformed-JSON
warning + skip, unknown-key strip, type-mismatch strip, partial-bad-file
continues, non-object root rejection, and three strict-mode escalations
(JSON / schema / unknown-key).

Test count: 213 → 231 (+18).
