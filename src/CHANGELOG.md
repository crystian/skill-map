# skill-map

## 0.3.3

### Patch Changes

- 16e782a: Fix `tsc --noEmit` regressions surfaced by CI after the Step 6
  follow-up commits (`7d4b143`, `4669267`). The commits validated
  through `tsup` (which does not enforce `noUncheckedIndexedAccess` /
  `exactOptionalPropertyTypes`) but tripped CI's stricter `npm run
typecheck` step. Eight TS errors across six files; runtime behaviour
  unchanged.

  **Type fixes**:

  - `src/cli/commands/config.ts` — `setAtPath` / `deleteAtPath` /
    `pruneEmptyAncestors` indexed `segments[i]` directly under
    `noUncheckedIndexedAccess`. Added an early-return guard for
    empty paths and non-null assertions on segment access.
  - `src/cli/commands/init.ts` — `GITIGNORE_ENTRIES as const` narrowed
    `length` to `2`, making the pluralization branch (`=== 1`) a TS
    "no-overlap" error. Dropped `as const` and typed it as
    `readonly string[]`.
  - `src/cli/commands/plugins.ts` — `TogglePluginsBase` extends
    Clipanion's `Command` but never implemented the abstract
    `execute()`. Marked the class `abstract` so only its concrete
    subclasses (`PluginsEnableCommand` / `PluginsDisableCommand`)
    need to implement it.
  - `src/kernel/config/loader.ts` — direct cast between
    `IEffectiveConfig` and `Record<string, unknown>` is no longer
    accepted; routed through `unknown` at both `deepMerge` call
    sites.
  - `src/kernel/scan/ignore.ts` — under `exactOptionalPropertyTypes`,
    `IBuildIgnoreFilterOptions` did not accept `undefined` even
    though the runtime tolerated it. Widened the three optional
    fields to `T | undefined` so callers can forward
    `readIgnoreFileText()` (which returns `string | undefined`)
    without a guard.
  - `src/test/config-loader.test.ts` — `match(warnings[0], …)`
    failed under `noUncheckedIndexedAccess`; added non-null
    assertions (the lines above already verify `length === 1`).

  **Prevention** — encadenar typecheck antes del test runner:

  - `src/package.json` — `test` and `test:ci` now run
    `tsc --noEmit && node --import tsx --test ...`. Local `npm test`
    picks up strict-mode regressions immediately instead of waiting
    for CI.

  Test count unchanged: 312 of 312 pass.

- f41dbad: Step 6.2 — Layered config loader for `.skill-map/settings.json`. Walks the
  six canonical layers (defaults → user → user-local → project → project-local
  → overrides), deep-merges per key, validates each layer against the
  `project-config` JSON schema, and is resilient per-key: malformed JSON,
  schema violations, and type mismatches emit warnings and skip the offending
  input without invalidating the rest of the layer. Strict mode (`--strict`,
  wired in 6.3+) re-routes every warning to a thrown `Error`.

  **Runtime change**:

  - `src/config/defaults.json` — bundled defaults derived from `project-config.schema.json`
    property descriptions (autoMigrate, tokenizer, scan._, jobs._, history.share, i18n.locale).
  - `src/kernel/config/loader.ts` — `loadConfig(opts)` entry point. Returns
    `{ effective, sources, warnings }`:
    - `effective` — fully merged `IEffectiveConfig`.
    - `sources` — `Map<dotPath, layerName>` so `sm config show --source` (6.3)
      can answer who set what.
    - `warnings` — accumulated diagnostics; empty when the load was clean.
  - Layer dedup: when `scope === 'global'`, project layers (4/5) resolve to
    the same files as user layers (2/3) and are skipped to avoid double-merging
    the same source.
  - Deep-merge semantics: nested objects merge per key; arrays replace whole;
    `null` values are preserved (e.g. `jobs.retention.failed`).
  - Schema-failure handling: AJV errors are walked once; `additionalProperties`
    errors strip the unknown key, type/const/etc. errors strip the offending
    leaf. The cleaned object is then merged so a single bad value never
    invalidates the rest of the layer.
  - No CLI surface yet — `sm config` verbs (6.3) and `--strict` flag
    (6.3+) consume this loader; the API is internal until then.

  **Tests**: `src/test/config-loader.test.ts` covers defaults application,
  five-layer precedence, override layer, global-scope dedup, deep-merge
  nested objects + array replacement + null preservation, malformed-JSON
  warning + skip, unknown-key strip, type-mismatch strip, partial-bad-file
  continues, non-object root rejection, and three strict-mode escalations
  (JSON / schema / unknown-key).

  Test count: 213 → 231 (+18).

- f41dbad: Step 6.3 — `sm config list / get / set / reset / show` go from
  stub-printing-"not implemented" to real implementations. The five verbs
  share the layered loader from 6.2 and gain a `--strict` flag on
  the read side that escalates merge warnings to fatal errors.

  **Runtime change**:

  - `src/cli/commands/config.ts` — five Clipanion commands plus shared
    helpers (`getAtPath`, `setAtPath`, `deleteAtPath` with empty-parent
    pruning, JSON-first value coercion, dot-path → human formatter).
  - `src/cli/commands/stubs.ts` — five `Config*Command` classes removed;
    `STUB_COMMANDS` array shrunk; replaced-at-step comment kept.
  - `src/cli/entry.ts` — registers the new `CONFIG_COMMANDS` array.
  - `context/cli-reference.md` — regenerated from `sm help --format md`;
    CLI version line now reflects the live `0.3.x` value (the file had
    drifted at PR #12 against the prior stub descriptions).

  **Verb semantics**:

  - `sm config list [--json] [-g] [--strict]` — prints the merged
    effective config. Human mode emits sorted `key.path = value` lines;
    `--json` emits the JSON object. Exempt from `done in <…>` per
    `spec/cli-contract.md` §Elapsed time.
  - `sm config get <key> [--json] [-g] [--strict]` — leaf value
    by dot-path. Unknown key → exit 5. `--json` wraps in JSON literals
    so callers can pipe into `jq`. Exempt from elapsed-time.
  - `sm config show <key> [--source] [--json] [-g] [--strict]` —
    identical to `get` plus optional `--source` that surfaces the winning
    layer (`defaults / user / user-local / project / project-local /
override`). For nested objects, the highest-precedence descendant
    wins. `--source --json` emits `{ value, source }`. Exempt from
    elapsed-time.
  - `sm config set <key> <value> [-g]` — writes to project file by
    default; `-g` writes to user file. JSON-parses the raw value first so
    CLI ergonomics produce booleans / numbers / arrays / objects naturally
    (unparseable falls through as plain string). Result is re-validated
    against `project-config.schema.json`; schema violation → exit 2 with
    the file untouched. In-scope verb — emits `done in <…>` to stderr.
  - `sm config reset <key> [-g]` — strips the key from the target file;
    prunes now-empty parent objects so the file stays tidy. Idempotent —
    absent key prints "No override at <path>" and exits 0. In-scope verb.

  **Tests**: `src/test/config-cli.test.ts` exercises every verb through
  the real `bin/sm.mjs` binary with isolated `HOME` and `cwd` per test:
  list defaults / project / `--json`, get leaf / object / `--json` /
  unknown-key, show `--source` on leaf and nested object, show `--source
--json`, show without `--source`, set project default + `-g` + nested
  dot-path + invalid → exit 2 + preserves siblings + emits `done in`,
  reset basic + idempotent absent + `-g` + parent-pruning.

  Test count: 231 → 252 (+21).

- f41dbad: Step 6.4 — `.skill-mapignore` parser + scan walker integration.
  Layered ignore filter composes bundled defaults + `config.ignore`
  (from `.skill-map/settings.json`) + `.skill-mapignore` file content;
  the walker honours it so reorganising `node_modules`, `dist`, drafts,
  or any user-defined private dir keeps them out of the scan in one
  predictable place.

  **New dependency**: `ignore@7.0.5` (zero-deps, MIT, gitignore-spec
  compliant — same library used by eslint, prettier). Pinned exact per
  AGENTS.md.

  **Runtime change**:

  - `src/config/defaults/skill-mapignore` — bundled defaults file shipped
    with the CLI (`.git/`, `node_modules/`, `dist/`, `build/`, `out/`,
    `.next/`, `.cache/`, `.tmp/`, `.skill-map/`, `*.log`, `.DS_Store`,
    `Thumbs.db`, `*.swp`, `*~`). Copied into `dist/config/defaults/` by
    tsup `onSuccess`.
  - `src/kernel/scan/ignore.ts` — `buildIgnoreFilter({ configIgnore?,
ignoreFileText?, includeDefaults? })` returns an `IIgnoreFilter` with
    one method, `ignores(relativePath)`. Layer order is fixed: defaults
    → `configIgnore` → `ignoreFileText`. Bundled defaults loaded once
    (module-level cache); resolves a small candidate-list of paths to
    cover both the dev layout (`src/`) and the bundled layout (`dist/`).
  - `src/kernel/scan/ignore.ts` also exports `readIgnoreFileText(scopeRoot)`
    — convenience to read `<scopeRoot>/.skill-mapignore` and feed it to
    `buildIgnoreFilter`.
  - `src/kernel/extensions/adapter.ts` — `IAdapter.walk` signature
    changes: `options.ignore?: string[]` → `options.ignoreFilter?:
IIgnoreFilter`. The old shape was unused (no caller passed it), so
    no compat shim ships.
  - `src/extensions/adapters/claude/index.ts` — walker tracks the
    current relative path during recursion and consults the filter for
    every directory and file. The previous hard-coded `DEFAULT_IGNORE`
    set is removed; the bundled defaults provide the same baseline.
    Adapters that omit `ignoreFilter` get the bundled-defaults filter as
    a defensive fallback, so kernel-empty-boot and direct adapter tests
    still skip `.git` / `node_modules` / `.tmp`.
  - `src/kernel/orchestrator.ts` — `RunScanOptions.ignoreFilter?:
IIgnoreFilter` plumbed through to every `adapter.walk(...)` call.
  - `src/cli/commands/scan.ts` — `ScanCommand` loads layered config and
    composes the filter from `cfg.ignore` + the project's
    `.skill-mapignore`, then passes it via `runOptions.ignoreFilter`.

  **Tests**: `src/test/scan-ignore.test.ts` — 14 tests covering filter
  defaults (skip / preserve / empty path), `configIgnore` patterns and
  directory globs, ignore-file text parsing with comments and blanks,
  three-layer combination including negation that respects gitignore's
  "can't re-include from excluded directory" rule, `includeDefaults:
