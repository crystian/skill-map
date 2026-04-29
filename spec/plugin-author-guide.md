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
| Claude adapter | `claude` | `claude/claude` |
| Frontmatter detector | `frontmatter` | `claude/frontmatter` |
| Slash detector | `slash` | `claude/slash` |
| At-directive detector | `at-directive` | `claude/at-directive` |
| External-URL counter | `external-url-counter` | `core/external-url-counter` |
| Broken-ref rule | `broken-ref` | `core/broken-ref` |
| Trigger-collision rule | `trigger-collision` | `core/trigger-collision` |
| ASCII renderer | `ascii` | `core/ascii` |
| Validate-all audit | `validate-all` | `core/validate-all` |

Two namespaces are convention for built-ins:

- **`core/`** — kernel-internal primitives (every built-in rule, the ASCII renderer, the audit, the external-URL counter detector). Platform-agnostic.
- **`claude/`** — the Claude Code provider bundle (the adapter plus the three detectors that decode Claude-specific syntax: frontmatter, slash, `@`-directive).

For your own plugin, the `id` you declare in `plugin.json` is the namespace for every extension the plugin contains. If your manifest declares `id: "my-plugin"` and your extension file declares `id: "foo-detector"`, the kernel registers it as `my-plugin/foo-detector`. You do **not** write the qualifier yourself — the loader injects it.

What this means in practice:

- **In the extension file**, declare only the short id (`id: "greet"`). Do **not** prefix it with the plugin id (`id: "my-plugin/greet"` is rejected as a kebab-case violation).
- **In the manifest's `extensions[]`**, list relative paths to extension files as before — nothing changes.
- **In `defaultRefreshAction` (adapter)** and any other cross-extension reference (e.g. an audit's `composes[]` once that surface lands), use the qualified id of the target. A built-in adapter that wants the `core/summarize-agent` action references it by the qualified form; a third-party adapter that wants its own bundled action references `<my-plugin>/<my-action>`.
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
| `bundle` (default) | the bundle id alone (e.g. `my-plugin`, `claude`) | The plugin's extensions form a coherent product (e.g. an adapter and the detectors that decode its native syntax). The user wants one switch. **95% of plugins.** |
| `extension` | the qualified extension id (`<bundle>/<ext-id>`, e.g. `core/superseded`, `my-plugin/orphan-skill`) | The plugin ships several orthogonal capabilities a user might reasonably want piecemeal. **Built-in `core` is the canonical example** — the spec promises every kernel built-in is removable, so each one toggles independently. |

Built-in mapping:

- **`claude`** — `granularity: 'bundle'`. `sm plugins disable claude` flips the adapter and the three Claude-specific detectors at once.
- **`core`** — `granularity: 'extension'`. `sm plugins disable core/superseded` flips just the supersession rule; the other six core extensions stay live.

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
    "./extensions/orphan-skill-rule.mjs",
    "./extensions/csv-renderer.mjs"
  ]
}
```

The default (`'bundle'`) is the right answer for almost every plugin — keep the manifest minimal until the plugin actually ships several independent capabilities.

### Detector `applicableKinds` — narrow the pipeline

A `Detector` extension MAY declare an `applicableKinds` array on its manifest. When declared, the kernel runs the detector **only** against nodes whose `kind` is in the list — the filter is fail-fast (no detect context, no method call) so a probabilistic detector wastes zero LLM cost (and a deterministic detector zero CPU) on nodes it cannot meaningfully process.

| `applicableKinds` | Behaviour |
|---|---|
| Absent (`undefined`) | **Default.** The detector runs on every kind the loaded adapters emit. |
| `['skill']` | Runs only on skill nodes. |
| `['skill', 'agent']` | Runs on skills + agents. Hooks, commands, notes are skipped. |
| `[]` | **Invalid.** AJV rejects the manifest at load time (`minItems: 1`). The absence of the field already means "every kind"; an empty array is reserved for "this is a typo". |

There is no wildcard syntax (no `'*'`) — omitting the field IS the wildcard. The pattern is intentional: a literal absence is unambiguous, a string sentinel would invite typos that silently disable the detector.

Use case — a probabilistic tag-inferrer that only makes sense for skills:

```javascript
export default {
  id: 'tag-inferrer',
  kind: 'detector',
  mode: 'probabilistic',
  version: '1.0.0',
  description: 'LLM-derived tag links for skill nodes.',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'medium',
  scope: 'body',
  applicableKinds: ['skill'],
  async detect(ctx) {
    // Never invoked for agents, commands, hooks, or notes — the kernel
    // skipped this node before reaching us.
    const tags = await ctx.runner.invoke({ /* prompt … */ });
    return tags.map((t) => ({
      source: ctx.node.path,
      target: t.path,
      kind: 'references',
      confidence: 'medium',
      sources: ['tag-inferrer'],
    }));
  },
};
```

**Unknown kinds are non-blocking.** A detector that lists a kind no installed Adapter declares (typo, missing Provider plugin) still loads with status `loaded`; `sm plugins doctor` surfaces an informational warning so the author sees the mismatch. The exit code of `doctor` is NOT promoted to 1 by this warning — the corresponding Provider may legitimately arrive later (e.g. when the user installs the matching plugin), and the load contract favours forward compatibility over rigid checks. The full set of "known kinds" is the union of every installed Adapter's `defaultRefreshAction` keys.

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

## Frontmatter validation — three-tier model

The kernel validates frontmatter on a graduated dial; tighter is opt-in. The model is normative — every conforming implementation MUST honour the three tiers — but the policy lives in **rules**, not the JSON Schemas. The schemas stay shape-only ([`schemas/frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) declares `additionalProperties: true` deliberately) so that authors can extend their own nodes without forking the spec.

