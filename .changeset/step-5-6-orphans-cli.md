---
"@skill-map/cli": patch
---

Step 5.6 — `sm orphans` verbs land. The three stubs are removed from
`stubs.ts`; the real implementations live at
`src/cli/commands/orphans.ts` and are registered as `ORPHANS_COMMANDS`
in `cli/entry.ts`.

**`sm orphans [--kind orphan|medium|ambiguous] [--json]`**:
Lists every active issue with `ruleId IN (orphan, auto-rename-medium,
auto-rename-ambiguous)`. `--json` emits an array of `Issue` objects
(per `spec/schemas/issue.schema.json`); the human path renders a
one-line summary per issue grouped by ruleId.

**`sm orphans reconcile <orphan.path> --to <new.path>`**:
Forward direction. Validates `<new.path>` exists in `scan_nodes`
(exit 5 otherwise) and that an active `orphan` issue with
`data.path === <orphan.path>` exists (exit 5 otherwise). Migrates
state_* FKs via `migrateNodeFks` (5.2) inside a single transaction
along with the `DELETE FROM scan_issues` of the resolved orphan
issue. Surfaces composite-PK collision diagnostics on stderr when
they occur.

**`sm orphans undo-rename <new.path> [--from <old.path>] [--force]`**:
Reverse direction. Resolves the active `auto-rename-medium` or
`auto-rename-ambiguous` issue on `<new.path>`:

- For `auto-rename-medium`, reads `data.from` (omit `--from`).
  Passing a `--from` that does not match `data.from` → exit 2.
- For `auto-rename-ambiguous`, requires `--from <old.path>` to pick
  one of `data.candidates` (exit 5 if missing or not in candidates).

Migrates state_* FKs back to the prior path (the reverse of what the
heuristic did), deletes the auto-rename issue, and emits a new
`orphan` issue on the prior path (per spec: "the previous path
becomes an `orphan`"). Destructive — prompts via `readline` unless
`--force`.

**Refactor**: the `confirm()` helper used by `sm db restore` /
`sm db reset --state` / `sm db reset --hard` is extracted to
`src/cli/util/confirm.ts` so `sm orphans undo-rename` reuses the
exact same prompt shape (`<question> [y/N] `, stderr-emitting
readline interface). `db.ts` now imports it; behaviour identical.

Test count: 190 → 201 (+11 covering: list happy path, --kind filter,
--kind invalid, reconcile happy path / target-missing / no-issue,
undo-rename medium force, --from mismatch, no-issue exit 5,
ambiguous --from required + outside-candidates + valid).

`context/cli-reference.md` regenerated.
