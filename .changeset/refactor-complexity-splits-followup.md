---
'@skill-map/cli': patch
---

Code-quality follow-up to commit `91fea6a` — split the next three
high-complexity offenders into focused private helpers. **Patch bump**:
zero public API changes (every refactored function keeps its exported
signature; no new exports); pure internal restructuring.

## Why

The previous round closed `walkAndExtract` (47 -> 35) but left three
"monster" call sites that the lint pass kept flagging week after week.
Three sequential algorithm steps stuffed into one body each is the
shape that makes the lint warning pile feel permanent — once the steps
are named, the warning disappears and the next reader gets a free
table of contents.

## What

### `src/kernel/orchestrator.ts` — `detectRenamesAndOrphans` (24 -> <8)

Five private helpers, one per step of the spec'd pipeline:

- `findHighConfidenceRenames(opts)` — step 1, body-hash match.
- `buildFrontmatterRenameCandidates(opts)` — step 2, bucket newPaths
  by `frontmatterHash`.
- `claimSingletonRenames(opts)` — step 3a, medium-confidence
  singletons.
- `flagAmbiguousRenames(opts)` — step 3b, multi-candidate ambiguity.
- `flagOrphans(opts)` — step 4, unclaimed deletions.

`detectRenamesAndOrphans` itself is now a 15-line orchestrator that
threads the shared `claimedDeleted` / `claimedNew` / `issues`
collections through the helpers in order. Every helper sits below the
complexity threshold (no new lint warnings introduced). The mutation
contract — helpers update the supplied sets in place — is documented
on each JSDoc.

### `src/kernel/adapters/sqlite/scan-persistence.ts` — `persistScanResult` (23 -> <8)

The async transaction callback was 180+ lines doing four distinct
things. Three new private helpers, all taking the live `Transaction`
plus the slice of state they own:

- `replaceAllScanZone(trx, result, scannedAt, extractorRuns)` —
  the replace-all on `scan_*` tables + `scan_extractor_runs`.
- `upsertEnrichmentLayer(trx, result, renameOps, enrichments)` —
  A.8 enrichment steps 1+2+3 (rename migration + drop disappeared +
  upsert fresh).
- `flagStaleProbabilisticEnrichments(trx, result, enrichments)` —
  A.8 enrichment step 4 (mark stale prob rows).

The transaction body is now ~10 lines orchestrating: rename FK
migration, stranded-orphan detection (still inline because it's small
and tightly coupled to `result.issues` / `result.stats` mutation),
then the three helpers. Added `Transaction<IDatabase>` import from
`kysely` to type the helper parameters.

### `src/kernel/adapters/sqlite/scan-persistence.ts` — `nodeToRow` / `linkToRow` justified disables

These are pure column-by-column mappings: every `??` adds one to
cyclomatic count, but there are zero branches. Splitting would be
ceremony for a function with one purpose. Added
`// eslint-disable-next-line complexity` with a comment on each
explaining the justification.

### `src/kernel/scan/query.ts` — `parseExportQuery` (15 -> 11)

Two private helpers extracted for the validators that contained the
inner loops (the switch over `key` had inline `for (v of values)`
with throw-on-invalid):

- `parseKindValues(values)` — validates kind tokens, returns
  `NodeKind[]`.
- `parseHasValues(values)` — validates has tokens, returns boolean
  (true iff `issues` is present).

`parseExportQuery` still sits at 11 — just above the threshold of 8.
Further splitting would dilute clarity (the remaining body is the
clause loop itself plus the unknown-key default), so the residual
warning is acceptable for now.

## Net effect on lint

- Previous baseline (commit `91fea6a`): 84 warnings.
- After this commit: **80 warnings** (-4 net).
- Three "monster" complexity sites eliminated (24, 23 -> <8). One
  reduced (15 -> 11). Two justified disables (13 and 12, pure
  mappings).
- Zero new warnings introduced — every extracted helper is below
  threshold.
- 602 / 602 tests still green.

## Out of scope

Three high-complexity sites remain and are intentionally left for
their own dedicated session, because each carries enough behavioural
risk that a focused testing pass before the split is the right
approach:

- `scan.ts:execute()` (complexity 38, 338 lines) — the main scan
  command; regressions would break the most-used CLI verb.
- `loadOne` in `plugin-loader.ts` (complexity 31) — flagged by the
  audit; same reasoning.
- `walkAndExtract` (still at 35 from earlier) — more splits possible
  (the partialCacheHit / buildNode branches), but this commit focuses
  on net-new wins.
