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
    └── detector.mjs       ← one file per declared extension
```

```jsonc
// my-plugin/plugin.json
{
  "id": "my-plugin",
  "version": "1.0.0",
  "specCompat": "^1.0.0",
  "extensions": ["./extensions/detector.mjs"]
}
```

```javascript
// my-plugin/extensions/detector.mjs
export default {
  id: 'my-detector',
  kind: 'detector',
  version: '1.0.0',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'high',
  scope: 'body',
  detect(ctx) {
    // ctx.node, ctx.body, ctx.frontmatter — return Link[]
    return [];
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

After every change to the `plugins/` folder, run `sm plugins list` to see the load status of each. The five statuses are documented under [Diagnostics](#diagnostics) below.

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
| `adapter` | `walk(roots, opts)` | filesystem roots | `IRawNode[]` | deterministic only |
| `detector` | `detect(ctx)` | one node + body + frontmatter | `Link[]` | dual-mode |
| `rule` | `evaluate(ctx)` | full graph | `Issue[]` | dual-mode |
| `action` | `run(ctx)` | one or more nodes | execution record | dual-mode |
| `audit` | `audit(ctx)` | full graph | `TAuditReport` | derived (from `composes[]`) |
| `renderer` | `render(ctx)` | full graph | `string` | deterministic only |

The runtime instance you `export default` from an extension file MUST include both the manifest fields (id, kind, version, plus kind-specific metadata) AND the runtime method. The kernel strips function-typed properties before AJV-validating the manifest shape, so `detect` / `evaluate` / etc. live alongside metadata without confusing the schema.

### Detectors

Pure single-node analysis. **Never** read another node, the graph, or the database — cross-node reasoning is for rules. Spec at [`schemas/extensions/detector.schema.json`](./schemas/extensions/detector.schema.json).

> **Pick a syntax that doesn't collide with built-ins.** The built-in `at-directive` detector fires on any `@token`; the built-in `slash` detector fires on any `/token`. A new detector that also matches one of those prefixes will likely fire on the same input, and if the two emit different `target` shapes the kernel raises a `trigger-collision` error. The example below uses a wikilink-style `[[ref:<name>]]` pattern to side-step this; reserve `@` and `/` for the built-ins.

```javascript
import { normalizeTrigger } from '@skill-map/cli';

export default {
  id: 'ref-detector',
  kind: 'detector',
  version: '1.0.0',
  description: 'Detects [[ref:<name>]] tokens in the body.',
  stability: 'experimental',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'medium',
  scope: 'body',
  detect(ctx) {
    const matches = [...ctx.body.matchAll(/\[\[ref:([a-z0-9-]+)\]\]/gi)];
    return matches.map((m) => ({
      source: ctx.node.path,
      target: m[1],
      kind: 'references',
      confidence: 'medium',
      sources: ['ref-detector'],
      trigger: { originalTrigger: m[0], normalizedTrigger: m[0].toLowerCase() },
    }));
  },
};
```

### Rules

Cross-node reasoning over the merged graph. Run after every adapter and detector has completed. Spec at [`schemas/extensions/rule.schema.json`](./schemas/extensions/rule.schema.json).

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

### Renderers

Graph-to-string serializers. Invoked by `sm graph --format <name>`. Output **MUST** be byte-deterministic for the same input graph (the snapshot-test suite relies on this). Spec at [`schemas/extensions/renderer.schema.json`](./schemas/extensions/renderer.schema.json).

```javascript
export default {
  id: 'csv-renderer',
  kind: 'renderer',
  version: '1.0.0',
  format: 'csv',
  contentType: 'text/csv',
  render(ctx) {
    const rows = ['source,target,kind,confidence'];
    for (const link of ctx.links) {
      rows.push([link.source, link.target, link.kind, link.confidence].join(','));
    }
    return rows.join('\n');
  },
};
```

### Adapters / Audits / Actions

These ship later in the v1.x line as bundled built-ins; the spec already pins their manifest shapes. Until the testkit grows full helpers for them (planned alongside Step 10), authors are encouraged to test them with a live kernel via `sm scan` against a fixture directory rather than in unit tests.

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

---

## Execution modes

Detector / Rule / Action declare `mode` in the manifest with default `deterministic`. Audit forbids `mode` — the kernel derives it from `composes[]` at load time. Adapter / Renderer must NOT declare `mode`.

```jsonc
// deterministic detector — default, runs in sm scan
{ "kind": "detector", "id": "my-detector", "mode": "deterministic", ... }
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

The testkit ships builders, per-kind context factories, in-memory KV / runner fakes, and high-level `runDetectorOnFixture` / `runRuleOnGraph` / `runRendererOnGraph` helpers. Most plugin tests reduce to one line per assertion.

```javascript
import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { runDetectorOnFixture, node } from '@skill-map/testkit';

import detector from '../extensions/detector.mjs';

test('emits one reference per [[ref:<name>]] token', async () => {
  const links = await runDetectorOnFixture(detector, {
    body: 'Talk to [[ref:architect]] or [[ref:sre]].',
    context: { node: node({ path: 'a.md' }) },
  });
  strictEqual(links.length, 2);
  strictEqual(links[0].target, 'architect');
});
```

For rule tests, `runRuleOnGraph(rule, { context: { nodes, links } })` returns the issue array. For renderer tests, `runRendererOnGraph(renderer, { context: { nodes, links, issues } })` returns the rendered string.

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

`sm plugins list` shows every discovered plugin with one of five statuses. When a plugin doesn't behave the way you expect, this is the first thing to check.

| Status | Meaning | Common cause |
|---|---|---|
| `loaded` | manifest valid, specCompat satisfied, every extension imported and validated. | — |
| `disabled` | user toggled it off via `sm plugins disable` or `settings.json#/plugins/<id>/enabled`. Manifest parsed; extensions not imported. | Intentional. |
| `incompatible-spec` | manifest parsed but `semver.satisfies` failed against the installed spec. | Plugin built against an older / newer spec. |
| `invalid-manifest` | `plugin.json` missing, unparseable, or AJV-fails. | Typo, missing required field, wrong shape. |
| `load-error` | manifest passed but an extension module failed to import or its default export failed schema validation. | Missing `kind` field, wrong `kind` for the file, runtime import error. |

`sm plugins doctor` runs the full load pass and exits 1 if any plugin is in a non-`loaded` / non-`disabled` state. Wire it into CI to catch breakage early.

---

## See also

- [`architecture.md`](./architecture.md) — extension contract, ports, execution modes.
- [`plugin-kv-api.md`](./plugin-kv-api.md) — Storage Mode A normative API.
- [`db-schema.md`](./db-schema.md) — table catalog and migration rules (Mode B).
- [`schemas/plugins-registry.schema.json`](./schemas/plugins-registry.schema.json) — normative manifest shape.
- [`schemas/extensions/*.schema.json`](./schemas/extensions) — per-kind manifest schemas.

---

## Stability

- Document status: **stable** as of spec v1.0.0. Future minor revisions add new sections (e.g. richer testkit coverage when actions / audits gain helpers); breaking edits to the documented surface require a major bump per [`versioning.md`](./versioning.md).
- The five plugin statuses (`loaded` / `disabled` / `incompatible-spec` / `invalid-manifest` / `load-error`) are stable; adding a sixth status is a minor bump.
- The recommended `specCompat` strategy is descriptive prose; revising the recommendation does not require a spec bump as long as the schema stays unchanged.
- The example code blocks track the public TypeScript surface of `@skill-map/cli`; bumping their imports follows the cli's own semver.