false` opt-out, `readIgnoreFileText` present / missing, plus four
  end-to-end runScan integrations (`.skill-mapignore` excludes drafts,
  `config.ignore` excludes a private dir, defaults still skip
  `node_modules` / `.git` without extra config, file-glob negation
  re-includes a single file inside an otherwise-excluded directory).

  Test count: 252 → 266 (+14).

- 8a4667f: Step 6.5 — `sm init` scaffolding. Replaces the
  "not-implemented" stub with a real bootstrap verb that provisions
  everything Step 6 has built so far in one command:

  - `<scopeRoot>/.skill-map/` directory.
  - `settings.json` with `{ "schemaVersion": 1 }` (minimal, validated
    against `project-config.schema.json`).
  - `settings.local.json` with `{}` (placeholder for personal overrides;
    appended to `.gitignore` so it never gets committed).
  - `.skill-mapignore` at the scope root, copied byte-for-byte from
    `src/config/defaults/skill-mapignore`.
  - `<scopeRoot>/.skill-map/skill-map.db` provisioned via
    `SqliteStorageAdapter.init()` (auto-applies kernel migrations).
  - First scan: walks the scope, persists `scan_*` tables. Exit code
    mirrors `sm scan` — 1 if any `error`-severity issues land.

  Project scope (default = cwd): also appends two entries to
  `<cwd>/.gitignore` (`.skill-map/settings.local.json`,
  `.skill-map/skill-map.db`); creates the file if missing, leaves
  existing entries untouched, never duplicates. Comments and blank
  lines in an existing `.gitignore` survive.

  Global scope (`-g`): same scaffolding under `$HOME/.skill-map/`. No
  `.gitignore` is written — `$HOME` isn't a repo.

  Re-running over an existing scope errors with exit 2 unless `--force`
  is passed. `--no-scan` skips the first scan (useful in CI where the
  operator wants to provision before populating roots). `--force`
  overwrites `settings.json`, `settings.local.json`, and `.skill-mapignore`
  but keeps the DB and any other state in `.skill-map/`.

  **Runtime change**:

  - `src/cli/commands/init.ts` — new file. The `runFirstScan` helper
    loads the layered config, builds the ignore filter
    (defaults + `config.ignore` + the `.skill-mapignore` it just wrote),
    runs `runScanWithRenames`, and persists. Inline (not subprocess) so
    the parent owns the elapsed line and stdio cleanly.
  - `src/cli/commands/stubs.ts` — `InitCommand` removed; replaced-at-step
    comment kept.
  - `src/cli/entry.ts` — registers the new `InitCommand`.
  - `src/kernel/scan/ignore.ts` — new `loadBundledIgnoreText()` export;
    re-uses the module-level cache so `sm init` reads the defaults file
    once across the process lifetime.
  - `context/cli-reference.md` — regenerated; init's flag table and
    examples block now appear in the reference.

  **Tests**: `src/test/init-cli.test.ts` — 7 tests through the real
  binary covering project-scope scaffolding (files present, schemaVersion
  set, ignore template populated), `.gitignore` create-when-missing,
  `.gitignore` merge without duplicating an existing entry, re-init
  blocked without `--force`, `--force` overwrites, default first-scan
  finds and counts a seeded `.claude/agents/foo.md`, global scope under
  `HOME/.skill-map/` with no `.gitignore` written and no leakage into
  `cwd`.

  Test count: 266 → 273 (+7).

- 8a4667f: Step 6.6 — `sm plugins enable / disable` + the `config_plugins`
  override layer they read from. The two stub verbs become real, and
  the `PluginLoader` finally honours user intent: a disabled plugin
  surfaces in `sm plugins list` with status `disabled`, but its
  extensions are NOT imported and the kernel will not run them.

  **Decision (recorded in spec)**: enable/disable resolution favours the
  DB row over `settings.json` over the installed default. The DB
  override is local-machine; `settings.json` is the team-shared baseline.
  A developer can locally disable a misbehaving plugin without
  committing the toggle to the team's config; conversely, a baseline
  that explicitly enables a plugin is overridable per-machine. The rule
  is documented in `spec/db-schema.md` §`config_plugins`.

  **Spec change (additive, patch)**:

  - `spec/db-schema.md` — appended an "Effective enable/disable
    resolution" subsection under `config_plugins` documenting the
    three-layer precedence (DB > `settings.json` > installed default).
    No schema changes; the `config_plugins` table itself was already
    defined in the initial migration.

  **Runtime change**:

  - `src/kernel/types/plugin.ts` — `TPluginLoadStatus` gains a `disabled`
    variant. JSDoc explains all five states.
  - `src/kernel/adapters/sqlite/plugins.ts` — new file. Storage helpers
    over the `config_plugins` table: `setPluginEnabled` (upsert),
    `getPluginEnabled` (single read), `loadPluginOverrideMap` (bulk
    read for one round-trip per process), `deletePluginOverride`
    (idempotent drop, used by future `sm config reset plugins.<id>`).
  - `src/kernel/config/plugin-resolver.ts` — new file.
    `resolvePluginEnabled` implements the precedence above;
    `makeEnabledResolver` curries the layered config and DB map into
    the `(id) => boolean` shape `IPluginLoaderOptions.resolveEnabled`
    expects.
  - `src/kernel/adapters/plugin-loader.ts` — new optional
    `resolveEnabled` callback in `IPluginLoaderOptions`. When supplied,
    the loader checks AFTER manifest + specCompat validation and
    short-circuits with `status: 'disabled'` (manifest preserved,
    extensions array omitted, reason `"disabled by config_plugins or
settings.json"`). Omitting the callback keeps the legacy "always
    load" behaviour for tests / kernel-empty-boot.
  - `src/cli/commands/plugins.ts` — wires the loader to the resolver:
    every read (`list / show / doctor`) loads `config_plugins` once and
    feeds the resolver. Two new commands `PluginsEnableCommand` and
    `PluginsDisableCommand` write to the DB. `--all` toggles every
    discovered plugin; `<id>` and `--all` are mutually exclusive.
    `sm plugins doctor` now treats `disabled` as intentional (does not
    contribute to the issue list, does not flip exit code).
  - `src/cli/commands/plugins.ts` — adds `off` to the status icon legend
    in human output (`off  mock-a@0.1.0 · disabled by config_plugins or
settings.json`).
  - `src/cli/commands/stubs.ts` — `PluginsEnableCommand` and
    `PluginsDisableCommand` removed; replaced-at-step comment kept.
  - `context/cli-reference.md` — regenerated; the two new verbs appear
    with their flag tables.

  **Tests**:

  - `src/test/plugin-overrides.test.ts` — 8 unit tests covering storage
    round-trip (upsert + read), `loadPluginOverrideMap` bulk read,
    `deletePluginOverride` idempotency, resolver precedence (default ⇒
    true, `settings.json` overrides default, DB overrides
    `settings.json`), `makeEnabledResolver` currying, and PluginLoader
    surfacing `disabled` status with manifest preserved + no extensions
    - omitting the resolver still loads.
  - `src/test/plugins-cli.test.ts` — 9 end-to-end tests via the binary:
    `disable <id>` writes a DB row + `sm plugins list` reflects `off`,
    `enable <id>` flips back, `--all` covers every discovered plugin,
    unknown id → exit 5, no-arg → exit 2, both `<id>` and `--all` →
    exit 2, `settings.json` baseline overridden by DB `enable`,
    `settings.json` baseline applies when DB has no row, and
    `sm plugins doctor` exits 0 when the only non-loaded plugin is
    intentionally disabled.

  Test count: 273 → 291 (+18).

- 8a4667f: Step 6.7 — Frontmatter strict mode. The orchestrator now validates each
  node's parsed frontmatter against `frontmatter/<kind>.schema.json`
  during `sm scan` and emits a `frontmatter-invalid` issue when the shape
  doesn't conform. Severity is `warn` by default (scan still exits 0);
  `--strict` (CLI) or `scan.strict: true` (config) promote every such
  finding to `error` so the scan exits 1.

  **Runtime change**:

  - `src/kernel/adapters/schema-validators.ts` — registers
    `frontmatter-skill / -agent / -command / -hook / -note` as named
    top-level validators (they were already loaded as supporting schemas
    via the AJV `$ref` graph; this step exposes them through the
    `validate(name, data)` surface). Reuses the module-level cache from
    Step 5.12 — the validators compile once per process.
  - `src/kernel/orchestrator.ts` — new `RunScanOptions.strict?: boolean`
    field. After each adapter yields a node, the orchestrator validates
    the parsed frontmatter (skipping when no `---` fence is present, so
    fence-less notes stay clean). A failure produces a single
    `frontmatter-invalid` issue with `severity: 'warn' | 'error'` per
    the `strict` flag, the path in `nodeIds`, the AJV error string in
    `message`, and `data: { kind, errors }` for downstream tools.
    Issues collected during the walk land in the result alongside the
    rule-emitted ones.
  - Incremental-scan (`--changed`) preservation: a per-path
    `priorFrontmatterIssuesByNode` index walks the prior result once;
    on a cache hit, the previously-emitted frontmatter issue is re-pushed
    (re-validating would be wasted work since `frontmatterHash` is
    unchanged). The `strict` flag still applies on the second pass — a
    cached `warn` from the first scan becomes `error` on a strict
    re-run.
  - `src/cli/commands/scan.ts` — new `--strict` flag. The CLI also reads
    `cfg.scan.strict` (already in the project-config schema since 0.1)
    and passes `strict: this.strict || cfg.scan.strict === true` to
    `runScan`. CLI flag wins when both are set.
  - `context/cli-reference.md` — regenerated; `--strict` appears under
    `sm scan` with its description.

  **Tests**:

  - `src/test/scan-frontmatter-strict.test.ts` — 12 tests covering
    fence-less files (no issue), fenced-but-incomplete frontmatter
    (warn issue, message names the missing field), `strict: true`
    promotion to error, valid frontmatter (no issue), type-mismatch
    on a base field (`name: 42` flagged), per-kind schemas
    (skill / command / hook / note each emit one issue with the
    matching `data.kind`), incremental preservation of the cached
    issue, incremental + strict promotion, and four CLI tests via
    the binary (`sm scan` exit 0 with warnings, `--strict` → exit 1,
    `scan.strict: true` config → exit 1, `--strict` overrides
    `scan.strict: false` config).
  - `src/test/scan-readers.test.ts` — `rollback.md` fixture extended to
    include `description` + `metadata` so the `--issue` filter test
    remains semantically correct (rollback.md is the issue-free node).
  - `src/test/scan-benchmark.test.ts` — 500-MD perf budget bumped from
    2000ms → 2500ms with a comment explaining the AJV per-file cost
    (~50-80μs × 500 = ~25-40ms over the prior ceiling). Warm-scan
    reality on a developer laptop stays around 1.0-1.2s; the new
    ceiling preserves headroom for slow CI without lowering the bar.

  Test count: 291 → 303 (+12).

