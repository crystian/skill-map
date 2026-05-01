---
"@skill-map/cli": minor
---

Drop the closed-enum SQL CHECK constraints on `scan_nodes.kind` and `state_summaries.kind` (Phase D — kernel migration `003_open_node_kinds.sql`).

Phase A opened the spec; Phases B + C opened the TS runtime; this phase aligns the live SQL. The `001_initial.sql` migration declared `CONSTRAINT ck_scan_nodes_kind CHECK (kind IN ('skill','agent','command','hook','note'))` (and the matching constraint on `state_summaries`); both rejected any external-Provider kind at the DB layer regardless of TS / spec saying otherwise. SQLite has no `ALTER TABLE DROP CONSTRAINT`, so the migration runs the standard table-recreate dance for each table:

1. Create `<table>_new` with the same columns, indexes-on-recreate, and the remaining constraints (the `stability` whitelist on `scan_nodes` is preserved verbatim).
2. `INSERT INTO <table>_new SELECT * FROM <table>`.
3. `DROP TABLE <table>` and `RENAME <table>_new TO <table>`.
4. Re-create every index that lived on the original.

The migration runner already wraps the file in `BEGIN / COMMIT`, so the recreate is atomic from the caller's perspective — a partial failure rolls back to the prior state.

**Why version 3 (not 2)**: Pre-1.0 history had a `002_scan_meta` migration that was later folded into `001_initial.sql`. DBs created in the field before the fold still carry version 2 in their `config_schema_versions` ledger (with `description='scan_meta'`); using `002` for this new migration would collide and skip on those DBs. Using `003` gives a clean apply on both fresh DBs (jump from v1 to v3, ledger gets a v1 + v3 entry, `PRAGMA user_version = 3`) and legacy DBs (apply v3 on top of v2, ledger gets v3 appended, `user_version = 3`).

`PRAGMA foreign_keys` gymnastics: not needed. `scan_nodes.path` is referenced by other tables only via string equality (no DDL `FOREIGN KEY` clauses in `001_initial.sql`), so the recreate doesn't require disabling FK enforcement.

Tests:

- `storage.test.ts` — the `rejects CHECK constraint violations` test was retargeted to use the surviving `stability` whitelist; the old assertion ("`kind: 'not-a-kind'` rejected") is by definition no longer true post-003 and would be a false-positive guard going forward. New companion test asserts the open contract: a `kind: 'cursorRule'` row from a `provider: 'cursor'` persists and round-trips through `selectFrom('scan_nodes')`.

End-to-end smoke verification (manual, on a fresh DB): `sm init --no-scan` → `sm version` reports `db-schema 3`; raw insert with `kind: 'cursorRule'` succeeds; `sm list` renders the row; `sm export 'kind=cursorRule' --format json` filters down to it. All four steps pass without any TS / DB layer rejecting the external kind.

What ships next:

- **Phase E** — conformance suite re-run, smoke fixture promoted into the kernel test suite (a fake external Provider that emits `kind: 'cursorRule'` end-to-end), changelog entry rolled forward into the spec CHANGELOG when the next published bump cuts.
