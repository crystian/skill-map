---
'@skill-map/cli': minor
---

Replace the placeholder `PluginLoaderPort` shape with the real
contract the concrete loader has been exposing since Step 0b, and
pin the adapter to the port via `implements PluginLoaderPort`.

**Why.** The port was authored as Step-0b stubs (`discover` / `load` /
`validateManifest`, plus `PluginManifest` / `PluginStorage` /
`LoadedExtension` types) and never updated when the real loader
landed. Two latent risks: callers who imported from the ports barrel
got a different shape than the actual class; and the concrete adapter
was free to drift from the port silently. Both eliminated.

**What.**

- `PluginLoaderPort` now declares `discoverPaths()`,
  `discoverAndLoadAll()`, `loadOne(path)` — verbatim mirror of
  `kernel/adapters/plugin-loader.ts`.
- The placeholder DTOs are gone; the port re-exports the real domain
  types (`IPluginManifest`, `ILoadedExtension`, `IDiscoveredPlugin`,
  `IPluginStorageSchema`, `TGranularity`, `TPluginLoadStatus`,
  `TPluginStorage`) from `kernel/types/plugin.ts`.
- `class PluginLoader implements PluginLoaderPort` — drift is now a
  compile error.
- New factory `createPluginLoader(opts): PluginLoaderPort`. The CLI
  call sites (`commands/plugins.ts`, `util/plugin-runtime.ts`) use it
  so production callers are pinned to the abstract shape; tests keep
  `new PluginLoader(...)` for legitimate access to internals.
- Re-exports through `kernel/index.ts` and `kernel/ports/index.ts`
  swapped to the real domain types (already shipped in the previous
  Logger commit alongside the new `LoggerPort` exports).
