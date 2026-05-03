# @skill-map/testkit

## 0.3.1

### Patch Changes

- 103fc1a: Doc revision pass — greenfield framing across READMEs, spec prose, ROADMAP, AGENTS, web, and workspace landing pages.

  Pure documentation changes; no normative schema or code changes.

  `@skill-map/spec`:

  - `architecture.md` — terse rewrite of §Provider · `kinds` catalog (now lists three required fields: `schema`, `defaultRefreshAction`, `ui`); new §Provider · `ui` presentation section documenting the label / color / colorDark / emoji / icon contract; §Stability section updated for the six extension kinds + Hook trigger set.
  - `plugin-author-guide.md` — Provider section gains the `ui` block documentation alongside `schema` and `defaultRefreshAction`; example manifest carries both icon variants (`pi` + `svg`); migration notes stripped under greenfield framing.
  - `cli-contract.md` — §Server documents the `kindRegistry` envelope field on every payload-bearing variant (sentinel envelopes — health/scan/graph — exempt).
  - `conformance/coverage.md` — row 18 (`extensions/provider.schema.json`) flipped 🔴 → 🟡, points at the new `plugin-missing-ui-rejected` case; new §Stability section.
  - `conformance/README.md` — drop "(Phase 5 / A.13 of spec 0.8.0)" historical phase markers.
  - `db-schema.md`, `plugin-author-guide.md` — fix `pisar` typo (Spanish leaked into English) → "are simply overwritten".
  - `CHANGELOG.md` — aggressive sweep: 2114 → 77 lines (96% reduction). Every release gets a 1–3 line greenfield summary. Drops the `Files touched`, `Migration for consumers`, `Out of scope`, `Why`, and per-step decision sub-sections. Drops commit-hash prefixes and `Pre-1.0 minor per versioning.md` boilerplate from every entry. The `[Unreleased]` section preserves the three in-flight Step 14 entries.
  - `conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/{plugin.json,provider.js}` — recovered (lost in the merge from `main` due to `.gitignore` masking gitignored-but-tracked files; `git add -f` brings them back into the index).

  `@skill-map/cli`:

  - `src/README.md` — Status section greenfield (terse: pre-1.0, what's next, what's after); usage examples expanded with `sm serve` + monorepo dev scripts.
  - `src/built-in-plugins/README.md` — drop the contradictory "empty on purpose" framing; document the actual built-in inventory (Claude Provider + Extractors + Rules + Formatter + `validate-all`).

  `@skill-map/testkit`:

  - `testkit/README.md` — rewrite end-to-end against the actual exported helper names (`runExtractorOnFixture` instead of the long-renamed `runDetectorOnFixture`); align example with the `extract(ctx) → void` Extractor shape and the `enabled` plugin status enum.

  Plus `ui/` README rewrite, root README + ES mirror Status / badge bumps + `sm serve` mention + Star History embed, AGENTS.md greenfield BFF section, CONTRIBUTING.md refresh, ROADMAP.md greenfield sweep (`Earlier prose` blocks stripped, decision log reframed without rename history, 14.6+ content preserved), web copy revision (How-it-works section), examples/hello-world rewritten to the Extractor model with passing tests, and the spec/index.json regeneration that goes with it.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

- Updated dependencies [103fc1a]
  - @skill-map/cli@0.11.1

## 0.3.0

### Minor Changes