- 7d4b143: Step 6 follow-up — unify the `--strict-config` flag (introduced in 6.2
  for the layered loader) with the existing `--strict` flag (introduced
  in 6.7 for frontmatter validation). One name, same intent across every
  verb that touches user input: "fail loudly on any validation
  warning".

  **CLI surface change** (renamed flag, same Option.Boolean):

  - `sm config list / get / show` — `--strict-config` → `--strict`.
  - `sm scan --strict` — already did frontmatter strict; now ALSO
    propagates strict to `loadConfig` so a bogus key in
    `settings.json` aborts the scan instead of being silently
    skipped.
  - `sm init --strict` — new. Propagates strict to BOTH the loader
    (so user-layer warnings during the first-scan path become
    fatal) and the first-scan's frontmatter validator. Affects only
    the path that actually loads config — `sm init --no-scan`
    skips the loader entirely so `--strict` has nothing to enforce
    there.

  The user-visible motivation: one flag to remember. Internally each
  verb still routes the boolean to whichever validations are reachable
  from its execution path; the conflated name reflects the conflated
  intent ("strict mode = no silent input fixups").

  **Runtime change**:

  - `src/cli/commands/config.ts` — `Option.Boolean('--strict-config',
false)` becomes `Option.Boolean('--strict', false)` in three
    commands (list / get / show). Local field renamed `strictConfig`
    → `strict`. Module JSDoc rewritten to point at the unified
    contract.
  - `src/cli/commands/scan.ts` — `loadConfig` call in `ScanCommand`
    now passes `strict: this.strict` and is wrapped in a try/catch
    emitting `sm scan: <message>` + exit 2 on throw, matching the
    config-verbs UX from the prior follow-up.
  - `src/cli/commands/init.ts` — new `Option.Boolean('--strict',
false)` on `InitCommand`; threaded through `runFirstScan` to
    both the `loadConfig` call (try/catch) and the `runScan` options.
  - `context/cli-reference.md` — regenerated; `sm init --strict` flag
    description now appears in the reference.

  **Spec / docs**:

  - `ROADMAP.md` — every `--strict-config` reference renamed to
    `--strict` (header status, §Configuration body, completeness
    marker, Step 14 `sm ui` flag list).
  - `ui/src/models/settings.ts` JSDoc — same rename.
  - `.changeset/step-6-2-config-loader.md`,
    `.changeset/step-6-3-config-verbs.md`,
    `.changeset/step-6-followup-version-strict-config.md` — all
    flag mentions in pending changeset bodies updated so the
    generated CHANGELOG entries match the shipping flag name.

  **Tests**:

  - `src/test/config-cli.test.ts` — `--strict-config` references in
    the existing `sm config — --strict UX` describe block renamed to
    `--strict`. Test count unchanged.
  - `src/test/scan-frontmatter-strict.test.ts` — new
    `--strict unification` describe block with two end-to-end CLI
    tests: `sm scan --strict` aborts on a bogus loader key (and
    the lenient `sm scan` still tolerates it), and `sm init --strict`
    surfaces the same bogus key during the first-scan path.

  Test count: 310 → 312 (+2).

  No `@skill-map/spec` change — the rename is CLI-only; the spec never
  defined the flag (only the feature semantics).

- 4669267: Step 6 follow-up — two UX polish fixes surfaced during the post-Step-6
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

  **`sm config --strict` UX**: the loader's strict-mode `throw`
  was reaching Clipanion's default error handler, producing "Internal
  Error: ..." with a five-line stack trace and exit code 1. Now wrapped
  in a per-command `tryLoadConfig` helper that catches the throw, writes
  a one-line `sm config: <message>` to stderr, and returns exit code 2
  (operational error) per `spec/cli-contract.md` §Exit codes. Applied to
  `sm config list`, `sm config get`, and `sm config show` — every read
  verb that exposes `--strict`.

  - Pre-fix: stack trace + exit 1.
  - Post-fix: clean stderr line + exit 2.

  **Runtime change**:

  - `src/cli/commands/version.ts` — new `resolveDbSchemaVersion()` helper
    uses `node:sqlite` `DatabaseSync` in read-only mode + `PRAGMA
user_version`. Three failure paths all collapse to `'—'`. JSDoc
    expanded with the resolution contract.
  - `src/cli/commands/config.ts` — new `tryLoadConfig()` private wrapper
    catches `loadConfig` throws (only emitted under `--strict`).
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
  - `src/test/config-cli.test.ts` — new `sm config — --strict UX`
    describe block (5 tests): warning + exit 0 without the flag,
    clean-message + exit 2 with the flag (and explicit assertion that
    no `Internal Error` / stack-trace lines leak through), wrapper
    applied uniformly to `list / get / show`, and malformed-JSON path
    also routes through the clean-error path.

  Test count: 303 → 310 (+7).

- Updated dependencies [f41dbad]
- Updated dependencies [8a4667f]
  - @skill-map/spec@0.6.1

## 0.3.2

### Patch Changes

- dacd4d9: Move the auto-generated CLI reference from `docs/cli-reference.md` to
  `context/cli-reference.md`. Spec change is editorial: `cli-contract.md`
  references the file path in three spots (`--format md` description, the
  NORMATIVE introspection section, and the "Related" link list); all three
  updated to the new location. No schema or behavioural change.

  Reference impl: `scripts/build-cli-reference.mjs` writes to the new path,
  the `cli:reference` / `cli:check` npm scripts point there, and `sm help`
  output (which embeds the path in the `--format md` flag description) is
  regenerated. The `docs/` folder is gone.

- 551f6ec: Persist scan results to SQLite (scan_nodes/links/issues).

  `sm scan` now writes the ScanResult into `<cwd>/.skill-map/skill-map.db`
  with replace-all semantics across `scan_nodes`, `scan_links`, and
  `scan_issues`. The DB is auto-migrated on first run. Persistence is
  skipped under `--no-built-ins` so the kernel-empty-boot conformance
  probe cannot wipe an existing snapshot.

  Also fixes the bundled-CLI default migrations directory: the prior
  resolver assumed an unbundled `kernel/adapters/sqlite/` path layout,
  which silently missed `dist/migrations/` in the tsup-bundled CLI.

- 4c34af1: Step 4.10 — scenario coverage. Pure regression-test growth, no behavior
  changes, no new dependencies, no migrations, no spec edits. Backfills
  the scenarios surfaced by the manual end-to-end validation in
  `.tmp/sandbox/` that the existing test suite did not codify:

  - Hash discrimination: body-only edits leave `frontmatter_hash` and
    `bytes_frontmatter` byte-equal; frontmatter-only edits leave
    `body_hash` and `bytes_body` byte-equal. Locks in that the two
    SHA-256 streams are independent.
  - `external_refs_count` lifecycle across body edits: 0 → 2 → 2 (dedup) →
    1 (malformed URL silently dropped), and `scan_links.target_path`
    never carries an `http(s)` value at any step.
  - Replace-all ID rotation: synthetic `scan_links.id` /
    `scan_issues.id` are not promised to round-trip across re-scans;
    the natural keys (source/kind/target/normalized-trigger and
    ruleId/nodeIds) do. Documents the contract via assertion.
  - Deletion-driven dynamic broken-ref re-evaluation, full-scan path:
    companion to the existing incremental-path test. Confirms rules
    always re-run over the merged graph even on the all-fresh path.
  - Trigger-collision interaction with `--changed`: editing one
    advertiser keeps the collision firing (cached node still claims
    the trigger); deleting one advertiser clears it.
  - `sm scan --no-tokens` at the CLI handler level (the existing test
    exercised the orchestrator only): default → `tokens_total`
    populated; `--no-tokens` → null; default again → repopulated.
  - `sm scan --changed --no-built-ins` rejection: exit 2 with an
    explanatory stderr, no DB I/O.

  Test count delta: 133 → 143.

- 4c34af1: Step 4.11 — three layers of defense against accidental DB wipes when
  `sm scan` receives invalid or empty inputs:

  - `runScan` validates every root path exists as a directory before
    walking, throwing on the first failure (was: silently yielded zero
    files via the claude adapter swallowing `ENOENT` in `readdir`).
  - `sm scan` surfaces the validation error with exit code 2 and a clear
    stderr message naming the bad path.
  - `sm scan` refuses to overwrite a populated DB with a zero-result scan
    unless `--allow-empty` is passed. Prevents the typo-trap reported in
    the e2e validation: `sm scan -- --dry-run` (where clipanion's `--`
    made `--dry-run` a positional root that did not exist) silently
    cleared the user's data. The new flag is opt-in by design — the
    natural case of "empty repo on first scan" is preserved (DB starts
    empty, scan returns 0 rows, persist proceeds without prompting).

  Test count delta: 143 → 151.

- 551f6ec: Compute per-node token counts via `js-tiktoken`.

  `runScan` now populates `node.tokens` (frontmatter / body / total) using
  the `cl100k_base` BPE — the modern OpenAI tokenizer used by
  GPT-4 / GPT-3.5-turbo. The encoder is constructed once per scan and
  reused across nodes (the BPE table is heavyweight to load). Tokens are
  computed against the raw frontmatter bytes (not the parsed YAML
  object) so the count stays reproducible from on-disk content.

  The new `sm scan --no-tokens` flag opts out of tokenization; `node.tokens`
  is left undefined, which is spec-valid because the field is optional in
  `spec/schemas/node.schema.json`. Persistence already handles the absence
  (maps to NULL across `tokens_frontmatter` / `tokens_body` / `tokens_total`).

- 551f6ec: Add `external-url-counter` detector and orchestrator-level segregation for
  external pseudo-links.

  The new detector scans node bodies for `http(s)://` URLs, normalizes them
  (lowercase host, drop fragment, preserve scheme / port / path / query),
  dedupes per node, and emits one `references` pseudo-link per distinct URL
  at `low` confidence. URL parsing uses Node's built-in WHATWG `URL` — no
  new dependency.

  `runScan` now partitions emitted links into internal (graph) and external
  (URL pseudo-link) sets by checking `target.startsWith('http://')` or
  `'https://'`. Internal links flow through the rules layer, populate
  `linksOutCount` / `linksInCount`, and land in `result.links` and
  `scan_links` as before. External pseudo-links are counted into
  `node.externalRefsCount` and then dropped — they never reach rules,
  never appear in `result.links`, and never persist to `scan_links`. This
  keeps the spec's `link.kind` enum locked and `scan_links` semantically
  clean (graph relations only) while giving the inspector a cheap "external
  references" badge.

  This is the drop-in proof from Step 2: the kernel boots, detectors plug
  in, and a new built-in extension lands without spec or migration changes.

