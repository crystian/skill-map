---
"@skill-map/cli": patch
---

Step 5.9 — Orphan issues now persist across scans as long as `state_*`
has stranded references. Closes a gap surfaced during end-to-end
walkthrough.

**The bug**: `persistScanResult` does `DELETE FROM scan_issues` before
inserting the new issues. The per-scan rename heuristic
(`detectRenamesAndOrphans`) only emits `orphan` for paths in `prior \
current` of the *immediately preceding* scan. So after a deletion-scan
emitted an `orphan` issue, the very next scan (with no further
mutations) wiped that issue and emitted nothing — leaving the stranded
`state_*` rows invisible. Worst consequence:
`sm orphans reconcile <orphan.path>` requires an active orphan issue,
so once the issue silently expired, the user had no way to reconcile
the stranded references.

This contradicts `spec/db-schema.md` §Rename detection:

> "the kernel emits an issue (...) and keeps the `state_*` rows
> referencing the dead path untouched **until the user runs
> `sm orphans reconcile`** or accepts the orphan."

The "until" language implies the issue stays surfaceable as long as
the stranded refs remain.

**The fix**: new `findStrandedStateOrphans(trx, livePaths)` helper in
`src/kernel/adapters/sqlite/history.ts` sweeps every node reference
across `state_jobs`, `state_executions` (json_each over the JSON
array), `state_summaries`, `state_enrichments`, and `state_plugin_kvs`
(skipping the empty-string sentinel for plugin-global keys). Returns
the set of distinct `node_id` values not present in the live snapshot,
deterministically lex-asc.

`persistScanResult` calls the sweep AFTER applying `renameOps` and
BEFORE the replace-all of `scan_issues`. For each stranded path not
already covered by a per-scan orphan issue, it appends a new orphan
issue to `result.issues`. Then the replace-all writes the augmented
list. `result.stats.issuesCount` is updated to keep `sm scan --json`
self-consistent.

**Behaviour**:

- High / medium renames migrate state_* → no stranded refs → no extra
  orphan issues. Unchanged.
- Ambiguous → state stays on the old paths → next scan emits orphans
  for each previously-stranded path automatically.
- Pure orphan (deleted, no rename match) → emits orphan in the same
  scan, persists across subsequent scans until the user reconciles
  via `sm orphans reconcile <path> --to <new.path>` or rewrites the
  state row manually.
- Once `state_*` no longer references the dead path, the next scan
  emits no orphan for it. Self-healing.

The sweep is deduplicated against per-scan emissions via
`knownOrphanPaths`, so the same path never appears twice in
`scan_issues` after a single scan.

Tests: 2 new in `rename-heuristic.test.ts`:

- "orphan issue persists across subsequent scans while state_*
  references the dead path" — 4 scans walking the full lifecycle
  (seed → delete → re-scan persistence → reconcile-via-state-edit).
- "per-scan orphan and stranded sweep do not duplicate the same path"
  — same path emitted by both pathways, only 1 issue in result.

Test count: 204 → 206.
