---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Pre-1.0 review pass — `cli-architect` audit findings.

Internal audit run by the `cli-architect` agent in REVIEW mode produced
a Critical / High / Medium / Low / Nit catalog. This changeset bundles
the implementation of every actionable finding into one unit so the
review can be read end-to-end. **Pre-1.0 minor bump**: a few breaking
surface changes ride along (CLI sub-verb split, exit-code enum exposed,
plugin loader option). No published downstream consumers exist yet.

### Spec changes (`@skill-map/spec`)

- **`cli-contract.md`** — `sm scan compare-with <dump> [roots...]`
  is now a sub-verb instead of a `--compare-with <path>` flag on
  `sm scan`. Read-only delta report against a saved `ScanResult` JSON
  dump. Read-only — does not modify the DB. Same exit codes (`0` empty
  delta / `1` drift / `2` operational error). Old flag form removed.
- **`cli-contract.md`** — exit-code `2` "Operational error" row
  clarified to mention environment / runtime mismatches (wrong Node
  version, missing native dependency) explicitly. The "unhandled
  exception" catch-all already covered the case; this just removes
  ambiguity for future implementers.
- **`cli-contract.md`** — new normative section **§Dry-run** between
  §Exit codes and §Verb catalog defining the contract for any verb
  exposing `-n` / `--dry-run`: no observable side effects (DB / FS /
  config / network / spawns), no auto-provisioning of scope
  directories, output mirrors the live mode with explicit "would …"
  framing, exit codes mirror the live mode, dry-run MUST short-
  circuit `--yes` / `--force` confirmation prompts. Per-verb opt-in:
  the flag is not global, verbs that don't declare it MUST reject
  it as an unknown option. Verb catalog rows for `sm init`, `sm db
  reset` (default + `--state` + `--hard`), and `sm db restore`
  amended to declare and describe their `--dry-run` previews.

### CLI changes (`@skill-map/cli`)

#### Critical — kernel & adapter hygiene

- **C1 — `runScanInternal` decomposed.** The 290-line monolith in
  `kernel/orchestrator.ts` split into a thin composer + four pure
  functions: `validateRoots`, `indexPriorSnapshot`, `walkAndDetect`,
  `runRules`. Composer is now 89 lines reading top-to-bottom through
  the pipeline phases. Zero behavioural change.
- **C2 — `withSqlite(options, fn)` helper.** Single utility at
  `cli/util/with-sqlite.ts` standardises the open / use / close idiom
  every read-side command was open-coding. Eliminates four classes of
  boilerplate bugs (forgotten close, `autoBackup` drift, double-close,
  missing `try/finally`). Migrated 20 call sites across `check`,
  `export`, `graph`, `history`, `init`, `jobs`, `list`, `orphans`,
  `plugins`, `scan`, `show`, `watch`, plus `cli/util/plugin-runtime.ts`.
  Companion `tryWithSqlite` short-circuits when the DB file does not
  exist, replacing the `if (existsSync) { withSqlite(...) }` chain.
  In `scan.ts` the read-prior + persist double-open consolidated into
  a single `withSqlite` callback that brackets read prior → run scan →
  guard → persist when `willPersist`. Saves one migration discovery
  pass + one WAL setup per normal scan (~50–100ms).

#### High — UX & contract integrity