- 551f6ec: Add `sm scan -n` / `--dry-run` (in-memory, no DB writes) and `sm scan
--changed` (incremental scan against the persisted prior snapshot).

  `-n` / `--dry-run` runs the full pipeline in memory and skips every DB
  operation (no auto-migration, no persistence). The human-mode summary
  now ends with `Would persist N nodes / M links / K issues to <path>
(dry-run).` so the operator sees what would land. `--json` output is
  unchanged.

  `--changed` opens the project DB read-side, loads the prior snapshot via
  the new `loadScanResult` helper, walks the filesystem, and reuses
  unchanged nodes (matched by `path` + `bodyHash` + `frontmatterHash`).
  Only new / modified files run through the detector pipeline; rules
  always re-run over the merged graph (issue state can change for an
  unchanged node when a sibling moves). Persistence semantics are
  unchanged — replace-all over the merged ScanResult — so the on-disk
  shape stays canonical regardless of how the result was assembled.

  Combination rules:

  - `--changed --no-built-ins` is rejected with exit code 2 — a
    zero-filled pipeline has nothing to merge against.
  - `--changed -n` is supported: load the prior, compute the merged
    result, emit it, do NOT persist. Useful for "what would change?"
    inspection.
  - `--changed` against an empty / missing DB degrades to a full scan and
    prints `--changed: no prior snapshot found; running full scan.` to
    stderr. Exit code unaffected.

  Internals: `runScan` gains an optional `priorSnapshot` field on
  `RunScanOptions`. The orchestrator emits `scan.progress` events with a
  new `cached: boolean` field so future UIs can show the
  reused-vs-reprocessed delta. External pseudo-links are never persisted,
  so for cached nodes the prior `externalRefsCount` is preserved as-is;
  new / modified nodes recompute it from a fresh detector pass. The
  `loadScanResult` helper documents the external-pseudo-link omission
  explicitly — it returns zero pseudo-links by definition, but the
  per-node count survives in the loaded node row.

- 551f6ec: Promote `sm list`, `sm show`, `sm check` from stubs to real
  implementations backed by the persisted `scan_*` snapshot.

  `sm list [--kind <k>] [--issue] [--sort-by <field>] [--limit N] [--json]`
  emits a tabular view (PATH / KIND / OUT / IN / EXT / ISSUES / BYTES) of
  every node in `scan_nodes`. `--kind` and `--issue` filter rows; the
  issue filter uses a SQL `EXISTS` over `scan_issues` so the work stays
  in the DB. `--sort-by` is whitelisted (`path`, `kind`, `bytes_total`,
  `links_out_count`, `links_in_count`, `external_refs_count`) — anything
  else exits 2 with a clear stderr message. Numeric columns sort
  descending by default so `--sort-by bytes_total --limit N` returns the
  heaviest nodes; textual columns sort ascending. `--json` emits a flat
  array conforming to `node.schema.json`.

  `sm show <node.path> [--json]` prints the per-node detail view: header
  with kind / adapter, optional title / description / stability /
  version / author lines, the bytes (and tokens, when present) triple
  split, the parsed frontmatter, links out, links in, and current
  issues. `--json` emits `{ node, linksOut, linksIn, issues, findings,
summary }`; `findings` is reserved as `[]` and `summary` as `null`
  until Step 10 (`state_findings`) and Step 11 (`state_summaries`) ship.
  A missing path exits 5 with `Node not found: <path>` on stderr.

  `sm check [--json]` reads every row from `scan_issues`, prints them
  grouped by severity (errors first, then warns, then infos) as
  `[<severity>] <ruleId>: <message> — <node-paths>`, and exits 1 if any
  issue carries severity `error`, otherwise 0. Equivalent to
  `sm scan --json | jq '.issues'` but without the walk-and-detect cost.
  `--json` emits an `Issue[]`.

  All three verbs honor the `-g/--global` and `--db <path>` global flags,
  and exit 5 with `DB not found at <path>; run \`sm scan\` first.` when
  the snapshot has not been persisted yet.

  Internals: extracted the `resolveDbPath` and DB-existence guard from
  `sm db` into a shared `cli/util/db-path.ts` so the read-side commands
  and the lifecycle commands stay byte-aligned on path resolution.
  Promoted the row→Node / row→Link / row→Issue mappers in
  `scan-load.ts` from private helpers to module exports so the readers
  reuse the exact mapping the incremental loader uses, keeping the
  read-side aligned with the spec schemas.

- 551f6ec: Add Step 4.6 acceptance coverage: a self-scan test and a 500-MD
  performance benchmark.

  `src/test/self-scan.test.ts` runs `runScan` directly against the
  project repo (no persistence — never writes `.skill-map/skill-map.db`)
  with the full built-in pipeline and asserts: `schemaVersion === 1`;
  every node, link, and issue conforms to its authoritative spec
  schema (mirrors the `validate-all` audit's per-element strategy);
  nodes count > 0; the expected node kinds appear (relaxed to allow
  `command` and `hook` as missing today since neither
  `.claude/commands/` nor `.claude/hooks/` exists in the working tree
  — the tolerated-missing set auto-tightens the moment either grows
  a real file); no `error`-severity issues survive; tokens are
  populated for ≥ 1 node (Step 4.2 smoke test); `externalRefsCount > 0`
  for ≥ 1 node (Step 4.3 smoke test). Failures print actionable detail
  (missing kinds present, full per-issue dump) so a regression is
  diagnosable without re-running with extra logging.

  `src/test/scan-benchmark.test.ts` materialises 500 synthetic
  markdown files under `<repo>/.tmp/scan-bench-<random>/` (gitignored,
  project-local per AGENTS.md) — 100 each of agents, commands, hooks,
  skills (with `SKILL.md` per-skill subdir), and notes — each carrying
  a slash invocation, an `@`-directive, and an http URL so every
  detector fires. Ten agents share the same `name` so
  `trigger-collision` has work to do; some commands cross-reference
  each other through `metadata.related[]`. Asserts the full scan
  (tokenize + 4 detectors + 3 rules) completes within a 2000 ms
  budget (measured ~930 ms locally), `nodesCount === 500`, and
  `linksCount > 0`. Always prints a `[bench] 500 nodes / N links / M
issues in Tms` line to stderr so a CI failure surfaces the actual
  measurement, not a bare assertion. Comment above the threshold
  documents the escape hatch (profile cl100k_base cold-start before
  bumping; never disable).

  Adds `.tmp` to the `claude` adapter's `DEFAULT_IGNORE` set so the
  walker never traverses transient AI/test artifacts. Without this,
  the benchmark's fixture would appear in the self-scan and races
  between the two tests would flake the suite. The convention is
  already enforced everywhere else (gitignore, AGENTS.md), so the
  adapter now matches.

  Both tests run inside the standard `npm test` / `npm run test:ci`
  flow; no separate `bench` script is needed (runtime delta well under
  a second).

- 551f6ec: Reconcile the runtime `ScanResult` shape with `spec/schemas/scan-result.schema.json`.

  The runtime has been silently violating the spec since Step 0c. The
  spec is the source of truth and has been correct all along; this change
  is a one-way fix — `src/` catches up to `spec/`. No spec edit, no
  spec changeset.

  What changed at the runtime boundary:

  - `scannedAt` is now `number` (Unix milliseconds, integer ≥ 0). It used
    to be an ISO-8601 `string` that the persistence layer parsed back to
    an int via `Date.parse()`; both conversions are gone. The DB column
    has always been `INTEGER` — only the in-memory shape moved.
  - `scope` is now emitted: `'project' | 'global'`. Defaults to
    `'project'`; overridable via the new `RunScanOptions.scope?` field.
    The CLI surface (`sm scan`) hardcodes `'project'` for now — the
    `--global` flag wiring lands in Step 6 (config + onboarding).
  - `roots` is now hard-required to be non-empty. `runScan` throws
    `"runScan: roots must contain at least one path (spec requires
minItems: 1)"` when called with `roots: []`. The CLI already
    defaults `roots = ['.']` when no positional args are supplied, so
    the throw is a programming-error guard, not a user-visible regression.
  - `adapters: string[]` is now emitted (the ids of every adapter that
    participated in classification; `[]` when no adapter ran). Optional
    in spec; emitted unconditionally for self-describing output.
  - `scannedBy: { name, version, specVersion }` is now emitted.
    `name` is hardcoded `'skill-map'`; `version` is read once at module
    init from this package's `package.json` (static JSON import, same
    pattern as `cli/version.ts`); `specVersion` reuses the existing
    `installedSpecVersion()` helper from the plugin loader (reads
    `@skill-map/spec/package.json#version` off disk, with a safe fallback
    to `'unknown'`).
  - `stats.filesWalked: number` is now emitted. Counts every `IRawNode`
    yielded by the adapter walkers. With one adapter it equals
    `nodesCount`; with future multi-adapter scans on overlapping roots
    it will diverge.
  - `stats.filesSkipped: number` is now emitted. Spec definition: "Files
    walked but not classified by any adapter." Today every walked file
    IS classified (the `claude` adapter's `classify()` always returns a
    kind, falling back to `'note'`), so this is **always 0**. Wired now
    so the field shape is spec-conformant; meaningful once multiple
    adapters compete (Step 9+).

  Ripple changes:

  - `persistScanResult` no longer parses `scannedAt`; it validates
    `Number.isInteger(scannedAt) && scannedAt >= 0` and uses the value
    as-is. The error message updated to "expected non-negative integer
    ms"; the matching test case renamed from "rejects an unparseable
    scannedAt" to "rejects a non-integer scannedAt".
  - `loadScanResult` returns a synthetic envelope: `scannedAt` is
    derived from `max(scan_nodes.scanned_at)` (or `Date.now()` for
    empty snapshots); `scope` defaults to `'project'`; `roots: ['.']`
    to satisfy the spec's `minItems: 1` (NOT load-bearing — the
    orchestrator's incremental path only reads `nodes` / `links` /
    `issues` from a prior, never the meta); `adapters: []`;
    `stats.filesWalked` / `filesSkipped` / `durationMs` are zeroed.
    The header comment documents the omissions and points at the
    follow-up `state_scan_meta` table that would let the loader return
    real values.
  - `ScanCommand` (`sm scan`) explicitly passes `scope: 'project'` into
    `runScan`. No change to the CLI surface.

  Self-scan acceptance test (`src/test/self-scan.test.ts`) upgraded:
  the per-element node / link / issue validation is replaced with a
  single top-level `scan-result.schema.json` validation. This is the
  strong assertion for the reconciliation: the whole `ScanResult` now
  parses against the authoritative top-level schema.

  **Breaking change for runtime consumers**: anyone who was reading the
  buggy ISO `scannedAt` string off `result` (or from `JSON.stringify(result)`
  via `sm scan --json`) now sees an integer. The fix is one line:
  `new Date(result.scannedAt)`. The runtime contract was buggy — the
  spec said integer all along — but the buggy runtime was the de-facto
  contract for downstream tooling tracking the `0.3.x` line, so call
  this out explicitly. `schemaVersion` stays at 1 because the spec did
  not move.

- 551f6ec: Three fixes surfaced by the Step 4 end-to-end validation:

  - `sm scan` exit code now matches `sm check`: returns `1` only when issues
    at `error` severity exist (was: `1` on any issue, including warn / info).
    Honors `spec/cli-contract.md` §Exit codes. The exit code is now
    consistent across `--json` and the human format — previously the
    `--json` branch always returned `0`, which made an agent loop scripting
    `sm scan --json | jq` blind to error-severity issues.
  - `sm show` human output now reports `External refs: <N>` after the
    Weight section. The `--json` output already exposed
    `node.externalRefsCount`; the human format had a parity gap. Rendered
    unconditionally (including `External refs: 0`) for honest reporting.
  - `sm scan --changed` no longer drops `supersedes`-inversion links from
    cached nodes. The frontmatter detector emits `supersededBy` edges with
    `source = newer-node` and `target = older-node`; the prior cached-reuse
    filter incorrectly required `link.source === node.path`, which dropped
    these inverted edges (the source path is often not even a real node).
    Repro on the skill-map repo: `sm scan` then `sm scan --changed`
    previously yielded 470 → 468 links; both now yield 470 with the link
    sets set-equal. The fix introduces an `originatingNodeOf(link,
priorNodePaths)` helper in the orchestrator: for `kind === 'supersedes'`
    it falls back to `link.target` only when `link.source` is not a known
    prior node path, which handles BOTH the inverted case (originating =
    target) and the forward `metadata.supersedes[]` case (originating =
    source). Frontmatter is currently the only detector that emits
    cross-source links — a future detector adding another inversion case
    would escalate to a persisted `Link.detectedFromPath` field with a
    schema bump rather than extending this heuristic.

