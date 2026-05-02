/**
 * Strings emitted by `kernel/registry.ts`. Same `tx(template, vars)`
 * convention as every other `kernel/i18n/*.texts.ts` peer.
 *
 * These messages are thrown as `Error.message`; some surface to the user
 * via CLI verbs that catch them (e.g. `sm scan` registering manifests).
 */

export const REGISTRY_TEXTS = {
  duplicateExtension:
    'Extension already registered: {{kind}}:{{qualifiedId}}',

  unknownKind:
    'Unknown extension kind: {{kind}}',

  missingPluginId:
    'Extension {{kind}}:{{id}} is missing pluginId; built-ins declare it directly, user plugins have it injected by PluginLoader.',
} as const;
