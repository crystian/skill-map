---
'@skill-map/cli': patch
---

Code-quality follow-up to commit `369213c` — eighth batch of the
ongoing complexity sweep ("hasta menos de 8"). Eight functions
addressed: two splits into focused private helpers, six justified
inline disables on CLI orchestrators / safe-apply loops where the
cyclomatic count is intrinsic to the contract. **Patch bump**: zero
public API changes (every refactored function keeps its exported
signature; no new exports); pure internal restructuring.

## Why

The previous round closed `splitStatements`, `plugins`, `history` and
`config` and brought the lint baseline from 84 -> 75. This batch
continues the same playbook: split where naming the steps adds value,
disable-with-rationale where every branch is one flag in a multi-flag
verb and splitting would scatter intent. Net `-8` warnings in one
commit and four functions dropped fully below the threshold.

## What

### Splits (extracted helpers)

#### `src/cli/commands/plugins.ts` — `PluginsShowCommand.execute` (21 -> <8)

Two private helpers, one per detail-rendering branch:

- `renderBuiltInDetail(builtIn)` — header + extensions list for a
  built-in bundle row.
- `renderPluginDetail(match)` — header + manifest fields + extensions
  list for a discovered user plugin.

`execute` is now a thin orchestrator: load the registry, resolve
`builtIn` vs `match`, pick the renderer, emit. The two renderers
mirror each other in shape (both return `string[]`) so the
`builtIn ? renderBuiltInDetail(builtIn) : renderPluginDetail(match!)`
ternary at the call site reads as a table of contents.

#### `src/cli/commands/show.ts` — `renderHuman` (14 -> 10)

One private helper, parametrised over direction:

- `renderLinksSection(label, links, projectField, arrow)` — the
  `(N total, M unique)` header, `(none)` placeholder, and grouped
  per-link lines. Used for both "Links out" (project on `target`,
  arrow `->`) and "Links in" (project on `source`, arrow `<-`).

`renderHuman` now spreads the helper twice instead of inlining two
near-identical 8-line blocks. Aggregation behaviour and JSON output
are unchanged.

### Justified inline complexity disables

Each of these is a CLI orchestrator or per-file safe-apply transaction
where the cyclomatic count is intrinsic to multi-flag handling,
multi-accumulator folds, or per-file rollback semantics. Splitting per
branch would distance the validations / guards from the state they
shape. Each disable carries a comment explaining the call-site
contract.

- `src/cli/commands/db.ts` — `DbResetCommand.execute` (21) and
  `DbMigrateCommand.execute` (30). Multi-flag verbs: `--state` vs
  `--hard` mutex, `--dry-run`, `--yes`, `--kernel-only`,
  `--plugin <id>`, `--status`, `--to`. The early-return chain is the
  clearest expression of the flag semantics.
- `src/cli/commands/history.ts` — `HistoryCommand.execute` (14). Many
  optional filter flags (`--node`, `--action`, `--status`, `--since`,
  `--until`, `--limit`, `--json`, `--quiet`); each branch is
  single-purpose and tightly coupled to the filter it shapes.
- `src/cli/commands/orphans.ts` — undo-rename arrow function (14).
  Destructive verb with per-`ruleId` validation chain
  (`auto-rename-medium` vs `auto-rename-ambiguous`) before the FK
  migration runs in a transaction.
- `src/cli/commands/scan-compare.ts` — `renderDeltaHuman` (14). Three
  parallel sections (nodes / links / issues), each with
  added/removed/changed loops; per-section format differs slightly so
  a single helper would need a per-section adapter that hides the
  parallel structure.
- `src/kernel/adapters/sqlite/migrations.ts` — `applyMigrations` (14).
  Per-file transactional safe-apply with backup + dry-run guards;
  rollback semantics live at the loop level.
- `src/kernel/adapters/sqlite/plugin-migrations.ts` —
  `applyPluginMigrations` (14). Same shape as `applyMigrations` plus
  plugin-id ledger scoping.

## Net effect on lint

- Previous baseline (commit `369213c`): 75 warnings.
- After this commit: **67 warnings** (-8 net).
- Four functions dropped fully below threshold via splits or disables;
  zero new warnings introduced.
- 602 / 602 tests still green.