- 4c34af1: Two more fixes from the Step 4 end-to-end validation pass:

  - `trigger-collision` rule now also detects cases where two nodes advertise
    the same trigger via their `frontmatter.name` (e.g. two commands both
    named `deploy` in different files — the canonical example in the rule's
    own doc comment). Previously the rule only fired on case-mismatch
    invocations between different sources; commands competing for a
    namespace silently passed because the implementation iterated `links`
    alone and never looked at `nodes`. The rule now buckets two kinds of
    claims on each normalized trigger — advertisements (`'/' +
frontmatter.name` for `command` / `skill` / `agent` nodes) and
    invocations (raw `link.target`) — and emits one `error` issue per
    bucket with two or more distinct advertiser paths, two or more distinct
    invocation forms, or one advertiser plus a non-canonical invocation
    (e.g. an upper-cased trigger against a lower-cased advertiser name).
    Issue payload exposes
    `{ normalizedTrigger, invocationTargets, advertiserPaths }` so callers
    can render either side.
  - `sm scan` now runs `PRAGMA wal_checkpoint(TRUNCATE)` after persisting,
    so external read-only tools (sqlitebrowser, DBeaver, ad-hoc `sqlite3`
    clients) see fresh state without manual intervention. Previously the
    main `.db` could lag the `.db-wal` arbitrarily — for typical small-repo
    scans the WAL never crossed the 1000-page auto-checkpoint threshold,
    so the canonical snapshot stayed in the sidecar indefinitely. The
    checkpoint runs on the top-level Kysely handle (not inside the
    transaction); cost is `~ms` on small DBs and there are no concurrent
    readers to contend with.

- 9a89124: Step 5.1 — Persist scan-result metadata in a new `scan_meta` table so
  `loadScanResult` returns real values for `scope` / `roots` / `scannedAt` /
  `scannedBy` / `adapters` / `stats.filesWalked` / `stats.filesSkipped` /
  `stats.durationMs` instead of the synthetic envelope shipped at Step 4.7.

  **Spec change (additive, minor)**:

  - New `scan_meta` table in zone `scan_*`, single-row (CHECK `id = 1`).
    Columns: `scope`, `roots_json`, `scanned_at`, `scanned_by_name`,
    `scanned_by_version`, `scanned_by_spec_version`, `adapters_json`,
    `stats_files_walked`, `stats_files_skipped`, `stats_duration_ms`.
    `nodesCount` / `linksCount` / `issuesCount` are not stored — they are
    derived from `COUNT(*)` of the sibling tables.
  - Replaced atomically with the rest of `scan_*` on every `sm scan`.

  **Runtime change**:

  - New kernel migration `002_scan_meta.sql`.
  - `IScanMetaTable` added to `src/kernel/adapters/sqlite/schema.ts` and
    bound in `IDatabase`.
  - `persistScanResult` writes the row (and deletes prior rows in the same
    transaction).
  - `loadScanResult` reads from `scan_meta` when the row exists; degrades
    to the previous synthetic envelope when it does not (DB freshly
    migrated, never scanned, or pre-5.1 snapshot).
  - The Step 4.7 follow-up notes in `scan-load.ts` documenting the
    synthetic envelope are simplified to describe both branches.

  Test count: 151 → 154 (+3 covering meta round-trip, replace-all
  single-row invariant, and synthetic-fallback on empty DB).

- 9a89124: Step 5.10 — Two polish fixes for the `sm history` CLI surfaces, both
  surfaced during end-to-end walkthrough.

  **Fix 1 — `sm history` (human) table columns no longer collapse**:
  the previous `formatRow` padded every non-ID column to a flat 11
  chars. The STARTED column writes a 20-char ISO-8601 timestamp
  (`2026-04-26T14:00:00Z`), which exceeds the 11-char width — `padEnd`
  silently no-ops when content is longer than the target width, so the
  timestamp ran into the next ACTION cell with zero whitespace
  between (`...T14:00:00Zsummarize`). Replaced with a per-column
  `COL_WIDTHS` array sized so the longest expected content fits with
  ≥2 trailing spaces:

  | Column   | Width | Rationale                      |
  | -------- | ----- | ------------------------------ |
  | ID       | 28    | truncate to 26 + 2 padding     |
  | STARTED  | 22    | 20-char ISO + 2 padding        |
  | ACTION   | 26    | truncate to 24 + 2 padding     |
  | STATUS   | 12    | longest enum (`completed`) + 3 |
  | DURATION | 10    | longest format (`1m 42s`) + 3  |
  | TOKENS   | 14    | typical `12345/6789` + buffer  |
  | NODES    | 6     | small int + buffer             |

  **Fix 2 — `sm history stats --json` `elapsedMs` accuracy**: the field
  was captured at `stats` construction time, BEFORE
  `loadSchemaValidators()` (which loads + AJV-compiles 29 schemas from
  disk on every CLI invocation, ~100 ms cold). Result: the JSON
  reported `elapsedMs: 10` while stderr showed `done in 111ms` —
  divergence of ~10× that misled anyone trying to correlate the two
  numbers. Fixed by re-stamping `stats.elapsedMs = elapsed.ms()` AFTER
  the validator load but BEFORE serialise. Schema validation is
  order-independent for `elapsedMs` (any non-negative integer
  satisfies the schema), so re-stamping post-validate is safe. The
  ~10 ms remaining gap (serialise + write) is below user-perception
  threshold.

  The validator load itself is still uncached — addressing that is a
  deeper refactor (module-level cache or pre-compiled validators) and
  out of scope for this polish pass.

  Test: 1 new in `src/test/history-cli.test.ts` — "table columns do
  not collapse" — asserts the rendered output contains an ISO
  timestamp followed by ≥2 spaces before the action id. Catches the
  pre-5.10 regression directly.

  Test count: 206 → 207.

- 9a89124: Step 5.11 — `sm history` human renderer now shows `failure_reason`
  inline when present, so the human path stops hiding info that's
  already in `--json`.

  Before:

  ```
  h-008  ...  audit-bar  failed     200ms  50/0     1
  h-006  ...  audit-foo  cancelled  50ms   20/0     1
  ```

  After:

  ```
  h-008  ...  audit-bar  failed (runner-error)         200ms  50/0   1
  h-006  ...  audit-foo  cancelled (user-cancelled)    50ms   20/0   1
  ```

  `completed` rows are unchanged (no parens noise). The STATUS column
  widened from 12 to 30 chars to fit the longest enum
  (`cancelled (user-cancelled)` = 26).

  Test count: 207 → 208.

- 9a89124: Step 5.12 — `loadSchemaValidators()` now caches the compiled validator
  set at module level. Before: every call paid ~100 ms cold to read +
  AJV-compile 17 schemas (plus 8 supporting `$ref` targets). After: the
  first call costs the same; every subsequent call in the same process
  returns the same instance for free.

  For a one-shot CLI like `sm history stats --json`, this is a no-op
  (only one call per process). The win shows up once a future verb
  validates at multiple boundaries — likely candidates: `sm doctor`,
  `sm record`, plugin manifest re-checks, the audit pipeline. Lays the
  groundwork without forcing those callers to thread a cached
  validators bundle through their call stacks.

  Test-only escape hatch `_resetSchemaValidatorsCacheForTests()`
  exported so tests can re-trigger the cold load deterministically. The
  public `loadSchemaValidators` signature is unchanged.

  Test count: 208 → 211 (+3 in `kernel/adapters/schema-validators.test.ts`).

- 9a89124: Step 5.13 — `frontmatter_hash` is now computed over a CANONICAL YAML
  form of the parsed frontmatter, not over the raw text bytes.

  **Why**: a YAML formatter pass on the user's editor (Prettier YAML,
  IDE autoformat, manual indent fix, key reordering) used to silently
  break the medium-confidence rename heuristic — two files with
  identical logical frontmatter but different YAML formatting got
  different `frontmatter_hash` values, so the heuristic saw them as
  "different frontmatter" and demoted what should have been a
  medium-confidence rename to an `orphan` issue. Surfaced during the
  end-to-end walkthrough (the `cat <<EOF` output didn't byte-match the
  file written via the Write tool, even though both blocks looked
  identical to a human).

  **How**: new `canonicalFrontmatter(parsed, raw)` helper in
  `kernel/orchestrator.ts`. Re-emits the parsed frontmatter via
  `yaml.dump` with deterministic options:

  - `sortKeys: true` — keys in lexicographic order regardless of
    declaration order.
  - `lineWidth: -1` — no auto-wrap.
  - `noRefs: true` — no `*alias` shorthand.
  - `noCompatMode: true` — modern YAML 1.2 output.

  Comments are lost (they're not semantic). Hash is then `sha256` of
  that canonical string instead of `raw.frontmatterRaw`.

  **Fallback**: when the adapter's parse failed silently (yields
  `parsed = {}` for non-empty `raw`), we fall back to hashing the raw
  text so a malformed-YAML file still hashes deterministically against
  itself across rescans. Without this, every malformed file would
  collapse to the same `sha256(yaml.dump({}))` and erroneously match
  each other for rename.

  **Migration impact**: existing DBs have `frontmatter_hash` values
  computed over raw text. After this lands, the next `sm scan` will
  see every file as "frontmatter changed" (cache miss in `--changed`
  mode; otherwise cosmetic). No data loss. `state_*` rows aren't
  affected — they key on `node.path`, not on `frontmatter_hash`. Once
  the new hashes settle, behaviour stabilises.

  Tests: 2 new in `src/test/scan-mutation.test.ts`:

  - "two files with the same logical frontmatter but DIFFERENT YAML
    formatting hash to the same fm_hash" — exercises key reordering,
    quote-style change, trailing-newline change, all in one fixture
    pair.
  - "logically-different frontmatters still produce different
    fm_hashes" — guard against canonicalization collapsing distinct
    values.

  Test count: 211 → 213.

