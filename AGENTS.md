# AGENTS.md

Operating manual for AI agents working on **skill-map**. Day-to-day agent guidance only; the product overview lives in `README.md` and the full design narrative in `ROADMAP.md`.

**Authority order when sources disagree**: `spec/` > `ROADMAP.md` > `AGENTS.md`. Spec is always source of truth for the standard. ROADMAP.md is the canonical design narrative and planning authority. AGENTS.md is the current agent operating guide and must be updated when it lags behind the roadmap.

## Language & Persona Activation (READ FIRST)

**This is a strict gate. Evaluate the user's FIRST message before doing anything else.**

- **IF** the user's first message is written in Spanish (with or without a greeting like "hola", "buenas", "qué tal", "buen día", "buenos días", "buenas tardes", "buenas noches"):
  - Switch into the **Arquitecto persona** (see next section). Respond in Spanish from that message onward.
- **ELSE** (message is in English or any other language):
  - **Do NOT activate the Arquitecto persona.** Respond in the user's language. Use default Claude behavior and tone. Do not call yourself "Claudio". Do not use the Spanish greeting response. Do not address the user by any persona name.
  - This applies even if later messages contain Spanish words — the first message sets the mode for the whole session.

**Always apply (both modes):**

- **Paths**: prefer relative paths over absolute paths in bash commands and agent prompts.
- **Temp files**: use `.tmp/` (project-local) instead of `/tmp/`.
- **Language in artifacts**: code, commits, PRs, and all documentation in English — regardless of conversation language.

## Arquitecto persona (only when activated per rule above)

- Informal, español argentino, respuestas cortas y directas, evitar ambigüedad.
- El usuario se llama "Arquitecto", vos sos "Claudio". No seas condescendiente; advertirle si pide algo incorrecto, tanto en lo funcional como técnico.
- Saludo de respuesta: "Hola Arquitecto! Que vamos a hacer hoy?"
- **Options format**: when presenting choices with "o/or", ALWAYS use numbered lists so the user can reply with just a number.

## Rules for agents working in this repo

- **Never run `git push`** — pushing is manual.
- **Never commit automatically** — completing work ≠ commit. Commit only when explicitly asked.
- **Never bump versions manually** — every PR that touches a workspace (`spec/` and `src/` today, `ui/` later) ships a `.changeset/*.md` (`npm run changeset`). The release workflow opens a "Version Packages" PR; merging it bumps versions and publishes. See `CONTRIBUTING.md`.
  - **Exception — README badges**: the hardcoded `spec-vX.Y.Z` and `impl-vX.Y.Z` badges in `README.md` and `README.es.md` must be bumped manually alongside the Version Packages PR. Keep both READMEs in sync. See the "README badges — manual version bump" section in `CONTRIBUTING.md`.
