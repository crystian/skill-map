# Architecture

Normative description of skill-map's internal boundaries: the **kernel**, the **ports** it exposes, the **adapters** that drive and serve it, and the six **extension kinds** that live outside the kernel.

Any conforming implementation — reference or third-party — MUST respect these boundaries. The conformance suite under `conformance/` enforces them.

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

- Transactional semantics for atomic claim (see `job-lifecycle.md`).
- Migration application with `PRAGMA user_version`-equivalent tracking.
- Read isolation sufficient to avoid phantom reads across a single scan write.

The reference impl backs this with `node:sqlite` + Kysely + `CamelCasePlugin`.

### `FilesystemPort`

Walks roots, reads node files, reports mtime/size. Abstracts away platform-specific path handling and test fixtures.

Operations: `walk(roots, ignore)`, `readNode(path)`, `stat(path)`, `writeJobFile(path, content)`, `ensureDir(path)`.

The reference impl uses real `node:fs` in production and an in-memory fixture in tests.

### `PluginLoaderPort`

Discovers plugin directories, reads `plugin.json`, checks `specCompat`, dynamically imports extension files, returns loaded extension descriptors ready to register.

Operations: `discover(scopes)`, `load(pluginPath)`, `validateManifest(json)`.

### `RunnerPort`

Executes an action against a job file. Returns a report reference (or an error) plus runner-side metrics (duration, tokens, exit code).

Operations: `run(jobFilePath, options)` → `{ reportPath, tokensIn, tokensOut, durationMs, exitCode } | Error`.

Two reference implementations:
- `ClaudeCliRunner` — subprocess `claude -p < jobfile`.
- `MockRunner` — deterministic fake for tests.

The **Skill agent** does NOT implement this port: it is a peer driving adapter (alongside CLI and Server) that runs inside an LLM session and consumes `sm job claim` + `sm record` as a kernel client. The name "Skill runner" is descriptive, not structural — only the `ClaudeCliRunner` (and its test fake) implement `RunnerPort`. See `job-lifecycle.md`.

### `ProgressEmitterPort`

Emits progress events during long operations (scans, job runs). Consumers: CLI pretty printer, `--json` ndjson, Server's WebSocket broadcaster.

Operations: `emit(event)`, `subscribe(listener)`. Events are defined in `job-events.md`.

---

## Kernel

The kernel is the only component that:
- Maintains the extension registry.
- Runs the scan orchestrator.
- Validates scan output against `scan-result.schema.json`.
- Applies the canonical prompt preamble to job files (`prompt-preamble.md`).
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

## Extension kinds

Six kinds, all first-class, all loaded through the same registry. Each kind has a JSON Schema describing its manifest shape under `spec/schemas/extensions/<kind>.schema.json`. Implementations MUST validate every extension manifest against the schema for its declared kind at load time; validation failure → the extension is skipped with status `invalid-manifest`.

| Kind | Role | Input | Output |
|---|---|---|---|
| **Adapter** | Recognizes a platform. Decides which files are nodes and what kind they are. Declares per-kind `defaultRefreshAction` (an action id that drives the probabilistic-refresh surface). | Filesystem walk results, candidate path. | `{ kind, adapter } \| null`. |
| **Detector** | Extracts signals from a node body. | Parsed node (frontmatter + body). | `Link[]`. |
| **Rule** | Evaluates the graph. | Full graph (nodes + links). | `Issue[]`. |
| **Action** | Operates on one or more nodes. Two modes: `local` (code) or `invocation-template` (LLM prompt). | Node(s), optional args. | Local: report JSON. Template: rendered prompt that a runner executes. |
| **Audit** | Deterministic workflow that composes rules and actions. Produces a structured report. | Graph + optional scope filter. | Audit report (hardcoded shape, kind-specific). |
| **Renderer** | Serializes the graph. | Graph + optional filter. | String (ASCII / Mermaid / DOT / JSON / user-defined). |

### Adapter · `defaultRefreshAction`

Every `Adapter` extension MUST declare a map `defaultRefreshAction: { <kind>: <actionId> }` covering every `kind` it emits. The referenced action MUST exist in the registry by the time the graph is queried; a dangling reference is a load-time error for the adapter. Consumers (CLI `🧠 prob` buttons in `sm show`, Web UI inspector) dispatch `sm job submit <defaultRefreshAction[kind]> -n <nodePath>` when the user asks for a probabilistic refresh on a node. Implementations MAY allow plugins to override the default per-node via `metadata.refreshAction`, but the adapter default is normative.

### Contract rules

1. An extension declares its kind in its module export and its manifest. Kind mismatch → load-error.
2. An extension MAY declare `preconditions` — predicates that must be satisfied for the extension to be offered (e.g., `action.requires: ["kind=skill"]`).
3. An extension MUST NOT retain state across invocations. Scoped persistence goes through `ctx.store` (storage mode `kv`) or the plugin's dedicated tables (`dedicated`).
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

## Stability

The **port list** is stable as of spec v1.0.0. Adding a sixth port is a major bump.

The **extension kind list** (6 kinds) is stable as of spec v1.0.0. Adding a seventh kind is a major bump.

The **dependency rules** above are stable as of spec v1.0.0. Relaxing any is a major bump; tightening (forbidding an allowed import) is a minor bump.
