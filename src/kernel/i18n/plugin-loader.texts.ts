/**
 * Kernel-side strings emitted by `kernel/adapters/plugin-loader.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation. See
 * `kernel/i18n/orchestrator.texts.ts` header for rationale.
 *
 * Reasons split by failure mode (per `IDiscoveredPlugin.status`):
 *   - `invalid-manifest`  → manifest JSON unreadable / schema mismatch /
 *                            directory name does not match manifest id
 *   - `incompatible-spec` → `manifest.specCompat` does not satisfy the
 *                            installed spec version
 *   - `load-error`        → extension file missing, import failure,
 *                            wrong export shape, kind mismatch, schema
 *                            mismatch, OR import timeout
 *   - `id-collision`      → two plugins (any combination of roots, e.g.
 *                            project + global) declared the same `id`.
 *                            Both collided plugins are blocked; no
 *                            precedence rule applies.
 */

export const PLUGIN_LOADER_TEXTS = {
  invalidManifestJsonParse:
    '{{manifestPath}}: {{errDescription}}. Validate the JSON (e.g. `npx jsonlint plugin.json`).',

  invalidManifestAjv:
    '{{manifestPath}}: {{errors}}. See spec/schemas/plugins-registry.schema.json#/$defs/PluginManifest.',

  invalidSpecCompat:
    'specCompat "{{specCompat}}" is not a valid semver range. Use a range like "^1.0.0".',

  incompatibleSpec:
    '@skill-map/spec {{installedSpecVersion}} does not satisfy specCompat "{{specCompat}}". ' +
    "Either update the plugin's specCompat (and re-test) or pin sm to a compatible spec version.",

  loadErrorFileNotFound:
    'extension file not found: {{relEntry}} (resolved to {{abs}}). Check plugin.json#/extensions paths.',

  loadErrorImportFailed: '{{relEntry}}: import failed — {{errDescription}}',

  loadErrorMissingKind:
    '{{relEntry}}: default export missing a string `kind` field. Expected one of: {{knownKindsList}}.',

  loadErrorUnknownKind:
    '{{relEntry}}: unknown extension kind "{{kindReceived}}". Expected one of: {{knownKindsList}}.',

  loadErrorManifestInvalid:
    '{{relEntry}}: {{kind}} manifest invalid — {{errors}}. See spec/schemas/extensions/{{kind}}.schema.json.',

  importExceededTimeout:
    'import exceeded {{timeoutMs}}ms — likely a top-level side effect ' +
    '(network call, infinite loop, large blocking work). Move side effects ' +
    'into the runtime methods (`detect` / `evaluate` / `render` / etc.).',

  disabledByConfig: 'disabled by config_plugins or settings.json',

  invalidManifestDirMismatch:
    "directory name '{{dirName}}' does not match manifest id '{{manifestId}}'. " +
    'Rename the directory to match the id, or update the manifest id to match the directory.',

  idCollision:
    "Plugin '{{id}}' at {{pathA}} collides with the plugin at {{pathB}}. " +
    'Rename one and rerun.',

  loadErrorPluginIdMismatch:
    "{{relEntry}}: extension declares pluginId '{{declared}}' but its plugin.json declares id '{{manifestId}}'. " +
    'Remove the explicit pluginId from the extension — the loader injects it from plugin.json#/id.',

  loadErrorStorageSchemaRead:
    "plugin '{{pluginId}}' failed to load schema for table '{{table}}': {{schemaPath}} — {{errDescription}}",

  loadErrorStorageSchemaCompile:
    "plugin '{{pluginId}}' failed to compile schema for table '{{table}}': {{schemaPath}} — {{errDescription}}",

  loadErrorStorageKvSchemaRead:
    "plugin '{{pluginId}}' failed to load KV schema: {{schemaPath}} — {{errDescription}}",

  loadErrorStorageKvSchemaCompile:
    "plugin '{{pluginId}}' failed to compile KV schema: {{schemaPath}} — {{errDescription}}",

  invalidManifestHookUnknownTrigger:
    "Hook '{{hookId}}' declares unknown trigger '{{trigger}}'. Hookable triggers: {{hookableList}}.",

  invalidManifestHookEmptyTriggers:
    "Hook '{{hookId}}' declares no triggers. At least one entry from the curated set is required.",

  loadErrorPathEscapesPlugin:
    "extension entry '{{relEntry}}' resolves outside the plugin directory ({{pluginPath}}). Plugin entries must be relative paths inside the plugin tree.",

  loadErrorSchemaPathEscapesPlugin:
    "schema path '{{relPath}}' resolves outside the plugin directory ({{pluginPath}}). Plugin schemas must be relative paths inside the plugin tree.",
} as const;
