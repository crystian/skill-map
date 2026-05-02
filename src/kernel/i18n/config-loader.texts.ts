/**
 * Kernel-side strings emitted by the layered config loader
 * (`kernel/config/loader.ts`). Same `tx(template, vars)` convention as
 * every other `kernel/i18n/*.texts.ts` peer.
 *
 * These warnings are accumulated into `ILoadedConfig.warnings` and surface
 * to the user via `cli/commands/config.ts` (and any other call site that
 * dumps them to stderr). Keeping them in the catalog keeps every
 * user-facing string greppable in one place and unblocks a future
 * Transloco migration.
 *
 * Strict mode also throws these strings as `Error` messages — same text,
 * same template; the loader picks `throw` vs `push` based on the
 * `strict` flag.
 */

export const CONFIG_LOADER_TEXTS = {
  readFailure:
    '[config:{{layer}}] failed to read {{path}}: {{message}}',

  invalidJson:
    '[config:{{layer}}] invalid JSON in {{path}}: {{message}}',

  expectedObject:
    '[config:{{layer}}] expected a JSON object, got {{type}}; ignored',

  unknownKey:
    '[config:{{layer}}] unknown key {{key}} ignored',

  invalidValue:
    '[config:{{layer}}] invalid value at {{path}}: {{message}}',
} as const;
