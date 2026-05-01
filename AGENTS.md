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
- **Planned refactors → `docs/refactors/<slug>.md`**. Multi-hour refactors that get scoped but not executed in the same session live as self-contained markdown files: status, decision rationale, complete inventory, proposed shape, phased plan with cost/risk, open questions, and "how to resume" steps. The file must be sufficient for a fresh agent (or future-you) to pick up without re-reading the conversation. See `docs/refactors/storage-port-promotion.md` as the template.
- **Every feature**: update `spec/` first, then `src/`. No impl feature without a matching spec change.
- **Pin every dependency in `package.json`** — no `^` or `~` ranges. Applies to `package.json` at root, `ui/`, and `src/` (while `src/` stays `private: true`). `spec/` has no dependencies. When adding a new package, use `npm install <pkg>@<exact-version>` or edit the manifest to the exact version from the lockfile. Reason: reproducible installs across contributors and CI, and zero surprise upgrades on `npm install` even if the lockfile is regenerated. Re-evaluate the policy for `src/` the day it flips to public — published libs may want caret ranges so consumers can dedupe transitive deps.
- **CI green, always** — extensions ship with tests or do not boot.
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

Two known edge cases kept on purpose: `RunScanOptions` and `RenameOp` are category 4 but lack the `I` prefix because they're part of the public kernel surface and renaming is a breaking change for plugin authors. They are grandfathered; new public option bags should still take `I*`.

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

6. **CLI commands MUST receive their `stdin` / `stdout` / `stderr` from the Clipanion `this.context`**, not Node globals. Helpers that need streams take them as a parameter (`confirm(question, { stdin, stderr })`, etc.). This keeps every command testable with captured streams instead of monkey-patched `process.*`.

## Linting & validation

ESLint v10 flat config lives at `src/eslint.config.js`. Run from any cwd:

- `npm run lint` — lints every workspace that declares a `lint` script (today: `src/` only; `ui/` joins later).
- `npm run lint:fix` — same with `--fix`.
- `npm run validate` — semantic alias for "all static checks". Currently delegates to lint across workspaces; expand here when more static checks land (typecheck-all, doctest, etc.).

CI (`.github/workflows/ci.yml` → `build-test` job) runs `npm run validate` after typecheck, before build. Fails on errors, allows warnings.

**Rule severity policy**:
- **Architectural invariants are `error`** and block CI: no `console.*` / `process.cwd` / `process.env` in kernel; no `cli/**` imports from `kernel/**`; relative ESM imports terminate in `.js`; the legacy hand-curated rules (`eqeqeq`, `no-var`, `no-eval`, `no-throw-literal`, `block-scoped-var`, etc.). These cannot regress.
- **Code-quality rules are `warn`**: `complexity > 8`, `@typescript-eslint/no-empty-function`, `preserve-caught-error`, `no-irregular-whitespace`, etc. Visible as debt without blocking CI. Promote a rule to `error` only after fixing the existing violations (e.g. `complexity` once the orchestrator splits land).

**Disabling a rule inline** (`// eslint-disable-next-line <rule>`) is acceptable when the warning is wrong for the site (`\x00` sentinel intentionally trips `no-control-regex`; CJS subpath imports without `.cjs` trip `import-x/extensions`). Always include a comment explaining the rationale.

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
