---
"@skill-map/cli": patch
---

Step 6.7 — Frontmatter strict mode. The orchestrator now validates each
node's parsed frontmatter against `frontmatter/<kind>.schema.json`
during `sm scan` and emits a `frontmatter-invalid` issue when the shape
doesn't conform. Severity is `warn` by default (scan still exits 0);
`--strict` (CLI) or `scan.strict: true` (config) promote every such
finding to `error` so the scan exits 1.

**Runtime change**:

- `src/kernel/adapters/schema-validators.ts` — registers
  `frontmatter-skill / -agent / -command / -hook / -note` as named
  top-level validators (they were already loaded as supporting schemas
  via the AJV `$ref` graph; this step exposes them through the
  `validate(name, data)` surface). Reuses the module-level cache from
  Step 5.12 — the validators compile once per process.
- `src/kernel/orchestrator.ts` — new `RunScanOptions.strict?: boolean`
  field. After each adapter yields a node, the orchestrator validates
  the parsed frontmatter (skipping when no `---` fence is present, so
  fence-less notes stay clean). A failure produces a single
  `frontmatter-invalid` issue with `severity: 'warn' | 'error'` per
  the `strict` flag, the path in `nodeIds`, the AJV error string in
  `message`, and `data: { kind, errors }` for downstream tools.
  Issues collected during the walk land in the result alongside the
  rule-emitted ones.
- Incremental-scan (`--changed`) preservation: a per-path
  `priorFrontmatterIssuesByNode` index walks the prior result once;
  on a cache hit, the previously-emitted frontmatter issue is re-pushed
  (re-validating would be wasted work since `frontmatterHash` is
  unchanged). The `strict` flag still applies on the second pass — a
  cached `warn` from the first scan becomes `error` on a strict
  re-run.
- `src/cli/commands/scan.ts` — new `--strict` flag. The CLI also reads
  `cfg.scan.strict` (already in the project-config schema since 0.1)
  and passes `strict: this.strict || cfg.scan.strict === true` to
  `runScan`. CLI flag wins when both are set.
- `context/cli-reference.md` — regenerated; `--strict` appears under
  `sm scan` with its description.

**Tests**:

- `src/test/scan-frontmatter-strict.test.ts` — 12 tests covering
  fence-less files (no issue), fenced-but-incomplete frontmatter
  (warn issue, message names the missing field), `strict: true`
  promotion to error, valid frontmatter (no issue), type-mismatch
  on a base field (`name: 42` flagged), per-kind schemas
  (skill / command / hook / note each emit one issue with the
  matching `data.kind`), incremental preservation of the cached
  issue, incremental + strict promotion, and four CLI tests via
  the binary (`sm scan` exit 0 with warnings, `--strict` → exit 1,
  `scan.strict: true` config → exit 1, `--strict` overrides
  `scan.strict: false` config).
- `src/test/scan-readers.test.ts` — `rollback.md` fixture extended to
  include `description` + `metadata` so the `--issue` filter test
  remains semantically correct (rollback.md is the issue-free node).
- `src/test/scan-benchmark.test.ts` — 500-MD perf budget bumped from
  2000ms → 2500ms with a comment explaining the AJV per-file cost
  (~50-80μs × 500 = ~25-40ms over the prior ceiling). Warm-scan
  reality on a developer laptop stays around 1.0-1.2s; the new
  ceiling preserves headroom for slow CI without lowering the bar.

Test count: 291 → 303 (+12).
