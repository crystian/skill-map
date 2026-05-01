/**
 * Strings emitted by `cli/commands/config.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const CONFIG_TEXTS = {
  unknownKey: 'Unknown config key: {{key}}\n',
  valueWithLayer: '{{value}}  (from {{layer}})\n',
  invalidAfterSet: 'Invalid config after set: {{errors}}\n',
  setWritten: '{{key}} = {{value}}  (wrote {{path}})\n',
  unsetNoOverride: 'No override at {{path}} for {{key}}\n',
  unsetRemoved: 'Removed {{key}} from {{path}}\n',
} as const;
