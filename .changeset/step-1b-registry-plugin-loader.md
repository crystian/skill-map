---
"skill-map": minor
---

Step 1b — Registry + plugin loader.

Wires AJV Draft 2020-12 validation against the schemas published by `@skill-map/spec` and ships the default `PluginLoader` implementation on top of it.

**`src/kernel/adapters/schema-validators.ts`** compiles 17 reusable validators from the spec (11 top-level + 6 extension-kind). A single Ajv instance is used so `$ref` resolution works across `allOf` composition (every extension kind extends `extensions/base` via `allOf`). Supporting schemas (frontmatter, summaries) register first so targets resolve during compile. Eager compilation at load time means a spec corruption is a hard boot error, not a deferred surprise. `ajv-formats` is enabled for `uri` / `date` / `date-time`. A dedicated `validatePluginManifest()` targets `plugins-registry.schema.json#/$defs/PluginManifest` so callers don't hand-filter the combined `oneOf`.

**`src/kernel/types/plugin.ts`** hand-writes the plugin-surface types (`IPluginManifest`, `TPluginStorage`, `ILoadedExtension`, `IDiscoveredPlugin`, `TPluginLoadStatus`). Per the updated DTO-gap note, this hand-curated mirror stays in place until Step 2's real adapter arrives as a third consumer that justifies a canonical typed-DTO export from `@skill-map/spec`.

**`src/kernel/adapters/plugin-loader.ts`** implements the full load pass:

1. Discover plugin directories under the configured search paths; each direct child containing a `plugin.json` is a plugin root.
2. Parse + AJV-validate the manifest — any failure (JSON parse error, schema mismatch, malformed `specCompat` range) returns `status: 'invalid-manifest'`.
3. `semver.satisfies(installedSpecVersion, manifest.specCompat)` with `includePrerelease: true` — mismatch returns `status: 'incompatible-spec'` with the manifest preserved for diagnostics.
4. Dynamic-import every path in `manifest.extensions[]`, expecting a default export with a string `kind` field. File missing, import failure, missing/unknown kind, or default export failing its kind schema all return `status: 'load-error'` with a precise reason.

Never throws — the kernel always keeps booting, regardless of how broken a plugin is.

**CLI: `sm plugins list / show / doctor`** land in `src/cli/commands/plugins.ts`:

- `list` tabulates discovered plugins with a status glyph and either their extension list (on success) or their failure reason.
- `show <id>` dumps a single plugin's manifest + extensions + load status; exit 5 when not found.
- `doctor` returns exit 0 when every plugin loads, exit 1 otherwise — script-friendly readiness check.

All three support `-g / --global` (global scope only), `--plugin-dir <p>` (explicit override, handy for tests), and `--json` on list / show. The `module` field on loaded extensions is omitted from JSON output to avoid circular-reference serialization errors.

**Side fix** surfaced while wiring AJV against the extension-kind schemas: the six kind schemas paired `additionalProperties: false` with `allOf: [{ $ref: base.schema.json }]`, a Draft 2020-12 composition footgun where each sub-schema applies its closed-content rule independently. The fix (shipped as a `@skill-map/spec` patch in the same commit train) switches kind schemas to `unevaluatedProperties: false` and removes closure from base; closed-content now survives the allOf composition.

**Spec resolution**: `@skill-map/spec`'s `exports` field does not expose `package.json`, so `require.resolve('@skill-map/spec/package.json')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Both `resolveSpecRoot()` in the validators and `installedSpecVersion()` in the loader now resolve `@skill-map/spec/index.json` (always exported) and walk one directory up. Zero spec-side changes needed.

**Acceptance test** (`src/test/plugin-loader.test.ts`) codifies the ROADMAP criterion across 8 cases: empty search paths return `[]`; a green-path plugin with one detector extension loads and reports its extensions; both `invalid-manifest` sub-cases (missing required fields, unparseable JSON) surface; `incompatible-spec` preserves the manifest for diagnostics; both `load-error` sub-cases (missing extension file, default export failing its kind schema) surface; and a mixed scenario proves the kernel keeps going when one plugin in the search path is bad.

Classification: minor per `spec/versioning.md` §Pre-1.0. Second feature surface after Step 1a; `skill-map` bumps `0.3.0 → 0.4.0`.

Deferred to Step 2: `sm db migrate --kernel-only` / `--plugin <id>` (wait for real plugin migrations + triple protection), plugin-authored migrations themselves (require SQL AST parsing + prefix injection), and closing the typed-DTO gap.
