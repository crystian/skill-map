---
"@skill-map/cli": minor
---

Storage-port promotion — Phase D (`pluginConfig` namespace).

- **Port**: `port.pluginConfig.set / get / list / delete / loadOverrideMap`. The `set` upserts a per-plugin enabled override into `config_plugins`; `loadOverrideMap` returns the full map for layering over `settings.json` defaults at scan boot.
- **Adapter**: `SqliteStorageAdapter.pluginConfig` delegates to the existing free functions in `kernel/adapters/sqlite/plugins.ts`.
- **CLI migrated**: `cli/commands/plugins.ts` (the `enable / disable` toggle and the override-map loader for `sm plugins doctor`); `cli/util/plugin-runtime.ts` (the same loader used by `loadPluginRuntime` to layer DB overrides at boot). Both files no longer import directly from `kernel/adapters/sqlite/plugins.js`. `deletePluginOverride` was used as a `void`-suppressed import to keep it available for a future `sm config reset`; that comment now points at `port.pluginConfig.delete` instead.

617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump.
