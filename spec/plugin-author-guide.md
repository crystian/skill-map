# Plugin author guide

How to ship a third-party `skill-map` plugin: directory layout, manifest fields, the six extension kinds, storage choice, version compatibility, dual-mode posture, and how to test the result with `@skill-map/testkit`.

This guide is **descriptive prose**, not the normative contract. The normative pieces live in the schemas and the architecture document — every claim here is cross-linked to its source. When the two disagree, [`architecture.md`](./architecture.md) wins.

> **Status.** Ships with spec v1.0.0. The author surface is intended to stay stable through the v1.x line; widening (new extension kind, new storage mode) is a minor bump per [`versioning.md`](./versioning.md).

---

## Quick start

```text
my-plugin/
├── plugin.json            ← manifest (required)
└── extensions/
    └── extractor.js      ← one file per declared extension
```

```jsonc
// my-plugin/plugin.json
{
  "id": "my-plugin",
  "version": "1.0.0",
  "specCompat": "^1.0.0",
  "extensions": ["./extensions/extractor.js"]
}
```

```javascript
// my-plugin/extensions/extractor.js
export default {
  id: 'my-extractor',
  kind: 'extractor',
  version: '1.0.0',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'high',
  scope: 'body',
  extract(ctx) {
    // ctx.node, ctx.body, ctx.frontmatter, ctx.emitLink, ctx.enrichNode
    // Output flows through the callbacks; the method returns void.
    ctx.emitLink({
      source: ctx.node.path,
      target: 'something.md',
      kind: 'references',
      confidence: 'high',
      sources: ['my-extractor'],
    });
  },
};
```

Drop the directory under one of the discovery roots and `sm plugins list` will pick it up.

---

## Discovery

The kernel scans two roots, in this order:

1. `<project>/.skill-map/plugins/` — committed-with-the-repo plugins.
2. `~/.skill-map/plugins/` — user-level plugins available across every project.

A plugin is any direct child directory containing a `plugin.json`. Nested directories are not searched recursively. Pass `--plugin-dir <path>` to override both roots (mostly for testing).

