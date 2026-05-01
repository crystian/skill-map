---
'@skill-map/cli': minor
---

Audit cleanup pass — close four mechanical items from the
`cli-architect` audit in a single sweep. **Pre-1.0 minor bump** per
`spec/versioning.md` § Pre-1.0; the API changes below are technically
breaking but ship as a minor while the package stays `0.Y.Z`.

## V5 — kernel stops reading Node globals

`ILoadConfigOptions.cwd` / `.homedir` and `ICreateFsWatcherOptions.cwd`
are now **mandatory**. Previously they fell back to `process.cwd()` /
`os.homedir()` inside the kernel — which broke the kernel-isolation
invariant the linter enforces elsewhere. New helper
`src/cli/util/runtime-context.ts#defaultRuntimeContext()` wraps
`{ cwd: process.cwd(), homedir: homedir() }`; the CLI threads it
through every `loadConfig` / `createChokidarWatcher` call. Eight CLI
sites migrated (`scan`, `watch`, `jobs`, `scan-compare`, `plugins`,
`config` × 3, `init`, `plugin-runtime` resolver) plus seven test sites
in `watcher.test.ts`.

**Breaking** for any external consumer of `loadConfig` /
`createChokidarWatcher` that relied on the implicit fallback — they
now must pass `cwd` (and `homedir` for `loadConfig`) explicitly.

## V8 — no more `pluginId` mutation in plugin-runtime

`ILoadedExtension` gains an `instance: unknown` field alongside
`module: unknown`. The loader now shallow-clones the runtime instance
(default export, or the module namespace when none) and injects
`pluginId` per spec § A.6, exposing the result as `instance`. The CLI
runtime composer (`bucketLoaded`) consumes `ext.instance` directly —
the previous post-hoc mutation of `instance['pluginId']` is gone, and
the obsolete `extractDefault` helper with it.

The bug this closes: two plugins importing the same file via the ESM
module cache shared a single mutable object, so the second `pluginId`
assignment stomped the first. Centralising the clone in the loader
makes the issue structurally impossible.

**Additive** at the type level (`instance` is a new field consumers
read; only the loader produces it).

## V9 — `confirm()` accepts streams from the Clipanion context

`src/cli/util/confirm.ts` now takes
`confirm(question, { stdin, stderr })` instead of reaching for
`process.stdin` / `process.stderr`. Every command site
(`db restore`, `db reset --hard`, `db reset --state`,
`orphans undo-rename`) passes `this.context.stdin` /
`this.context.stderr`, so commands become testable with captured
streams instead of monkey-patching the globals.

**Breaking** for any external caller of the helper (none expected —
it lives under `src/cli/util/`).

## D7 — extracted `isBundleEntryEnabled` helper

The toggle-resolution logic
(`if (granularity === 'bundle') resolveEnabled(bundle.id) else
resolveEnabled(qualifiedExtensionId(...))`) was duplicated between
`isBuiltInExtensionEnabled` (typed `TBuiltInExtension`) and the inline
filter inside `filterBuiltInManifests` (raw `IPluginManifest.id`). A
new private helper `isBundleEntryEnabled(bundle, extId, resolveEnabled)`
operates on the plain extension id; both call sites delegate to it.
Pure refactor, no behaviour change.

## Out of scope

The audit's SD4 item (88 references to "Step N / Phase N" in kernel
docstrings) is deferred to a dedicated docs pass — too large for a
mechanical sweep.
