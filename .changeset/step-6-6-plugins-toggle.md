---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Step 6.6 — `sm plugins enable / disable` + the `config_plugins`
override layer they read from. The two stub verbs become real, and
the `PluginLoader` finally honours user intent: a disabled plugin
surfaces in `sm plugins list` with status `disabled`, but its
extensions are NOT imported and the kernel will not run them.

**Decision (recorded in spec)**: enable/disable resolution favours the
DB row over `settings.json` over the installed default. The DB
override is local-machine; `settings.json` is the team-shared baseline.
A developer can locally disable a misbehaving plugin without
committing the toggle to the team's config; conversely, a baseline
that explicitly enables a plugin is overridable per-machine. The rule
is documented in `spec/db-schema.md` §`config_plugins`.

**Spec change (additive, patch)**:

- `spec/db-schema.md` — appended an "Effective enable/disable
  resolution" subsection under `config_plugins` documenting the
  three-layer precedence (DB > `settings.json` > installed default).
  No schema changes; the `config_plugins` table itself was already
  defined in the initial migration.

**Runtime change**:

- `src/kernel/types/plugin.ts` — `TPluginLoadStatus` gains a `disabled`
  variant. JSDoc explains all five states.
- `src/kernel/adapters/sqlite/plugins.ts` — new file. Storage helpers
  over the `config_plugins` table: `setPluginEnabled` (upsert),
  `getPluginEnabled` (single read), `loadPluginOverrideMap` (bulk
  read for one round-trip per process), `deletePluginOverride`
  (idempotent drop, used by future `sm config reset plugins.<id>`).
- `src/kernel/config/plugin-resolver.ts` — new file.
  `resolvePluginEnabled` implements the precedence above;
  `makeEnabledResolver` curries the layered config and DB map into
  the `(id) => boolean` shape `IPluginLoaderOptions.resolveEnabled`
  expects.
- `src/kernel/adapters/plugin-loader.ts` — new optional
  `resolveEnabled` callback in `IPluginLoaderOptions`. When supplied,
  the loader checks AFTER manifest + specCompat validation and
  short-circuits with `status: 'disabled'` (manifest preserved,
  extensions array omitted, reason `"disabled by config_plugins or
  settings.json"`). Omitting the callback keeps the legacy "always
  load" behaviour for tests / kernel-empty-boot.
- `src/cli/commands/plugins.ts` — wires the loader to the resolver:
  every read (`list / show / doctor`) loads `config_plugins` once and
  feeds the resolver. Two new commands `PluginsEnableCommand` and
  `PluginsDisableCommand` write to the DB. `--all` toggles every
  discovered plugin; `<id>` and `--all` are mutually exclusive.
  `sm plugins doctor` now treats `disabled` as intentional (does not
  contribute to the issue list, does not flip exit code).
- `src/cli/commands/plugins.ts` — adds `off` to the status icon legend
  in human output (`off  mock-a@0.1.0 · disabled by config_plugins or
  settings.json`).
- `src/cli/commands/stubs.ts` — `PluginsEnableCommand` and
  `PluginsDisableCommand` removed; replaced-at-step comment kept.
- `context/cli-reference.md` — regenerated; the two new verbs appear
  with their flag tables.

**Tests**:

- `src/test/plugin-overrides.test.ts` — 8 unit tests covering storage
  round-trip (upsert + read), `loadPluginOverrideMap` bulk read,
  `deletePluginOverride` idempotency, resolver precedence (default ⇒
  true, `settings.json` overrides default, DB overrides
  `settings.json`), `makeEnabledResolver` currying, and PluginLoader
  surfacing `disabled` status with manifest preserved + no extensions
  + omitting the resolver still loads.
- `src/test/plugins-cli.test.ts` — 9 end-to-end tests via the binary:
  `disable <id>` writes a DB row + `sm plugins list` reflects `off`,
  `enable <id>` flips back, `--all` covers every discovered plugin,
  unknown id → exit 5, no-arg → exit 2, both `<id>` and `--all` →
  exit 2, `settings.json` baseline overridden by DB `enable`,
  `settings.json` baseline applies when DB has no row, and
  `sm plugins doctor` exits 0 when the only non-loaded plugin is
  intentionally disabled.

Test count: 273 → 291 (+18).
