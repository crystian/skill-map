---
'@skill-map/cli': minor
---

Step 8.2 — `sm scan --compare-with <path>` delta report

Second sub-step of Step 8 (Diff + export). Adds a flag to `sm scan` that
loads a saved `ScanResult` dump, runs a fresh scan in memory, and emits
a delta between the two snapshots. Never touches the DB.

**Flag**:

- `--compare-with <path>` — string, optional. Points at a JSON file
  conforming to `scan-result.schema.json` (typically the output of an
  earlier `sm scan --json > baseline.json` invocation).

**Behaviour**:

- Loads the dump, parses it, validates against `scan-result.schema.json`
  via the existing `loadSchemaValidators()` adapter.
- Runs a fresh scan with the same wiring as a normal `sm scan` (built-ins,
  layered config, ignore filter, strict mode). Skips persistence — the
  verb's contract is read-only.
- Computes a delta via the new `computeScanDelta` kernel helper and
  emits a report.

**Identity contract** (recorded in `src/kernel/scan/delta.ts`):

- **Node** identity = `path`. Two nodes with the same path are the same
  node; differences become a `changed` entry annotated with the reason
  (`'body'` / `'frontmatter'` / `'both'`) so a renderer / summariser can
  decide whether the change is interesting.
- **Link** identity = `(source, target, kind, normalizedTrigger ?? '')`.
  Mirrors the `sm show` aggregation key and Step 7.2's `link-conflict`
  rule — the `sources[]` union and confidence are presentation facets
  that don't constitute identity.
- **Issue** identity = `(ruleId, sorted nodeIds, message)`. Matches the
  diff key `spec/job-events.md` §issue.\* defines for future job events,
  so consumers can reuse the same logic.

No "changed" bucket for links / issues — identity already captures
everything that matters there. Nodes get one because the path stays
stable while the body / frontmatter rewrites, and that change matters
to downstream consumers (renderers, summarisers, the UI inspector).

**Output**:

- Pretty (default): one-line header with totals per bucket, then a
  `## nodes` / `## links` / `## issues` section per non-empty bucket
  using `+` (added), `-` (removed), `~` (changed) prefixes. Identical
  scans get a `(no differences)` hint.
- `--json`: emits the `IScanDelta` object — `{ comparedWith, nodes:
  { added, removed, changed }, links: { added, removed }, issues:
  { added, removed } }`. Schema is implementation-defined pre-1.0 per
  `spec/cli-contract.md` and intentionally not pinned to a separate
  `delta.schema.json` until consumers materialise.

**Exit codes** (per `spec/cli-contract.md` §Exit codes):

- `0` — empty delta. Snapshot matches the dump byte-for-identity.
- `1` — non-empty delta. Pre-commit / pre-merge wiring trips here.
- `2` — operational error: dump file missing, malformed JSON, or
  schema-violating dump.

**Combo rules**:

- `--compare-with` cannot be combined with `--changed`, `--no-built-ins`,
  `--allow-empty`, or `--watch`. The first three are incoherent (a
  zero-filled or partial current scan makes the delta meaningless); the
  last is a different lifecycle.
- `--dry-run` is implicit (no DB writes happen anyway), so the combo is
  silently allowed as a no-op.
- `--strict` and `--no-tokens` are honoured — they affect what the
  fresh scan produces, which then drives the delta.

**Kernel surface**:

- New module `src/kernel/scan/delta.ts` exporting `computeScanDelta`,
  `isEmptyDelta`, `IScanDelta`, `INodeChange`, `TNodeChangeReason`.
- Re-exported from `src/kernel/index.ts` for plugin authors and
  alternative drivers.

**Tests** (`src/test/scan-compare.test.ts`, 12 cases): identical fixture
→ empty delta exit 0; body / frontmatter edits surface with the right
reason; new file → added node + added link; deleted file → removed node;
`--json` shape matches `IScanDelta`; missing / non-JSON / schema-violating
dumps exit 2; combo rejections for `--changed`, `--no-built-ins`,
`--watch`. Test count: 351 → **363** (+12).

**No spec change**: the `sm scan --compare-with <path>` row in
`spec/cli-contract.md` was already in place since Step 0a. This is pure
runtime catch-up — wiring the verb that the spec already promised.
