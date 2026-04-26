---
"@skill-map/cli": patch
---

Step 5.3 — `sm history` CLI lands. The stub is removed from
`stubs.ts`; the real implementation lives at `src/cli/commands/history.ts`
and is registered in `cli/entry.ts`.

Surface (matches `spec/cli-contract.md` §History):

- `-n <path>` — restrict to executions whose `nodeIds[]` contains `<path>`
  (JSON-array containment via `json_each`, mirroring the
  `sm list --issue` subquery).
- `--action <id>` — exact match on `extension_id`.
- `--status <s,...>` — comma-separated subset of
  `completed,failed,cancelled`. Unknown values rejected with exit 2.
- `--since <ISO>` / `--until <ISO>` — Unix-ms boundaries on
  `started_at`. Since inclusive, until exclusive (per the schema's
  `range` semantics). Unparseable input → exit 2.
- `--limit N` — positive integer cap. Non-positive → exit 2.
- `--json` — emits an array conforming to
  `spec/schemas/execution-record.schema.json` (no top-level
  `elapsedMs` for array outputs, per `cli-contract.md` §Elapsed time).
- `--quiet` — suppresses the `done in <…>` stderr line.

Exit codes follow `cli-contract.md`: 0 ok (including empty result),
2 bad flag, 5 DB missing.

New shared util `src/cli/util/elapsed.ts` (`startElapsed` /
`formatElapsed` / `emitDoneStderr`) carries the §Elapsed time
formatting (`34ms` / `2.4s` / `1m 42s`). Used by `sm history` /
`sm history stats` only — retrofitting `list` / `show` / `check` /
`scan` is a known drift kept out of Step 5 scope.

Tests: 9 new under `src/test/history-cli.test.ts` covering the missing
DB, empty DB, --json schema validation, every filter axis (-n, --status,
window boundaries), and bad-input exit codes.

`context/cli-reference.md` regenerated.

Test count: 169 → 184.