- **H3 — `--dry-run` semantics unified across `init` / `db reset` /
  `db restore`.** The new spec §Dry-run codifies the "no writes,
  reads OK" contract; three verbs that did not previously expose a
  preview now do:
  - `sm init --dry-run` — previews the would-create lines for
    `.skill-map/`, `settings.json`, `settings.local.json`,
    `.skill-mapignore`, the `.gitignore` entries that would be
    appended (deduped against the existing file), the DB
    provisioning, and the first-scan trigger. Honours `--force` for
    the would-overwrite preview. Re-init over an existing scope
    without `--force` still exits 2 (same gate as live).
  - `sm db reset --dry-run` (default + `--state`) — opens the DB
    read-only, computes the row count per `scan_*` (and `state_*`
    when `--state`) table, and prints them. No `DELETE` statements
    issued. Bypasses the `--state` confirmation prompt entirely.
  - `sm db reset --hard --dry-run` — reports the DB file path and
    size that would be unlinked; missing-file case prints a clear
    no-op line instead of an error.
  - `sm db restore <src> --dry-run` — validates the source exists
    (still exits 5 if missing), reports the source size and whether
    the target would be created or overwritten, plus the WAL / SHM
    sidecars that would be dropped. Bypasses the confirmation prompt.
  Implementation: new helper `previewGitignoreEntries(scopeRoot,
  entries)` in `init.ts` mirrors `ensureGitignoreEntries` parsing so
  the preview tracks the live outcome exactly. Texts moved into
  `cli/i18n/init.texts.ts` and `cli/i18n/db.texts.ts` per the N4
  pattern. **9 new tests** under `init-cli.test.ts` (5 cases) and
  `db-cli.test.ts` (9 cases) cover the previews + the spec
  invariants ("DB file checksum unchanged after dry-run", "scope
  directory absent after dry-run", "source-not-found still exits
  5", "confirmation prompt skipped under dry-run").
- **H1 — Centralised exit codes.** New `cli/util/exit-codes.ts`
  exporting `ExitCode` (`Ok` / `Issues` / `Error` / `Duplicate` /
  `NonceMismatch` / `NotFound`) and the type alias `TExitCode`.
  Every `Command#execute()` migrated from numeric literals (123 sites
  across 17 files) to the enum. Single source of truth aligned with
  `spec/cli-contract.md` §Exit codes. **Bug fix surfaced en passant:**
  `sm job prune` returned `2` for "DB missing" while every other
  read-side verb returned `5` via `assertDbExists`; corrected to use
  the shared helper and return `NotFound`. Companion test updated to
  expect `5`.
- **H2 — Plugin loader timeout.** `IPluginLoaderOptions.loadTimeoutMs`
  (default `5000`, exported as `DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS`).
  Each dynamic `import()` now races against a timer; on timeout the
  plugin is reported as `load-error` with a message naming the elapsed
  budget and pointing at top-level side effects as the likely cause
  (network call, infinite loop, large blocking work). Without this a
  plugin with a hanging top-level `await` blocks every host CLI command
  indefinitely.
- **H4 — `--strict` self-validates `--json` output.** When
  `sm scan --strict --json` is invoked, the produced `ScanResult` is
  validated against `scan-result.schema.json` before stdout. Catches
  the case where a custom detector emits a Link that passes the
  shallow `validateLink` guard but fails the full schema, which would
  silently land in stdout and break a downstream `sm scan
  compare-with -`.
- **H5 — External-link discrimination uses URL-shape regex.**
  `isExternalUrlLink` was string-matching `http://` / `https://` only;
  any other URL scheme (`mailto:`, `data:`, `file:///`, `ftp://`) was
  silently classified as internal and polluted the graph as a fake
  internal link with `byPath` lookups that always missed. Replaced
  with the RFC 3986 scheme regex (`/^[a-z][a-z0-9+\-.]+:/i`),
  guarding against Windows-style absolute paths via the ≥ 2-char
  scheme constraint.
- **H6 — Prior snapshot validated under `--strict`.** Both `sm scan`
  and `sm watch`, when run with `--strict`, validate the
  DB-resident `ScanResult` against the spec schema before handing it
  to the orchestrator. A DB corrupted manually or mid-rollback used
  to slip nodes with malformed `bodyHash` / `frontmatterHash` into
  the rename heuristic, where the dereference would silently produce
  spurious matches.

#### Medium — surface & extensibility

- **M1 — `sm scan compare-with` sub-verb.** New `ScanCompareCommand`
  in `cli/commands/scan-compare.ts`; the `--compare-with` flag is
  removed from `ScanCommand`. The sub-verb form structurally rejects
  flag combos that used to require runtime guards
  (`--changed`, `--no-built-ins`, `--allow-empty`, `--watch`):
  Clipanion rejects them at parse time as unknown options.
- **M2 — `kernel/index.ts` enumerated exports.** Replaced the two
  `export type *` wildcards (from `./types.js` and `./ports/index.js`)
  with explicit named exports. Same set of public types — the DTS
  size and tests confirm parity. Going forward, any new domain type
  or port change requires an explicit edit to the barrel, preventing
  silent surface drift.
- **M3 — Build hack documented (workaround retained).** Tried to
  replace the post-build `restoreNodeSqliteImports` pass with
  `external: ['node:sqlite']` in `tsup.config.ts`. Esbuild marks the
  specifier as external but still strips the `node:` prefix; same
  outcome with `[/^node:/]` regex and `packages: 'external'` (which
  also externalises real npm deps). Reverted to the post-build
  `replaceAll` pass, with a docstring documenting every workaround
  attempted so the next agent does not repeat the spike.
- **M4 — `tryWithSqlite` helper.** See C2.
- **M5 — `CamelCasePlugin` trap documented.** Added a trap-warning
  block to `SqliteStorageAdapter`'s docstring: `sql.raw` /
  `sql\`...\`` template literals do NOT pass through the
  `CamelCasePlugin`; raw SQL fragments must use snake_case to match
  the migrations.
- **M6 — Per-extension error reporting.** When the orchestrator
  drops a link emitted with an undeclared kind or an issue with an
  invalid severity, it now emits a `type: 'extension.error'`
  `ProgressEvent` instead of silently swallowing. The CLI subscribes
  via the new `createCliProgressEmitter(stderr)` helper and renders
  those events as `extension.error: <message>` on stderr. Plugin
  authors finally see WHY their link / issue disappears from the
  result. Wired in `scan` (normal + compare-with), `watch`, and
  `init`.
- **M7 — Type naming convention documented (no rename).** Top-of-
  file docstring in `kernel/types.ts` and a new section in
  `AGENTS.md` describe the four-bucket convention the codebase has
  always implicitly followed: domain types (no prefix, mirrors
  spec schemas), hexagonal ports (`Port` suffix), runtime
  extension contracts (`I` prefix), internal shapes (`I` prefix).
  Mass rename was rejected after a cost-benefit pass — naming
  changes are cheap to write but expensive to review; existing
  names are mostly coherent. The agent base
  (`_plugins/minions/shared/architect.md`) gained a "Naming
  conventions check" sub-section in REVIEW mode so future audits
  reach the same conclusion.

#### Low / nit — cleanup

- **L1 — `omitModule` JSON replacer precision.** Identifies the ESM
  namespace by `[Symbol.toStringTag] === 'Module'` instead of
  matching every `module` key blindly. A plugin manifest that
  legitimately ships an unrelated `module` field (e.g. a string
  property in `metadata`) is no longer silently dropped from
  `sm plugins list --json` output.
- **L2 — Stub verbs flagged in `--help`.** Every `not-yet-implemented`
  verb in `cli/commands/stubs.ts` carries a `(planned)` suffix on
  its `description`, surfaced in `sm --help`. The `notImplemented`
  helper now writes `<verb>: not yet implemented (planned).` on
  stderr instead of promising a specific Step number — roadmap step
  numbers shift mid-flight, stale promises in `--help` are worse
  than no promise.
- **L3 — Dead `eslint-disable` removed** from
  `cli/util/plugin-runtime.ts`.
- **N1 — `Link.source` vs `Link.sources` doc clarified.** Both
  fields now carry inline doc-comments calling out the singular /
  plural naming trap. Spec-frozen, but the ambiguity is the easiest
  way to misread the type for new contributors.
- **N2 — `sm check` Usage examples expanded.** The `-g/--global`
  and `--db <path>` flags were declared but missing from the
  `Usage.examples` block — asymmetry with `sm scan` and the rest of
  the read-side verbs that ship the same flags. Two examples added:
  `sm check --global` and `sm check --db /path/to/skill-map.db`.
- **N4 — Error / hint strings extracted to `*.texts.ts` modules with
  `{{name}}` template interpolation.** Pre-1.0 is the natural
  moment to seed the pattern before the string set grows. The
  workspace `ui/` already has a sibling layout at `ui/src/i18n/`
  (functions returning template literals); CLI takes a deliberately
  different shape — flat string templates with `{{name}}`
  placeholders, interpolated by a tiny `tx(template, vars)` helper.
  Rationale: the template form is **drop-in compatible with
  Transloco / Mustache / Handlebars** (the syntax they all share)
  so the day this project migrates to a real i18n library, the
  strings move as-is. Functions would have to be re-shaped first.

  Helper at `kernel/util/tx.ts`. Contract:
    - Every `{{name}}` token MUST have a matching key in the vars
      object — missing key throws (silent fallback hides forgotten
      args in production).
    - `null` / `undefined` values throw — caller coerces upstream.
    - Whitespace inside the braces tolerated (`{{ name }}`) so
      long templates wrap cleanly across `+`-joined lines.
    - Plural / conditional logic does NOT live in the template;
      the caller picks `*_singular` vs `*_plural` keys.

  Files created:
    - `kernel/util/tx.ts` — the helper itself, with 13 tests in
      `test/tx.test.ts` (single / multi token, whitespace, missing /
      null / undefined keys, identifier shapes, error truncation).
    - `kernel/i18n/orchestrator.texts.ts` — frontmatter
      malformed/invalid templates, `extension.error` payloads, root
      validation errors.
    - `kernel/i18n/plugin-loader.texts.ts` — every `load-error` /
      `invalid-manifest` / `incompatible-spec` reason, plus the
      import timeout message.
    - `cli/i18n/scan.texts.ts` — `sm scan` flag-clash / scan
      failure / guard / summary templates, plus the `sm scan
      compare-with` dump-load errors.
    - `cli/i18n/watch.texts.ts` — `sm watch` lifecycle templates.
    - `cli/i18n/init.texts.ts` — `sm init` templates including the
      `--dry-run` previews and the singular/plural pair for
      gitignore updates.
    - `cli/i18n/db.texts.ts` — `sm db reset` / `sm db restore`
      templates including their `--dry-run` previews.
    - `cli/i18n/cli-progress-emitter.texts.ts` — the
      `extension.error: ...` stderr line.

  String content moved verbatim — every existing test that matches
  on stderr / stdout content keeps passing. Trivial single-token
  strings (`'No issues.\n'`) and rare per-handler bespoke phrases
  stay inline; the pattern is now established for whoever wants
  to migrate them in a follow-up.

  Note on `ui/` divergence: today the two workspaces use different
  shapes for their text tables (functions in `ui/`, templates in
  `cli/`). Aligning them is a follow-up — the day a real i18n
  library lands, both converge on its native shape. The CLI shape
  is closer to the eventual destination.
- **N6 — `TIssueSeverity` aliased to `Severity`.** SQLite schema
  type now reads `type TIssueSeverity = Severity` instead of
  duplicating the union literal. Keeps DB and runtime in lock-step
  if the union ever evolves.

### Migrations consolidation (kernel DB)

- **`src/migrations/001_initial.sql` + `002_scan_meta.sql`**
  consolidated into a single `001_initial.sql`. Pre-1.0 with no
  released DBs to forward-migrate, the two-file split was a
  historical accident from an incremental shipment. After
  consolidation: same 12 tables, same constraints, same indexes;
  `PRAGMA user_version` of a freshly-initialised DB is now `1`
  instead of `2`. Migration runner is unchanged (it tolerates any
  count of `NNN_*.sql` files).

### Test coverage

- New tests for H2 (plugin loader timeout — 2 cases),
  M6 (orchestrator `extension.error` emission — 3 cases),
  CLI progress emitter wiring (4 cases). The compare-with suite
  (`scan-compare.test.ts`, 9 cases) was migrated to
  `ScanCompareCommand` and the three flag-clash tests dropped (the
  flags are now structurally absent on the sub-verb). Test totals:
  479 (start of pass) → 488 (after H2/M6 tests) → 485 (after the
  three flag-clash deletions).

### Deferred / out of scope

The findings below were reviewed but did not warrant code changes;
each has its own resolution noted alongside.
- **L4 — `runScan` / `runScanWithRenames` unification.** Already
  resolved by C1 (both are thin wrappers around `runScanInternal`).
- **L5 — Node-version-guard exit code.** Reviewed against the
  updated exit-code table; existing `2` is correct under "operational
  error / unhandled exception". Spec table got the
  environment-mismatch clarification (above).
- **L6 — `loadSchemaValidators()` cache.** Already cached at
  module level since Step 5.12.
- **L7 — `pkg with { type: 'json' }` portability.** Stable in
  Node ≥ 22; `engines.node": ">=24.0"` covers it. No fallback
  needed.
- **N3 — `compare-with` "dump not found" exit code.** The error
  paths in `ScanCompareCommand` already use the `ExitCode.Error`
  enum (= 2) for dump load failures, matching the spec clause for
  operational errors.
- **N5 — Exit-code list completeness.** Verified the comment in
  `cli/entry.ts` against `spec/cli-contract.md` §Exit codes —
  identical, no edit needed.