- **Pre-1.0: never bump to a major** — while a workspace (`spec/`, `src/`, `testkit/`) is in `0.Y.Z`, every breaking change ships as a **minor** (`0.X.Y → 0.X+1.0`), never `1.0.0`. Per `spec/versioning.md` § Pre-1.0, breakings are allowed inside minor bumps pre-1; the first `1.0.0` is a deliberate stabilization moment, not a side-effect of a normal PR. If a changeset proposes `major` while the workspace is pre-1, downgrade it to `minor` and document the breaking change in `CHANGELOG.md`.
- **Regenerate `spec/index.json` after any `spec/` change** — `npm run spec:index`. CI runs `npm run spec:check` and fails on drift. The integrity block is deterministic; do not hand-edit.
- **Keep `ROADMAP.md` in sync** — `ROADMAP.md` is a living document, not a one-shot artifact. Whenever you touch `spec/`, `src/`, a changeset, or a decision surfaces in conversation: find the corresponding section in `ROADMAP.md` and update it in the same change (examples, decision table, execution plan, last-updated line, completeness marker). The authority order (`spec/` > `ROADMAP.md` > `AGENTS.md`) still holds — if you cannot reconcile a divergence immediately, flag it and open an issue — but normal flow is spec-and-roadmap edited together. Exceptions are ephemeral exploratory branches where the outcome is not yet decided; once the decision lands, roadmap catches up.
- **All artifacts in English** — code, commits, PRs, docs. Conversation language follows the activation rule at the top.
- **Paths**: prefer relative over absolute in bash commands and agent prompts.
- **Temp files AND scratch directories**: use `.tmp/` (project-local, gitignored), not `/tmp/` or `/var/tmp/`. This applies to every temp path an AI agent writes, including intermediate files for `awk`, `sed`, `diff`, `grep`, piped scripts, and extracted snippets. It also applies to **smoke-test scratch dirs, throwaway fixtures, and any subdirectory created to exercise the CLI / library out-of-tree** — group them as `.tmp/<scope>/` (e.g. `.tmp/graph-smoke/`, `.tmp/fixture-foo/`). If `.tmp/` does not exist, create it (`mkdir -p .tmp`). Never write a temp file or working directory outside the repo.
- **Every feature**: update `spec/` first, then `src/`. No impl feature without a matching spec change.
- **Pin every dependency in `package.json`** — no `^` or `~` ranges. Applies to `package.json` at root, `ui/`, and `src/` (while `src/` stays `private: true`). `spec/` has no dependencies. When adding a new package, use `npm install <pkg>@<exact-version>` or edit the manifest to the exact version from the lockfile. Reason: reproducible installs across contributors and CI, and zero surprise upgrades on `npm install` even if the lockfile is regenerated. Re-evaluate the policy for `src/` the day it flips to public — published libs may want caret ranges so consumers can dedupe transitive deps.
- **CI green, always** — extensions ship with tests or do not boot.
- **Never hardcode `.skill-map/...` paths in CLI code.** Every CLI command that resolves the project DB, jobs dir, plugins dir, or any other path under `.skill-map/` MUST go through the helpers in `src/cli/util/db-path.ts` (`resolveDbPath`, `defaultProjectDbPath`, `defaultProjectJobsDir`, `defaultProjectPluginsDir`, `defaultUserPluginsDir`, `SKILL_MAP_DIR`). New paths under `.skill-map/` get a new helper there; consumers never compose the literal themselves. Reason: the directory layout is shared across `scan`, `refresh`, `watch`, `jobs`, `plugins`, `init`, `db`, and any future verb — duplicated literals diverge silently when one consumer moves and the others don't.
- **No hacks — read the official docs first.** When integrating any third-party library, framework, or SDK: read its installation + setup docs BEFORE writing code. If code doesn't work as expected, re-read the docs before inventing workarounds (manual CSS overrides, wrappers that emulate missing behavior, hardcoded defaults that hide misconfiguration). Symptoms like "I had to add `fill: none` and custom stroke widths manually" or "I needed a fallback selector" are red flags that a setup step was skipped. The correct fix is almost always to wire up the official piece (theme import, module registration, schematic, peer dep) — not to paper over it. If you cannot find the official way, project-local `.claude/skills/*` (e.g. the `foblex-flow` skill) are the second authority; third, context7 MCP for current upstream docs.
- **When AGENTS.md and ROADMAP.md disagree**: ROADMAP.md wins (it is the canonical design narrative and planning authority). AGENTS.md should be updated to match. When `spec/` and either disagree, spec wins.

## Agent delegation (when to spawn subagents)

The orchestrator does not have to do everything itself. For this repo:

- **Use `cli-agent` for multi-file mechanical implementation** (storage helpers, CLI command bodies from existing stubs, schema extensions + runner updates, test scaffolding around a known surface). Trigger when the task touches **≥ 3 files** AND the spec is settled AND there is **low design ambiguity**. The agent runs `npm run build` / `npm test -w src` before reporting, which catches mechanical errors that an in-context loop tends to bounce on.
- **Use `Explore` for codebase research that takes more than ~3 queries**: mapping unfamiliar areas, finding patterns to reuse, understanding existing conventions before writing. Up to 3 in parallel for orthogonal questions. Brief them with the full context — they have no memory of the conversation.
- **Use `Plan` only for genuinely ambiguous design questions** where you want a second pass on tradeoffs. Skip for trivial or already-scoped tasks.
- **Use the audit agents** (`api-architect` / `app-architect` / `cli-architect` / `*-hacker` / `*-ruler` / `app-a11y`) for review passes, not implementation. They are read-only and verify against current docs (some via context7).

**Do NOT delegate** when:
- Spec wording or zone semantics need a judgement call (e.g. `scan_meta` vs `state_scan_meta`, conformance schema extension shape).
- The task is a bug investigation with no known root cause.
- Cross-cutting refactors where the right cut depends on weighing tradeoffs.
- Anything that requires reading the user's mind on a non-obvious preference.

