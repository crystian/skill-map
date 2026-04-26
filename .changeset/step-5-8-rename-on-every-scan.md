---
"@skill-map/cli": patch
---

Step 5.8 — fire the rename heuristic on every `sm scan`, not just
`sm scan --changed`. Closes the follow-up flagged at the close of
Step 5.

Before this change, `priorSnapshot` in `RunScanOptions` carried two
coupled responsibilities:

1. Source for the rename heuristic (5.5).
2. Source for cache reuse (5.4 / Step 4.4 — skip detectors on
   hash-matching nodes).

Loading prior was gated on `--changed` in `scan.ts`, so a plain
`sm scan` after reorganising files emitted no rename / orphan issues
and migrated no `state_*` FKs. The user-visible expectation — and a
defensible reading of the spec ("`sm scan` is the only surface that
triggers automatic rename detection") — is that **every** `sm scan`
fires the heuristic.

The fix decouples the two responsibilities:

- New `RunScanOptions.enableCache?: boolean` (default `false`).
  Controls cache reuse only. The orchestrator's "cached" check is now
  `enableCache && prior !== null && hashes match`.
- `priorSnapshot` reverts to a single meaning: "data from the prior
  scan". Always passed when a prior exists, regardless of `--changed`.
- `scan.ts` always loads the prior when the DB exists and the user
  isn't running `--no-built-ins`. The `--changed`-only stderr warning
  ("no prior snapshot found") survives — without `--changed` the
  empty-prior path is silent (it's the normal first-scan behaviour).
- `scan.ts` sets `enableCache: this.changed` when `priorSnapshot` is
  passed, so `--changed` keeps its perf win and the contract for
  cache-reliant tests doesn't break.

Behaviour matrix after the fix:

| Invocation | Prior loaded? | Cache reuse? | Rename heuristic? |
|---|---|---|---|
| `sm scan` (DB exists) | yes | no | yes |
| `sm scan` (DB empty) | no | n/a | no |
| `sm scan --changed` (DB exists) | yes | yes | yes |
| `sm scan --changed` (DB empty) | no — warns | n/a | no |
| `sm scan --no-built-ins` | no | n/a | no (no walk) |

`--changed --no-built-ins` rejection (exit 2) stays as-is — the
combination is still incoherent.

Tests:

- `scan-incremental.test.ts` — pre-existing tests assert on cache
  events; they now pass `enableCache: true` explicitly to keep that
  contract under test.
- `cli.test.ts` — new e2e: write file → `sm scan` → delete file →
  `sm scan --json` (no --changed) → assert one `orphan` issue in the
  result. Closes the gap at the binary level.

Test count: 203 → 204.

Internal API note: `runScanWithRenames` continues to return
`{ result, renameOps }`. Both the heuristic and the cache use the
same prior data, so the wrapper's signature didn't change.
