# Architecture

Normative description of skill-map's internal boundaries: the **kernel**, the **ports** it exposes, the **adapters** that drive and serve it, and the five **extension kinds** that live outside the kernel.

Any conforming implementation — reference or third-party — MUST respect these boundaries. The conformance suite under [`conformance/`](./conformance/README.md) enforces them.

---

## Layering

```
                    Driving adapters (primary)
                          │
   ┌─────────┐       ┌─────────┐       ┌──────┐
   │   CLI   │       │ Server  │       │Skill │
   └────┬────┘       └────┬────┘       └───┬──┘
        │                 │                │
        └─────────────────┼────────────────┘
                          ▼
                   ┌──────────────┐
                   │    Kernel    │  ← domain core
                   │              │
                   │  Registry    │
                   │  Orchestrator│
                   │  Use cases   │
                   └──┬───┬───┬───┘
                      │   │   │
        ┌─────────────┘   │   └──────────────┐
        ▼                 ▼                  ▼
   ┌────────┐        ┌─────────┐        ┌─────────┐
   │ Storage│        │   FS    │        │ Plugins │
   └────────┘        └─────────┘        └─────────┘
                Driven adapters (secondary)
```

- **Driving adapters** call into the kernel. The spec defines three: `CLI`, `Server`, `Skill`. A fourth driving adapter MAY be built by third parties (IDE extension, VSCode command palette, TUI) without spec changes.
- **Driven adapters** implement ports the kernel declares. An implementation MUST ship adapters for every port — no port may be left unimplemented at runtime.
- **Kernel** is domain-pure. It never imports a filesystem API, a database driver, or a subprocess spawner directly. All IO crosses a port.

---

## Ports

An implementation MUST expose these five ports. Each is an interface (TypeScript, in the reference impl; equivalent in other languages).

### `StoragePort`

Persistence for all kernel tables in all three zones (`scan_*`, `state_*`, `config_*`). Exposes typed repositories, not raw SQL. Implementations MAY back this with SQLite, Postgres, in-memory, or anything else, as long as:

- Transactional semantics for atomic claim (see [`job-lifecycle.md`](./job-lifecycle.md)).
- Migration application with `PRAGMA user_version`-equivalent tracking.
- Read isolation sufficient to avoid phantom reads across a single scan write.

The reference impl backs this with `node:sqlite` + Kysely + `CamelCasePlugin`. See [`db-schema.md`](./db-schema.md) for the full table catalog.

### `FilesystemPort`

Walks roots, reads node files, reports mtime/size. Abstracts away platform-specific path handling and test fixtures.

Operations: `walk(roots, ignore)`, `readNode(path)`, `stat(path)`, `writeJobFile(path, content)`, `ensureDir(path)`.

The reference impl uses real `node:fs` in production and an in-memory fixture in tests.

### `PluginLoaderPort`

Discovers plugin directories, reads `plugin.json`, checks `specCompat`, dynamically imports extension files, returns loaded extension descriptors ready to register.

Operations: `discover(scopes)`, `load(pluginPath)`, `validateManifest(json)`.

