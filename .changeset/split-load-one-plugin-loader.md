---
"@skill-map/cli": patch
---

Code-quality follow-up to commit `66ea293` — split the audit's other
big offender, `loadOne` in `src/kernel/adapters/plugin-loader.ts`
(310 lines, complexity 31), into focused private helpers. **Patch
bump**: zero public API changes (the `PluginLoader` class still
exposes the same `loadOne(pluginPath): Promise<IDiscoveredPlugin>`
signature; new helpers are `#`-prefixed truly-private methods plus
one private free function); pure internal restructuring.

## Why

`loadOne` was the last "monster" call site flagged by the pre-1.0
audit and explicitly deferred in `refactor-complexity-splits-followup`
as needing a dedicated session. Three sequential phases (manifest
parse + validation, per-extension import + kind validation, storage
schema compile) stuffed into one body, with the per-extension loop
itself doing six sub-checks plus a 30-line hook-trigger validation
block inline. Once each phase is named, the warning disappears and
the next reader gets a free table of contents.

## What

Three extractions, all in `src/kernel/adapters/plugin-loader.ts`:

- `#parseAndValidateManifest(pluginPath)` (private method, ~75 lines)
  — phase 1: read `plugin.json`, AJV-validate the manifest shape,
  enforce the directory-name == manifest.id structural rule, validate
  specCompat (range syntax + satisfies installed spec version).
  Returns either the validated manifest or an `IDiscoveredPlugin`
  with the appropriate failure status (`invalid-manifest` /
  `incompatible-spec`).
- `#loadAndValidateExtensionEntry(pluginPath, manifest, relEntry)`
  (private async method, ~100 lines) — phase 3 inner loop body: 6
  sub-checks per extension entry (file exists, dynamic import with
  timeout, has-kind, kind-is-known, pluginId match, kind-specific
  manifest validation including hook trigger pre-check), with the
  `pluginId` injection and shallow-clone of the runtime instance.
- `validateHookTriggers(...)` (private free function) — extracted
  because the hook-specific trigger validation was a 30-line block
  inside the extension loop body that was hurting both readability
  and complexity.

Both methods/functions return discriminated unions
(`{ ok: true; ... } | { ok: false; failure: IDiscoveredPlugin }`) so
the caller (`loadOne`) stays a thin orchestrator: ~30 lines of
"manifest -> enabled check -> loop entries -> storage schemas ->
success result".

## Net effect on lint

- Previous baseline (after `66ea293`): 80 warnings.
- After this commit: **81 warnings** (+1 net).
- `loadOne` itself: **31 -> 10** (-21 — massive drop, just barely
  above the threshold of 8).
- `#loadAndValidateExtensionEntry` new helper at **13** (the new
  warning, but contained — much easier to reason about than the
  original monolith).
- `#parseAndValidateManifest` and `validateHookTriggers` both <8
  (no warnings).
- 602 / 602 tests still green.

The +1 net is misleading — the architectural improvement is the
central method dropping from 31 to 10. The helper at 13 is the next
splitting target if anyone wants to keep going.
