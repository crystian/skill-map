# Architecture

Normative description of skill-map's internal boundaries: the **kernel**, the **ports** it exposes, the **adapters** that drive and serve it, and the six **extension kinds** that live outside the kernel.

Any conforming implementation — reference or third-party — MUST respect these boundaries. The conformance suite under [`conformance/`](./conformance/README.md) enforces the kernel-agnostic invariants; per-Provider suites (e.g. `src/extensions/providers/claude/conformance/` for the reference impl's Claude Provider) enforce the kind-catalog cases. Both are driven via `sm conformance run`.

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

Executes an action against rendered job content. Returns the produced report (or an error) plus runner-side metrics (duration, tokens, exit code).

Operations: `run(jobContent, options)` → `{ report, tokensIn, tokensOut, durationMs, exitCode } | Error`.

`jobContent` is a string: the kernel reads `state_job_contents` for the job and passes the content directly. There is no on-disk job file as part of the contract — runners that need an actual file (the `claude -p` subprocess, for example) materialize a temporary file inside `run()` and remove it after spawn. The temp file is operational, not normative.

`report` is the parsed JSON the runner produced; the kernel ingests it into `state_executions.report_json`. Path-based reporting is not part of the port contract.

Two reference implementations:
- `ClaudeCliRunner` — subprocess `claude -p` with the content piped into a temp file or stdin.
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
| **Hook** | deterministic / probabilistic | declared in manifest (`mode` field, optional; defaults to `deterministic`) |
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

Six kinds, all first-class, all loaded through the same registry. Each kind has a JSON Schema describing its manifest shape under [`schemas/extensions/`](./schemas/extensions/). Implementations MUST validate every extension manifest against the schema for its declared kind at load time; validation failure → the extension is skipped with status `invalid-manifest`.

| Kind | Role | Input | Output |
|---|---|---|---|
| **Provider** | Recognizes a platform. Declares the catalog of node `kind`s it emits via the `kinds` map; each map entry pairs the kind's frontmatter schema (path relative to the Provider's package directory) with its `defaultRefreshAction` (a qualified action id that drives the probabilistic-refresh surface). Also declares the filesystem `explorationDir` where its content lives. Deterministic-only. | Filesystem walk results, candidate path. | `{ kind, provider } \| null`. |
| **Extractor** | Extracts signals from a node body. Dual-mode: `deterministic` runs in scan, `probabilistic` runs in jobs. Output flows through three context callbacks (no return value): `ctx.emitLink(link)` for the kernel's `links` table, `ctx.enrichNode(partial)` for the kernel's enrichment layer (separate from the author's frontmatter), `ctx.store` for the plugin's own KV / dedicated tables. | Parsed node (frontmatter + body) + callbacks. | `void` (output via callbacks). |
| **Rule** | Evaluates the graph. Dual-mode: `deterministic` runs in `sm check`, `probabilistic` runs in jobs. | Full graph (nodes + links). | `Issue[]`. |
| **Action** | Operates on one or more nodes. Dual-mode: `deterministic` (in-process code) or `probabilistic` (rendered prompt the runner executes). | Node(s), optional args. | Deterministic: report JSON. Probabilistic: rendered prompt that a runner executes. |
| **Formatter** | Serializes the graph. Deterministic-only. | Graph + optional filter. | String (ASCII / Mermaid / DOT / JSON / user-defined). |
| **Hook** | Reacts declaratively to one of eight curated lifecycle events (`scan.started`, `scan.completed`, `extractor.completed`, `rule.completed`, `action.completed`, `job.spawning`, `job.completed`, `job.failed`). Dual-mode: `deterministic` runs in-process during the dispatch, `probabilistic` is enqueued as a job. Hooks REACT to events; they cannot block, mutate, or steer the pipeline. | A curated event payload (run-scoped, scan-scoped, or job-scoped) plus an optional declarative `filter` map. | `void` (reactions are side effects). |

### Provider · `kinds` catalog

Every `Provider` MUST declare a non-empty map `kinds: { <kind>: { schema, defaultRefreshAction, ui } }` covering every `kind` it classifies into. Each entry carries three required fields:

- **`schema`** — path (relative to the Provider package) to the kind's frontmatter JSON Schema. The schema MUST extend [`frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) via `allOf` + `$ref` to base's `$id`. The kernel registers it with AJV at boot and validates every node's frontmatter against the entry matching its classified kind.
- **`defaultRefreshAction`** — qualified action id (`<plugin-id>/<action-id>`) the UI's probabilistic-refresh surface (`🧠 prob`) dispatches for nodes of this kind. The action MUST exist in the registry; a dangling reference disables the Provider with status `invalid-manifest`. Plugins MAY override per-node via `metadata.refreshAction`; the Provider default is normative.
- **`ui`** — presentation block: `{ label, color, colorDark?, emoji?, icon? }`. See §Provider · `ui` presentation below.

The catalog is the single source of truth for "which kinds does this Provider emit" — the `IProvider` runtime contract derives the kind set from `Object.keys(kinds)`.

### Provider · `ui` presentation

Each `kinds[*].ui` entry declares how the UI renders nodes of that kind:

- **`label`** — short human name (e.g. `'Skill'`, `'Agent'`). Used in palette chips, list view, inspector header.
- **`color`** — base color (any CSS color string) for the kind. The UI derives bg / fg tints per theme via a deterministic helper, so the Provider declares one base color per theme rather than four hex values.
- **`colorDark?`** — optional dark-theme override. Defaults to `color` when omitted.
- **`emoji?`** — optional single-glyph emoji rendered alongside the label.
- **`icon?`** — optional discriminated union: either `{ kind: 'pi'; id: 'pi-…' }` (a PrimeIcons class id) or `{ kind: 'svg'; path: '…' }` (raw SVG path data wrapped by the UI in `viewBox="0 0 24 24"` and tinted with `currentColor`). The discriminator keeps UI dispatch exhaustive without string-sniffing; AJV validates each variant cleanly.

The `ui` block is required (not optional) by design: making it optional would force the UI to invent visuals for missing entries, silently collapsing unknown kinds to a default rendering and hiding manifest gaps. Forcing the Provider to declare presentation up-front means the UI never guesses.

The kernel ships every Provider's `ui` block to the BFF at boot; the BFF aggregates them into a `kindRegistry` map and embeds it in every payload-bearing REST envelope (see [`cli-contract.md` §Server](./cli-contract.md#server)). The UI consumes `kindRegistry` directly — built-in and user-plugin kinds render identically.

### Provider · `explorationDir`

Every `Provider` extension MUST declare an `explorationDir: string` naming the filesystem directory (relative to user home or project root) where its content lives. Examples: `'~/.claude'` for the Claude Provider, `'~/.cursor'` for a hypothetical Cursor Provider. The kernel walks this directory during boot/scan to discover nodes; the Provider's `globs` (if declared) refines what to match inside. `sm doctor` (and `sm plugins doctor`) validates the directory exists; missing directory yields a non-blocking warning so the user sees the gap without the load failing — the Provider may legitimately precede installation of its platform.

### Extractor · output callbacks

The `Extractor` runtime contract is `extract(ctx) → void`. The extractor emits its work through three callbacks the kernel binds onto `ctx`:

- `ctx.emitLink(link)` — append a `Link` to the kernel's `links` table. The kernel validates the link against the extractor's declared `emitsLinkKinds` before persistence; off-contract links are dropped and surface as `extension.error` events. URL-shaped targets (`http(s)://…`) are partitioned out into `node.externalRefsCount` and never persisted.
- `ctx.enrichNode(partial)` — merge canonical, kernel-curated properties onto the current node's enrichment layer (persisted into [`node_enrichments`](./db-schema.md#node_enrichments)). **Strictly separate from the author-supplied frontmatter** (the latter remains immutable across scans). The enrichment layer is the right home for kernel-derived facts (e.g. computed titles, summaries, signals from probabilistic extractors) without polluting what the user wrote on disk. See §Enrichment layer below for the full lifecycle (per-extractor attribution, stale tracking, refresh verbs).
- `ctx.store` — plugin-scoped persistence. Optional, present only when the plugin declares `storage.mode` in `plugin.json`. Shape depends on the mode (`KvStore` for mode A, scoped `Database` for mode B). See [`plugin-kv-api.md`](./plugin-kv-api.md). The plugin author MAY opt into shape validation for their own writes by declaring `storage.schema` (Mode A) or `storage.schemas` (Mode B) in the manifest — JSON Schemas the kernel AJV-compiles at load time and runs against every `ctx.store.set(key, value)` / `ctx.store.write(table, row)` call. Absent = permissive (status quo). `emitLink` and `enrichNode` keep their universal validation against `link.schema.json` / `node.schema.json` regardless of this opt-in. See [`plugin-author-guide.md` §`outputSchema`](./plugin-author-guide.md#outputschema--opt-in-correctness-for-custom-storage-writes).

Probabilistic extractors additionally receive `ctx.runner` (the `RunnerPort`) for LLM dispatch.

### Extractor · enrichment layer

`ctx.enrichNode(partial)` is the only writable surface the Extractor pipeline has on a node. The author's frontmatter on `scan_nodes.frontmatter_json` is read-only from any Extractor — that contract holds for both deterministic and probabilistic extractors. Implementations MUST:

- Persist enrichments into a per-`(node, extractor)` table (the reference impl uses [`node_enrichments`](./db-schema.md#node_enrichments)) so attribution survives across scans.
- Preserve the author frontmatter byte-for-byte through every scan and refresh; the enrichment overlay is a SEPARATE store.
- Track stale state for probabilistic rows: when the scan loop detects `body_hash_at_enrichment != node.body_hash` for a probabilistic enrichment, mark the row stale (NOT delete it — the LLM cost is preserved). Deterministic enrichments do not need stale tracking — they regenerate via the §Extractor · fine-grained scan cache contract.

Read-side merge (`mergeNodeWithEnrichments` in the reference impl):

1. Filter to non-stale enrichments for the target node.
2. Sort by `enriched_at` ASC.
3. Spread-merge each `value` over the author frontmatter (last-write-wins per field).

Rules / `sm check` / `sm export` consume `node.frontmatter` directly (deterministic CI-safe baseline); enrichment consumption is opt-in by the caller. Stale visibility is also opt-in (`includeStale: true` in the merge helper) so the UI can render a "stale (last value: …)" marker without polluting the deterministic merge.

Refresh verbs (`sm refresh <node>` and `sm refresh --stale`) re-run the Extractor pipeline against a node or the stale set and upsert fresh enrichment rows — see [`cli-contract.md` §Scan](./cli-contract.md#scan).

### Extractor · `applicableKinds` filter

Extractors MAY declare an optional `applicableKinds: string[]` on their manifest. When declared, the kernel filters fail-fast: `extract()` is invoked **only** for nodes whose `kind` appears in the list. The skip happens BEFORE the extractor context is built so a probabilistic extractor wastes zero LLM cost — and a deterministic extractor zero CPU — on inapplicable nodes. Absent (`undefined`) is the default and means "applies to every kind"; there is no wildcard syntax. An empty array (`[]`) is invalid (`minItems: 1` in the schema). Unknown kinds (no installed Provider declares them in its `kinds` catalog) are non-blocking: the extractor keeps `loaded` status and `sm plugins doctor` surfaces an informational warning so the author sees typos and missing-Provider cases, but the doctor's exit code is NOT promoted by this warning. See [`plugin-author-guide.md` §Extractor `applicableKinds`](./plugin-author-guide.md#extractor-applicablekinds--narrow-the-pipeline) for the full author-side contract.

### Extractor · fine-grained scan cache

Implementations MAY maintain a per-`(node, extractor)` cache so that on `sm scan --changed` the orchestrator can skip rerunning an Extractor against an unchanged body when that specific Extractor already ran against the same body hash. The reference impl persists the cache in [`scan_extractor_runs`](./db-schema.md#scan_extractor_runs).

The contract the cache MUST satisfy (engine-agnostic):

- A node-level cache hit (body+frontmatter unchanged) is upgraded to a full skip ONLY when every currently-registered Extractor that applies to the node's kind has a recorded run against the prior body hash.
- A new Extractor registered between scans MUST run on the cached node — its absence from the cache is the canonical signal. The rest of the cache (existing Extractors against the same body) is preserved.
- An Extractor uninstalled between scans MUST have its cache rows removed and its sole-source links dropped. Links whose `sources` mix the uninstalled Extractor's short id with a still-cached Extractor's short id MUST be reshaped: the obsolete short id is stripped from the array and the link survives with the cached attribution intact. The persisted audit trail therefore never references a removed contributor.
- The cache is transparent to plugin authors. An Extractor cannot opt out and cannot inspect the cache; its only obligation is to be deterministic for a given body input (probabilistic Extractors run as jobs, never in scan).

This invariant is the difference between a free and a paid scan for the probabilistic Extractor model: re-running an LLM Extractor against an unchanged body would be both expensive and non-reproducible.

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

### Hook · curated trigger set

Hooks subscribe declaratively to a curated set of kernel lifecycle events and react to them. Reaction-only by design: a hook cannot mutate the pipeline, block emission, or alter outputs. The hookable trigger set is intentionally small — eight events out of the full [`job-events.md`](./job-events.md) catalog. Other events (per-node `scan.progress`, `model.delta`, `run.*`, `job.claimed`, `job.callback.received`) are deliberately NOT hookable: too verbose for a reactive surface, internal to the runner, or covered elsewhere. Declaring a trigger outside the curated set yields `invalid-manifest` at load time.

| Trigger | When it fires | Payload (key fields) | Hook scope |
|---|---|---|---|
| `scan.started` | Once at the start of every `sm scan` invocation. | `roots: string[]`. | Pre-scan setup (cache warm-up, telemetry init). |
| `scan.completed` | Once at the end of every `sm scan` invocation. | `stats: { filesWalked, nodesCount, linksCount, issuesCount, durationMs }`. | Post-scan reaction (Slack notification, CI gate, summary). |
| `extractor.completed` | Once per registered Extractor, after the full walk completes. Aggregated, NOT per-node. | `extractorId: string` (qualified). | Per-Extractor metrics, audit. |
| `rule.completed` | Once per Rule, after every issue has been validated. | `ruleId: string` (qualified). | Per-Rule alerting, downstream tooling. |
| `action.completed` | Once per Action invocation, after the report has been recorded. | `actionId: string` (qualified), `node`, `jobResult`. | Per-Action notification, integration glue. |
| `job.spawning` | Pre-spawn of a runner subprocess (job subsystem; Step 10). | `jobId`, `actionId`, spawn metadata. | Pre-flight checks, audit logging. |
| `job.spawning`, `job.completed`, `job.failed` | The three job-lifecycle hookables; same payload shapes as the [`job-events.md`](./job-events.md) entries of the same name. | See [`job-events.md` §Event catalog](./job-events.md#event-catalog). | Most common Hook surface (notifications, retries, billing). |

A hook MAY narrow further with an optional declarative `filter` map: keys are payload field paths (top-level only in v0.x); values are the literal expected match. The dispatcher walks `event.data` for each declared key and short-circuits the invocation when any value disagrees. Examples:

- `filter: { extractorId: 'core/external-url-counter' }` — invoke only when THIS extractor finishes.
- `filter: { actionId: 'claude/skill-summarizer' }` — invoke only for one Action.
- `filter: { reason: 'runner-error' }` (on `job.failed`) — invoke only when the runner crashed.

#### Mode semantics

- **Deterministic** (default): the hook's `on(ctx)` runs in-process during the dispatch of the matching event, synchronously between the event's emission and the next pipeline step. Errors are caught by the dispatcher (logged through a synthetic `extension.error` event with kind `hook-error`) and NEVER block the main pipeline. A buggy hook degrades gracefully — the scan continues.
- **Probabilistic**: the hook is enqueued as a job. Until the job subsystem ships at Step 10, probabilistic hooks load but skip dispatch with a stderr advisory. The hook still surfaces in `sm plugins list` / `sm plugins doctor`; it just does not fire today.

#### Cross-extension impact

Hooks introduce no new persisted state and do NOT participate in the deterministic scan cache (A.9). A scan that re-runs against an unchanged corpus dispatches `scan.started` / `scan.completed` exactly as before; subscribed hooks fire on every scan regardless of cache hit / miss. Hooks that need cache-aware behaviour MUST inspect their own state via `ctx.store` (declared in their plugin's manifest).

### Contract rules

1. An extension declares its kind in its module export and its manifest. Kind mismatch → load-error.
2. An extension MAY declare `preconditions` — predicates that must be satisfied for the extension to be offered (e.g., `action.requires: ["kind=skill"]`).
3. An extension MUST NOT retain state across invocations. Scoped persistence goes through `ctx.store` (storage mode `kv`) or the plugin's dedicated tables (`dedicated`). See [`plugin-kv-api.md`](./plugin-kv-api.md).
4. An extension MUST NOT import another extension directly. Cross-extension communication goes through the kernel's registry lookup.
5. An extension MUST provide a sibling test file. The reference impl treats a missing test as a contract-check failure; other impls MAY relax this to a warning.

### Locality

- **Drop-in**: extensions live inside plugins, discovered at boot from `.skill-map/plugins/<id>/` and `~/.skill-map/plugins/<id>/`.
- **Built-in**: the reference impl bundles a default extension set (one Provider, four extractors, five rules, one formatter, zero hooks). The fifth rule, `core/validate-all`, replays every scanned node and link through the authoritative spec schemas via AJV — the kernel-side guard against persisting non-conforming graph rows. The Hook kind has no built-ins at this bump; the kind exists so plugins can subscribe (concrete built-in hooks land separately when demand surfaces). These are loaded from `src/extensions/` and are indistinguishable from plugin-supplied extensions from the kernel's point of view.

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

The **extension kind list** (6 kinds: Provider, Extractor, Rule, Action, Formatter, Hook) is stable as of spec v1.0.0. Adding a seventh kind is a major bump. Removing or renaming a kind is a major bump.

The **Hook curated trigger set** (eight events: `scan.started`, `scan.completed`, `extractor.completed`, `rule.completed`, `action.completed`, `job.spawning`, `job.completed`, `job.failed`) is stable as of spec v1.0.0. Adding a ninth trigger is a minor bump; removing or renaming any of the eight is a major bump.

The **execution modes** (`deterministic` / `probabilistic`) and the per-kind mode capability matrix above are stable as of spec v1.0.0. Adding a third mode or changing which kinds are dual-mode is a major bump. Renaming or repurposing the mode enum values is a major bump.

The **dependency rules** above are stable as of spec v1.0.0. Relaxing any is a major bump; tightening (forbidding an allowed import) is a minor bump.

The **Extractor · trigger normalization** pipeline (six steps, in order) is stable from the next spec release. Adding a new step at the end is a minor bump; reordering, removing, or changing any existing step (including the character classes in step 4) is a major bump. Implementations that produce different `normalizedTrigger` output for equivalent input are non-conforming.
