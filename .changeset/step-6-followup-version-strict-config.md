---
"@skill-map/cli": patch
---

Step 6 follow-up — two UX polish fixes surfaced during the post-Step-6
manual walkthrough.

**`sm version` db-schema field**: was hardcoded `'—'` (carried over from
Step 1a as a placeholder). The command now resolves the project DB path
via the shared `resolveDbPath` helper, opens the DB read-only when it
exists, and reads `PRAGMA user_version` (kept in sync by the migrations
runner since Step 1a). Returns `'—'` for every failure mode (missing
DB, unreadable file, malformed pragma) so an informational verb can
never crash on a bad DB.

  - Pre-fix: `db-schema —` regardless of DB state.
  - Post-fix: `db-schema —` when no DB; `db-schema 2` after `sm init`
    (= MAX kernel migration version applied).

**`sm config --strict-config` UX**: the loader's strict-mode `throw`
was reaching Clipanion's default error handler, producing "Internal
Error: ..." with a five-line stack trace and exit code 1. Now wrapped
in a per-command `tryLoadConfig` helper that catches the throw, writes
a one-line `sm config: <message>` to stderr, and returns exit code 2
(operational error) per `spec/cli-contract.md` §Exit codes. Applied to
`sm config list`, `sm config get`, and `sm config show` — every read
verb that exposes `--strict-config`.

  - Pre-fix: stack trace + exit 1.
  - Post-fix: clean stderr line + exit 2.

**Runtime change**:

- `src/cli/commands/version.ts` — new `resolveDbSchemaVersion()` helper
  uses `node:sqlite` `DatabaseSync` in read-only mode + `PRAGMA
  user_version`. Three failure paths all collapse to `'—'`. JSDoc
  expanded with the resolution contract.
- `src/cli/commands/config.ts` — new `tryLoadConfig()` private wrapper
  catches `loadConfig` throws (only emitted under `--strict-config`).
  Three call sites in `ConfigListCommand`, `ConfigGetCommand`, and
  `ConfigShowCommand` updated to early-return with the wrapper's exit
  code.

**Tests**:

- `src/test/cli.test.ts` — two new tests under the existing `CLI binary`
  suite: `sm version` shows `db-schema —` when no DB exists in cwd
  (uses `EMPTY_DIR`), and reports the numeric `user_version` after
  `sm init --no-scan` provisions a DB in a tmpdir. Test asserts the
  number matches `\d+` and is `>= 1` rather than pinning a specific
  value, so it survives future kernel migrations.
- `src/test/config-cli.test.ts` — new `sm config — --strict-config UX`
  describe block (5 tests): warning + exit 0 without the flag,
  clean-message + exit 2 with the flag (and explicit assertion that
  no `Internal Error` / stack-trace lines leak through), wrapper
  applied uniformly to `list / get / show`, and malformed-JSON path
  also routes through the clean-error path.

Test count: 303 → 310 (+7).
