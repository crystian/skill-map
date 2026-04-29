# Architecture

Normative description of skill-map's internal boundaries: the **kernel**, the **ports** it exposes, the **adapters** that drive and serve it, and the six **extension kinds** that live outside the kernel.

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

In addition, the loader **qualifies every extension** with its owning plugin id before registering it. The registry stores extensions under the qualified id `<plugin-id>/<extension-id>` (e.g. `claude/slash`, `core/broken-ref`, `hello-world/greet`). Authors continue to declare the short `id` in each extension manifest; the loader composes the qualified form from `manifest.id` at load time. Built-in extensions bundled with the reference impl declare their `pluginId` directly in `built-ins.ts` — `core/` for kernel-internal primitives (rules, the renderer, the audit, the external-url-counter detector) and `claude/` for the Claude provider bundle (the adapter and its kind-aware detectors). If a plugin author injects a `pluginId` field on an extension that disagrees with `plugin.json`'s `id`, the loader emits `invalid-manifest` with a directed reason.

Each plugin (and each built-in bundle) declares a **granularity** that controls how its extensions are toggled. `granularity: 'bundle'` (the default) means the plugin id is the only enable/disable key; `granularity: 'extension'` means each extension is independently toggle-able under its qualified id. The loader's pre-import `resolveEnabled(pluginId)` short-circuit is always coarse (bundle level) — when a granularity=`extension` bundle is partially enabled, the import work proceeds and the runtime composer (the CLI's `composeScanExtensions` / `composeRenderers` in `src/cli/util/plugin-runtime.ts`) drops the disabled extensions before they reach the orchestrator. The two built-in bundles split deliberately: `claude` is granularity=`bundle` (provider-level toggle), `core` is granularity=`extension` (every kernel built-in is removable, satisfying §Boot invariant: "no extension is privileged"). See [`plugin-author-guide.md` §Granularity — bundle vs extension](./plugin-author-guide.md#granularity--bundle-vs-extension) for the author-facing summary.

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
- Know which adapter produced an event.
- Know which platform a node belongs to (that is the `Adapter` extension's job).
- Contain any platform-specific branching (e.g., `if (platform === 'claude')`).

### Boot invariant

**With all extensions removed, the kernel MUST boot and return an empty graph.** This is enforced by the conformance suite case `kernel-empty-boot`.

No extension is privileged. The Claude adapter ships bundled with the reference impl but is removable, same as any third-party plugin.

---

## Execution modes

Every analytical extension in skill-map is one of two **modes**:

- **`deterministic`** — pure code. Same input → same output, every run.
- **`probabilistic`** — calls an LLM through the kernel's `RunnerPort`. Output may vary across runs; cost and latency are non-trivial.

Mode is a property of the extension as a whole, not of an individual call. **An extension is one mode or the other; it cannot switch at runtime.** If a plugin author needs both flavors of the same idea (regex-based AND LLM-based "find suspicious imports"), they ship two extensions with distinct ids.

### Which kinds support which modes

| Kind | Modes | How mode is set |
|---|---|---|
| **Detector** | deterministic / probabilistic | declared in manifest (`mode` field, optional; defaults to `deterministic`) |
| **Rule** | deterministic / probabilistic | declared in manifest (`mode` field, optional; defaults to `deterministic`) |
| **Action** | deterministic / probabilistic | declared in manifest (`mode` field, **required** — no default) |
| **Audit** | deterministic / probabilistic | derived from `composes[]` (see below) |
| **Adapter** | deterministic-only | implicit; `mode` field MUST NOT appear |
| **Renderer** | deterministic-only | implicit; `mode` field MUST NOT appear |

Adapter and Renderer are locked to deterministic because they sit at the **boundaries** of the system. An adapter resolves `path → kind` during boot; probabilistic classification would make the boot phase slow, costly, and non-reproducible. A renderer must produce diffable output (`sm scan` snapshots round-trip in CI). Probabilistic narrators of the graph are a valid product but they live in jobs and emit Findings, not in renderers.

### Audit · derived mode

An audit is a **composer**: it declares which primitives it runs and the kernel handles dispatch. The audit manifest does NOT carry a `mode` field. Instead it declares `composes[]` — the rule and action references the audit executes in sequence. At load time the kernel resolves each entry and computes the audit's **effective mode**:

- If every composed primitive is `deterministic` → the audit's effective mode is `deterministic`. Runs synchronously inside `sm audit <id>`.
- If any composed primitive is `probabilistic` → the audit's effective mode is `probabilistic`. Dispatches as a job via `sm job submit audit:<id>`.

A dangling reference in `composes[]` (the id doesn't resolve, the kind is wrong, or the primitive is disabled) is a **load-time error**. The audit is rejected with status `invalid-manifest`, not silently skipped. This matches the rule already in place for `defaultRefreshAction`. Declaring `mode` directly on an audit manifest is also a load-time error.

The effective mode is exposed to the UI and to `sm audit show <id>` so consumers can preview cost before invoking.

### When each mode runs

- **Deterministic extensions** run synchronously inside the standard kernel pipelines (`sm scan`, `sm check`, `sm list`). Fast, free, reproducible. CI-safe.
- **Probabilistic extensions** never run during `sm scan`. They are dispatched as **jobs** via `sm job submit <kind>:<id>`. Jobs are async, queued, persisted under `state_jobs`, and resume on next boot. The same scan snapshot can be re-analyzed by probabilistic extensions on demand without re-walking the filesystem.

This separation is normative: a probabilistic extension cannot register a hook that fires from `sm scan`. The kernel rejects it at load time.

### How probabilistic extensions invoke the LLM

The kernel exposes the LLM through the `RunnerPort` (see §Ports above). Reference impl: `ClaudeCliRunner`. Tests: `MockRunner`. Other adapters (OpenAI, local Ollama, etc.) implement the same port without spec changes.

A probabilistic extension receives the runner in its invocation context alongside `ctx.store`. The extension never imports a specific LLM SDK — the runner contract is what the spec normalizes; wire format and model selection are adapter concerns.

---

## Extension kinds

Six kinds, all first-class, all loaded through the same registry. Each kind has a JSON Schema describing its manifest shape under [`schemas/extensions/`](./schemas/extensions/). Implementations MUST validate every extension manifest against the schema for its declared kind at load time; validation failure → the extension is skipped with status `invalid-manifest`.

| Kind | Role | Input | Output |
|---|---|---|---|
| **Adapter** | Recognizes a platform. Decides which files are nodes and what kind they are. Declares per-kind `defaultRefreshAction` (an action id that drives the probabilistic-refresh surface). Deterministic-only. | Filesystem walk results, candidate path. | `{ kind, adapter } \| null`. |
| **Detector** | Extracts signals from a node body. Dual-mode: `deterministic` runs in scan, `probabilistic` runs in jobs. | Parsed node (frontmatter + body). | `Link[]`. |
| **Rule** | Evaluates the graph. Dual-mode: `deterministic` runs in `sm check`, `probabilistic` runs in jobs. | Full graph (nodes + links). | `Issue[]`. |
| **Action** | Operates on one or more nodes. Dual-mode: `deterministic` (in-process code) or `probabilistic` (rendered prompt the runner executes). | Node(s), optional args. | Deterministic: report JSON. Probabilistic: rendered prompt that a runner executes. |
| **Audit** | Workflow that composes rules and actions. Effective mode is derived from `composes[]` — deterministic if all composed primitives are deterministic, probabilistic otherwise. Produces a structured report. | Graph + optional scope filter. | Audit report (hardcoded shape, kind-specific). |
| **Renderer** | Serializes the graph. Deterministic-only. | Graph + optional filter. | String (ASCII / Mermaid / DOT / JSON / user-defined). |

### Adapter · `defaultRefreshAction`

Every `Adapter` extension MUST declare a map `defaultRefreshAction: { <kind>: <actionId> }` covering every `kind` it emits. The referenced action MUST exist in the registry by the time the graph is queried; a dangling reference is a load-time error for the adapter. Consumers (CLI `🧠 prob` buttons in `sm show`, Web UI inspector) dispatch `sm job submit <defaultRefreshAction[kind]> -n <nodePath>` when the user asks for a probabilistic refresh on a node. Implementations MAY allow plugins to override the default per-node via `metadata.refreshAction`, but the adapter default is normative.

### Detector · `applicableKinds` filter

Detectors MAY declare an optional `applicableKinds: string[]` on their manifest. When declared, the kernel filters fail-fast: `detect()` is invoked **only** for nodes whose `kind` appears in the list. The skip happens BEFORE the detect context is built so a probabilistic detector wastes zero LLM cost — and a deterministic detector zero CPU — on inapplicable nodes. Absent (`undefined`) is the default and means "applies to every kind"; there is no wildcard syntax. An empty array (`[]`) is invalid (`minItems: 1` in the schema). Unknown kinds (no installed Adapter declares them via `defaultRefreshAction`) are non-blocking: the detector keeps `loaded` status and `sm plugins doctor` surfaces an informational warning so the author sees typos and missing-Provider cases, but the doctor's exit code is NOT promoted by this warning. See [`plugin-author-guide.md` §Detector `applicableKinds`](./plugin-author-guide.md#detector-applicablekinds--narrow-the-pipeline) for the full author-side contract.

### Detector · trigger normalization

Detectors that emit invocation-style links (slashes, at-directives, command names) populate the `link.trigger` block defined in [`schemas/link.schema.json`](./schemas/link.schema.json):

- `originalTrigger` — the exact source text the detector saw, byte-for-byte. Used only for display.
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

Characters outside the separator set that are not letters or digits (e.g. `/`, `@`, `:`, `.`) are **preserved**. Stripping them is the detector's concern, not the normalizer's — the normalizer operates on whatever the detector classifies as "the trigger text". This keeps namespaced invocations like `/skill-map:explore` or `@my-plugin/foo` comparable in their intended form.

#### Examples

| `originalTrigger` | `normalizedTrigger` |
|---|---|
| `Hacer Review` | `hacer review` |
| `hacer-review` | `hacer review` |
| `hacer_review` | `hacer review` |
| `  hacer   review  ` | `hacer review` |
| `Clúster` | `cluster` |
| `/MyCommand` | `/mycommand` |
| `@FooDetector` | `@foodetector` |
| `skill-map:explore` | `skill map:explore` |

### Contract rules

1. An extension declares its kind in its module export and its manifest. Kind mismatch → load-error.
2. An extension MAY declare `preconditions` — predicates that must be satisfied for the extension to be offered (e.g., `action.requires: ["kind=skill"]`).
3. An extension MUST NOT retain state across invocations. Scoped persistence goes through `ctx.store` (storage mode `kv`) or the plugin's dedicated tables (`dedicated`). See [`plugin-kv-api.md`](./plugin-kv-api.md).
4. An extension MUST NOT import another extension directly. Cross-extension communication goes through the kernel's registry lookup.
5. An extension MUST provide a sibling test file. The reference impl treats a missing test as a contract-check failure; other impls MAY relax this to a warning.

### Locality

- **Drop-in**: extensions live inside plugins, discovered at boot from `.skill-map/plugins/<id>/` and `~/.skill-map/plugins/<id>/`.
- **Built-in**: the reference impl bundles a default extension set (one adapter, three detectors, three rules, one audit, one renderer). These are loaded from `src/extensions/` and are indistinguishable from plugin-supplied extensions from the kernel's point of view.

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

The **extension kind list** (6 kinds) is stable as of spec v1.0.0. Adding a seventh kind is a major bump.

The **execution modes** (`deterministic` / `probabilistic`) and the per-kind mode capability matrix above are stable as of spec v1.0.0. Adding a third mode, changing which kinds are dual-mode, or changing the audit's mode-derivation rule is a major bump. Renaming or repurposing the mode enum values is a major bump.

The **dependency rules** above are stable as of spec v1.0.0. Relaxing any is a major bump; tightening (forbidding an allowed import) is a minor bump.

The **Detector · trigger normalization** pipeline (six steps, in order) is stable from the next spec release. Adding a new step at the end is a minor bump; reordering, removing, or changing any existing step (including the character classes in step 4) is a major bump. Implementations that produce different `normalizedTrigger` output for equivalent input are non-conforming.