After every change to the `plugins/` folder, run `sm plugins list` to see the load status of each. The six statuses are documented under [Diagnostics](#diagnostics) below.

### Plugin id uniqueness

The `id` declared in `plugin.json` is **globally unique** across every active discovery root. The kernel enforces this in two places:

1. **Directory name MUST equal manifest id.** A plugin lives at `<root>/<id>/plugin.json`. If `basename(<plugin-dir>) !== manifest.id`, discovery surfaces the plugin with status `invalid-manifest` and a reason naming both names. This rule eliminates same-root collisions by construction (a filesystem cannot host two siblings with the same name).
2. **Cross-root id collisions are blocked, both sides.** If two plugins from different roots (project + global, or any combination of `--plugin-dir`) declare the same `id`, **both** receive status `id-collision`. There is no precedence rule — neither plugin loads its extensions; the user resolves the conflict by renaming one and rerunning. Coherent with the spec rule that no extension is privileged.

`sm plugins list` shows the conflict; `sm plugins doctor` exits `1` whenever any `id-collision` is present.

### Qualified extension ids

Every extension is identified in the registry — and in any cross-extension reference — by its **qualified id** `<plugin-id>/<extension-id>`. The plugin's manifest `id` is therefore not just a discovery key: it doubles as the **namespace** for every extension the plugin ships.

Concrete examples for the reference impl's bundled extensions:

| Extension | Short id (in the file) | Qualified id (in the registry) |
|---|---|---|
| Claude Provider | `claude` | `claude/claude` |
| Frontmatter extractor | `frontmatter` | `claude/frontmatter` |
| Slash extractor | `slash` | `claude/slash` |
| At-directive extractor | `at-directive` | `claude/at-directive` |
| External-URL counter | `external-url-counter` | `core/external-url-counter` |
| Broken-ref rule | `broken-ref` | `core/broken-ref` |
| Trigger-collision rule | `trigger-collision` | `core/trigger-collision` |
| ASCII formatter | `ascii` | `core/ascii` |
| Validate-all rule | `validate-all` | `core/validate-all` |

Two namespaces are convention for built-ins:

- **`core/`** — kernel-internal primitives (every built-in rule including `validate-all`, the ASCII formatter, the external-URL counter extractor). Platform-agnostic.
- **`claude/`** — the Claude Code Provider bundle (the Provider plus the three extractors that decode Claude-specific syntax: frontmatter, slash, `@`-directive).

For your own plugin, the `id` you declare in `plugin.json` is the namespace for every extension the plugin contains. If your manifest declares `id: "my-plugin"` and your extension file declares `id: "foo-extractor"`, the kernel registers it as `my-plugin/foo-extractor`. You do **not** write the qualifier yourself — the loader injects it.

What this means in practice:

- **In the extension file**, declare only the short id (`id: "greet"`). Do **not** prefix it with the plugin id (`id: "my-plugin/greet"` is rejected as a kebab-case violation).
- **In the manifest's `extensions[]`**, list relative paths to extension files as before — nothing changes.
- **In `defaultRefreshAction` (Provider)** and any other cross-extension reference, use the qualified id of the target. A built-in Provider that wants the `core/summarize-agent` action references it by the qualified form; a third-party Provider that wants its own bundled action references `<my-plugin>/<my-action>`.
- **`sm plugins list` and `sm plugins show`** print qualified ids for every extension. The plugin id itself stays unqualified (it IS the namespace; nothing wraps it).
- **`sm plugins enable/disable <id>`** still operates on the **plugin id** (the namespace), not on individual extensions. Toggle the namespace and every extension under it follows.

The kernel guards against two foot-guns:

- If the extension file injects a `pluginId` field that doesn't match `plugin.json#/id`, the loader emits `invalid-manifest` with a directed reason. The composed qualifier MUST come from `plugin.json` — there is no second source of truth.
- The kebab-case pattern on the extension `id` deliberately forbids `/`. This keeps the rule "the qualifier always lives in the plugin id, never in the extension id" enforced by AJV.

For built-ins, the reference impl's `src/extensions/built-ins.ts` declares each extension's `pluginId` (`core` or `claude`) explicitly — built-ins do not have a `plugin.json`, so the bundle declaration IS the source of truth for their namespace.

### Granularity — bundle vs extension

Every plugin and every built-in bundle declares a **granularity** that controls how its extensions are toggled by `sm plugins enable / disable` and by `config_plugins` / `settings.json`. Two modes:

| Granularity | Toggle key | When to use |
|---|---|---|
| `bundle` (default) | the bundle id alone (e.g. `my-plugin`, `claude`) | The plugin's extensions form a coherent product (e.g. a Provider and the extractors that decode its native syntax). The user wants one switch. **95% of plugins.** |
| `extension` | the qualified extension id (`<bundle>/<ext-id>`, e.g. `core/superseded`, `my-plugin/orphan-skill`) | The plugin ships several orthogonal capabilities a user might reasonably want piecemeal. **Built-in `core` is the canonical example** — the spec promises every kernel built-in is removable, so each one toggles independently. |

Built-in mapping:

- **`claude`** — `granularity: 'bundle'`. `sm plugins disable claude` flips the Provider and the three Claude-specific extractors at once.
- **`core`** — `granularity: 'extension'`. `sm plugins disable core/superseded` flips just the supersession rule; the other six core extensions (the four other rules, the ASCII formatter, the external-URL counter extractor) stay live.

Per-verb behaviour:

| Command | Bundle granularity | Extension granularity |
|---|---|---|
| `sm plugins enable claude` | OK — flips the bundle. | Rejected: `'core' has granularity=extension; use sm plugins enable core/<ext-id>`. |
| `sm plugins enable claude/slash` | Rejected: `'claude' has granularity=bundle; use sm plugins enable claude`. | n/a (no bundle of granularity=bundle accepts qualified ids) |
| `sm plugins disable core` | n/a | Rejected: same directed message as the bundle row above. |
| `sm plugins disable core/superseded` | n/a | OK — persists `config_plugins['core/superseded'].enabled = 0`. |

Resolution order is the same as for plugin enabled-state: DB override (`config_plugins`) > settings.json (`#/plugins/<id>/enabled`) > installed default (`true`). For granularity=extension bundles the row key is the qualified id; for granularity=bundle bundles the row key is the bundle id. `settings.json#/plugins` keys are arbitrary strings (no AJV pattern), so both forms are accepted there too.

`sm plugins enable/disable --all` operates only on top-level bundle ids (the default-enabled set every user can see); it never expands to qualified `<bundle>/<ext>` keys. The "disable every kernel built-in at once" intent is served by `--no-built-ins` on `sm scan` and friends; `--all` is the macro on user-toggle-able units, not on every individual extension.

In your own plugin's `plugin.json`, set `granularity` only when you opt into the per-extension form:

```jsonc
{
  "id": "my-multi-tool",
  "version": "1.0.0",
  "specCompat": "^1.0.0",
  "granularity": "extension",
  "extensions": [
    "./extensions/orphan-skill-rule.js",
    "./extensions/csv-formatter.js"
  ]
}
```

The default (`'bundle'`) is the right answer for almost every plugin — keep the manifest minimal until the plugin actually ships several independent capabilities.

### Extractor `applicableKinds` — narrow the pipeline

An `Extractor` extension MAY declare an `applicableKinds` array on its manifest. When declared, the kernel runs the extractor **only** against nodes whose `kind` is in the list — the filter is fail-fast (no extractor context, no method call) so a probabilistic extractor wastes zero LLM cost (and a deterministic extractor zero CPU) on nodes it cannot meaningfully process.

| `applicableKinds` | Behaviour |
|---|---|
| Absent (`undefined`) | **Default.** The extractor runs on every kind the loaded Providers emit. |
| `['skill']` | Runs only on skill nodes. |
| `['skill', 'agent']` | Runs on skills + agents. Hooks, commands, notes are skipped. |
| `[]` | **Invalid.** AJV rejects the manifest at load time (`minItems: 1`). The absence of the field already means "every kind"; an empty array is reserved for "this is a typo". |

There is no wildcard syntax (no `'*'`) — omitting the field IS the wildcard. The pattern is intentional: a literal absence is unambiguous, a string sentinel would invite typos that silently disable the extractor.

Use case — a probabilistic tag-inferrer that only makes sense for skills:

```javascript
export default {
  id: 'tag-inferrer',
  kind: 'extractor',
  mode: 'probabilistic',
  version: '1.0.0',
  description: 'LLM-derived tag links for skill nodes.',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'medium',
  scope: 'body',
  applicableKinds: ['skill'],
  async extract(ctx) {
    // Never invoked for agents, commands, hooks, or notes — the kernel
    // skipped this node before reaching us.
    const tags = await ctx.runner.invoke({ /* prompt … */ });
    for (const t of tags) {
      ctx.emitLink({
        source: ctx.node.path,
        target: t.path,
        kind: 'references',
        confidence: 'medium',
        sources: ['tag-inferrer'],
      });
    }
  },
};
```

**Unknown kinds are non-blocking.** An extractor that lists a kind no installed Provider declares (typo, missing Provider plugin) still loads with status `loaded`; `sm plugins doctor` surfaces an informational warning so the author sees the mismatch. The exit code of `doctor` is NOT promoted to 1 by this warning — the corresponding Provider may legitimately arrive later (e.g. when the user installs the matching plugin), and the load contract favours forward compatibility over rigid checks. The full set of "known kinds" is the union of every installed Provider's `defaultRefreshAction` keys.

---

## Manifest

Required fields (see [`schemas/plugins-registry.schema.json#/$defs/PluginManifest`](./schemas/plugins-registry.schema.json) for the normative shape):

| Field | Type | Notes |
|---|---|---|
| `id` | kebab-case string | Globally unique. Pattern: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. |
| `version` | semver | Plugin version, independent of `specCompat`. |
| `specCompat` | semver range | Spec versions this plugin is compatible with. Checked via `semver.satisfies(specVersion, this)` at load time. |
| `extensions` | string[] | Relative paths to extension files. Each file's default export is the extension's runtime instance. `minItems: 1`. |

Optional fields:

| Field | Type | Notes |
|---|---|---|
| `description` | string | One-line summary shown in `sm plugins list`. |
| `granularity` | `'bundle' \| 'extension'` | Controls how `sm plugins enable / disable` operates on this plugin. Default `'bundle'`. See [Granularity — bundle vs extension](#granularity--bundle-vs-extension). |
| `storage` | object | `{ "mode": "kv" }` or `{ "mode": "dedicated", "tables": [...], "migrations": [...] }`. Absent means the plugin does not persist state. |
| `author` | string | Free-form. |
| `license` | string | SPDX identifier. |
| `homepage` | string | URL. |
| `repository` | string | URL. |

### `specCompat` strategy

Pre-`v1.0.0` of the spec, narrow ranges are the defensive default — minor bumps **MAY** carry breaking changes per [`versioning.md`](./versioning.md). A plugin that spans minor boundaries can load successfully and crash at first use against a changed schema.

After the spec hits v1.0.0, the recommended ranges are:

- `"^1.0.0"` — most plugins. Loads against any v1.x.
- `">=1.0.0 <2.0.0"` — equivalent, more explicit.
- A pre-release pin (`"^1.0.0-beta.5"`) — only when you depend on a feature added between minors.

Authors who explicitly review each minor's changelog **MAY** widen across the next major (`"^1.0.0 || ^2.0.0"`) at their own risk.

---

## The six extension kinds

The kernel knows six categories. Four are dual-mode (deterministic or probabilistic per [`architecture.md` §Execution modes](./architecture.md)); two are deterministic-only because they sit at the system boundaries.

| Kind | Method | Receives | Returns | Mode |
|---|---|---|---|---|
| `provider` | `walk(roots, opts)` | filesystem roots | `IRawNode[]` | deterministic only |
| `extractor` | `extract(ctx)` | one node + body + frontmatter + callbacks | `void` (output via `ctx.emitLink` / `ctx.enrichNode` / `ctx.store`) | dual-mode |
| `rule` | `evaluate(ctx)` | full graph | `Issue[]` | dual-mode |
| `action` | `run(ctx)` | one or more nodes | execution record | dual-mode |
| `formatter` | `format(ctx)` | full graph | `string` | deterministic only |
| `hook` | `on(ctx)` | a curated lifecycle event payload | `void` (reactions are side effects) | dual-mode |

The runtime instance you `export default` from an extension file MUST include both the manifest fields (id, kind, version, plus kind-specific metadata) AND the runtime method. The kernel strips function-typed properties before AJV-validating the manifest shape, so `extract` / `evaluate` / etc. live alongside metadata without confusing the schema.

### Extractors

Pure single-node analysis. **Never** read another node, the graph, or the database — cross-node reasoning is for rules. Spec at [`schemas/extensions/extractor.schema.json`](./schemas/extensions/extractor.schema.json).

The runtime method is `extract(ctx) → void`. Output flows through three callbacks the kernel binds onto the context:

- **`ctx.emitLink(link)`** — append a `Link` to the kernel's `links` table. The kernel validates against the extractor's declared `emitsLinkKinds` before persistence; off-contract kinds are dropped and surface as `extension.error` events. URL-shaped targets are partitioned into `node.externalRefsCount` and never persisted.
- **`ctx.enrichNode(partial)`** — merge canonical, kernel-curated properties onto the node's enrichment layer (persisted into `node_enrichments` per `db-schema.md`). **Strictly separate from the author-supplied frontmatter** — the latter is IMMUTABLE from any Extractor. Use the enrichment layer for facts the author did not write but the extractor inferred (computed titles, summaries, signals from probabilistic extractors). Probabilistic enrichments track `body_hash_at_enrichment`; when the scan loop sees a body change, those rows are flagged `stale = 1` (NOT deleted, preserving the LLM cost paid to produce them) and surface for refresh via `sm refresh <node>` or `sm refresh --stale`. Deterministic enrichments simply pisar via PRIMARY KEY conflict on the next re-extract through the A.9 cache and are never stale-flagged.
- **`ctx.store`** — plugin-scoped persistence. Optional, only present when your `plugin.json` declares `storage.mode`. Shape depends on the mode (`KvStore` for mode A, scoped `Database` for mode B). See [`plugin-kv-api.md`](./plugin-kv-api.md).

A probabilistic extractor additionally receives `ctx.runner` (the `RunnerPort`) for LLM dispatch.

> **Pick a syntax that doesn't collide with built-ins.** The built-in `at-directive` extractor fires on any `@token`; the built-in `slash` extractor fires on any `/token`. A new extractor that also matches one of those prefixes will likely fire on the same input, and if the two emit different `target` shapes the kernel raises a `trigger-collision` error. The example below uses a wikilink-style `[[ref:<name>]]` pattern to side-step this; reserve `@` and `/` for the built-ins.

```javascript
import { normalizeTrigger } from '@skill-map/cli';

export default {
  id: 'ref-extractor',
  kind: 'extractor',
  version: '1.0.0',
  description: 'Extracts [[ref:<name>]] tokens from the body.',
  stability: 'experimental',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'medium',
  scope: 'body',
  extract(ctx) {
    for (const m of ctx.body.matchAll(/\[\[ref:([a-z0-9-]+)\]\]/gi)) {
      ctx.emitLink({
        source: ctx.node.path,
        target: m[1],
        kind: 'references',
        confidence: 'medium',
        sources: ['ref-extractor'],
        trigger: { originalTrigger: m[0], normalizedTrigger: m[0].toLowerCase() },
      });
    }
    // Optional: emit a canonical title onto the enrichment layer.
    // ctx.enrichNode({ title: 'Computed title' });
  },
};
```

> **Migration note (spec 0.8.x).** This kind was previously named `Detector` with a `detect(ctx) → Link[]` signature. The rename to `Extractor` and the move to callback-based output landed as a single breaking minor in the pre-1.0 line. The mechanical migration: rename `kind: 'detector'` → `kind: 'extractor'`, rename `detect` → `extract`, replace `return links` with `for (const l of links) ctx.emitLink(l)`. The `applicableKinds`, `emitsLinkKinds`, `defaultConfidence`, and `scope` fields are unchanged.

### Rules

Cross-node reasoning over the merged graph. Run after every Provider and extractor has completed. Spec at [`schemas/extensions/rule.schema.json`](./schemas/extensions/rule.schema.json).

Rules are dual-mode (`deterministic` default; `probabilistic` opt-in via the manifest). Deterministic rules run synchronously inside `sm scan` / `sm check` — same CI-safe baseline as today. Probabilistic rules are dispatched as queued jobs via the kernel's `RunnerPort`; they NEVER participate in the deterministic scan-time pipeline. Until the job subsystem ships at Step 10 the dispatch is stubbed: `sm scan` always skips probabilistic rules silently, and `sm check` exposes them via the opt-in `--include-prob` flag — the verb loads the plugin runtime, finds the registered prob rules (filtered by `--rules` and `-n` if set), and emits a stderr advisory naming them. The flag default is unchanged: deterministic-only, CI-safe. The `--async` companion is reserved for the future encoding (returns job ids without waiting once jobs land); today it is a no-op the advisory simply mentions. The flag does NOT extend to `sm scan` or `sm list`.

```javascript
export default {
  id: 'orphan-skill',
  kind: 'rule',
  version: '1.0.0',
  description: 'Flags skill nodes with zero inbound links.',
  evaluate(ctx) {
    const inboundCount = new Map();
    for (const link of ctx.links) {
      inboundCount.set(link.target, (inboundCount.get(link.target) ?? 0) + 1);
    }
    return ctx.nodes
      .filter((n) => n.kind === 'skill' && (inboundCount.get(n.path) ?? 0) === 0)
      .map((n) => ({
        ruleId: 'orphan-skill',
        severity: 'info',
        message: `Skill ${n.path} has no inbound references.`,
        nodeIds: [n.path],
      }));
  },
};
```

### Formatters

Graph-to-string serializers. Invoked by `sm graph --format <name>`. Output **MUST** be byte-deterministic for the same input graph (the snapshot-test suite relies on this). Spec at [`schemas/extensions/formatter.schema.json`](./schemas/extensions/formatter.schema.json).

The manifest field `formatId` carries the identifier the user types on the command line (matching `sm graph --format <name>`); the runtime method `format(ctx)` produces the serialized output. The split is deliberate: the method reads naturally as `Formatter.format()`, and the field is the lookup key used by the kernel.

```javascript
export default {
  id: 'csv-formatter',
  kind: 'formatter',
  version: '1.0.0',
  formatId: 'csv',
  contentType: 'text/csv',
  format(ctx) {
    const rows = ['source,target,kind,confidence'];
    for (const link of ctx.links) {
      rows.push([link.source, link.target, link.kind, link.confidence].join(','));
    }
    return rows.join('\n');
  },
};
```

### Hooks

Declarative subscribers to a curated set of kernel lifecycle events. Use case: notification (Slack on `job.completed`), integration glue (CI webhook on `job.failed`), and bookkeeping (per-extractor metrics). Spec at [`schemas/extensions/hook.schema.json`](./schemas/extensions/hook.schema.json) and the trigger semantics at [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set).

The runtime method is `on(ctx) → void`. The hook reacts to events; it cannot mutate the pipeline or alter outputs. Errors are caught by the kernel's dispatcher (logged as `extension.error` with `kind: 'hook-error'`) and NEVER block the main flow — a buggy hook degrades gracefully.

The eight hookable triggers (declaring any other event yields `invalid-manifest` at load time):

1. `scan.started` — pre-scan setup (one per scan).
2. `scan.completed` — post-scan reaction (one per scan).
3. `extractor.completed` — aggregated per-Extractor outputs.
4. `rule.completed` — aggregated per-Rule outputs.
5. `action.completed` — Action executed on a node.
6. `job.spawning` — pre-spawn of runner subprocess (Step 10).
7. `job.completed` — most common trigger (Step 10).
8. `job.failed` — alerts, retry triggers (Step 10).

```javascript
export default {
  id: 'slack-notifier',
  kind: 'hook',
  version: '1.0.0',
  description: 'Posts to Slack when a scan completes with issues.',
  triggers: ['scan.completed'],
  // Optional: only fire when the scan actually surfaced issues.
  // Filter keys are top-level event.data fields; values are literal matches.
  // filter: { issuesCount: 0 } — example only; this hook fires on every scan.
  async on(ctx) {
    const stats = ctx.event.data?.stats;
    if (!stats || stats.issuesCount === 0) return;
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `skill-map scan finished with ${stats.issuesCount} issue(s) in ${stats.durationMs} ms.`,
      }),
    });
  },
};
```

> **Filter narrows fan-out, not the trigger enum.** `filter` is a runtime predicate over the event payload — it does NOT extend the hookable trigger set. Declaring `triggers: ['scan.progress']` is rejected at load time regardless of any filter, because `scan.progress` is intentionally non-hookable (per-node fan-out is too verbose for a reactive surface).

> **Mode semantics.** Default `mode: 'deterministic'` runs `on(ctx)` in-process during the dispatch of the matching event, synchronously between the event's emission and the next pipeline step. `mode: 'probabilistic'` enqueues the hook as a job; until the job subsystem ships at Step 10, probabilistic hooks load but skip dispatch with a stderr advisory.

> **What hooks CANNOT do.** Hooks REACT to events; they cannot block emission, mutate the graph, alter Extractor / Rule output, or enrich nodes. For graph mutations use `extractor.enrichNode`; for graph reasoning use a Rule; for periodic background work use a probabilistic Action wrapped in a hook that submits the job. The single-responsibility split keeps the kernel's deterministic baseline stable.

### Providers / Actions

These ship later in the v1.x line as bundled built-ins; the spec already pins their manifest shapes. Until the testkit grows full helpers for them (planned alongside Step 10), authors are encouraged to test them with a live kernel via `sm scan` against a fixture directory rather than in unit tests.

#### Provider — `kinds` catalog and `explorationDir`

Every Provider declares two required fields beyond the manifest base.

**`kinds` catalog.** Maps each kind the Provider emits to its frontmatter schema (path relative to the Provider's package directory) and its qualified `defaultRefreshAction`. The catalog is the single source of truth for "which kinds does this Provider emit"; the kernel derives the supported kind set from `Object.keys(kinds)`. The schema MUST extend the spec's universal [`schemas/frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) via `allOf` + `$ref` to base's `$id`, so cross-package resolution works without copying base into every Provider.

**`explorationDir`.** Filesystem directory the kernel walks at boot/scan time to discover candidate files; `sm doctor` checks the resolved path exists and emits a non-blocking warning when it does not — the user may legitimately install the matching platform later.

```jsonc
{
  "id": "cursor",
  "kind": "provider",
  "version": "1.0.0",
  "explorationDir": "~/.cursor",
  "kinds": {
    "skill": {
      "schema": "./schemas/skill.schema.json",
      "defaultRefreshAction": "cursor/summarize-skill"
    },
    "command": {
      "schema": "./schemas/command.schema.json",
      "defaultRefreshAction": "cursor/summarize-command"
    }
  }
}
```

Bare `~` and `~/...` prefixes in `explorationDir` resolve against the current user's home (the same convention the shell applies); relative paths fall back to the cwd. Keep `explorationDir` short and platform-canonical; the doctor warning is the only place the user sees the field, so misleading values create confusion later.

> **Migration note (spec 0.8.x).** Pre-0.8 Providers declared two separate fields, `emits: string[]` and a flat `defaultRefreshAction: { <kind>: actionId }`. Both collapsed into the `kinds` map in 0.8.0 (Phase 3 of plug-in model overhaul); the per-kind frontmatter schema (which previously lived under `spec/schemas/frontmatter/<kind>.schema.json`) joined the same map entry. Migration: drop `emits` (replaced by `Object.keys(kinds)`); move each `defaultRefreshAction[<kind>]` value into `kinds[<kind>].defaultRefreshAction`; ship your per-kind schemas inside the plugin package and reference them via `kinds[<kind>].schema`.

---

## Frontmatter validation — three-tier model

The kernel validates frontmatter on a graduated dial; tighter is opt-in. The model is normative — every conforming implementation MUST honour the three tiers — but the policy lives in **rules**, not the JSON Schemas. The schemas stay shape-only ([`schemas/frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) declares `additionalProperties: true` deliberately) so that authors can extend their own nodes without forking the spec. Per-kind frontmatter schemas live with the **Provider** that emits the kind (declared via `provider.kinds[<kind>].schema`); spec only ships the universal `base`.

| Tier | Mechanism | Behavior on unknown / non-conforming fields |
|---|---|---|
| **0 — Default permissive** | `additionalProperties: true` on `base.schema.json` and on every per-kind frontmatter schema declared by an installed Provider. | Field passes silently, persists in `node.frontmatter`, and is available to every extension (extractors, rules, actions, formatters). |
| **1 — Built-in `unknown-field` rule** | Deterministic Rule shipped with the kernel. Always active. | Emits an Issue with `severity: 'warn'` for every key outside the documented catalog (base + the matched kind's schema). |
| **2 — Strict mode** | [`schemas/project-config.schema.json`](./schemas/project-config.schema.json) `scan.strict: true` (team default in `settings.json`); also via `--strict` on `sm scan`. | Promotes **all** frontmatter warnings to `severity: 'error'`. They persist in the DB; `sm check` then exits `1` on the next read. CI fails. |

> Tier 1 is normative behavior — the kernel ships the rule out-of-the-box. Disabling it is not a supported configuration; an unknown key that you want to keep is either (a) moved under `metadata.*` (the spec permits free-form keys there), or (b) carried as-is at the cost of a persistent `warn`-severity issue (informational unless you run Tier 2).

### Worked example — same node, three tiers

Starting frontmatter on a skill node:

```yaml
---
name: code-reviewer
description: Reviews diffs against repo conventions.
metadata:
  version: 1.0.0
priority: high          # ← author-defined, not in any schema
---
```

**Tier 0 (default permissive — no project config, default scan).** The field validates fine. `node.frontmatter.priority === 'high'` for any extractor / rule / action that reads the node. No issues raised by the schema itself.

**Tier 1 (always-active `unknown-field` rule).** After `sm scan`, the rule emits:

```jsonc
{
  "ruleId": "unknown-field",
  "severity": "warn",
  "message": "Unknown frontmatter field 'priority' on skill node 'code-reviewer'. Add it to a custom rule or move it under metadata.* if intentional.",
  "nodeIds": ["code-reviewer.md"]
}
```

`sm scan` exits `0` (warnings do not fail the verb). The author can either move the key under `metadata.*` — where [`schemas/frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) already permits free-form keys, so the `unknown-field` rule does not match — or accept the persistent warning and add a Rule that consumes `priority` for whatever cross-node logic motivated the field.

**Tier 2 (strict mode).** Either `scan.strict: true` in `.skill-map/settings.json`, or `sm scan --strict` on the CLI. The same `unknown-field` warning is now persisted at `severity: 'error'`. `sm scan --strict` exits `1` when the issue is created; `sm check` (which reads from the DB) also exits `1` thereafter. CI breaks until the field is reconciled.

```jsonc
// .skill-map/settings.json
{
  "schemaVersion": 1,
  "scan": { "strict": true }
}
```

The CLI flag wins when both are set (see the `--strict` description on `sm scan`); the flag is the per-invocation override, the config field is the team default.

### Why no "schema-extender" plugin kind

A reasonable next thought is: "I want my plugin to widen the frontmatter schema so my custom keys are first-class." The spec deliberately rejects that route. The accepted path is to write a deterministic **Rule** that:

1. Reads the candidate keys from `node.frontmatter` (which Tier 0 already exposes).
2. Validates them against whatever shape your domain expects (regex, enum, cross-node consistency).
3. Emits Issues for violations.

The trade-off is intentional: a "schema-extender" kind would force every consumer (the kernel, the storage layer, every other plugin, the UI) to re-resolve the active schema set per scan. A Rule-driven approach keeps the kernel's parser one-pass and the validation surface composable — the union of every author's rules is the project's policy.

If the rule needs to be CI-blocking, the rule itself emits the Issue at `severity: 'error'`. `--strict` / `scan.strict` apply only to the kernel's own frontmatter-shape and `unknown-field` warnings; plugin-authored rules pick their own severity directly.

---

## Storage

A plugin that needs to persist state declares `storage` in its manifest. Two modes; each is documented in full at [`plugin-kv-api.md`](./plugin-kv-api.md).

### Mode A — KV

```jsonc
{ "storage": { "mode": "kv" } }
```

Backed by the kernel-owned `state_plugin_kvs` table. The plugin gets `ctx.store` with `get` / `set` / `list` / `delete`. No migrations to write, ready immediately.

Pick KV when your state is a small map (less than ~1 MB total, simple key lookup or prefix list). 90 % of plugins fit.

### Mode B — Dedicated

```jsonc
{
  "storage": {
    "mode": "dedicated",
    "tables": ["plugin_my_plugin_items", "plugin_my_plugin_history"],
    "migrations": ["./migrations/001_init.sql"]
  }
}
```

The plugin owns SQL tables prefixed `plugin_<normalizedId>_*`. Migrations live under `<plugin-dir>/migrations/NNN_<name>.sql` and apply through `sm db migrate` (mixed with kernel migrations, after them).

Pick Dedicated when you need indexes, joins, or relational shape.

#### Triple protection

Every DDL or DML object a plugin migration creates / alters / drops MUST live in the `plugin_<normalizedId>_*` namespace. The kernel enforces this in three places:

1. **Discovery (Layer 1)**: every pending migration file is parsed and validated before any of them run. A bad file aborts the whole batch with no DB writes.
2. **Apply (Layer 2)**: the same validator re-runs immediately before `db.exec(sql)`, defending against TOCTOU edits between discovery and apply.
3. **Catalog assertion (Layer 3)**: `sqlite_master` is swept after each plugin's batch commits; any new object outside the prefix is reported as an intrusion (exit 2).

Forbidden in plugin migrations: `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT` / `PRAGMA` / `ATTACH` / `DETACH` / `VACUUM` / `REINDEX` / `ANALYZE`. The runner wraps each migration in its own transaction. Schema qualifiers other than `main.` are also rejected.

### `outputSchema` — opt-in correctness for custom storage writes

`emitLink` and `enrichNode` are universally validated by the kernel — every link goes through `link.schema.json` and every enrichment partial through `node.schema.json` before it persists. `ctx.store` writes are different: by default the kernel accepts any shape, because the plugin author owns the table layout and the kernel doesn't know the row shape ahead of time.

Plugin authors who want correctness for their own writes opt in by declaring JSON Schemas in the manifest. The kernel then AJV-validates each `set` / `write` call before persisting.

**Mode A (`kv`) — single value-shape schema.**

```jsonc
{
  "storage": {
    "mode": "kv",
    "schema": "./schemas/kv-value.schema.json"
  }
}
```

The kernel validates the value passed to `ctx.store.set(key, value)` against `kv-value.schema.json` on every call. The schema is single-shape — every key in the namespace stores a value of the same shape. Plugins that need heterogeneous values per key MUST switch to Mode B (or skip validation).

**Mode B (`dedicated`) — per-table schemas.**

```jsonc
{
  "storage": {
    "mode": "dedicated",
    "tables": ["items", "history"],
    "migrations": ["./migrations/001_init.sql"],
    "schemas": {
      "items": "./schemas/items-row.schema.json"
    }
  }
}
```

The kernel validates the row passed to `ctx.store.write(table, row)` against the schema declared for that table. Tables present in `tables` but absent from `schemas` (here, `history`) accept any shape — the map is sparse on purpose, so authors can validate the columns they care about without writing schemas for cache / log tables.

**Failure modes.**

- A schema file missing on disk OR unparseable as JSON OR rejected by AJV's compiler at load time → the plugin's status flips to `load-error` and its extensions are NOT registered. The diagnostic names the offending plugin, table (Mode B), and schema path.
- A `set` / `write` call whose value violates the declared schema → the kernel throws synchronously from inside the wrapper. The throw message names the plugin id, the schema path, and the AJV errors.

**When to use.** Opt in for tables / KV namespaces whose shape is part of the plugin's contract with downstream consumers (e.g. another extension that joins on the row, the UI inspector that renders the value). Skip for tables with free-form payloads (cache rows, observability counters) where validation is friction with no payoff.

`emitLink` and `enrichNode` keep their universal validation regardless of the `outputSchema` opt-in — those go through the kernel's own `link.schema.json` / `node.schema.json` validators, not the per-plugin map.

---

## Execution modes

Extractor / Rule / Action declare `mode` in the manifest with default `deterministic`. Provider / Formatter must NOT declare `mode`.

```jsonc
// deterministic extractor — default, runs in sm scan
{ "kind": "extractor", "id": "my-extractor", "mode": "deterministic", ... }
```

```jsonc
// probabilistic action — runs only as a queued job, dispatched via `sm job submit action:my-action`
{ "kind": "action", "id": "my-action", "mode": "probabilistic", ... }
```

A `probabilistic` extension receives `ctx.runner` (a `RunnerPort`) and dispatches its work to the configured LLM runner (CLI, Skill Agent, or in-process per [`architecture.md`](./architecture.md)). It MUST NOT register scan-time hooks; the kernel rejects probabilistic extensions that do.

The full per-kind capability matrix lives in [`architecture.md` §Execution modes](./architecture.md).

---

## Testing with `@skill-map/testkit`

```bash
npm install --save-dev @skill-map/testkit
```

The testkit ships builders, per-kind context factories, in-memory KV / runner fakes, and high-level `runExtractorOnFixture` / `runRuleOnGraph` / `runFormatterOnGraph` helpers. Most plugin tests reduce to one line per assertion.

```javascript
import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { runExtractorOnFixture, node } from '@skill-map/testkit';

import extractor from '../extensions/extractor.js';

test('emits one reference per [[ref:<name>]] token', async () => {
  const { links } = await runExtractorOnFixture(extractor, {
    body: 'Talk to [[ref:architect]] or [[ref:sre]].',
    context: { node: node({ path: 'a.md' }) },
  });
  strictEqual(links.length, 2);
  strictEqual(links[0].target, 'architect');
});
```

For rule tests, `runRuleOnGraph(rule, { context: { nodes, links } })` returns the issue array. For formatter tests, `runFormatterOnGraph(formatter, { context: { nodes, links, issues } })` returns the formatted string.

For probabilistic extensions, `makeFakeRunner()` queues canned responses and records every call:

```javascript
import { makeFakeRunner } from '@skill-map/testkit';

const runner = makeFakeRunner();
runner.queue({ text: '5 nodes summarized' });
const result = await myAction.run({ runner, ... });
strictEqual(runner.history[0].action, 'skill-summarizer');
```

Full surface in `@skill-map/testkit/index.ts`.

---

## Diagnostics

`sm plugins list` shows every discovered plugin with one of six statuses. When a plugin doesn't behave the way you expect, this is the first thing to check.

| Status | Meaning | Common cause |
|---|---|---|
| `loaded` | manifest valid, specCompat satisfied, every extension imported and validated. | — |
| `disabled` | user toggled it off via `sm plugins disable` or `settings.json#/plugins/<id>/enabled`. Manifest parsed; extensions not imported. | Intentional. |
| `incompatible-spec` | manifest parsed but `semver.satisfies` failed against the installed spec. | Plugin built against an older / newer spec. |
| `invalid-manifest` | `plugin.json` missing, unparseable, AJV-fails, OR the directory name does not equal the manifest id. | Typo, missing required field, wrong shape, mismatched directory name. |
| `load-error` | manifest passed but an extension module failed to import or its default export failed schema validation. | Missing `kind` field, wrong `kind` for the file, runtime import error. |
| `id-collision` | two plugins reachable from different roots declared the same `id`. Both collided plugins receive this status; no precedence rule applies. | Project-local plugin and a user-global plugin (or two `--plugin-dir` plugins) sharing an id. Rename one and rerun. |

`sm plugins doctor` runs the full load pass and exits 1 if any plugin is in a non-`loaded` / non-`disabled` state (so any of `incompatible-spec` / `invalid-manifest` / `load-error` / `id-collision` trips it). Wire it into CI to catch breakage early.

---

## See also

- [`architecture.md`](./architecture.md) — extension contract, ports, execution modes.
- [`plugin-kv-api.md`](./plugin-kv-api.md) — Storage Mode A normative API.
- [`db-schema.md`](./db-schema.md) — table catalog and migration rules (Mode B).
- [`schemas/plugins-registry.schema.json`](./schemas/plugins-registry.schema.json) — normative manifest shape.
- [`schemas/extensions/*.schema.json`](./schemas/extensions) — per-kind manifest schemas.

---

## Stability

- Document status: **stable** as of spec v1.0.0. Future minor revisions add new sections (e.g. richer testkit coverage when actions gain helpers); breaking edits to the documented surface require a major bump per [`versioning.md`](./versioning.md).
- The six plugin statuses (`loaded` / `disabled` / `incompatible-spec` / `invalid-manifest` / `load-error` / `id-collision`) are stable; adding a seventh status is a minor bump.
- The structural rule **directory name MUST equal manifest id** is stable; relaxing it (allowing mismatch) is a major bump.
- The cross-root id-collision rule (both sides blocked, no precedence) is stable; introducing precedence (e.g. project root wins over global) is a major bump.
- The `granularity` field on `PluginManifest` is stable as introduced. The two values (`bundle` / `extension`) are stable. Adding a third value is a minor bump; changing the default away from `bundle` is a major bump (every existing plugin manifest would silently flip toggle semantics).
- The optional `applicableKinds` field on the Extractor manifest is stable as introduced. Adding a wildcard syntax (`'*'`) is a minor bump (additive, the existing "absent = all kinds" semantics keeps holding); changing the default away from "applies to every kind" or making the field required is a major bump. Promoting the unknown-kinds doctor warning to a hard load error is a major bump (today's contract is "load OK, surface as warning").
- The recommended `specCompat` strategy is descriptive prose; revising the recommendation does not require a spec bump as long as the schema stays unchanged.
- The example code blocks track the public TypeScript surface of `@skill-map/cli`; bumping their imports follows the cli's own semver.