A useful smell test: if you can write a self-contained 200-word brief that names the files to read, the spec to follow, the tests to add, and the success criteria — delegate. If the brief would be "figure out what to do here", do it yourself.

## Rules for AI agents editing `spec/`

1. **Spec is the source of truth**. When spec and `ROADMAP.md` disagree, spec wins. ROADMAP is the design narrative; it may lag.
2. **Every normative change → `spec/CHANGELOG.md` entry** in the `[Unreleased]` section, classified as patch / minor / major per `spec/versioning.md`.
3. **Breaking changes → major bump required (post-v1.0.0)**. Do not sneak breaking changes into a minor once the spec hits v1.0.0. **Pre-1.0 exception**: while the spec is `0.Y.Z`, breaking changes ship as minor bumps per `versioning.md` § Pre-1.0 (also restated in the "Rules for agents working in this repo" section above). Either way, classify the change correctly in `CHANGELOG.md`.
4. **Update spec first, then `src/`**. The inverse is a policy violation caught in review. If a proposed feature cannot land in spec (because the shape isn't clear yet), it is not ready for implementation.
5. **JSON Schema files MUST parse**. CI enforces this via the `validate` job.
6. **Never hand-edit `conformance/fixtures/preamble-v*.txt`**. The text in `prompt-preamble.md` is authoritative; regenerate fixtures from it.
7. **Cross-schema references**: use relative paths in `$ref` (e.g. `"base.schema.json"`, `"../report-base.schema.json"`). Do NOT use absolute URLs in `$ref` — those are reserved for `$id`.
8. **Prose docs follow the convention**: each ends with a `## Stability` section stating what is stable as of v1.0.0 and what bump is required for future changes.
9. **Schemas under `schemas/frontmatter/*` extend `base.schema.json` via `allOf`**. Schemas under `schemas/summaries/*` extend `../report-base.schema.json` via `allOf`. Do not copy fields; reference them.
10. **Conformance tests** (`spec/conformance/cases/`) MUST exist for every schema before spec v1.0.0 ships. Missing conformance case → missing release.

## Maintenance checklist (apply on any `spec/` PR)

- [ ] JSON Schema files parse.
- [ ] `$id` is present, uses the canonical scheme, matches the file path.
- [ ] Any new required field has a migration note in `spec/CHANGELOG.md`.
- [ ] camelCase for JSON keys; kebab-case for file names.
- [ ] Stability tag set where non-obvious (`experimental` / `stable` / `deprecated`).
- [ ] `spec/CHANGELOG.md` updated under `[Unreleased]` with the correct classification.
- [ ] If the preamble text changed: conformance fixture regenerated and tests re-run.
- [ ] Prose doc ends with a `## Stability` section.
- [ ] No absolute URL in `$ref`.
- [ ] Extends `base` / `report-base` via `allOf` where applicable; no field duplication.
- [ ] `npm run spec:index` run; `spec/index.json` reflects the change.

## Type naming convention (`src/`)

The kernel uses four naming buckets for TypeScript types / interfaces. The full doc (with edge cases) lives in `src/kernel/types.ts`'s top docstring; the short version:

1. **Domain types** — mirror `spec/schemas/*.json`. **No prefix.** `Node`, `Link`, `Issue`, `ScanResult`, `ExecutionRecord`. The name tracks the schema verbatim because the spec is the source of truth.
2. **Hexagonal ports** — abstract boundaries with `Port` suffix: `StoragePort`, `RunnerPort`, `ProgressEmitterPort`. The suffix flags the architectural role and avoids clash with the concrete adapter (e.g. `SqliteStorageAdapter` implements `StoragePort`).
3. **Runtime extension contracts** — shapes a plugin author implements: `IProvider`, `IExtractor`, `IRule`, `IAction`, `IFormatter`. **`I` prefix.** Reads as "you supply this".
4. **Internal shapes** — option bags, result records, config slices that live only in TS (never in JSON): `IPluginRuntimeBundle`, `IPruneResult`, `IDbLocationOptions`. **`I` prefix.**

Several public-surface shapes are grandfathered without the `I` prefix because renaming would break downstream consumers:

- **Category 4 option bags**: `RunScanOptions`, `RenameOp`.
- **Category 4 TS-only exports from `kernel/index.ts` / `kernel/ports/*`**: `Kernel`, `ProgressEvent`, `LogRecord`, `NodeStat`.

The list above is closed. New public option bags and new TS-only exports must still take `I*`. Removing a name from this list (i.e. renaming the shape to `I*`) is a breaking change and ships under the breaking-change rules in `spec/versioning.md`.

When in doubt: "does this shape exist in the spec?". Yes → no prefix, name from schema. No → `I*` prefix.

## Kernel boundaries & adapter wiring

The kernel is NOT allowed to know about its drivers. The CLI is one such driver; future drivers (HTTP server, in-memory test harness) should drop in without the kernel changing. The lint config (`src/eslint.config.js`) enforces these invariants structurally — they cannot regress silently.

1. **No `console.*` in `src/kernel/**`**. Use the singleton logger: `import { log } from '<.../>kernel/util/logger.js'`. The CLI installs the active impl at boot via `configureLogger(new Logger({ level, stream }))`. The default is `SilentLogger`. Tests install a capture logger and call `resetLogger()` in `try/finally` (or `afterEach`) to avoid cross-test bleed. The port shape (`LoggerPort`, `LogLevel`, `LogRecord`) lives in `src/kernel/ports/logger.ts`; the proxy + setters in `src/kernel/util/logger.ts`.

2. **No `process.cwd()` / `process.env` / `os.homedir()` in `src/kernel/**`**. Kernel APIs that need a runtime context take it through their options bag, **mandatory** (not optional with a fallback). The CLI bridges via `defaultRuntimeContext()` in `src/cli/util/runtime-context.ts` — returns `{ cwd: process.cwd(), homedir: homedir() }`. Pattern: `loadConfig({ scope: 'project', ...defaultRuntimeContext() })`.

3. **No imports from `src/cli/**` inside `src/kernel/**`**. The reverse direction is fine. Enforced by `no-restricted-imports`.

4. **Adapter classes MUST `implements`-declare their port**: `class PluginLoader implements PluginLoaderPort`, `class SqliteStorageAdapter implements StoragePort`. Drift between port shape and concrete adapter becomes a TS compile error, not a hand-audit.

5. **The CLI consumes adapters via factory functions**, not `new` constructors. The factory returns the port type (the abstract contract), not the concrete class:
   - `createPluginLoader(opts): PluginLoaderPort` exported from `src/kernel/adapters/plugin-loader.ts`.
   - **Tests are the exception**: they construct the concrete class directly (`new PluginLoader(...)`) when they need to assert against implementation internals (timeouts, schema compilation, private state).
   - **Zero-options adapters are exempt**: when an adapter has no constructor arguments and no configuration knobs (today only `InMemoryProgressEmitter`), it MAY be instantiated with `new` directly from CLI / kernel call sites. A factory adds no behavioral value when the constructor takes no inputs. The moment such an adapter grows even one option, it MUST switch to a `create*` factory before that option lands — every CLI / kernel caller updates in the same change.

6. **CLI commands MUST receive their `stdin` / `stdout` / `stderr` from the Clipanion `this.context`**, not Node globals. Helpers that need streams take them as a parameter (`confirm(question, { stdin, stderr })`, etc.). This keeps every command testable with captured streams instead of monkey-patched `process.*`.

## Source layout: built-ins vs extension contracts

Two directories with similar-sounding names; tell them apart by purpose:

- **`src/kernel/extensions/`** — the **contracts**: one file per extension kind (`provider.ts`, `extractor.ts`, `rule.ts`, `action.ts`, `formatter.ts`, `hook.ts`) plus a shared `base.ts` (`IExtensionBase`). Each kind file exports its main contract (`IProvider`, `IExtractor`, `IRule`, `IAction`, `IFormatter`, `IHook`) alongside the associated context / payload shapes that live next to it (`IRawNode` and `IProviderKind` in `provider.ts`; `IExtractorContext` / `IExtractorCallbacks` in `extractor.ts`; `IRuleContext` in `rule.ts`; `IActionPrecondition` in `action.ts`; `IFormatterContext` in `formatter.ts`; `IHookContext` / `THookTrigger` / `THookFilter` in `hook.ts`). Defines the shape any extension author (built-in or user plugin) must implement. Pure types + small helpers; no runtime data.
- **`src/built-in-plugins/`** — the **bundled implementations**: the `claude` Provider, the `frontmatter` / `slash` / `at-directive` / `external-url-counter` Extractors, the `link-conflict` / `trigger-collision` / `orphan-detection` / `auto-rename` Rules, the `ascii` Formatter. Every one of these `implements` a contract from `kernel/extensions/`.

Mnemonic: "kernel/extensions = what shape; built-in-plugins = what code." When wiring from the CLI: import the **runtime instance** from `built-in-plugins/built-ins.ts`; import the **type** from `kernel/extensions/<kind>.ts`.

## i18n strategy: where strings live

User-facing text in the **CLI** uses the `tx(*_TEXTS.*)` system end-to-end:

- Every `cli/commands/<verb>.ts` that emits text to `stdout` / `stderr` MUST source its strings from a sibling `cli/i18n/<verb>.texts.ts` file via `tx(*_TEXTS.<key>, { vars })`.
- Hardcoded inline strings (e.g. `this.context.stdout.write('No issues.\n')`) are forbidden in command files. The pattern goes through `tx(<VERB>_TEXTS.noIssues)`.
- Pure passthrough of an external string (`this.context.stderr.write(\`${warn}\n\`)` for a plugin warning that already came formatted from the kernel) is allowed — the warning text was already authored elsewhere.
- The kernel emits text via `kernel/i18n/<module>.texts.ts` for the same reason; mirroring the pattern keeps the future Transloco / message-format migration trivial.
- **Built-in plugins follow the same rule.** `Issue.message` strings emitted by `built-in-plugins/rules/*` and any user-visible text rendered by `built-in-plugins/formatters/*` (or `extractors/*`, when a future built-in extractor surfaces user-readable output) MUST come from `built-in-plugins/i18n/<id>.texts.ts`. Issue messages persist in `scan_issues.message` and surface through `sm check` / `sm show` / `sm export` — they are user-facing exactly like CLI stdout. The catalog naming mirrors the rule / formatter id (`broken-ref.texts.ts`, `ascii.texts.ts`).
- **Conformance runner follows the same rule.** Assertion `reason` strings produced by `src/conformance/index.ts` are surfaced verbatim to stderr by `sm conformance run` — they are user-facing. Source them from `src/conformance/i18n/runner.texts.ts` via `tx(CONFORMANCE_RUNNER_TEXTS.*, { vars })`.

Why this discipline today even without a real i18n framework: it keeps every user-visible string in a flat, greppable, JSON-shaped catalog, ready to drop into a translator pipeline the day a non-English locale lands. Until then, it is also the cheapest way to enforce "no copy-changes hidden inside command logic" — every wording lives in one place.

## CLI output sanitization

Every CLI sink that writes to `stdout` / `stderr` MUST pass strings sourced from **persisted DB rows**, **plugin-authored values** (rule messages, manifest fields, extension ids, failure reasons), or **filesystem entries** (file paths, frontmatter values, dirent names) through `sanitizeForTerminal()` from `src/kernel/util/safe-text.ts` before emission. The helper strips C0 control bytes (including `\x1B`) and prevents ANSI escape injection from masquerading as terminal control sequences in the user's terminal — `\x1b[2J` clearing the screen, fake-prompt injection, cursor manipulation that hides commands ahead of an unsuspecting paste.

**Pure passthrough is forbidden** for the categories above: even fields that look "controlled" (a `ruleId` validated by regex, a `node.kind` from a fixed enum) go through `sanitizeForTerminal` for defense in depth — schemas drift, regexes loosen, the cost of wrapping is one function call. Reference implementations: `cli/commands/{check,history,list,orphans,plugins,refresh,export,show,scan-compare}.ts` all sanitize at the render layer.

**Exceptions** (sanitization NOT required):

- Strings the CLI itself authored in the current process — i18n catalog values reached via `tx(*_TEXTS.*, ...)` are trusted source. The `vars` interpolated INTO the catalog are NOT trusted; sanitize them at the call site.
- Filesystem paths the CLI composed via `path.join` from trusted parts (e.g. `defaultProjectDbPath(cwd)`).
- Numeric values, booleans, and other non-string primitives.

When in doubt, sanitize. The cost is a function call; the cost of forgetting is a screen-clear or fake-prompt smuggled into the user's terminal via a hostile plugin's `Issue.message`.

Note: `stripAnsi()` is also exported from `safe-text.ts` but is the wrong tool for this rule — it only removes well-formed ANSI sequences, not arbitrary C0 control bytes. Use `sanitizeForTerminal` for output safety; reserve `stripAnsi` for measuring visual length or comparing styled output in tests.

## Linting & validation

ESLint v10 flat config lives at `src/eslint.config.js`. Run from any cwd:

- `npm run lint` — lints every workspace that declares a `lint` script (today: `src/` only; `ui/` joins later).
- `npm run lint:fix` — same with `--fix`.
- `npm run validate` — semantic alias for "all static checks". Currently delegates to lint across workspaces; expand here when more static checks land (typecheck-all, doctest, etc.).

CI (`.github/workflows/ci.yml` → `build-test` job) runs `npm run validate` after typecheck, before build. Both errors AND warnings block CI — there are no `'warn'` rules in the config.

**Rule severity policy**: every quality rule is `'error'` (post-complexity-sweep). The categories below cover what's enforced; new rules should land at `'error'` from day one or come with a justified disable plan.

- **Architectural invariants** (kernel-isolation): no `console.*` in `kernel/**`; no `process.cwd` / `process.env` in `kernel/**`; no `cli/**` imports from `kernel/**`; relative ESM imports terminate in `.js`. Cannot regress.
- **Legacy hand-curated rules**: `complexity` (max 8), `eqeqeq`, `no-var`, `no-eval`, `no-throw-literal`, `block-scoped-var`, `no-fallthrough`, `no-useless-return`, `no-else-return`, `no-extra-boolean-cast`, `curly`, `no-console` (allow `[warn,error,log]` in CLI).
- **Quality rules**: `@typescript-eslint/explicit-module-boundary-types`, `@typescript-eslint/no-empty-function`, `preserve-caught-error`, `no-irregular-whitespace` (with `skipStrings/Comments/RegExps/Templates`), `no-useless-assignment`.
- **Stylistic**: `@stylistic/quotes` single, `@stylistic/semi`, `@stylistic/linebreak-style` unix, `@stylistic/no-multi-spaces`, `@stylistic/newline-per-chained-call` depth 4.

**When `eslint-disable-next-line` is acceptable**: only the categories below, each with a comment explaining which one. Anything else means the function should be split or the code rewritten — not disabled.

1. **CLI orchestrators with multi-flag handling**: `execute()` methods on Clipanion `Command` classes that fan out over many flags (each `if (this.flag) ...` is one cyclomatic branch). Splitting per branch scatters the validation away from the flag it gates. Examples: `cli/commands/{scan,db,history,refresh,init,...}.ts:execute`.
2. **Char-by-char parsers / state machines**: each character produces a state transition; splitting per state mode hides the dispatcher loop. Examples: `kernel/scan/query.ts:parseExportQuery`, `kernel/adapters/sqlite/plugin-migrations-validator.ts:splitStatements` / `objectName`.
3. **Multi-accumulator folds**: one row contributes to N independent accumulators in one pass. Per-accumulator helpers split the state mutation across helpers without making the loop body clearer. Examples: `kernel/adapters/sqlite/history.ts:accumulateExecutionRow`, `conformance/index.ts:applyJsonPathComparator`.
4. **Migration runners with per-file safe-apply**: each iteration is `BEGIN / try / catch + rollback / COMMIT`; the structure IS the contract. Examples: `kernel/adapters/sqlite/migrations.ts:applyMigrations`, `kernel/adapters/sqlite/plugin-migrations.ts:applyPluginMigrations`.
5. **Pure column mappers**: object literals where every `??` adds a cyclomatic branch despite there being zero control flow. Splitting would replace clarity with ceremony. Examples: `kernel/adapters/sqlite/scan-persistence.ts:nodeToRow` / `linkToRow`.
6. **Discriminated-union dispatchers**: one branch per shape variant (`switch (a.type) { case ... }`). Splitting per case scatters the central dispatch table. Examples: `conformance/index.ts:evaluateAssertion`, `extensions/rules/{trigger-collision,link-conflict}/index.ts:evaluate`.

If a function does not fit one of those six and is above the threshold, **split it** (see commits `91fea6a` … `aa550a6` for the canonical split patterns: extract per-branch helpers, return discriminated unions for early exits, use small focused render-section helpers for output assembly).

**`ui/` workspace**: no lint config yet. When configuring it, add `lint` / `lint:fix` scripts to `ui/package.json` and an `ui/eslint.config.js` (probably with `@angular-eslint`). `npm run validate` picks them up automatically via `--workspaces --if-present`.

## UI library reference

The `ui/` workspace uses **Foblex Flow** (`@foblex/flow`) for the graph visualization layer. The library is poorly documented upstream, so the full operating guide (seven non-negotiable rules, antipattern checklist, canonical patterns, full API reference) lives in the project-local **`foblex-flow` skill** at `.claude/skills/foblex-flow/`.

Invoke it via `/foblex-flow` — or it auto-triggers when touching any graph-related Angular template, component, CSS, or `@foblex/flow` import. **Read the skill before touching any graph code.** The rules it encodes were all learned the hard way and skipping any produces silent failures.

## UI test IDs

Every interactive or test-targetable element in `ui/src/` carries a `data-testid` attribute. The codebase has no E2E tests today, but the IDs are placed proactively so future Playwright/Cypress/Vitest-Testing-Library flows land on stable selectors instead of CSS chains or i18n-fragile text.

**Naming convention**: `kebab-case`, shaped as `<area>-<element>` or `<area>-<element>-<modifier>`.

- Page sections: `list-view`, `graph-view`, `inspector-view`, `shell`, `shell-topbar`, `shell-nav`.
- Navigation: `nav-list`, `nav-graph`, `nav-inspector`, `inspector-back`.
- Action buttons: `action-<verb>` (`action-simulate-scan`, `action-theme-toggle`, `action-det`, `action-prob`).
- Toolbar buttons: `<view>-<verb>` (`graph-zoom-in`, `graph-fit-to-screen`, `graph-reset-layout`, `graph-theme-toggle`).
- Form controls: `filter-search`, `filter-kinds`, `filter-stabilities`, `filter-has-issues`, `filter-reset`.
- Empty / loading / error states: `<view>-empty-<reason>` / `<view>-loading` / `<view>-error` (`list-empty-filtered`, `list-empty-all`, `inspector-empty-no-selection`, `inspector-empty-not-found`, `graph-loading`, `graph-error`, `graph-empty`).
- Cards / panels: `<view>-card-<topic>` (`inspector-card-summary`, `inspector-card-agent`, …, `inspector-card-body`).

**Dynamic IDs** (per-row, per-node, per-kind): `[attr.data-testid]="'<prefix>-' + value"`. Examples in the codebase: `list-row-<path>`, `graph-node-<id>`, `kind-palette-<kind>`.

**PrimeNG components**: place `data-testid` directly on the `<p-button>` / `<p-togglebutton>` / `<p-multiselect>` / `<p-table>` host tag. Tests reach the inner `<button>` / `<input>` via descendant selectors. Keeping the testid on the host tag survives PrimeNG internal DOM changes.

**When to add**:

- Every new view's section root.
- Every new interactive element a test could plausibly target (button, link, input, toggle, row).
- Every distinguishable empty / loading / error state.
- Every card or panel that a test might assert "is shown" or read content from.

**When to skip**: purely decorative elements (icons, separators, swatches), text inside an already-targetable parent, and elements with no test value.

**Why testids and not CSS / text**: CSS-selector tests rot with every styling refactor (`.foo .bar > .baz:nth-child(2)`); text-based tests rot when copy changes (which happens routinely in i18n-bound UIs). `data-testid` is deliberately test-only — neither styling nor logic touches it, so it stays stable across both.

## Further reading

- `README.md` — product overview, philosophy, repo layout, specification surface, glossary pointers.
- `ROADMAP.md` — design narrative, decisions, execution plan, stack conventions, persistence, testing, rejected proposals. The completeness marker flags the last fully-done step.
- `spec/` — normative standard: JSON Schemas, prose contracts (`architecture.md`, `cli-contract.md`, `job-lifecycle.md`, `job-events.md`, `prompt-preamble.md`, `db-schema.md`, `plugin-kv-api.md`), conformance suite.
- `CONTRIBUTING.md` — PR workflow, changeset rules.
- `CLAUDE.md` — single-line pointer (`@AGENTS.md`) so Claude Code and Codex pick up this file under either filename.