- 9a89124: Step 5.2 — Storage helpers for the history readers (`sm history`,
  `sm history stats`) and for the rename heuristic / `sm orphans` verbs
  landing in 5.3 — 5.6.

  New module `src/kernel/adapters/sqlite/history.ts` with four entry
  points, all accepting either a `Kysely<IDatabase>` or a
  `Transaction<IDatabase>` so callers can compose them inside a larger
  tx (the rename heuristic does this):

  - `insertExecution(db, exec)` — write a `state_executions` row.
    Surfaces today through tests; consumed by `sm record` / `sm job run`
    at Step 9.
  - `listExecutions(db, filter)` — read with optional filters: `nodePath`
    (JSON-array containment via `json_each`, mirroring the
    `sm list --issue` subquery in `cli/commands/list.ts`), `actionId`
    (exact match on `extension_id`), `statuses[]`, `sinceMs` /
    `untilMs` (since inclusive, until exclusive), `limit`. Sorted
    most-recent first.
  - `aggregateHistoryStats(db, range, period, topN)` — totals,
    per-action token rollup (sorted desc by `tokensIn + tokensOut`),
    per-period bucketing via `bucketStartMs` (UTC `day` / `week` /
    `month`), top-N nodes by frequency (tie-break `lastExecutedAt`
    desc), and error rates: global, per-action, and per-failure-reason.
    The per-failure-reason map ALWAYS includes all six enum values
    (zero-filled), so dashboards see a predictable shape.
  - `migrateNodeFks(trx, fromPath, toPath)` — repoint every `state_*`
    reference to a node from `fromPath` to `toPath`. Handles the three
    FK shapes the kernel uses today: simple column on `state_jobs`,
    JSON-array contents on `state_executions.node_ids_json`
    (pull-modify-update), and composite PKs on `state_summaries`,
    `state_enrichments`, `state_plugin_kvs` (delete + insert at the new
    PK). Composite-PK collisions are resolved conservatively: the
    destination row is preserved (it represents the live node's
    history), the migrating row is dropped, and the drop is reported
    back via `IMigrateNodeFksReport.collisions[]` so callers can surface
    a diagnostic. The empty-string sentinel for plugin-global keys is
    intentionally skipped.

  Exports `bucketStartMs(dateMs, period)` for direct use by the
  `sm history stats` CLI (5.4) and to keep bucketing testable in
  isolation.

  New domain types in `src/kernel/types.ts`: `ExecutionRecord`,
  `ExecutionKind`, `ExecutionStatus`, `ExecutionFailureReason`,
  `ExecutionRunner`, plus `HistoryStats` and its sub-shapes —
  mirroring `spec/schemas/execution-record.schema.json` and
  `spec/schemas/history-stats.schema.json` respectively.

  Test count: 154 → 169 (+15 covering insert/list filter axes,
  bucket boundaries for day/week/month, totals + per-action +
  per-period + top-nodes + error-rates aggregation including the
  all-six-keys failure-reason invariant, FK migration across the
  three shapes, sentinel preservation, and conservative collision
  resolution).

- 9a89124: Step 5.3 — `sm history` CLI lands. The stub is removed from
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

- 9a89124: Step 5.4 — `sm history stats` CLI lands alongside `sm history` in
  `src/cli/commands/history.ts`. The stub is removed from `stubs.ts`
  and the real class registered in `cli/entry.ts`.

  Surface (matches `spec/cli-contract.md` §History):

  - `--since <ISO>` / `--until <ISO>` — window boundaries. Since defaults
    to `null` (all-time); until defaults to `now()`. Both validated.
  - `--period day|week|month` — bucket granularity. Default `month`. Bucket
    start computed in UTC (`bucketStartMs` from 5.2): day = 00:00 of the
    date, week = Monday 00:00 UTC, month = day-1 00:00 UTC.
  - `--top N` — caps the `topNodes` array. Default 10. Non-positive → exit 2.
  - `--json` — emits a `HistoryStats` object conforming to
    `spec/schemas/history-stats.schema.json`. The output is **self-validated
    before emit** via `loadSchemaValidators().validate('history-stats', …)` —
    same pattern as `src/test/self-scan.test.ts` — so a runtime shape
    regression surfaces as exit 2 with a clear stderr message rather than
    drifting silently.
  - `--quiet` — suppresses the `done in <…>` stderr line.

  Top-level `elapsedMs` is included in the JSON object per the schema.
  Stderr always carries `done in <formatted>` unless `--quiet`.

  The per-failure-reason map ALWAYS contains all six enum values
  (`runner-error`, `report-invalid`, `timeout`, `abandoned`,
  `job-file-missing`, `user-cancelled`), zero-filled when a reason has
  no occurrences — predictable shape for dashboards.

  Tests: 6 new in `src/test/history-cli.test.ts` covering schema
  self-validation, day-period bucketing, invalid `--period`, `--top`
  cap, `range.since` shape (`null` vs ISO string), and the empty-DB
  all-zero totals path.

  `context/cli-reference.md` regenerated.

- 9a89124: Step 5.5 — Auto-rename heuristic lands at scan time per
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

