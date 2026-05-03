# Kernel & `src/` conventions

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before editing anything under `src/` (kernel, CLI, built-in plugins, conformance runner). For BFF-specific layout see [`bff.md`](./bff.md); for lint policy see [`lint.md`](./lint.md).

## Type naming convention

The kernel uses four naming buckets for TypeScript types / interfaces. The full doc (with edge cases) lives in `src/kernel/types.ts`'s top docstring; the short version:

1. **Domain types** — mirror `spec/schemas/*.json`. **No prefix.** `Node`, `Link`, `Issue`, `ScanResult`, `ExecutionRecord`. The name tracks the schema verbatim because the spec is the source of truth.
2. **Hexagonal ports** — abstract boundaries with `Port` suffix: `StoragePort`, `RunnerPort`, `ProgressEmitterPort`. The suffix flags the architectural role and avoids clash with the concrete adapter (e.g. `SqliteStorageAdapter` implements `StoragePort`).
3. **Runtime extension contracts** — shapes a plugin author implements: `IProvider`, `IExtractor`, `IRule`, `IAction`, `IFormatter`. **`I` prefix.** Reads as "you supply this".
4. **Internal shapes** — option bags, result records, config slices that live only in TS (never in JSON): `IPluginRuntimeBundle`, `IPruneResult`, `IDbLocationOptions`. **`I` prefix.**

**Grandfathered exceptions** — pre-existing public-surface shapes that pre-date the `I*` convention and would break downstream consumers if renamed. These are exempt from the `I` prefix rule:

- **Category 4 option bags**: `RunScanOptions`, `RenameOp`.
- **Category 4 TS-only exports from `kernel/index.ts` / `kernel/ports/*`**: `Kernel`, `ProgressEvent`, `LogRecord`, `NodeStat`.

The list above is closed. New public option bags and new TS-only exports must still take `I*`. Removing a name from this list (i.e. renaming the shape to `I*`) is a breaking change and ships under the breaking-change rules in `spec/versioning.md`.

When in doubt: "does this shape exist in the spec?". Yes → no prefix, name from schema. No → `I*` prefix.

## Kernel boundaries & adapter wiring

The kernel is NOT allowed to know about its drivers. Today there are two drivers: `src/cli/` (Clipanion verbs) and `src/server/` (Hono BFF). Future drivers (in-memory test harness, IDE plugin, …) drop in without the kernel changing. The lint config (`src/eslint.config.js`) enforces these invariants structurally — they cannot regress silently.

1. **No `console.*` in `src/kernel/**`**. Use the singleton logger: `import { log } from '<.../>kernel/util/logger.js'`. The CLI installs the active impl at boot via `configureLogger(new Logger({ level, stream }))`. The default is `SilentLogger`. Tests install a capture logger and call `resetLogger()` in `try/finally` (or `afterEach`) to avoid cross-test bleed. The port shape (`LoggerPort`, `LogLevel`, `LogRecord`) lives in `src/kernel/ports/logger.ts`; the proxy + setters in `src/kernel/util/logger.ts`.

2. **No `process.cwd()` / `process.env` / `os.homedir()` in `src/kernel/**`**. Kernel APIs that need a runtime context take it through their options bag, **mandatory** (not optional with a fallback). The CLI bridges via `defaultRuntimeContext()` in `src/cli/util/runtime-context.ts` — returns `{ cwd: process.cwd(), homedir: homedir() }`. Pattern: `loadConfig({ scope: 'project', ...defaultRuntimeContext() })`.

3. **No imports from `src/cli/**` inside `src/kernel/**`**. The reverse direction is fine. Enforced by `no-restricted-imports`. The same rule applies to `src/server/**` — kernel never imports the BFF driver. Cross-driver borrowing (the BFF reaching into `src/cli/util/`) IS allowed and used today: `cli/commands/serve.ts` consumes `createServer` from `src/server/`, and `src/server/` consumes the kernel + a small set of CLI utilities (error reporter, sanitization, exit codes, runtime context). The BFF never adds kernel side effects of its own — it reads from / writes to the kernel via its public API.

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
- **BFF (Hono server) follows the same rule.** Strings the server writes to `stdout` / `stderr` (boot banner, shutdown trace, missing-bundle hint) source from `src/server/i18n/server.texts.ts` (`SERVER_TEXTS`); the `sm serve` CLI verb's strings source from `src/cli/i18n/serve.texts.ts` (`SERVE_TEXTS`). HTTP response bodies (the `/api/*` JSON envelopes) are NOT user-facing in the same way — they are machine-readable contract surface and stay where they belong (`src/server/app.ts` formats them inline against the documented envelope shape).

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
