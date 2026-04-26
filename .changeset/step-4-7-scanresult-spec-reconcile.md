---
"@skill-map/cli": patch
---

Reconcile the runtime `ScanResult` shape with `spec/schemas/scan-result.schema.json`.

The runtime has been silently violating the spec since Step 0c. The
spec is the source of truth and has been correct all along; this change
is a one-way fix — `src/` catches up to `spec/`. No spec edit, no
spec changeset.

What changed at the runtime boundary:

- `scannedAt` is now `number` (Unix milliseconds, integer ≥ 0). It used
  to be an ISO-8601 `string` that the persistence layer parsed back to
  an int via `Date.parse()`; both conversions are gone. The DB column
  has always been `INTEGER` — only the in-memory shape moved.
- `scope` is now emitted: `'project' | 'global'`. Defaults to
  `'project'`; overridable via the new `RunScanOptions.scope?` field.
  The CLI surface (`sm scan`) hardcodes `'project'` for now — the
  `--global` flag wiring lands in Step 6 (config + onboarding).
- `roots` is now hard-required to be non-empty. `runScan` throws
  `"runScan: roots must contain at least one path (spec requires
  minItems: 1)"` when called with `roots: []`. The CLI already
  defaults `roots = ['.']` when no positional args are supplied, so
  the throw is a programming-error guard, not a user-visible regression.
- `adapters: string[]` is now emitted (the ids of every adapter that
  participated in classification; `[]` when no adapter ran). Optional
  in spec; emitted unconditionally for self-describing output.
- `scannedBy: { name, version, specVersion }` is now emitted.
  `name` is hardcoded `'skill-map'`; `version` is read once at module
  init from this package's `package.json` (static JSON import, same
  pattern as `cli/version.ts`); `specVersion` reuses the existing
  `installedSpecVersion()` helper from the plugin loader (reads
  `@skill-map/spec/package.json#version` off disk, with a safe fallback
  to `'unknown'`).
- `stats.filesWalked: number` is now emitted. Counts every `IRawNode`
  yielded by the adapter walkers. With one adapter it equals
  `nodesCount`; with future multi-adapter scans on overlapping roots
  it will diverge.
- `stats.filesSkipped: number` is now emitted. Spec definition: "Files
  walked but not classified by any adapter." Today every walked file
  IS classified (the `claude` adapter's `classify()` always returns a
  kind, falling back to `'note'`), so this is **always 0**. Wired now
  so the field shape is spec-conformant; meaningful once multiple
  adapters compete (Step 9+).

Ripple changes:

- `persistScanResult` no longer parses `scannedAt`; it validates
  `Number.isInteger(scannedAt) && scannedAt >= 0` and uses the value
  as-is. The error message updated to "expected non-negative integer
  ms"; the matching test case renamed from "rejects an unparseable
  scannedAt" to "rejects a non-integer scannedAt".
- `loadScanResult` returns a synthetic envelope: `scannedAt` is
  derived from `max(scan_nodes.scanned_at)` (or `Date.now()` for
  empty snapshots); `scope` defaults to `'project'`; `roots: ['.']`
  to satisfy the spec's `minItems: 1` (NOT load-bearing — the
  orchestrator's incremental path only reads `nodes` / `links` /
  `issues` from a prior, never the meta); `adapters: []`;
  `stats.filesWalked` / `filesSkipped` / `durationMs` are zeroed.
  The header comment documents the omissions and points at the
  follow-up `state_scan_meta` table that would let the loader return
  real values.
- `ScanCommand` (`sm scan`) explicitly passes `scope: 'project'` into
  `runScan`. No change to the CLI surface.

Self-scan acceptance test (`src/test/self-scan.test.ts`) upgraded:
the per-element node / link / issue validation is replaced with a
single top-level `scan-result.schema.json` validation. This is the
strong assertion for the reconciliation: the whole `ScanResult` now
parses against the authoritative top-level schema.

**Breaking change for runtime consumers**: anyone who was reading the
buggy ISO `scannedAt` string off `result` (or from `JSON.stringify(result)`
via `sm scan --json`) now sees an integer. The fix is one line:
`new Date(result.scannedAt)`. The runtime contract was buggy — the
spec said integer all along — but the buggy runtime was the de-facto
contract for downstream tooling tracking the `0.3.x` line, so call
this out explicitly. `schemaVersion` stays at 1 because the spec did
not move.