- 9a89124: Step 5.6 — `sm orphans` verbs land. The three stubs are removed from
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
  state\_\* FKs via `migrateNodeFks` (5.2) inside a single transaction
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

  Migrates state\_\* FKs back to the prior path (the reverse of what the
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

- 9a89124: Step 5.7 — Conformance coverage for the rename heuristic.

  **Spec change (additive, minor)**:

  - `spec/schemas/conformance-case.schema.json` gains
    `setup.priorScans: Array<{ fixture, flags? }>` — an ordered list of
    staging scans the runner executes BEFORE the main `invoke`. Each
    step replaces every non-`.skill-map/` directory in the scope with
    the named fixture and runs `sm scan` (with optional flags). The DB
    persists across steps because `.skill-map/` is preserved between
    swaps. After the last step, the runner copies the top-level
    `fixture` and runs the case's `invoke`.

    Required to express scenarios that need a prior snapshot (rename
    heuristic, future incremental cases). The schema is purely
    additive — every existing case keeps passing without modification.

  - Two new conformance cases under `spec/conformance/cases/`:

    - **`rename-high`** — moving a single file with identical body
      triggers a high-confidence auto-rename. Asserts:
      `stats.nodesCount === 1`, `stats.issuesCount === 0`,
      `nodes[0].path === skills/bar.md`. Verifies the spec invariant
      that high-confidence renames emit NO issue.
    - **`orphan-detection`** — deleting a file with no replacement
      emits exactly one `orphan` issue (severity `info`). Asserts the
      `ruleId` and `severity` directly.

  - Four new fixture directories under `spec/conformance/fixtures/`:
    `rename-high-before/`, `rename-high-after/`,
    `orphan-before/`, `orphan-after/`.

  - `spec/conformance/coverage.md`: row I (Rename heuristic) flips
    from `🔴 missing` to `🟢 covered`. Notes the medium / ambiguous
    branches stay covered by `src/test/rename-heuristic.test.ts` for
    now (assertion vocabulary in the schema is not rich enough to
    express "the issues array contains an item with ruleId X and
    data.confidence === 'medium'" — when the conformance schema gains
    array-filter assertions, those branches can land here too).

  **Runtime change**:

  - `src/conformance/index.ts` runner: implements `setup.priorScans`.
    Helper `replaceFixture(scope, specRoot, fixture)` clears every
    top-level entry in the scope except `.skill-map/`, then copies the
    named fixture on top. Used by both staging steps and the main
    `fixture` phase.
  - `src/test/conformance.test.ts`: includes the two new cases in the
    Step-0b subset. Total conformance cases passing in CI: 1 → 3.

  **`spec/index.json`** regenerated (50 → 57 files). `npm run spec:check`
  green.

  Test count: 201 → 203 (+2 conformance cases). The Step 5 totals close
  at: 151 → 203 (+52 across 7 sub-steps).

- 9a89124: Step 5.8 — fire the rename heuristic on every `sm scan`, not just
  `sm scan --changed`. Closes the follow-up flagged at the close of
  Step 5.

  Before this change, `priorSnapshot` in `RunScanOptions` carried two
  coupled responsibilities:

  1. Source for the rename heuristic (5.5).
  2. Source for cache reuse (5.4 / Step 4.4 — skip detectors on
     hash-matching nodes).

  Loading prior was gated on `--changed` in `scan.ts`, so a plain
  `sm scan` after reorganising files emitted no rename / orphan issues
  and migrated no `state_*` FKs. The user-visible expectation — and a
  defensible reading of the spec ("`sm scan` is the only surface that
  triggers automatic rename detection") — is that **every** `sm scan`
  fires the heuristic.

  The fix decouples the two responsibilities:

  - New `RunScanOptions.enableCache?: boolean` (default `false`).
    Controls cache reuse only. The orchestrator's "cached" check is now
    `enableCache && prior !== null && hashes match`.
  - `priorSnapshot` reverts to a single meaning: "data from the prior
    scan". Always passed when a prior exists, regardless of `--changed`.
  - `scan.ts` always loads the prior when the DB exists and the user
    isn't running `--no-built-ins`. The `--changed`-only stderr warning
    ("no prior snapshot found") survives — without `--changed` the
    empty-prior path is silent (it's the normal first-scan behaviour).
  - `scan.ts` sets `enableCache: this.changed` when `priorSnapshot` is
    passed, so `--changed` keeps its perf win and the contract for
    cache-reliant tests doesn't break.

  Behaviour matrix after the fix:

  | Invocation                      | Prior loaded? | Cache reuse? | Rename heuristic? |
  | ------------------------------- | ------------- | ------------ | ----------------- |
  | `sm scan` (DB exists)           | yes           | no           | yes               |
  | `sm scan` (DB empty)            | no            | n/a          | no                |
  | `sm scan --changed` (DB exists) | yes           | yes          | yes               |
  | `sm scan --changed` (DB empty)  | no — warns    | n/a          | no                |
  | `sm scan --no-built-ins`        | no            | n/a          | no (no walk)      |

  `--changed --no-built-ins` rejection (exit 2) stays as-is — the
  combination is still incoherent.

  Tests:

  - `scan-incremental.test.ts` — pre-existing tests assert on cache
    events; they now pass `enableCache: true` explicitly to keep that
    contract under test.
  - `cli.test.ts` — new e2e: write file → `sm scan` → delete file →
    `sm scan --json` (no --changed) → assert one `orphan` issue in the
    result. Closes the gap at the binary level.

  Test count: 203 → 204.

  Internal API note: `runScanWithRenames` continues to return
  `{ result, renameOps }`. Both the heuristic and the cache use the
  same prior data, so the wrapper's signature didn't change.

- 9a89124: Step 5.9 — Orphan issues now persist across scans as long as `state_*`
  has stranded references. Closes a gap surfaced during end-to-end
  walkthrough.

  **The bug**: `persistScanResult` does `DELETE FROM scan_issues` before
  inserting the new issues. The per-scan rename heuristic
  (`detectRenamesAndOrphans`) only emits `orphan` for paths in `prior \
current` of the _immediately preceding_ scan. So after a deletion-scan
  emitted an `orphan` issue, the very next scan (with no further
  mutations) wiped that issue and emitted nothing — leaving the stranded
  `state_*` rows invisible. Worst consequence:
  `sm orphans reconcile <orphan.path>` requires an active orphan issue,
  so once the issue silently expired, the user had no way to reconcile
  the stranded references.

  This contradicts `spec/db-schema.md` §Rename detection:

  > "the kernel emits an issue (...) and keeps the `state_*` rows
  > referencing the dead path untouched **until the user runs
  > `sm orphans reconcile`** or accepts the orphan."

  The "until" language implies the issue stays surfaceable as long as
  the stranded refs remain.

  **The fix**: new `findStrandedStateOrphans(trx, livePaths)` helper in
  `src/kernel/adapters/sqlite/history.ts` sweeps every node reference
  across `state_jobs`, `state_executions` (json_each over the JSON
  array), `state_summaries`, `state_enrichments`, and `state_plugin_kvs`
  (skipping the empty-string sentinel for plugin-global keys). Returns
  the set of distinct `node_id` values not present in the live snapshot,
  deterministically lex-asc.

  `persistScanResult` calls the sweep AFTER applying `renameOps` and
  BEFORE the replace-all of `scan_issues`. For each stranded path not
  already covered by a per-scan orphan issue, it appends a new orphan
  issue to `result.issues`. Then the replace-all writes the augmented
  list. `result.stats.issuesCount` is updated to keep `sm scan --json`
  self-consistent.

  **Behaviour**:

  - High / medium renames migrate state\_\* → no stranded refs → no extra
    orphan issues. Unchanged.
  - Ambiguous → state stays on the old paths → next scan emits orphans
    for each previously-stranded path automatically.
  - Pure orphan (deleted, no rename match) → emits orphan in the same
    scan, persists across subsequent scans until the user reconciles
    via `sm orphans reconcile <path> --to <new.path>` or rewrites the
    state row manually.
  - Once `state_*` no longer references the dead path, the next scan
    emits no orphan for it. Self-healing.

  The sweep is deduplicated against per-scan emissions via
  `knownOrphanPaths`, so the same path never appears twice in
  `scan_issues` after a single scan.

  Tests: 2 new in `rename-heuristic.test.ts`:

  - "orphan issue persists across subsequent scans while state\_\*
    references the dead path" — 4 scans walking the full lifecycle
    (seed → delete → re-scan persistence → reconcile-via-state-edit).
  - "per-scan orphan and stranded sweep do not duplicate the same path"
    — same path emitted by both pathways, only 1 issue in result.

  Test count: 204 → 206.

- Updated dependencies [dacd4d9]
- Updated dependencies [9a89124]
- Updated dependencies [9a89124]
  - @skill-map/spec@0.6.0

## 0.3.1

### Patch Changes

- 18d758a: Editorial pass across spec/ and src/ docs: convert relative-path text references (e.g. `plugin-kv-api.md`, `schemas/node.schema.json`) to proper markdown links, so they resolve on GitHub and in renderers. No normative or behavioural changes — prose, schemas, and CLI contract are unchanged.
- b6c46f8: Pin all dependencies to exact versions in `src/package.json` (no `^` / `~` ranges). Matches the new repo-wide rule in `AGENTS.md`. No runtime behaviour change — all versions match what the lockfile already resolves to. Re-evaluate when `src/` flips to public (published libs usually prefer caret ranges so consumers can dedupe).
- 48c386b: First npm publish of `@skill-map/cli` — name registration. The package was previously private; flipping `private: false` plus adding `publishConfig.access: public` lets the next "Version Packages" merge publish to the npm registry under the `@skill-map` org alongside `@skill-map/spec`. Status remains preview / pre-1.0 (Steps 0a-3 done; full scan lands at Step 4). Subsequent releases follow the standard changeset flow.
- Updated dependencies [18d758a]
  - @skill-map/spec@0.5.1

## 0.3.0

### Minor Changes

- 128a678: Step 1a — Storage + migrations.

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

- a0e6578: Step 1b — Registry + plugin loader.

  Wires AJV Draft 2020-12 validation against the schemas published by `@skill-map/spec` and ships the default `PluginLoader` implementation on top of it.

  **`src/kernel/adapters/schema-validators.ts`** compiles 17 reusable validators from the spec (11 top-level + 6 extension-kind). A single Ajv instance is used so `$ref` resolution works across `allOf` composition (every extension kind extends `extensions/base` via `allOf`). Supporting schemas (frontmatter, summaries) register first so targets resolve during compile. Eager compilation at load time means a spec corruption is a hard boot error, not a deferred surprise. `ajv-formats` is enabled for `uri` / `date` / `date-time`. A dedicated `validatePluginManifest()` targets `plugins-registry.schema.json#/$defs/PluginManifest` so callers don't hand-filter the combined `oneOf`.

  **`src/kernel/types/plugin.ts`** hand-writes the plugin-surface types (`IPluginManifest`, `TPluginStorage`, `ILoadedExtension`, `IDiscoveredPlugin`, `TPluginLoadStatus`). Per the updated DTO-gap note, this hand-curated mirror stays in place until Step 2's real adapter arrives as a third consumer that justifies a canonical typed-DTO export from `@skill-map/spec`.

  **`src/kernel/adapters/plugin-loader.ts`** implements the full load pass:

  1. Discover plugin directories under the configured search paths; each direct child containing a `plugin.json` is a plugin root.
  2. Parse + AJV-validate the manifest — any failure (JSON parse error, schema mismatch, malformed `specCompat` range) returns `status: 'invalid-manifest'`.
  3. `semver.satisfies(installedSpecVersion, manifest.specCompat)` with `includePrerelease: true` — mismatch returns `status: 'incompatible-spec'` with the manifest preserved for diagnostics.
  4. Dynamic-import every path in `manifest.extensions[]`, expecting a default export with a string `kind` field. File missing, import failure, missing/unknown kind, or default export failing its kind schema all return `status: 'load-error'` with a precise reason.

  Never throws — the kernel always keeps booting, regardless of how broken a plugin is.

  **CLI: `sm plugins list / show / doctor`** land in `src/cli/commands/plugins.ts`:

  - `list` tabulates discovered plugins with a status glyph and either their extension list (on success) or their failure reason.
  - `show <id>` dumps a single plugin's manifest + extensions + load status; exit 5 when not found.
  - `doctor` returns exit 0 when every plugin loads, exit 1 otherwise — script-friendly readiness check.

  All three support `-g / --global` (global scope only), `--plugin-dir <p>` (explicit override, handy for tests), and `--json` on list / show. The `module` field on loaded extensions is omitted from JSON output to avoid circular-reference serialization errors.

  **Side fix** surfaced while wiring AJV against the extension-kind schemas: the six kind schemas paired `additionalProperties: false` with `allOf: [{ $ref: base.schema.json }]`, a Draft 2020-12 composition footgun where each sub-schema applies its closed-content rule independently. The fix (shipped as a `@skill-map/spec` patch in the same commit train) switches kind schemas to `unevaluatedProperties: false` and removes closure from base; closed-content now survives the allOf composition.

  **Spec resolution**: `@skill-map/spec`'s `exports` field does not expose `package.json`, so `require.resolve('@skill-map/spec/package.json')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Both `resolveSpecRoot()` in the validators and `installedSpecVersion()` in the loader now resolve `@skill-map/spec/index.json` (always exported) and walk one directory up. Zero spec-side changes needed.

  **Acceptance test** (`src/test/plugin-loader.test.ts`) codifies the ROADMAP criterion across 8 cases: empty search paths return `[]`; a green-path plugin with one detector extension loads and reports its extensions; both `invalid-manifest` sub-cases (missing required fields, unparseable JSON) surface; `incompatible-spec` preserves the manifest for diagnostics; both `load-error` sub-cases (missing extension file, default export failing its kind schema) surface; and a mixed scenario proves the kernel keeps going when one plugin in the search path is bad.

  Classification: minor per `spec/versioning.md` §Pre-1.0. Second feature surface after Step 1a; `skill-map` bumps `0.3.0 → 0.4.0`.

  Deferred to Step 2: `sm db migrate --kernel-only` / `--plugin <id>` (wait for real plugin migrations + triple protection), plugin-authored migrations themselves (require SQL AST parsing + prefix injection), and closing the typed-DTO gap.

- 8bda522: Step 1c — Orchestrator + CLI dispatcher + introspection.

  Closes Step 1 (all three sub-steps done). Three deliverables land in this bump:

  **Real scan orchestrator.** `src/kernel/orchestrator.ts` replaces the Step 0b stub with a pipeline that actually walks the Registry — pulling adapters, detectors, and rules from the registered set, iterating in canonical order, and emitting `scan.started` / `scan.completed` through a `ProgressEmitterPort`. The kernel-empty-boot invariant is preserved because with zero extensions the iteration produces a zero-filled valid `ScanResult`. Concrete extension runtime interfaces (`adapter.walk()`, `detector.detect()`, `rule.evaluate()`) are not yet defined; the iteration sites carry `TODO(step-2)` markers so the Step 2 drop-in test stays honoured. New adapter `InMemoryProgressEmitter` handles default in-process event fan-out; WebSocket-backed emitter lands at Step 13.

  **Full CLI surface.** `src/cli/commands/stubs.ts` ships 35 Clipanion command classes covering every verb from `spec/cli-contract.md` that doesn't yet have a real implementation. Each stub registers the final path with the contract's declared flags typed correctly (boolean vs string vs array) and a `Usage` block carrying category / description / details — so `sm help` sees the full surface today and the drift-check script has something to diff against. `execute()` writes a one-liner pointing at the Step that will implement it and returns exit 2. Grouped by module in contract order: setup (init, doctor), config (5), browse (list/show/check/findings/graph/export/orphans*), actions, jobs (submit/list/show/preview/claim/run/status/cancel/prune), record, history, plugins toggle (enable/disable), audits, serve. Real commands from Step 1a (`sm db *`) and Step 1b (`sm plugins list/show/doctor`) + `sm scan`+`sm version` stay on their real implementations.

  **Introspection: `sm help --format human|md|json`.** `src/cli/commands/help.ts` walks `this.cli.definitions()` to introspect every registered verb. `human` delegates to Clipanion's own `cli.usage()` so the terminal output matches the built-in exactly. `json` emits a structured surface dump matching `cli-contract.md` §Help — `{ cliVersion, specVersion, globalFlags, verbs[] }` with each verb carrying `{ name, category, description, details, examples, flags[] }`. `md` emits canonical markdown grouped by category. Single-verb mode (`sm help scan --format json`) emits one block. Unknown verb returns exit 5; unknown format returns exit 2.

  **Auto-generated `docs/cli-reference.md`.** `scripts/build-cli-reference.mjs` runs `sm help --format md` via tsx and writes the result to `docs/cli-reference.md` (290 lines, 6.5 KB). Root package.json gains `cli:reference` (regenerate) and `cli:check` (CI drift check — exits 1 on mismatch with a pointer to the regenerate command). `cli-contract.md` mandates this file is NOT hand-edited in the reference impl; the CI check enforces that.

  **Acceptance test green.** The `kernel-empty-boot` conformance case runs end-to-end through the real `bin/sm.mjs` → real `runScan()` path (no longer via the stub). 36 of 36 tests pass — 32 prior + 4 new covering scan event emission, empty-registry orchestrator iteration, and InMemoryProgressEmitter subscribe/unsubscribe.

  Classification: minor per `spec/versioning.md` §Pre-1.0. Third feature surface after Steps 1a and 1b; `skill-map` bumps `0.4.0 → 0.5.0-pre` territory in the roadmap scheme, formally landing as a minor bump.

- eedaf90: Step 2 — First extension instances.

  Ships the reference implementation's eight built-in extensions and the orchestrator wiring that turns `sm scan` from a zero-filled stub into a real pipeline.

  **Runtime contracts** (`src/kernel/extensions/`): five TypeScript interfaces mirroring the six extension-kind manifest schemas — `IAdapter`, `IDetector`, `IRule`, `IRenderer`, `IAudit`. A plugin's default export IS the runtime instance: the manifest fields (`id`, `kind`, `version`, `stability`, …) and the callable method(s) (`walk`, `detect`, `evaluate`, `render`, `run`) live on the same object, so ESM dynamic imports don't need a `new` dance.

  **Shared utility `trigger-normalize`**: the six-step Unicode pipeline (NFD → strip `Mn` → lowercase → separator unification → whitespace collapse → trim) from `spec/architecture.md` §Detector trigger normalization. Every detector that emits invocation-style links uses it; the `trigger-collision` rule keys on its output.

  **Adapter: `claude`.** Walks Claude Code's on-disk conventions (`.claude/agents/`, `.claude/commands/`, `.claude/hooks/`, `.claude/skills/<name>/SKILL.md`, plus `notes/**/*.md` and a catch-all → `note`), parses frontmatter via js-yaml (tolerant of malformed YAML), uses an async iterator so large scopes don't buffer, and honours a default ignore set (`.git`, `node_modules`, `dist`, `.skill-map`) plus any extras the caller passes.

  **Detectors: `frontmatter`, `slash`, `at-directive`.** Frontmatter extracts structured refs from `metadata.supersedes[]`, `supersededBy` (inverted so the edge points from the new node), `requires[]`, `related[]`. Slash matches `/<command>` tokens in the body with namespace support (`/skill-map:explore`), dedupes on normalized trigger. At-directive matches `@<handle>` with email filtering (`foo@bar.com` skipped) and both scope/name and ns:verb namespaces.

  **Rules: `trigger-collision`, `broken-ref`, `superseded`.** Trigger-collision buckets links by `trigger.normalizedTrigger` and emits error for any bucket with ≥2 distinct targets. Broken-ref resolves path-style targets against `node.path` and trigger-style targets against `frontmatter.name` (normalized, with the leading sigil stripped) — warn severity because authors commonly reference external artifacts. Superseded surfaces every `metadata.supersededBy` as an info finding on the source node.

  **Renderer: `ascii`.** Plain-text dump grouped by node kind, then links, then issues. Minimal — mermaid/dot live as later drop-ins.

  **Audit: `validate-all`.** Post-scan consistency check via AJV against `node.schema.json` / `link.schema.json` / `issue.schema.json`. Plugin manifests are already validated at load time by the PluginLoader (Step 1b), so this audit focuses on user content.

  **Orchestrator wire-up.** `runScan()` now actually iterates: for each adapter, walk roots → classify → build Node (sha256 body/frontmatter hashes, triple-split bytes, stability/version/author denormalised), feed scope-appropriate detectors, collect links, denormalise `linksOutCount` / `linksInCount`, then run every rule over the graph. Links emitting a kind outside the detector's declared `emitsLinkKinds` allowlist are silently dropped.

  **`sm scan`** defaults to the built-in set and exits 1 when the scan surfaces issues (per `cli-contract.md` §Exit codes). A new `--no-built-ins` flag reproduces the kernel-empty-boot zero-filled parity for conformance.

  **Drop-in proof.** The orchestrator iterates `registry.all('<kind>')` — adding a 4th detector is one new file under `src/extensions/detectors/` plus one entry in `src/extensions/built-ins.ts`. Zero kernel edits. Step 4's `external-url-counter` ships as the live proof.

  **Tests.** 52 new tests across normalization, claude adapter, three detectors, three rules, ascii renderer, validate-all audit, and an end-to-end scan against a fixture — 88 of 88 passing. The test glob widened to pick up the colocated `extensions/**/*.test.ts` and `kernel/**/*.test.ts` files that match the `src/extensions/README.md` convention ("each extension is a directory with a manifest + implementation + a sibling `*.test.ts`").

  **Side touches.** `js-yaml` now runs on both sides of the workspace boundary (ui had it since Step 0c; the adapter brings it to src). `docs/cli-reference.md` regenerated to reflect the new `--no-built-ins` flag on `sm scan`.

  Classification: minor per `spec/versioning.md` §Pre-1.0. Fourth feature surface after Steps 1a / 1b / 1c; `skill-map` bumps to the next minor.

### Patch Changes

- Updated dependencies [69572fd]
- Updated dependencies [2699276]
  - @skill-map/spec@0.5.0

## 0.2.0

### Minor Changes

- 3e89d8f: Bump minimum Node version to **24+** (active LTS since October 2025).

  - `engines.node: ">=24.0"` in the reference-impl package.json (root + `src/`).
  - `@types/node` bumped to `^24.0.0`.
  - ROADMAP Decision #1, Stack conventions, and AGENTS.md aligned.

  Rationale: Node 22.5 gave us stable `node:sqlite` but 24 is now the active LTS (Node 22 enters maintenance Oct 2026). The jump buys built-in WebSocket (unblocks Step 13 without a `ws` dependency), the modern ESM loader API, and several runtime improvements Kysely / Clipanion already rely on. No known dependency blocks the bump. Users still on Node 20 are already outside LTS and are not supported.

### Patch Changes

- 5935948: Align kernel domain types with `spec/schemas/`. The Step 0b stub types for `Node`, `Link`, `Issue`, `Extension`, and `PluginManifest` were invented names that diverged from the normative schemas; they compiled only because the `runScan` stub never materialized any instance. This patch closes the drift before Step 4 starts consuming the types in earnest.

  - **`Node`** now matches `node.schema.json`: `path`, `kind`, `adapter`, `bodyHash`, `frontmatterHash`, `bytes` (triple-split `{ frontmatter, body, total }`), `linksOutCount`, `linksInCount`, `externalRefsCount` required; `title`, `description`, `stability`, `version`, `author`, `frontmatter`, `tokens` optional. Removed ad-hoc `name` / `metadata`.
  - **`Link`** now matches `link.schema.json`: `source` (was `from`), `target` (was `to`), `kind` (new discriminator `invokes | references | mentions | supersedes`), `confidence: 'high' | 'medium' | 'low'` (was `exact | fuzzy`), `sources: string[]` (was singular `detector`), `trigger: { originalTrigger, normalizedTrigger } | null` (was flat top-level), plus optional `location`, `raw`.
  - **`Issue`** now matches `issue.schema.json`: `ruleId` (was `rule`), `severity: 'error' | 'warn' | 'info'` (was `'warning'`), `nodeIds` (was `nodes`), plus optional `linkIndices`, `detail`, `fix`, `data`. Removed top-level `id` (DB-only autoincrement, not in the schema).
  - **`Extension`** extended with `version` (required), plus optional `description`, `stability`, `preconditions`, `entry` — matches `spec/schemas/extensions/base.schema.json`.
  - **`PluginManifest`** renamed `entries` → `extensions` (string paths); added `description`, `storage` (`oneOf` `kv | dedicated`), `author`, `license`, `homepage`, `repository` — matches `spec/schemas/plugins-registry.schema.json`.
  - New exported types: `NodeKind`, `LinkKind`, `Confidence`, `Severity`, `Stability`, `TripleSplit`, `LinkTrigger`, `LinkLocation`, `IssueFix`, `PluginStorage`.
  - **Tests**: imports normalized from `.ts` → `.js` (runtime-correct with `verbatimModuleSyntax`). `tsconfig.include` now lists `test/**/*`; `exclude` no longer skips `test` — typecheck covers tests going forward. Added coverage for `sm scan <roots...> --json` passing custom roots through. Dead copy-paste (`void k`) removed from the ISO-8601 test.
  - **Conformance runner cleanup**: removed `PATH_SEP` re-export (consumers import `sep` from `node:path` directly) and `caseFixturePath` helper (dead parameter, zero consumers). `assertSpecRoot` retained as defensive API.

  Classification: patch. Public types were unreleased Step 0b stubs; no consumer relied on the old shapes. The changes are corrections toward the already-published spec contract, not new behaviour.

- 1455cb1: Fix `sm version`: the `spec` line now reports the `@skill-map/spec` npm package version (e.g. `0.2.0`) instead of the `index.json` payload-shape version (which was `0.0.1` in every release).

  The CLI was reading `specIndex.specVersion`, which the spec renamed to `indexPayloadVersion` in the same release and was never the right field for this purpose — the payload version tracks changes to `index.json`'s own shape, not the spec a user is running against. `sm version` now reads `specIndex.specPackageVersion` (new top-level field in `@skill-map/spec`, populated from `spec/package.json.version`).

  Requires `@skill-map/spec` ≥ the release that introduces `specPackageVersion`. No CLI surface change; only the value changes in the output line.

- Updated dependencies [334c51a]
- Updated dependencies [3e89d8f]
- Updated dependencies [334c51a]
- Updated dependencies [d41b9ae]
- Updated dependencies [93ffe34]
- Updated dependencies [d41b9ae]
- Updated dependencies [5935948]
- Updated dependencies [1455cb1]
- Updated dependencies [1455cb1]
- Updated dependencies [93ffe34]
- Updated dependencies [1455cb1]
- Updated dependencies [334c51a]
- Updated dependencies [93ffe34]
- Updated dependencies [93ffe34]
- Updated dependencies [d41b9ae]
- Updated dependencies [93ffe34]
- Updated dependencies [93ffe34]
  - @skill-map/spec@0.3.0

## 0.1.0

### Minor Changes

- 5b3829a: Step 0b — Implementation bootstrap:

  - `src/` workspace scaffolded (TypeScript strict, Node ESM, tsup build, tsx test loader).
  - Hexagonal skeleton: 5 ports (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`) + `Registry` covering the six extension kinds + kernel shell + `runScan` stub that returns a well-formed empty `ScanResult`.
  - CLI (Clipanion v4): `sm --version`, `sm --help`, `sm scan [roots...] [--json]`. Binary wrapper at `bin/sm.mjs`.
  - Contract test runner (`src/conformance/index.ts`): loads a case JSON, provisions a tmp scope, invokes the binary, evaluates 5 of 6 assertion types (`file-matches-schema` marked NYI — lands with Step 2 when ajv is introduced).
  - Unit + integration tests with `node:test`: 13 tests covering the Registry, kernel, CLI surface, and conformance runner.
  - CI extended with `build-test` job (typecheck + tsup + tests).

  First cut of the reference implementation.

### Patch Changes

- Updated dependencies [5b3829a]
- Updated dependencies [4e0aec4]
  - @skill-map/spec@0.1.0
