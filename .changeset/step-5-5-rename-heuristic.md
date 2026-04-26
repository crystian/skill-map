---
"@skill-map/cli": patch
---

Step 5.5 — Auto-rename heuristic lands at scan time per
`spec/db-schema.md` §Rename detection.

**Orchestrator changes**:

- New post-rule phase in `runScan` that classifies the diff
  `priorPaths \ currentPaths` × `currentPaths \ priorPaths`:
  - **High** (body hash match): emits a `RenameOp` with confidence
    `high`. NO issue — silent migration per spec.
  - **Medium** (frontmatter hash, exactly one remaining candidate
    after high pass): emits `RenameOp` + `auto-rename-medium` issue
    (severity `warn`) with `data: { from, to, confidence: 'medium' }`.
  - **Ambiguous** (frontmatter hash, more than one remaining
    candidate): emits `auto-rename-ambiguous` issue with
    `data: { to, candidates: [<old1>, <old2>, …] }` and `nodeIds: [to]`.
    NO migration; the candidates fall through to the orphan pass.
  - **Orphan**: every unclaimed deletion yields an `orphan` issue
    (severity `info`) with `data: { path: <deletedPath> }`.
- 1-to-1 matching is enforced (a `newPath` claimed by an earlier
  stage cannot be reused). Iteration is lex-asc on both sides for
  deterministic output across runs and conformance fixtures.
- Body-hash match wins over frontmatter-hash match (high pass runs
  before medium pass and consumes its `newPath`).

**API surface**:

- `runScan(kernel, opts)` continues to return `ScanResult` only —
  preserved for backward compatibility with tests and external
  consumers.
- New `runScanWithRenames(kernel, opts)` returns
  `{ result: ScanResult; renameOps: RenameOp[] }` — the variant `sm scan`
  consumes so it can hand `renameOps` to `persistScanResult` for
  in-tx FK migration.
- New `detectRenamesAndOrphans(prior, currentNodes, issues)` exported
  for direct testing and reuse by future surfaces (e.g. `sm orphans`
  reconciliation paths).
- New `RenameOp` type exported from `kernel/index.ts`:
  `{ from: string; to: string; confidence: 'high' | 'medium' }`.

**Persistence changes**:

- `persistScanResult(db, result, renameOps?)` accepts an optional
  ops list. The migration runs **first inside the tx** (via the
  Step 5.2 `migrateNodeFks` helper), then the scan zone replace-all.
  A failure during FK migration rolls back the entire scan persist —
  either all renames land or none do (per spec). Returns
  `{ renames: IMigrateNodeFksReport[] }` so callers can surface
  collision diagnostics.

**`sm scan`**:

- Switches to `runScanWithRenames` and forwards the ops to
  `persistScanResult`. No new flags. CLI exit code semantics are
  unchanged: `auto-rename-medium` and `auto-rename-ambiguous` are
  `warn`-severity and `orphan` is `info`-severity, so they do NOT
  trip exit code 1 (which still requires at least one `error`).

Test count: 184 → 190 (+6: high happy path, medium issue + FK
migration, ambiguous N:1 leaving FKs intact, orphan info-issue,
body-wins-frontmatter precedence, deterministic 1-to-1 lex matching).

`context/cli-reference.md` unchanged — `sm scan` flag surface stays
identical.
