---
'@skill-map/cli': minor
---

Split the orchestrator's `walkAndExtract` into three named helpers and
close audit item V4 by reusing the kernel's extractor loop from
`sm refresh`. **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0;
the API addition below would warrant a minor on its own, and the
internal split is non-breaking (no public signature changes).

## Why

`walkAndExtract` was the audit's most-flagged complexity offender
(cyclomatic 47 — by a wide margin the worst offender in the kernel).
Three logically distinct concerns lived in the same function:
extractor-execution wiring, per-(node, extractor) cache decision, and
the reused-node bundle for full cache hits. Splitting them buys
readability, isolates the `IExtractorContext` plumbing in one place
that `refresh.ts` can reuse, and unblocks the next round of audit
follow-ups.

Independently, `cli/commands/refresh.ts#runExtractorForEnrichment` was
hand-duplicating the extract-and-fold dance: it built its own
`IExtractorContext`, did the scope-aware `body` / `frontmatter`
gating, folded partials into a single record, and hardcoded
`isProbabilistic: false`. That was audit item V4, and the hardcode was
a latent correctness bug — a probabilistic extractor passed to refresh
persisted with `isProbabilistic: false` while the in-scan path
correctly read `extractor.mode === 'probabilistic'`.

## What

### `src/kernel/orchestrator.ts` — three new helpers

- **`runExtractorsForNode(opts)`** — `export`ed. Runs N extractors
  against a single node and returns
  `{ internalLinks, externalLinks, enrichments }`. Encapsulates the
  `IExtractorContext` build + `emitLink` / `enrichNode` callback
  wiring + per-`(node, extractor)` enrichment folding. Reuses the
  existing private helpers (`buildExtractorContext`, `validateLink`,
  `isExternalUrlLink`).
- **`computeCacheDecision(opts)`** — internal. Returns
  `{ applicableExtractors, applicableQualifiedIds, cachedQualifiedIds,
  missingExtractors, fullCacheHit }` for one node. Handles both the
  fine-grained `priorExtractorRuns` case and the legacy fallback
  (when the caller did not load breadcrumbs — preserves the pre-A.9
  contract).
- **`reusePriorNode(opts)`** — internal. Builds the reused-node
  bundle for a full cache hit: shallow-clones the prior node, reshapes
  its outbound links per A.9 sources rules
  (`reuseCachedLink(...)`), re-emits prior frontmatter issues with the
  current `strict` severity, and persists `scan_extractor_runs` rows
  for every still-applicable, still-cached pair so the cache survives
  the next `replace-all` persist.

`walkAndExtract` complexity dropped **47 -> 35** (-12 points). The
two new private helpers sit at 9 and 10 — just above the lint
threshold of 8 — so visible debt remains, but the net architectural
improvement is the worth-having change. Promoting `complexity` to
`error` is deferred until the next round of splits brings the
remaining offenders down.

### `src/kernel/index.ts` — export `runExtractorsForNode`

Added to the orchestrator export block. New public kernel API; the
shape mirrors `walkAndExtract`'s internal call exactly so embedders
can reproduce a single-node extract pass without going through a full
scan.

### `src/cli/commands/refresh.ts` — close audit V4

`runExtractorForEnrichment` now delegates to `runExtractorsForNode`
with a single-element extractor array. Refresh keeps the returned
`enrichments` and discards the link arrays — link rebuilding is
`sm scan`'s job and refresh stays scoped to the enrichment layer.
~30 lines of duplication eliminated; the `isProbabilistic` field now
correctly reflects `extractor.mode === 'probabilistic'`. Imports
trimmed accordingly (`qualifiedExtensionId`, `IExtractorContext`,
`Link` are no longer needed); `InMemoryProgressEmitter` is added
as a throwaway emitter to satisfy the new API surface — refresh does
not expose progress events.

### `package.json` (root) — `validate` script also runs tests

`npm run validate` was lint-only; it now runs `npm run test &&
npm run lint --workspaces --if-present`. Intentional — local
`validate` becomes a proper pre-push gate. CI's `build-test` workflow
already runs tests separately, so the "Validate" step now overlaps
with it; that overlap is acknowledged and left for a follow-up
decision.

## Out of scope

The remaining `walkAndExtract` complexity (35) is still above the
threshold; further splits (provider walk, per-node frontmatter
validation) will follow in the next pass. Bonus correctness fix on
`isProbabilistic` is documented above but no behaviour test is added
in this commit — the in-scan path already exercises the field
correctly, and refresh's caller surface does not currently propagate
the flag.