| Tier | Mechanism | Behavior on unknown / non-conforming fields |
|---|---|---|
| **0 — Default permissive** | `additionalProperties: true` on `base.schema.json` and on every per-kind frontmatter schema. | Field passes silently, persists in `node.frontmatter`, and is available to every extension (detectors, rules, actions, renderers, audits). |
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

**Tier 0 (default permissive — no project config, default scan).** The field validates fine. `node.frontmatter.priority === 'high'` for any detector / rule / action that reads the node. No issues raised by the schema itself.

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

The trade-off is intentional: a "schema-extender" kind would force every consumer (the kernel, the storage adapter, every other plugin, the UI) to re-resolve the active schema set per scan. A Rule-driven approach keeps the kernel's parser one-pass and the validation surface composable — the union of every author's rules is the project's policy.

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

- Document status: **stable** as of spec v1.0.0. Future minor revisions add new sections (e.g. richer testkit coverage when actions / audits gain helpers); breaking edits to the documented surface require a major bump per [`versioning.md`](./versioning.md).
- The six plugin statuses (`loaded` / `disabled` / `incompatible-spec` / `invalid-manifest` / `load-error` / `id-collision`) are stable; adding a seventh status is a minor bump.
- The structural rule **directory name MUST equal manifest id** is stable; relaxing it (allowing mismatch) is a major bump.
- The cross-root id-collision rule (both sides blocked, no precedence) is stable; introducing precedence (e.g. project root wins over global) is a major bump.
- The `granularity` field on `PluginManifest` is stable as introduced. The two values (`bundle` / `extension`) are stable. Adding a third value is a minor bump; changing the default away from `bundle` is a major bump (every existing plugin manifest would silently flip toggle semantics).
- The optional `applicableKinds` field on the Detector manifest is stable as introduced. Adding a wildcard syntax (`'*'`) is a minor bump (additive, the existing "absent = all kinds" semantics keeps holding); changing the default away from "applies to every kind" or making the field required is a major bump. Promoting the unknown-kinds doctor warning to a hard load error is a major bump (today's contract is "load OK, surface as warning").
- The recommended `specCompat` strategy is descriptive prose; revising the recommendation does not require a spec bump as long as the schema stays unchanged.
- The example code blocks track the public TypeScript surface of `@skill-map/cli`; bumping their imports follows the cli's own semver.
