---
'@skill-map/cli': minor
---

Step 8.1 — `sm graph [--format <name>]` real implementation

Replaces the long-standing stub with a real read-side verb that renders
the persisted graph through any registered renderer. First sub-step of
Step 8 (Diff + export).

**Behaviour**:

- Reads the DB via the existing `loadScanResult` driving adapter
  (`src/kernel/adapters/sqlite/scan-load.ts`); never persists.
- Resolves the renderer by `format` field — default `ascii`. The lookup
  is over `builtIns().renderers`; plugin-supplied renderers will plug in
  through the same loader path that `sm scan` uses for adapters /
  detectors / rules, scheduled for Step 9 (plugin author UX).
- Trailing newline normalisation: appends `\n` only if the renderer's
  output didn't already end in one. Safe to pipe.

**Flags**:

- `--format <name>` — must match a registered renderer's `format` field.
  Default `ascii`. `mermaid` and `dot` ship at Step 12 as drop-in
  built-ins; the verb requires no further changes when they land.
- `--db <path>` and `-g/--global` — standard read-side scope flags
  (delegate to `resolveDbPath`).

**Exit codes** (per `spec/cli-contract.md` §Exit codes):

- `0` — render succeeded.
- `2` — bad flag or unhandled error.
- `5` — DB missing OR no renderer registered for the requested format.

The empty-DB case (migrated but never scanned) renders the zero-graph
("0 nodes, 0 links, 0 issues") and exits `0` on purpose: graph is a
read-side reporter, not a guard. Pair it with `sm doctor` (Step 10) for
state assertions.

**Wiring**:

- New command at `src/cli/commands/graph.ts`.
- Registered in `src/cli/entry.ts`.
- Removed from `STUB_COMMANDS` in `src/cli/commands/stubs.ts`; the
  remaining `export` stub now points at Step 8.3 (was Step 3, stale).
- `context/cli-reference.md` regenerated via `npm run cli:reference`;
  CI's `cli:check` job stays green.

**Tests** (`src/test/graph-cli.test.ts`, 5 cases): default format renders
two-node fixture; explicit `--format ascii` matches default; unknown
`--format mermaid` exits 5 with "Available: ascii"; missing DB exits 5;
empty DB renders zero-graph at exit 0. Total: 346 → **351** (+5).

**No spec change**: the `sm graph [--format ...]` row in
`spec/cli-contract.md` was already in place since Step 0a. This is pure
runtime catch-up — wiring the verb that the spec already promised.
