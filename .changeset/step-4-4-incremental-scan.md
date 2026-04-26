---
"@skill-map/cli": patch
---

Add `sm scan -n` / `--dry-run` (in-memory, no DB writes) and `sm scan
--changed` (incremental scan against the persisted prior snapshot).

`-n` / `--dry-run` runs the full pipeline in memory and skips every DB
operation (no auto-migration, no persistence). The human-mode summary
now ends with `Would persist N nodes / M links / K issues to <path>
(dry-run).` so the operator sees what would land. `--json` output is
unchanged.

`--changed` opens the project DB read-side, loads the prior snapshot via
the new `loadScanResult` helper, walks the filesystem, and reuses
unchanged nodes (matched by `path` + `bodyHash` + `frontmatterHash`).
Only new / modified files run through the detector pipeline; rules
always re-run over the merged graph (issue state can change for an
unchanged node when a sibling moves). Persistence semantics are
unchanged — replace-all over the merged ScanResult — so the on-disk
shape stays canonical regardless of how the result was assembled.

Combination rules:

- `--changed --no-built-ins` is rejected with exit code 2 — a
  zero-filled pipeline has nothing to merge against.
- `--changed -n` is supported: load the prior, compute the merged
  result, emit it, do NOT persist. Useful for "what would change?"
  inspection.
- `--changed` against an empty / missing DB degrades to a full scan and
  prints `--changed: no prior snapshot found; running full scan.` to
  stderr. Exit code unaffected.

Internals: `runScan` gains an optional `priorSnapshot` field on
`RunScanOptions`. The orchestrator emits `scan.progress` events with a
new `cached: boolean` field so future UIs can show the
reused-vs-reprocessed delta. External pseudo-links are never persisted,
so for cached nodes the prior `externalRefsCount` is preserved as-is;
new / modified nodes recompute it from a fresh detector pass. The
`loadScanResult` helper documents the external-pseudo-link omission
explicitly — it returns zero pseudo-links by definition, but the
per-node count survives in the loaded node row.
