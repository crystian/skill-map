# Linting & validation

Annex of [`AGENTS.md`](../AGENTS.md). Read this file when adding lint rules or weighing an `eslint-disable-next-line`.

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
