/**
 * Kernel-side strings emitted by `kernel/adapters/plugin-loader.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation. See
 * `kernel/i18n/orchestrator.texts.ts` header for rationale.
 *
 * Reasons split by failure mode (per `IDiscoveredPlugin.status`):
 *   - `invalid-manifest`  → manifest JSON unreadable / schema mismatch
 *   - `incompatible-spec` → `manifest.specCompat` does not satisfy the
 *                            installed spec version
 *   - `load-error`        → extension file missing, import failure,
 *                            wrong export shape, kind mismatch, schema
 *                            mismatch, OR import timeout
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
} as const;
