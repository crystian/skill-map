-- Step 5.1 — Persist scan-result metadata so `loadScanResult` returns real
-- values for `scope`, `roots`, `scannedAt`, `scannedBy`, `adapters`, and the
-- non-derivable `stats` fields (filesWalked / filesSkipped / durationMs)
-- instead of the synthetic envelope it has been returning since Step 0c.
-- Single-row table (CHECK id = 1); replaced atomically with the rest of
-- the scan_* zone on every `sm scan` via `persistScanResult`.

CREATE TABLE scan_meta (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  roots_json TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  scanned_by_name TEXT NOT NULL,
  scanned_by_version TEXT NOT NULL,
  scanned_by_spec_version TEXT NOT NULL,
  adapters_json TEXT NOT NULL,
  stats_files_walked INTEGER NOT NULL,
  stats_files_skipped INTEGER NOT NULL,
  stats_duration_ms INTEGER NOT NULL,
  CONSTRAINT ck_scan_meta_singleton CHECK (id = 1),
  CONSTRAINT ck_scan_meta_scope CHECK (scope IN ('project','global'))
);
