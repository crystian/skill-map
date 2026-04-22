---
"skill-map": minor
---

Step 1a — Storage + migrations.

Lands `SqliteStorageAdapter` behind `StoragePort`. Uses a bespoke `NodeSqliteDialect` for Kysely (Kysely's official `SqliteDialect` ships `better-sqlite3` — native, forbidden by Decision #7; the kernel runtime is Node 24+ with zero native deps). The dialect reuses Kysely's pure-JS `SqliteAdapter` / `SqliteIntrospector` / `SqliteQueryCompiler` and plugs a minimal Driver over `node:sqlite`'s `DatabaseSync`. CamelCasePlugin bridges camelCase TypeScript field names to the spec-mandated snake_case SQL.

The migrations runner (`src/kernel/adapters/sqlite/migrations.ts`) discovers `NNN_snake_case.sql` files, diffs them against the `config_schema_versions` ledger (scope = `kernel`, owner = `kernel`), and applies pending files inside per-file `BEGIN / COMMIT` transactions. The ledger insert and `PRAGMA user_version` update share the migration's transaction so partial success can't drift the state. Auto-backup fires before any apply — WAL checkpoint then file copy to `.skill-map/backups/skill-map-pre-migrate-v<N>.db`. `tsup.config.ts` gained an `onSuccess` hook that copies `src/migrations/` to `dist/migrations/`; `package.json#files` now includes `migrations/` so published artifacts ship the SQL.

`src/migrations/001_initial.sql` provisions every kernel table from `spec/db-schema.md`: 3 `scan_*`, 5 `state_*`, 3 `config_*` with full CHECK constraints (enum guards on kind / stability / confidence / severity / job status / failure reason / runner / execution kind / execution status / schema version scope / boolean verified flag / boolean config_plugins.enabled), every named index declared in the spec, and the unique partial index on `state_jobs(action_id, node_id, content_hash) WHERE status IN ('queued','running')` that enforces the duplicate-job detection contract from `spec/job-lifecycle.md`.

`sm db` command surface (per `spec/cli-contract.md` §Database):

- `sm db backup [--out <path>]` — WAL checkpoint + file copy.
- `sm db restore <path> [--yes]` — copies source over target and clears stale WAL sidecars; destructive, prompts by default.
- `sm db reset [--state] [--hard] [--yes]` — default truncates `scan_*` (non-destructive, no prompt); `--state` also truncates `state_*`; `--hard` removes the DB file and its sidecars. Destructive modes prompt by default.
- `sm db shell` — spawns the system `sqlite3` binary with inherited stdio; ENOENT produces a pointed error pointing at the install steps for macOS / Debian / Ubuntu and the `sm db dump` fallback.
- `sm db dump [--tables ...]` — `sqlite3 -readonly path .dump` to stdout.
- `sm db migrate [--dry-run|--status|--to <n>|--no-backup]` — default applies pending; `--status` prints applied vs pending; `--dry-run` previews without writing; `--to` caps the applied range; `--no-backup` skips the pre-apply copy.

`--kernel-only` and `--plugin <id>` from the CLI contract are deferred to Step 1b when the plugin loader introduces plugin-authored migrations; they would be no-ops today.

Acceptance test (`src/test/storage.test.ts`) covers the ROADMAP §Step 1a round-trip — fresh scope → migrate --dry-run → apply → write a row → backup → "corrupt" the row → restore → verify the original row came back — plus narrower checks around CamelCasePlugin field mapping, CHECK constraint enforcement at the DB layer, and the unique partial index behaviour (duplicate queued job rejected, same tuple allowed once the blocking job completes). 24 of 24 tests pass.

Classification: minor per `spec/versioning.md` §Pre-1.0 (`0.Y.Z`). First real feature surface after the Step 0b bootstrap; `skill-map` bumps `0.2.0 → 0.3.0`.
