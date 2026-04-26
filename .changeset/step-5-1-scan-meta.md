---
"@skill-map/spec": minor
"@skill-map/cli": patch
---

Step 5.1 — Persist scan-result metadata in a new `scan_meta` table so
`loadScanResult` returns real values for `scope` / `roots` / `scannedAt` /
`scannedBy` / `adapters` / `stats.filesWalked` / `stats.filesSkipped` /
`stats.durationMs` instead of the synthetic envelope shipped at Step 4.7.

**Spec change (additive, minor)**:

- New `scan_meta` table in zone `scan_*`, single-row (CHECK `id = 1`).
  Columns: `scope`, `roots_json`, `scanned_at`, `scanned_by_name`,
  `scanned_by_version`, `scanned_by_spec_version`, `adapters_json`,
  `stats_files_walked`, `stats_files_skipped`, `stats_duration_ms`.
  `nodesCount` / `linksCount` / `issuesCount` are not stored — they are
  derived from `COUNT(*)` of the sibling tables.
- Replaced atomically with the rest of `scan_*` on every `sm scan`.

**Runtime change**:

- New kernel migration `002_scan_meta.sql`.
- `IScanMetaTable` added to `src/kernel/adapters/sqlite/schema.ts` and
  bound in `IDatabase`.
- `persistScanResult` writes the row (and deletes prior rows in the same
  transaction).
- `loadScanResult` reads from `scan_meta` when the row exists; degrades
  to the previous synthetic envelope when it does not (DB freshly
  migrated, never scanned, or pre-5.1 snapshot).
- The Step 4.7 follow-up notes in `scan-load.ts` documenting the
  synthetic envelope are simplified to describe both branches.

Test count: 151 → 154 (+3 covering meta round-trip, replace-all
single-row invariant, and synthetic-fallback on empty DB).