The loader enforces two id-uniqueness rules during discovery (see [`plugin-author-guide.md` §Plugin id uniqueness](./plugin-author-guide.md#plugin-id-uniqueness) for the author-facing summary):

1. **Directory name == manifest id.** A plugin lives at `<root>/<id>/plugin.json`. A mismatch surfaces as status `invalid-manifest`. This rule eliminates same-root collisions by construction.
2. **Cross-root id collision blocks both sides.** Two plugins reachable from different roots (project + global, or any `--plugin-dir` combination) that declare the same `id` BOTH receive status `id-collision`. No precedence rule applies — coherent with §Boot invariant ("no extension is privileged"). The user resolves by renaming one of them.

In addition, the loader **qualifies every extension** with its owning plugin id before registering it. The registry stores extensions under the qualified id `<plugin-id>/<extension-id>` (e.g. `claude/slash`, `core/broken-ref`, `hello-world/greet`). Authors continue to declare the short `id` in each extension manifest; the loader composes the qualified form from `manifest.id` at load time. Built-in extensions bundled with the reference impl declare their `pluginId` directly in `built-ins.ts` — `core/` for kernel-internal primitives (rules, the formatter, the external-url-counter extractor) and `claude/` for the Claude provider bundle (the Provider and its kind-aware extractors). If a plugin author injects a `pluginId` field on an extension that disagrees with `plugin.json`'s `id`, the loader emits `invalid-manifest` with a directed reason.

Each plugin (and each built-in bundle) declares a **granularity** that controls how its extensions are toggled. `granularity: 'bundle'` (the default) means the plugin id is the only enable/disable key; `granularity: 'extension'` means each extension is independently toggle-able under its qualified id. The loader's pre-import `resolveEnabled(pluginId)` short-circuit is always coarse (bundle level) — when a granularity=`extension` bundle is partially enabled, the import work proceeds and the runtime composer (the CLI's `composeScanExtensions` / `composeFormatters` in `src/cli/util/plugin-runtime.ts`) drops the disabled extensions before they reach the orchestrator. The two built-in bundles split deliberately: `claude` is granularity=`bundle` (provider-level toggle), `core` is granularity=`extension` (every kernel built-in is removable, satisfying §Boot invariant: "no extension is privileged"). See [`plugin-author-guide.md` §Granularity — bundle vs extension](./plugin-author-guide.md#granularity--bundle-vs-extension) for the author-facing summary.

### `RunnerPort`

Executes an action against a job file. Returns a report reference (or an error) plus runner-side metrics (duration, tokens, exit code).

Operations: `run(jobFilePath, options)` → `{ reportPath, tokensIn, tokensOut, durationMs, exitCode } | Error`.

Two reference implementations:
- `ClaudeCliRunner` — subprocess `claude -p < jobfile`.
- `MockRunner` — deterministic fake for tests.

The **Skill agent** does NOT implement this port: it is a peer driving adapter (alongside CLI and Server) that runs inside an LLM session and consumes `sm job claim` + `sm record` as a kernel client. The name "Skill runner" is descriptive, not structural — only the `ClaudeCliRunner` (and its test fake) implement `RunnerPort`. See [`job-lifecycle.md`](./job-lifecycle.md).

### `ProgressEmitterPort`

Emits progress events during long operations (scans, job runs). Consumers: CLI pretty printer, `--json` ndjson, Server's WebSocket broadcaster.

Operations: `emit(event)`, `subscribe(listener)`. Events are defined in [`job-events.md`](./job-events.md).

---

## Kernel

The kernel is the only component that:
- Maintains the extension registry.
- Runs the scan orchestrator.
- Validates scan output against [`scan-result.schema.json`](./schemas/scan-result.schema.json).
- Applies the canonical prompt preamble to job files ([`prompt-preamble.md`](./prompt-preamble.md)).
- Enforces duplicate-prevention and atomic-claim invariants for jobs.
- Persists execution records.

The kernel is the only component that MAY:
- Import schemas.
- Call `validate(data, schema)`.
- Dispatch extension hooks.

The kernel MUST NOT:
- Know which Provider produced an event.
- Know which platform a node belongs to (that is the `Provider` extension's job).
- Contain any platform-specific branching (e.g., `if (platform === 'claude')`).

### Boot invariant

**With all extensions removed, the kernel MUST boot and return an empty graph.** This is enforced by the conformance suite case `kernel-empty-boot`.

No extension is privileged. The Claude Provider ships bundled with the reference impl but is removable, same as any third-party plugin.

---

## Execution modes

Every analytical extension in skill-map is one of two **modes**:

- **`deterministic`** — pure code. Same input → same output, every run.
- **`probabilistic`** — calls an LLM through the kernel's `RunnerPort`. Output may vary across runs; cost and latency are non-trivial.

Mode is a property of the extension as a whole, not of an individual call. **An extension is one mode or the other; it cannot switch at runtime.** If a plugin author needs both flavors of the same idea (regex-based AND LLM-based "find suspicious imports"), they ship two extensions with distinct ids.

### Which kinds support which modes

| Kind | Modes | How mode is set |
|---|---|---|
| **Extractor** | deterministic / probabilistic | declared in manifest (`mode` field, optional; defaults to `deterministic`) |
| **Rule** | deterministic / probabilistic | declared in manifest (`mode` field, optional; defaults to `deterministic`) |
| **Action** | deterministic / probabilistic | declared in manifest (`mode` field, **required** — no default) |
| **Provider** | deterministic-only | implicit; `mode` field MUST NOT appear |
| **Formatter** | deterministic-only | implicit; `mode` field MUST NOT appear |

Provider and Formatter are locked to deterministic because they sit at the **boundaries** of the system. A Provider resolves `path → kind` during boot; probabilistic classification would make the boot phase slow, costly, and non-reproducible. A formatter must produce diffable output (`sm scan` snapshots round-trip in CI). Probabilistic narrators of the graph are a valid product but they live in jobs and emit Findings, not in formatters.

> **Naming note — `Provider` vs hexagonal `adapter`.** The extension kind formerly named `Adapter` is now `Provider`. The hexagonal-architecture term `adapter` (driving / driven adapters that implement ports — `RunnerPort.adapter`, `StoragePort.adapter`, `FilesystemPort.adapter`, `PluginLoaderPort.adapter`) is unchanged: those live in `kernel/adapters/` and are internal to the impl. A `Provider` is an **extension** authored by plugins; an **adapter** in the hexagonal sense is a **port implementation** internal to the kernel package. The two concepts share an architectural lineage (both bridge two worlds) but live in deliberately disjoint namespaces so plugin authors and impl maintainers never confuse them.

### When each mode runs

- **Deterministic extensions** run synchronously inside the standard kernel pipelines (`sm scan`, `sm check`, `sm list`). Fast, free, reproducible. CI-safe.
- **Probabilistic extensions** never run during `sm scan`. They are dispatched as **jobs** via `sm job submit <kind>:<id>`. Jobs are async, queued, persisted under `state_jobs`, and resume on next boot. The same scan snapshot can be re-analyzed by probabilistic extensions on demand without re-walking the filesystem.

This separation is normative: a probabilistic extension cannot register a hook that fires from `sm scan`. The kernel rejects it at load time.

### How probabilistic extensions invoke the LLM

The kernel exposes the LLM through the `RunnerPort` (see §Ports above). Reference impl: `ClaudeCliRunner`. Tests: `MockRunner`. Other adapters (OpenAI, local Ollama, etc.) implement the same port without spec changes.

A probabilistic extension receives the runner in its invocation context alongside `ctx.store`. The extension never imports a specific LLM SDK — the runner contract is what the spec normalizes; wire format and model selection are adapter concerns.

---

## Extension kinds

Five kinds, all first-class, all loaded through the same registry. Each kind has a JSON Schema describing its manifest shape under [`schemas/extensions/`](./schemas/extensions/). Implementations MUST validate every extension manifest against the schema for its declared kind at load time; validation failure → the extension is skipped with status `invalid-manifest`.

| Kind | Role | Input | Output |
|---|---|---|---|
| **Provider** | Recognizes a platform. Declares the catalog of node `kind`s it emits via the `kinds` map; each map entry pairs the kind's frontmatter schema (path relative to the Provider's package directory) with its `defaultRefreshAction` (a qualified action id that drives the probabilistic-refresh surface). Also declares the filesystem `explorationDir` where its content lives. Deterministic-only. | Filesystem walk results, candidate path. | `{ kind, provider } \| null`. |
| **Extractor** | Extracts signals from a node body. Dual-mode: `deterministic` runs in scan, `probabilistic` runs in jobs. Output flows through three context callbacks (no return value): `ctx.emitLink(link)` for the kernel's `links` table, `ctx.enrichNode(partial)` for the kernel's enrichment layer (separate from the author's frontmatter), `ctx.store` for the plugin's own KV / dedicated tables. | Parsed node (frontmatter + body) + callbacks. | `void` (output via callbacks). |
| **Rule** | Evaluates the graph. Dual-mode: `deterministic` runs in `sm check`, `probabilistic` runs in jobs. | Full graph (nodes + links). | `Issue[]`. |
| **Action** | Operates on one or more nodes. Dual-mode: `deterministic` (in-process code) or `probabilistic` (rendered prompt the runner executes). | Node(s), optional args. | Deterministic: report JSON. Probabilistic: rendered prompt that a runner executes. |
| **Formatter** | Serializes the graph. Deterministic-only. | Graph + optional filter. | String (ASCII / Mermaid / DOT / JSON / user-defined). |

### Provider · `kinds` catalog

Every `Provider` extension MUST declare a map `kinds: { <kind>: { schema: string, defaultRefreshAction: string } }` covering every `kind` it can classify into. Each entry has two required fields:

- **`schema`** — path to the kind's frontmatter JSON Schema, relative to the Provider's package directory. The schema MUST extend the spec's universal [`frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) via `allOf` + `$ref` to base's `$id` so cross-package resolution works without copying base into every Provider. The kernel registers each Provider's schemas with AJV at scan boot and validates each node's frontmatter against the entry that matches its classified kind.
- **`defaultRefreshAction`** — qualified action id (`<plugin-id>/<action-id>`) the UI's probabilistic-refresh surface (`🧠 prob`) dispatches for nodes of this kind. The referenced action MUST exist in the registry by the time the graph is queried; a dangling reference is a load-time error for the Provider (status `invalid-manifest`). Consumers dispatch `sm job submit <defaultRefreshAction> -n <nodePath>` when the user asks for a probabilistic refresh. Implementations MAY allow plugins to override the default per-node via `metadata.refreshAction`, but the Provider default is normative.

The catalog is the single source of truth for "which kinds does this Provider emit" — the `IProvider` runtime contract derives the kind set from `Object.keys(kinds)`. Spec 0.8.0 (Phase 3 of plug-in model overhaul) replaced two earlier fields (`emits: string[]` and a flat `defaultRefreshAction: { <kind>: actionId }`) with this richer map; the catalog also subsumes per-kind frontmatter schemas, which previously lived in spec under `schemas/frontmatter/<kind>.schema.json`.

### Provider · `explorationDir`

Every `Provider` extension MUST declare an `explorationDir: string` naming the filesystem directory (relative to user home or project root) where its content lives. Examples: `'~/.claude'` for the Claude Provider, `'~/.cursor'` for a hypothetical Cursor Provider. The kernel walks this directory during boot/scan to discover nodes; the Provider's `globs` (if declared) refines what to match inside. `sm doctor` (and `sm plugins doctor`) validates the directory exists; missing directory yields a non-blocking warning so the user sees the gap without the load failing — the Provider may legitimately precede installation of its platform.

### Extractor · output callbacks

The `Extractor` runtime contract is `extract(ctx) → void`. The extractor emits its work through three callbacks the kernel binds onto `ctx`:

- `ctx.emitLink(link)` — append a `Link` to the kernel's `links` table. The kernel validates the link against the extractor's declared `emitsLinkKinds` before persistence; off-contract links are dropped and surface as `extension.error` events. URL-shaped targets (`http(s)://…`) are partitioned out into `node.externalRefsCount` and never persisted.
- `ctx.enrichNode(partial)` — merge canonical, kernel-curated properties onto the current node's enrichment layer. **Strictly separate from the author-supplied frontmatter** (the latter remains immutable across scans). The enrichment layer is the right home for kernel-derived facts (e.g. computed titles, summaries, signals from probabilistic extractors) without polluting what the user wrote on disk.
- `ctx.store` — plugin-scoped persistence. Optional, present only when the plugin declares `storage.mode` in `plugin.json`. Shape depends on the mode (`KvStore` for mode A, scoped `Database` for mode B). See [`plugin-kv-api.md`](./plugin-kv-api.md).

Probabilistic extractors additionally receive `ctx.runner` (the `RunnerPort`) for LLM dispatch.

### Extractor · `applicableKinds` filter

Extractors MAY declare an optional `applicableKinds: string[]` on their manifest. When declared, the kernel filters fail-fast: `extract()` is invoked **only** for nodes whose `kind` appears in the list. The skip happens BEFORE the extractor context is built so a probabilistic extractor wastes zero LLM cost — and a deterministic extractor zero CPU — on inapplicable nodes. Absent (`undefined`) is the default and means "applies to every kind"; there is no wildcard syntax. An empty array (`[]`) is invalid (`minItems: 1` in the schema). Unknown kinds (no installed Provider declares them in its `kinds` catalog) are non-blocking: the extractor keeps `loaded` status and `sm plugins doctor` surfaces an informational warning so the author sees typos and missing-Provider cases, but the doctor's exit code is NOT promoted by this warning. See [`plugin-author-guide.md` §Extractor `applicableKinds`](./plugin-author-guide.md#extractor-applicablekinds--narrow-the-pipeline) for the full author-side contract.

### Extractor · trigger normalization

Extractors that emit invocation-style links (slashes, at-directives, command names) populate the `link.trigger` block defined in [`schemas/link.schema.json`](./schemas/link.schema.json):

- `originalTrigger` — the exact source text the extractor saw, byte-for-byte. Used only for display.
- `normalizedTrigger` — the output of the pipeline below. Used for equality and collision detection — the built-in `trigger-collision` rule keys on this field.

Both fields MUST be present whenever `link.trigger` is non-null. Implementations MUST produce byte-identical `normalizedTrigger` output for byte-identical input across platforms and locales.

#### Normalization pipeline (normative)

Applied in exactly this order:

1. **Unicode NFD** — canonical decomposition (`String.prototype.normalize('NFD')` in JS).
2. **Strip diacritics** — remove every code point in Unicode category `Mn` (Nonspacing_Mark).
3. **Lowercase** — locale-independent Unicode lowercase.
4. **Separator unification** — replace every hyphen (`-`), underscore (`_`), and run of whitespace (space, tab, newline, NBSP, …) with a single ASCII space.
5. **Collapse whitespace** — runs of two or more spaces become one.
6. **Trim** — strip leading and trailing whitespace.

Characters outside the separator set that are not letters or digits (e.g. `/`, `@`, `:`, `.`) are **preserved**. Stripping them is the extractor's concern, not the normalizer's — the normalizer operates on whatever the extractor classifies as "the trigger text". This keeps namespaced invocations like `/skill-map:explore` or `@my-plugin/foo` comparable in their intended form.

#### Examples

| `originalTrigger` | `normalizedTrigger` |
|---|---|
| `Hacer Review` | `hacer review` |
| `hacer-review` | `hacer review` |
| `hacer_review` | `hacer review` |
| `  hacer   review  ` | `hacer review` |
| `Clúster` | `cluster` |
| `/MyCommand` | `/mycommand` |
| `@FooExtractor` | `@fooextractor` |
| `skill-map:explore` | `skill map:explore` |

### Contract rules

1. An extension declares its kind in its module export and its manifest. Kind mismatch → load-error.
2. An extension MAY declare `preconditions` — predicates that must be satisfied for the extension to be offered (e.g., `action.requires: ["kind=skill"]`).
3. An extension MUST NOT retain state across invocations. Scoped persistence goes through `ctx.store` (storage mode `kv`) or the plugin's dedicated tables (`dedicated`). See [`plugin-kv-api.md`](./plugin-kv-api.md).
4. An extension MUST NOT import another extension directly. Cross-extension communication goes through the kernel's registry lookup.
5. An extension MUST provide a sibling test file. The reference impl treats a missing test as a contract-check failure; other impls MAY relax this to a warning.

### Locality

- **Drop-in**: extensions live inside plugins, discovered at boot from `.skill-map/plugins/<id>/` and `~/.skill-map/plugins/<id>/`.
- **Built-in**: the reference impl bundles a default extension set (one Provider, four extractors, five rules, one formatter). The fifth rule, `core/validate-all`, replays every scanned node and link through the authoritative spec schemas via AJV — the kernel-side guard against persisting non-conforming graph rows. These are loaded from `src/extensions/` and are indistinguishable from plugin-supplied extensions from the kernel's point of view.

---

## Dependency rules

The following imports are NORMATIVELY FORBIDDEN:

- `kernel/*` → any `adapters/*` module.
- `kernel/*` → `node:fs`, `node:sqlite`, `node:child_process`, or equivalent IO libraries.
- Any extension → another extension.
- Any extension → `adapters/*`.
- `cli/*` or `server/*` → `adapters/*`. Driving adapters wire adapters into the kernel at startup; they do not import adapters directly in their command code.

The following imports are permitted:

- `kernel/*` → `spec/schemas/*` (type imports, JSON Schema files at runtime).
- `adapters/*` → `kernel/*` (ports are declared in the kernel and implemented in adapters).
- `cli/*`, `server/*`, extensions → `kernel/*` (consuming kernel APIs).

---

## Testability consequences

Because the kernel depends only on ports:

- Unit tests inject `InMemoryStorageAdapter`, `FixtureFilesystemAdapter`, `MockRunner`.
- Integration tests wire real adapters.
- Conformance tests exercise the kernel directly, bypassing the CLI entirely.
- A driving adapter (CLI/Server/Skill) can be tested by asserting the kernel calls it makes, with all ports mocked.

This collapses cleanly onto the test pyramid mandated by `CLAUDE.md`: contract tests exercise kind schemas; unit tests exercise the kernel in isolation; integration tests exercise adapter pairs; CLI tests spawn the binary.

---

## Package layout (reference impl)

The spec does not prescribe package layout. The reference impl uses a single npm package with multiple `exports` entries:

```
src/
├── kernel/              Registry, Orchestrator, domain types, use cases, port interfaces
├── cli/                 Clipanion commands, thin wrappers over kernel
├── server/              Hono + WebSocket, thin wrapper over kernel
├── testkit/             Kernel mocks for plugin authors
└── adapters/
    ├── sqlite/          node:sqlite + Kysely + CamelCasePlugin (StoragePort)
    ├── filesystem/      real fs (FilesystemPort)
    ├── plugin-loader/   drop-in discovery (PluginLoaderPort)
    └── runner/          claude -p subprocess (RunnerPort)
```

Alternative implementations MAY use workspaces, separate packages, or a compiled monolith. The spec has no opinion.

---

## Driving-adapter peer rule

The CLI, Server, and Skill driving adapters are **peers**. None depends on another.

- The Server MUST NOT call the CLI (no `child_process.spawn('sm', ...)`).
- The Skill agent MUST NOT depend on the Server (it can be used offline).
- The CLI MUST NOT embed HTTP logic.

All three consume the same kernel API. Any use case a driving adapter needs MUST be available as a kernel function — if it isn't, the gap is a kernel bug, not a driving-adapter workaround.

This is what makes "CLI-first" a coherent rule: every CLI verb is a kernel function call. The UI does not reimplement business logic; it calls the same functions.

---

## See also

- [`cli-contract.md`](./cli-contract.md) — verb surface of the CLI driving adapter.
- [`db-schema.md`](./db-schema.md) — table catalog backing `StoragePort`.
- [`job-lifecycle.md`](./job-lifecycle.md) — state machine for jobs, atomic claim, TTL/reap.
- [`job-events.md`](./job-events.md) — event stream emitted through `ProgressEmitterPort`.
- [`prompt-preamble.md`](./prompt-preamble.md) — canonical injection-mitigation preamble for job files.
- [`plugin-kv-api.md`](./plugin-kv-api.md) — `ctx.store` contract for extension persistence.
- [`versioning.md`](./versioning.md) — spec/impl version independence and semver policy.
- [`interfaces/security-scanner.md`](./interfaces/security-scanner.md) — convention over the Action kind for security scanners.

---

## Stability

The **port list** is stable as of spec v1.0.0. Adding a sixth port is a major bump.

The **extension kind list** (5 kinds) is stable as of spec v1.0.0. Adding a sixth kind is a major bump.

The **execution modes** (`deterministic` / `probabilistic`) and the per-kind mode capability matrix above are stable as of spec v1.0.0. Adding a third mode or changing which kinds are dual-mode is a major bump. Renaming or repurposing the mode enum values is a major bump.

The **dependency rules** above are stable as of spec v1.0.0. Relaxing any is a major bump; tightening (forbidding an allowed import) is a minor bump.

The **Extractor · trigger normalization** pipeline (six steps, in order) is stable from the next spec release. Adding a new step at the end is a minor bump; reordering, removing, or changing any existing step (including the character classes in step 4) is a major bump. Implementations that produce different `normalizedTrigger` output for equivalent input are non-conforming.