- 6dad772: v0.8.0 — Pre-1.0 stabilization pass.

  This release combines two coherent pre-1.0 cleanup pieces that
  both push the project closer to v1.0 stability: the cli-architect
  audit review pass and the plugin model overhaul.

  Pre-1.0 minor bumps per `versioning.md` § Pre-1.0; breaking
  changes allowed within minor while in `0.Y.Z`. No real downstream
  ecosystem exists yet, so the breaking surface costs nothing
  today.

  ## Part 1 — Pre-1.0 audit review pass

  Pre-1.0 review pass — `cli-architect` audit findings.

  Internal audit run by the `cli-architect` agent in REVIEW mode
  produced a Critical / High / Medium / Low / Nit catalog. This
  pass bundles the implementation of every actionable finding into
  one unit so the review can be read end-to-end. **Pre-1.0 minor
  bump**: a few breaking surface changes ride along (CLI sub-verb
  split, exit-code enum exposed, plugin loader option). No
  published downstream consumers exist yet.

  ### Spec changes (`@skill-map/spec`)

  - **`cli-contract.md`** — `sm scan compare-with <dump> [roots...]`
    is now a sub-verb instead of a `--compare-with <path>` flag on
    `sm scan`. Read-only delta report against a saved `ScanResult`
    JSON dump. Read-only — does not modify the DB. Same exit codes
    (`0` empty delta / `1` drift / `2` operational error). Old flag
    form removed.
  - **`cli-contract.md`** — exit-code `2` "Operational error" row
    clarified to mention environment / runtime mismatches (wrong
    Node version, missing native dependency) explicitly. The
    "unhandled exception" catch-all already covered the case; this
    just removes ambiguity for future implementers.
  - **`cli-contract.md`** — new normative section **§Dry-run**
    between §Exit codes and §Verb catalog defining the contract for
    any verb exposing `-n` / `--dry-run`: no observable side effects
    (DB / FS / config / network / spawns), no auto-provisioning of
    scope directories, output mirrors the live mode with explicit
    "would …" framing, exit codes mirror the live mode, dry-run
    MUST short-circuit `--yes` / `--force` confirmation prompts.
    Per-verb opt-in: the flag is not global, verbs that don't
    declare it MUST reject it as an unknown option. Verb catalog
    rows for `sm init`, `sm db reset` (default + `--state` +
    `--hard`), and `sm db restore` amended to declare and describe
    their `--dry-run` previews.

  ### CLI changes (`@skill-map/cli`)

  #### Critical — kernel & adapter hygiene

  - **C1 — `runScanInternal` decomposed.** The 290-line monolith in
    `kernel/orchestrator.ts` split into a thin composer + four pure
    functions: `validateRoots`, `indexPriorSnapshot`,
    `walkAndDetect`, `runRules`. Composer is now 89 lines reading
    top-to-bottom through the pipeline phases. Zero behavioural
    change.
  - **C2 — `withSqlite(options, fn)` helper.** Single utility at
    `cli/util/with-sqlite.ts` standardises the open / use / close
    idiom every read-side command was open-coding. Eliminates four
    classes of boilerplate bugs (forgotten close, `autoBackup`
    drift, double-close, missing `try/finally`). Migrated 20 call
    sites across `check`, `export`, `graph`, `history`, `init`,
    `jobs`, `list`, `orphans`, `plugins`, `scan`, `show`, `watch`,
    plus `cli/util/plugin-runtime.ts`. Companion `tryWithSqlite`
    short-circuits when the DB file does not exist, replacing the
    `if (existsSync) { withSqlite(...) }` chain. In `scan.ts` the
    read-prior + persist double-open consolidated into a single
    `withSqlite` callback that brackets read prior → run scan →
    guard → persist when `willPersist`. Saves one migration
    discovery pass + one WAL setup per normal scan (~50–100ms).

  #### High — UX & contract integrity

  - **H3 — `--dry-run` semantics unified across `init` / `db reset`
    / `db restore`.** The new spec §Dry-run codifies the "no
    writes, reads OK" contract; three verbs that did not previously
    expose a preview now do: - `sm init --dry-run` — previews the would-create lines for
    `.skill-map/`, `settings.json`, `settings.local.json`,
    `.skill-mapignore`, the `.gitignore` entries that would be
    appended (deduped against the existing file), the DB
    provisioning, and the first-scan trigger. Honours `--force`
    for the would-overwrite preview. Re-init over an existing
    scope without `--force` still exits 2 (same gate as live). - `sm db reset --dry-run` (default + `--state`) — opens the DB
    read-only, computes the row count per `scan_*` (and `state_*`
    when `--state`) table, and prints them. No `DELETE`
    statements issued. Bypasses the `--state` confirmation prompt
    entirely. - `sm db reset --hard --dry-run` — reports the DB file path and
    size that would be unlinked; missing-file case prints a clear
    no-op line instead of an error. - `sm db restore <src> --dry-run` — validates the source exists
    (still exits 5 if missing), reports the source size and
    whether the target would be created or overwritten, plus the
    WAL / SHM sidecars that would be dropped. Bypasses the
    confirmation prompt.
    Implementation: new helper `previewGitignoreEntries(scopeRoot,
entries)` in `init.ts` mirrors `ensureGitignoreEntries` parsing
    so the preview tracks the live outcome exactly. Texts moved
    into `cli/i18n/init.texts.ts` and `cli/i18n/db.texts.ts` per
    the N4 pattern. **9 new tests** under `init-cli.test.ts` (5
    cases) and `db-cli.test.ts` (9 cases) cover the previews + the
    spec invariants ("DB file checksum unchanged after dry-run",
    "scope directory absent after dry-run", "source-not-found
    still exits 5", "confirmation prompt skipped under dry-run").
  - **H1 — Centralised exit codes.** New `cli/util/exit-codes.ts`
    exporting `ExitCode` (`Ok` / `Issues` / `Error` / `Duplicate` /
    `NonceMismatch` / `NotFound`) and the type alias `TExitCode`.
    Every `Command#execute()` migrated from numeric literals (123
    sites across 17 files) to the enum. Single source of truth
    aligned with `spec/cli-contract.md` §Exit codes. **Bug fix
    surfaced en passant:** `sm job prune` returned `2` for "DB
    missing" while every other read-side verb returned `5` via
    `assertDbExists`; corrected to use the shared helper and return
    `NotFound`. Companion test updated to expect `5`.
  - **H2 — Plugin loader timeout.** `IPluginLoaderOptions.loadTimeoutMs`
    (default `5000`, exported as `DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS`).
    Each dynamic `import()` now races against a timer; on timeout
    the plugin is reported as `load-error` with a message naming
    the elapsed budget and pointing at top-level side effects as
    the likely cause (network call, infinite loop, large blocking
    work). Without this a plugin with a hanging top-level `await`
    blocks every host CLI command indefinitely.
  - **H4 — `--strict` self-validates `--json` output.** When
    `sm scan --strict --json` is invoked, the produced `ScanResult`
    is validated against `scan-result.schema.json` before stdout.
    Catches the case where a custom detector emits a Link that
    passes the shallow `validateLink` guard but fails the full
    schema, which would silently land in stdout and break a
    downstream `sm scan compare-with -`.
  - **H5 — External-link discrimination uses URL-shape regex.**
    `isExternalUrlLink` was string-matching `http://` / `https://`
    only; any other URL scheme (`mailto:`, `data:`, `file:///`,
    `ftp://`) was silently classified as internal and polluted the
    graph as a fake internal link with `byPath` lookups that always
    missed. Replaced with the RFC 3986 scheme regex
    (`/^[a-z][a-z0-9+\-.]+:/i`), guarding against Windows-style
    absolute paths via the ≥ 2-char scheme constraint.
  - **H6 — Prior snapshot validated under `--strict`.** Both
    `sm scan` and `sm watch`, when run with `--strict`, validate
    the DB-resident `ScanResult` against the spec schema before
    handing it to the orchestrator. A DB corrupted manually or
    mid-rollback used to slip nodes with malformed `bodyHash` /
    `frontmatterHash` into the rename heuristic, where the
    dereference would silently produce spurious matches.

  #### Medium — surface & extensibility

  - **M1 — `sm scan compare-with` sub-verb.** New
    `ScanCompareCommand` in `cli/commands/scan-compare.ts`; the
    `--compare-with` flag is removed from `ScanCommand`. The
    sub-verb form structurally rejects flag combos that used to
    require runtime guards (`--changed`, `--no-built-ins`,
    `--allow-empty`, `--watch`): Clipanion rejects them at parse
    time as unknown options.
  - **M2 — `kernel/index.ts` enumerated exports.** Replaced the two
    `export type *` wildcards (from `./types.js` and
    `./ports/index.js`) with explicit named exports. Same set of
    public types — the DTS size and tests confirm parity. Going
    forward, any new domain type or port change requires an
    explicit edit to the barrel, preventing silent surface drift.
  - **M3 — Build hack documented (workaround retained).** Tried to
    replace the post-build `restoreNodeSqliteImports` pass with
    `external: ['node:sqlite']` in `tsup.config.ts`. Esbuild marks
    the specifier as external but still strips the `node:` prefix;
    same outcome with `[/^node:/]` regex and `packages: 'external'`
    (which also externalises real npm deps). Reverted to the
    post-build `replaceAll` pass, with a docstring documenting
    every workaround attempted so the next agent does not repeat
    the spike.
  - **M4 — `tryWithSqlite` helper.** See C2.
  - **M5 — `CamelCasePlugin` trap documented.** Added a
    trap-warning block to `SqliteStorageAdapter`'s docstring:
    `sql.raw` / `sql\`...\``template literals do NOT pass through
the`CamelCasePlugin`; raw SQL fragments must use snake_case to
    match the migrations.
  - **M6 — Per-extension error reporting.** When the orchestrator
    drops a link emitted with an undeclared kind or an issue with
    an invalid severity, it now emits a `type: 'extension.error'`
    `ProgressEvent` instead of silently swallowing. The CLI
    subscribes via the new `createCliProgressEmitter(stderr)`
    helper and renders those events as `extension.error: <message>`
    on stderr. Plugin authors finally see WHY their link / issue
    disappears from the result. Wired in `scan` (normal +
    compare-with), `watch`, and `init`.
  - **M7 — Type naming convention documented (no rename).** Top-of-
    file docstring in `kernel/types.ts` and a new section in
    `AGENTS.md` describe the four-bucket convention the codebase
    has always implicitly followed: domain types (no prefix,
    mirrors spec schemas), hexagonal ports (`Port` suffix), runtime
    extension contracts (`I` prefix), internal shapes (`I`
    prefix). Mass rename was rejected after a cost-benefit pass —
    naming changes are cheap to write but expensive to review;
    existing names are mostly coherent. The agent base
    (`_plugins/minions/shared/architect.md`) gained a "Naming
    conventions check" sub-section in REVIEW mode so future audits
    reach the same conclusion.

  #### Low / nit — cleanup

  - **L1 — `omitModule` JSON replacer precision.** Identifies the
    ESM namespace by `[Symbol.toStringTag] === 'Module'` instead of
    matching every `module` key blindly. A plugin manifest that
    legitimately ships an unrelated `module` field (e.g. a string
    property in `metadata`) is no longer silently dropped from
    `sm plugins list --json` output.
  - **L2 — Stub verbs flagged in `--help`.** Every
    `not-yet-implemented` verb in `cli/commands/stubs.ts` carries a
    `(planned)` suffix on its `description`, surfaced in
    `sm --help`. The `notImplemented` helper now writes
    `<verb>: not yet implemented (planned).` on stderr instead of
    promising a specific Step number — roadmap step numbers shift
    mid-flight, stale promises in `--help` are worse than no
    promise.
  - **L3 — Dead `eslint-disable` removed** from
    `cli/util/plugin-runtime.ts`.
  - **N1 — `Link.source` vs `Link.sources` doc clarified.** Both
    fields now carry inline doc-comments calling out the singular /
    plural naming trap. Spec-frozen, but the ambiguity is the
    easiest way to misread the type for new contributors.
  - **N2 — `sm check` Usage examples expanded.** The `-g/--global`
    and `--db <path>` flags were declared but missing from the
    `Usage.examples` block — asymmetry with `sm scan` and the rest
    of the read-side verbs that ship the same flags. Two examples
    added: `sm check --global` and `sm check --db
/path/to/skill-map.db`.
  - **N4 — Error / hint strings extracted to `*.texts.ts` modules
    with `{{name}}` template interpolation.** Pre-1.0 is the
    natural moment to seed the pattern before the string set grows.
    The workspace `ui/` already has a sibling layout at
    `ui/src/i18n/` (functions returning template literals); CLI
    takes a deliberately different shape — flat string templates
    with `{{name}}` placeholders, interpolated by a tiny
    `tx(template, vars)` helper. Rationale: the template form is
    **drop-in compatible with Transloco / Mustache / Handlebars**
    (the syntax they all share) so the day this project migrates to
    a real i18n library, the strings move as-is. Functions would
    have to be re-shaped first.

        Helper at `kernel/util/tx.ts`. Contract:

        - Every `{{name}}` token MUST have a matching key in the vars
          object — missing key throws (silent fallback hides
          forgotten args in production).
        - `null` / `undefined` values throw — caller coerces
          upstream.
        - Whitespace inside the braces tolerated (`{{ name }}`) so
          long templates wrap cleanly across `+`-joined lines.
        - Plural / conditional logic does NOT live in the template;
          the caller picks `*_singular` vs `*_plural` keys.

        Files created:

        - `kernel/util/tx.ts` — the helper itself, with 13 tests in
          `test/tx.test.ts` (single / multi token, whitespace,
          missing / null / undefined keys, identifier shapes, error
          truncation).
        - `kernel/i18n/orchestrator.texts.ts` — frontmatter
          malformed/invalid templates, `extension.error` payloads,
          root validation errors.
        - `kernel/i18n/plugin-loader.texts.ts` — every `load-error` /
          `invalid-manifest` / `incompatible-spec` reason, plus the
          import timeout message.
        - `cli/i18n/scan.texts.ts` — `sm scan` flag-clash / scan
          failure / guard / summary templates, plus the `sm scan

    compare-with`dump-load errors.
    -`cli/i18n/watch.texts.ts`—`sm watch`lifecycle templates.
    -`cli/i18n/init.texts.ts`—`sm init`templates including
      the`--dry-run`previews and the singular/plural pair for
      gitignore updates.
    -`cli/i18n/db.texts.ts`—`sm db reset`/`sm db restore`      templates including their`--dry-run`previews.
    -`cli/i18n/cli-progress-emitter.texts.ts`— the
     `extension.error: ...` stderr line.

        String content moved verbatim — every existing test that
        matches on stderr / stdout content keeps passing. Trivial
        single-token strings (`'No issues.\n'`) and rare per-handler
        bespoke phrases stay inline; the pattern is now established
        for whoever wants to migrate them in a follow-up.

        Note on `ui/` divergence: today the two workspaces use
        different shapes for their text tables (functions in `ui/`,
        templates in `cli/`). Aligning them is a follow-up — the day a
        real i18n library lands, both converge on its native shape.
        The CLI shape is closer to the eventual destination.

  - **N6 — `TIssueSeverity` aliased to `Severity`.** SQLite schema
    type now reads `type TIssueSeverity = Severity` instead of
    duplicating the union literal. Keeps DB and runtime in
    lock-step if the union ever evolves.

  ### Migrations consolidation (kernel DB)

  - **`src/migrations/001_initial.sql` + `002_scan_meta.sql`**
    consolidated into a single `001_initial.sql`. Pre-1.0 with no
    released DBs to forward-migrate, the two-file split was a
    historical accident from an incremental shipment. After
    consolidation: same 12 tables, same constraints, same indexes;
    `PRAGMA user_version` of a freshly-initialised DB is now `1`
    instead of `2`. Migration runner is unchanged (it tolerates any
    count of `NNN_*.sql` files).

  ### Test coverage (Part 1)

  - New tests for H2 (plugin loader timeout — 2 cases),
    M6 (orchestrator `extension.error` emission — 3 cases),
    CLI progress emitter wiring (4 cases). The compare-with suite
    (`scan-compare.test.ts`, 9 cases) was migrated to
    `ScanCompareCommand` and the three flag-clash tests dropped
    (the flags are now structurally absent on the sub-verb). Test
    totals: 479 (start of pass) → 488 (after H2/M6 tests) → 485
    (after the three flag-clash deletions).

  ### Deferred / out of scope

  The findings below were reviewed but did not warrant code
  changes; each has its own resolution noted alongside.

  - **L4 — `runScan` / `runScanWithRenames` unification.** Already
    resolved by C1 (both are thin wrappers around
    `runScanInternal`).
  - **L5 — Node-version-guard exit code.** Reviewed against the
    updated exit-code table; existing `2` is correct under
    "operational error / unhandled exception". Spec table got the
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

  ## Part 2 — Plugin model overhaul (5-phase implementation)

  ### Summary

  The plugin model received a comprehensive overhaul before
  stabilizing at v1.0. Plugin kinds total after this bump: **6**
  (Provider, Extractor, Rule, Action, Formatter, Hook). All
  breakings are pre-1.0 minor per `versioning.md` § Pre-1.0.

  ### Phase 1 (commit 7354c26) — Foundation

  Five sub-phases, additive or pre-1.0 minor breakings:

  - **A.4** — three-tier frontmatter validation model documented in
    `plugin-author-guide.md` (default permissive + `unknown-field`
    rule + `scan.strict` promote-to-error). Behavior unchanged.
  - **A.5** — plugin id global uniqueness: `directory ==
manifest.id` rule, new status `id-collision` (sixth),
    validation in boot/scan/doctor. Cross-root collisions block
    both involved plugins; user resolves by renaming.
  - **A.6** — extension ids qualified `<plugin-id>/<ext-id>` in
    registry. Built-ins classified into `claude/*` (4 Claude-
    specific) and `core/*` (7 kernel built-ins) bundles. New
    `Registry.get/find` APIs; `defaultRefreshAction` schema
    requires the qualified pattern; `extension.error` events emit
    qualified ids.
  - **A.10** — optional `applicableKinds` filter on Detector
    manifest; fail-fast skip for non-matching kinds (zero CPU/LLM
    cost); doctor warning for kinds not declared by any installed
    Provider. Empty array invalid; absence preserves apply-to-all
    default.
  - **Granularity** — Built-ins now respect `config_plugins`
    enable/disable via granularity-aware filtering. New
    `IBuiltInBundle` shape with `granularity: 'bundle' |
'extension'`; `claude` ships as bundle (all-or-nothing), `core`
    as extension (each toggleable). User plugins default to bundle;
    opt in via `granularity` in `plugin.json`. Both plugin ids and
    qualified extension ids accepted as keys in `config_plugins`
    and `settings.json#/plugins` (no schema change needed).

  550/550 tests pass (+33 vs baseline 517).

  ### Phase 2 (commit ae3eaa6) — Renames

  Four sub-phases, all breaking but allowed in minor pre-1.0:

  - **2a (Renderer → Formatter)** — Kind, types, files renamed.
    Method `render(ctx)` → `format(ctx)`; manifest field `format`
    → `formatId` (TS clash resolution). Same contract: graph →
    string, deterministic-only.
  - **2b (Adapter → Provider)** — New required field
    `explorationDir` on the manifest (e.g. `~/.claude` for the
    Claude Provider). DB schema migrated in-place (column
    `nodes.adapter` → `nodes.provider`, etc.). The
    hexagonal-architecture `RunnerPort.adapter` /
    `StoragePort.adapter` is unchanged.
  - **2c (Audit removed)** — Audit kind removed. The single
    built-in `validate-all` migrated to a Rule (qualified id
    `core/validate-all`, `evaluate(ctx) → Issue[]`). CLI verbs
    `sm audit *` removed; users invoke via `sm check --rules
core/validate-all`.
  - **2d (Detector → Extractor)** — Method signature changes from
    `detect(ctx) → Link[]` to `extract(ctx) → void` — output flows
    through three ctx callbacks: `emitLink`, `enrichNode`, `store`.
    Built-ins migrated maintain functional parity using `emitLink`.
    Persistence of `enrichNode` deferred to Phase 4 (A.8 stale
    layer); orchestrator buffers in memory today.

  554/554 cli + 32/32 testkit pass.

  ### Phase 3 (commit 34f993e) — Schema relocation

  **A.2** — Per-kind frontmatter schemas relocate from spec to the
  Provider that declares them. Spec keeps only `frontmatter/base`
  (universal).

  - 5 schemas moved (`git mv`):
    `spec/schemas/frontmatter/{skill,agent,command,hook,note}.schema.json`
    → built-in Claude Provider's `schemas/` directory. New `$id`:
    `https://skill-map.dev/providers/claude/v1/frontmatter/<kind>`.
    Cross-package `$ref` resolves via the spec base's `$id`
    (`https://skill-map.dev/spec/v0/frontmatter/base.schema.json`);
    AJV resolves by `$id` when both schemas register on the same
    instance.
  - Provider manifest gains a required `kinds` map subsuming three
    former fields: `emits` (now derives from
    `Object.keys(kinds)`), the flat `defaultRefreshAction` map (now
    per-entry inside `kinds[<kind>].defaultRefreshAction`), and the
    new `schema` (path to the per-kind schema relative to the
    provider directory).
  - Built-in Claude Provider migrated: 5 kind entries (skill,
    agent, command, hook, note), each with `schema`, `schemaJson`
    (runtime field, AJV-compiled at load), and qualified
    `defaultRefreshAction` (`claude/summarize-<kind>`).
  - Kernel orchestrator parse phase asks the Provider for the
    schema via `IProviderFrontmatterValidator` (composed by scan
    via `buildProviderFrontmatterValidator`) instead of reading
    from spec/. Flow: validate base → look up provider → validate
    per-kind schema from Provider.
  - `schema-validators.ts` catalog loses the 5 per-kind frontmatter
    entries; only `frontmatter-base` remains kernel-known.
    `plugin-loader`'s `stripFunctionsAndPluginId` now also strips
    `schemaJson` (runtime-only) from each `kinds` entry before
    AJV-validating the manifest.
  - Coverage matrix: 28 → 23 schemas (the 5 per-kind frontmatter
    schemas are now Provider-owned and ship with their own
    conformance suite in Phase 5 / A.13).

  556/556 cli + 32/32 testkit pass.

  ### Phase 4 (commit e62695f) — Probabilistic infra

  Five sub-phases, all breaking but allowed in minor pre-1.0:

  - **4a (A.9)** — fine-grained Extractor cache via new
    `scan_extractor_runs` table. Resolves gap where newly
    registered Extractors silently skipped cached nodes; cache hit
    logic now per-(node, extractor). Uninstalled Extractors cleaned
    (rows + orphan links). Migration in-place.
  - **4b (A.12)** — opt-in `outputSchema` for plugin custom
    storage. Manifest gains `storage.schema` (Mode A) and
    `storage.schemas` (Mode B) for AJV validation of
    `ctx.store.write/.set` calls. Throws on shape violation;
    default absent = permissive.
  - **4c (A.8)** — enrichment layer + stale tracking. New
    `node_enrichments` table persists per-(node, extractor)
    partials separately from author's frontmatter (immutable).
    Probabilistic enrichments track `body_hash_at_enrichment`; scan
    flags `stale=1` on body change (NOT deleted, preserves LLM
    cost). Helper `mergeNodeWithEnrichments` filters stale +
    last-write-wins. New verbs `sm refresh <node>` and
    `sm refresh --stale` (stubs awaiting Step 10).
  - **4d (A.11)** — sixth plugin kind `hook`. Declarative
    subscriber to a curated set of 8 lifecycle events (`scan.*`,
    extractor/rule/action.completed,
    job.spawning/completed/failed). Other events deliberately not
    hookable. Manifest declares `triggers[]` (load-time validated)
    and optional `filter`. Three new kernel events added to
    catalog. Dual-mode (det dispatched in-process; prob deferred to
    Step 10).
  - **4e (A.7)** — `sm check --include-prob` opt-in flag (stub).
    Default `sm check` unchanged: det only, CI-safe. With flag:
    detects prob rules, emits stderr advisory; full dispatch awaits
    Step 10. Combines with `--rules`, `-n`, `--no-plugins`.

  591/591 cli + 32/32 testkit pass.

  ### Phase 5 (commit 03b5a65) — Conformance + cleanup

  **A.13** — Conformance fixture relocation:

  - 3 cases moved (`git mv`): `basic-scan`, `orphan-detection`,
    `rename-high` →
    `src/extensions/providers/claude/conformance/cases/`. 11
    fixture files (`minimal-claude/`, `orphan-{before,after}/`,
    `rename-high-{before,after}/`) moved alongside.
  - New `coverage.md` per-Provider listing the 5 frontmatter
    schemas (skill, agent, command, hook, note) and their cases.
  - New verb `sm conformance run [--scope spec|provider:<id>|all]`.
    Discovery by convention at `<plugin-dir>/conformance/`. The
    existing runner gains optional `fixturesRoot` (default
    `<specRoot>/conformance/fixtures` for compat); tooling using
    the public API of `@skill-map/cli/conformance` keeps working.
    `--json` deferred — reporter shape not yet frozen.
  - Spec keeps only the kernel-agnostic case (`kernel-empty-boot`)
    and the universal preamble fixture. Coverage matrix downgrades
    conservatively (rows that depended on `basic-scan` are now
    partial or missing, with cross-link to the Provider's matrix).

  ROADMAP cleanup:

  - The three "Status: target state for v0.8.0 — spec catch-up
    pending" banners on §Plugin system / §Frontmatter standard /
    §Enrichment are removed; prose shifts from future to present
    ("kinds from v0.7.0 are renamed" → "were renamed in spec
    0.8.0"; Model B enrichment now describes the shipped
    `node_enrichments` table with `body_hash_at_enrichment` rather
    than "table or column set decided in PR").
  - Decision-log entry for the working session rewritten to
    reflect "shipped" rather than "pending".
  - Last-updated header gains an "implementation" paragraph
    listing the four prior phase commits.

  593/593 cli + 32/32 testkit pass (+2 vs Phase 4 baseline).
  spec:check green (40 files hashed — down from 53 because the
  Claude-specific cases and fixtures left the spec's hash set).

  ### Breaking changes for plugin authors (Part 2)

  Manifest renames:

  - `kind: 'adapter'` → `kind: 'provider'`
  - `kind: 'detector'` → `kind: 'extractor'`
  - `kind: 'renderer'` → `kind: 'formatter'`
  - `kind: 'audit'` removed (migrate to `kind: 'rule'`).

  Method signatures:

  - Detector `detect(ctx) → Link[]` → Extractor `extract(ctx) →
void` (output via `ctx.emitLink` / `ctx.enrichNode` /
    `ctx.store`).
  - Renderer `render(ctx) → string` → Formatter `format(ctx) →
string`.

  Manifest fields:

  - Provider gains required `explorationDir`.
  - Provider's flat `defaultRefreshAction` map replaced by per-kind
    entries inside `kinds[<kind>].defaultRefreshAction` (must
    follow qualified pattern `<plugin-id>/<ext-id>`).
  - Provider's `emits` derives from `Object.keys(kinds)` (the
    manifest field is gone).
  - Provider's per-kind schemas declared via `kinds[<kind>].schema`
    (path relative to provider dir).
  - Renderer's `format` field renamed to `formatId` on the
    Formatter manifest (TS clash resolution).
  - New plugin kind `hook` with `triggers[]` + optional `filter`.
  - Optional `outputSchema` (`storage.schema` / `storage.schemas`)
    for Mode A / Mode B plugin custom storage.
  - Optional `applicableKinds` filter on Extractor manifest.

  Extension ids:

  - All extension ids must be qualified
    `<plugin-id>/<extension-id>` (built-ins classified into
    `claude/*` and `core/*`).

  DB schema:

  - Two new tables added in-place to `001_initial.sql` (pre-1.0
    consolidation, no production DBs to migrate):
    `scan_extractor_runs` and `node_enrichments`.
  - Column rename `nodes.adapter` → `nodes.provider` (and parallel
    in `result.adapters` → `result.providers`).

  ## Test stats

  593/593 cli + 32/32 testkit pass (post-Phase 5).
  Two new DB tables (`scan_extractor_runs`, `node_enrichments`)
  added in-place to `001_initial.sql` (pre-1.0 consolidation, no
  production DBs to migrate). The 5 per-kind frontmatter schemas
  relocated from spec/ to the Claude Provider package.

### Patch Changes

- Updated dependencies [6dad772]
  - @skill-map/cli@0.6.0

## 0.2.0

### Minor Changes

- 0463a0f: Step 9.3 — `@skill-map/testkit` lands as a separate workspace + npm
  package (per the Arquitecto's pick of independent versioning over a
  subpath export). Plugin authors install it alongside `@skill-map/cli`
  and use it to unit-test detectors, rules, renderers, and audits
  without spinning up the full skill-map runtime.

  New surface (all stable through v1.0 except the runner stand-in,
  flagged `experimental` until Step 10 lands the job subsystem
  contract):

  - **Builders** — `node()`, `link()`, `issue()`, `scanResult()` produce
    spec-aligned domain objects with sensible defaults. Override only
    the fields a given test cares about.
  - **Context factories** — `makeDetectContext`, `makeRuleContext`,
    `makeRenderContext`, `detectContextFromBody`. Per-kind context shapes
    the kernel injects into extension methods.
  - **Fakes** — `makeFakeStorage` (in-memory KV stand-in for `ctx.store`,
    matches the Storage Mode A surface) and `makeFakeRunner` (queue +
    history `RunnerPort` stand-in for probabilistic extensions).
  - **Run helpers** — `runDetectorOnFixture(detector, opts)`,
    `runRuleOnGraph(rule, opts)`, `runRendererOnGraph(renderer, opts)`.
    Most plugin tests reduce to one line: build the fixture, call the
    helper, assert on the result.

  Collateral on `@skill-map/cli`: `src/kernel/index.ts` now re-exports
  the extension-kind interfaces (`IDetector`, `IRule`, `IRenderer`,
  `IAdapter`, `IAudit` and their context shapes) so plugin authors can
  type-check their extensions against the same surface the kernel
  consumes. Patch-level bump because the change is purely additive.

  The testkit workspace ships its own `tsup` build (5 KB of runtime,
  10 KB of types) and pins every dep at exact versions per the
  monorepo policy. `@skill-map/cli` is marked `external` in the bundle
  so the published testkit stays a thin layer over the user's installed
  cli version.

  30 new tests under `testkit/test/*.test.ts` cover builder defaults +
  overrides, context factory shapes, KV stand-in semantics (set / get /
  list-by-prefix / delete), fake-runner queueing + history + reset, and
  the three high-level run helpers. Tests run in their own
  `npm test --workspace=@skill-map/testkit` step (independent from cli's
  test command).

  Out of scope for 9.3, picked up in 9.4:

  - Plugin author guide (`spec/plugin-author-guide.md`) referencing the
    testkit by example.
  - Reference plugin under `examples/hello-world/` (Arquitecto's pick:
    in the principal repo, not a separate one).
  - Diagnostics polish on the loader's `reason:` strings.

### Patch Changes

- Updated dependencies [0463a0f]
- Updated dependencies [0463a0f]
- Updated dependencies [0463a0f]
- Updated dependencies [0463a0f]
  - @skill-map/cli@0.5.0
