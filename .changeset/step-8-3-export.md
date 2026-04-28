---
'@skill-map/cli': minor
---

Step 8.3 — `sm export <query> --format <json|md|mermaid>` real implementation

Third and final sub-step of Step 8 (Diff + export). Replaces the stub
with a real verb that filters the persisted graph through a minimal
query language and emits the resulting subset as JSON or Markdown.
**Step 8 is now fully closed.**

**Query syntax** (v0.5.0; spec calls it "implementation-defined pre-1.0"):

- Whitespace-separated `key=value` tokens; AND across keys.
- Values within one token are comma-separated; OR within one key.
- Keys: `kind` (skill / agent / command / hook / note), `has` (`issues`
  today; `findings` / `summary` reserved for Steps 10 / 11), `path`
  (POSIX glob — `*` matches a single segment, `**` matches across
  segments).
- Empty query (`""`) is valid and exports every node.

Examples:

  sm export "kind=command" --format json
  sm export "kind=skill,agent has=issues" --format md
  sm export "path=.claude/commands/**" --format json
  sm export "" --format md

**Subset semantics** (recorded in `src/kernel/scan/query.ts`):

- A node passes when every specified filter matches (AND across keys,
  OR within values).
- Links survive only when BOTH endpoints are in the filtered set — the
  exported subgraph is closed. Boundary edges would confuse "I asked
  for a focused view" with "I asked for the focus and its neighbours".
- Issues survive when ANY of their `nodeIds` is in scope. Cross-cutting
  issues (e.g. `trigger-collision` over two advertisers) stay visible
  even when the user filtered to one of the parties — that's the
  scenario where the user actively wants to see the conflict.

**Format support at v0.5.0**:

- `json` — emits `{ query, filters, counts: {nodes, links, issues},
  nodes, links, issues }`. Schema is implementation-defined pre-1.0
  per `spec/cli-contract.md` and intentionally not pinned to a separate
  `export.schema.json` until consumers materialise.
- `md` — Markdown report grouped by node kind (same `KIND_ORDER` as the
  ASCII renderer for visual consistency); per-node issue counts inline;
  separate `## links` and `## issues` sections.
- `mermaid` — exits 5 with a clear pointer to Step 12 (when the mermaid
  renderer lands as a built-in). Surfacing it now would require a
  synthesis layer this verb shouldn't carry.

**Exit codes** (per `spec/cli-contract.md` §Exit codes):

- `0` — render succeeded.
- `5` — DB missing OR unsupported format OR invalid query.

**Kernel surface**:

- New module `src/kernel/scan/query.ts` exporting `parseExportQuery`,
  `applyExportQuery`, `IExportQuery`, `IExportSubset`, and
  `ExportQueryError`. Pure (no IO). Re-exported from `src/kernel/index.ts`
  for plugin authors and alternative drivers.
- Micro-glob → RegExp converter rolled in-module (zero-deps; supports
  `*` and `**` only). The grammar is intentionally minimal so the spec
  doesn't bind us to a specific glob library before v1.0.

**Wiring**:

- New command at `src/cli/commands/export.ts`.
- Registered in `src/cli/entry.ts`.
- Removed from `STUB_COMMANDS` in `src/cli/commands/stubs.ts`.
- `context/cli-reference.md` regenerated via `npm run cli:reference`;
  `cli:check` stays green.

**Tests** (`src/test/export-cli.test.ts`, 26 cases across two suites):

- `parseExportQuery` unit tests (12): empty / whitespace / kind /
  multi-value / has / path / combined / unknown key / unknown kind /
  unknown has / malformed token / empty value list / duplicate key.
- `applyExportQuery` semantic tests (7): empty query → everything;
  kind filter + closed subgraph; has=issues; path glob with `*` and
  `**`; AND across keys; ANY-nodeId rule for issues.
- `ExportCommand` handler tests (7): default JSON, kind filter, MD
  rendering, mermaid → exit 5, unsupported format → exit 5, invalid
  query → exit 5, missing DB → exit 5.

Total: 363 → **389** (+26).

**No spec change**: the `sm export <query> --format json|md|mermaid` row
in `spec/cli-contract.md` was already in place since Step 0a. This is
pure runtime catch-up — wiring the verb that the spec already promised.
