---
'@skill-map/cli': minor
---

cli-architect review follow-up — `SmCommand` base class wires every spec § Global flag (`-q/--quiet`, `-v/--verbose`, `--no-color`, env vars), every read-side verb now emits `done in <…>` per spec § Elapsed time, watch grows a circuit breaker, scan extracts the runner, and two invariant tests gate future regressions.

**HIGH — spec § Global flags / Elapsed time gaps**

Audit found the CLI honoured only a subset of the spec's global flags and emitted `done in <…>` from a handful of verbs ad-hoc. Closed structurally:

- New `cli/util/sm-command.ts` — abstract `SmCommand extends Command`. Declares `-g/--global`, `--json`, `-q/--quiet`, `--no-color`, `-v/--verbose`, `--db` once. Subclasses implement `protected run()` instead of `execute()`; the base wraps it with `applyEnvOverrides()` (promotes `SKILL_MAP_SCOPE=global`, `SKILL_MAP_JSON=1`, `NO_COLOR`, `SKILL_MAP_DB=<path>` to flags when the CLI flag is at default — spec precedence: CLI > env > config) + `startElapsed()` + a `finally` that emits `done in <…>` (suppressed by `--quiet`). Verbs opt out via `protected emitElapsed = false` (today: `sm version`, `sm watch`, `sm db shell`, `sm config list/get/show`).
- `-v` / `-vv` / `-vvv` reconfigures the kernel logger to `info` / `debug` / `trace` respectively; `--log-level` from `entry.ts` stays as the legacy escape hatch.
- 24 verb classes migrated: `init`, `scan`, `check`, `list`, `show`, `export`, `refresh`, `history`, `history stats`, `db backup/restore/reset/shell/dump/migrate`, `plugins list/show/doctor/enable/disable`, `orphans/orphans reconcile/orphans undo-rename`, `graph`, `scan-compare`, `version`, `conformance run`, `config list/get/show/set/reset`, `jobs prune`, `watch`. Each drops its locally-declared globals (`global`, `db`, `json`, `quiet`) and renames `execute()` → `run()`.

**MEDIUM — watch circuit breaker**

`runWatchLoop` previously caught every per-batch error, logged one line, and continued forever. A permanent failure (write-protected DB, schema corruption discovered post-init) repeated indefinitely with no exit signal. New `--max-consecutive-failures=N` flag (default 5; 0 disables) shuts the watcher down with exit 2 after N back-to-back failures. A successful batch resets the counter so transient errors never trip the breaker. Also removes the inner try/catch in `runOnePass` that was duplicating the per-batch error path — failures now propagate to `onBatch` so the breaker can count them.

**MEDIUM — `cli/util/scan-runner.ts` extraction**

`ScanCommand.execute` was 340 LOC inside one allowed `eslint-disable complexity`. The wiring chain (plugin runtime, config + ignore filter, prior-snapshot load, single-`withSqlite` open for persist, dry-run / non-persist branch) moved to `runScanForCommand(opts: IScanRunOpts): IScanRunResult` — a kernel-thin runner the verb consumes via `parse flags → runScanForCommand → render → exit code`. Mirrors `runWatchLoop`'s shape for `sm watch`.

**MEDIUM — quick wins**

- `cli/util/fs.ts` — lifts the `pathExists` / `statOrNull` helpers that were duplicated in `cli/commands/db.ts` and `cli/commands/init.ts`. ENOENT remains the only swallowed errno; every other code propagates so the caller sees the real reason.
- `cli/util/db-path.ts` — adds `defaultDbPath(scopeRoot)`, `defaultSettingsPath`, `defaultLocalSettingsPath`, `defaultIgnoreFilePath`, and a frozen `GITIGNORE_ENTRIES` constant. `cli/commands/init.ts` consumes them; the spirit of "no hardcoded `.skill-map/...` literals" now applies to settings / ignore paths the same way it already applied to the DB path.
- `kernel/util/ajv-interop.ts` — single `applyAjvFormats(ajv)` helper. The `ajv-formats as unknown as ...` ESM/CJS workaround that used to live in both `plugin-loader.ts` and `schema-validators.ts` is now in one place.
- `cli/commands/plugins.ts` — every `tx(PLUGINS_TEXTS.*, { ... })` interpolation that splices a user-supplied `id` / `bundleId` / `extId` (CLI flag input, untrusted) wraps the value in `sanitizeForTerminal()`. Closes the audit's note that `plugins.ts:304` and the surrounding `resolveToggleTarget` call sites were the one remaining gap in CLI output sanitization.
- `cli/commands/db.ts` — `db migrate` declares `-n,--dry-run` (was `--dry-run` only); aligns with `db reset` and the rest of the verb family.
- `cli/commands/show.ts` — drops the speculative `findings: never[]` / `summary: null` reserved slots. The spec § `sm show --json` shape is `{ node, linksOut, linksIn, issues }` until Step 10 (findings) and Step 11 (summary) ship; the placeholders narrow consumer types in a way the eventual `unknown[]` / `unknown | null` widen could not be additive over. Test updated to assert the fields are absent.

**Invariant tests (catch future regressions)**

- `test/elapsed-invariant.test.ts` (10 tests) — for every read-side verb in spec § Elapsed time scope (`check`, `list`, `show`, `export`, `history`, `history stats`, `db migrate --status`, `plugins list`, `plugins doctor`), captures stderr and asserts `/^done in (\d+ms|\d+\.\d+s|\d+m \d+s)\n?$/m`. Plus one negative test that `--quiet` suppresses the line.
- `test/render-sanitize-invariant.test.ts` (5 tests) — plants `\x1b[2J` (ANSI clear-screen) and `\x07` (BEL) inside `Node.title` and `Issue.message`, persists them, then runs `check`, `show`, `list`, `export --format md/json` and asserts no C0 / C1 control byte (other than `\n` / `\t`) reaches stdout. Catches any future render path that forgets to wrap a plugin / DB / FS string in `sanitizeForTerminal`.

**Out of scope (deferred)**

- `sm export --format mermaid` exit code — currently `2` (operational error). Audit suggested a dedicated "deferred / unsupported" code; that requires a `spec/cli-contract.md` § Exit codes amendment (codes 6–15 are reserved per spec). Not landing in this PR.

**Tests**

740/740 pass (+15 vs prior 725). Lint clean, build clean. No spec change; `spec/index.json` not regenerated.
