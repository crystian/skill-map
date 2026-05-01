/**
 * Strings emitted by `cli/commands/export.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const EXPORT_TEXTS = {
  errorPrefix: 'sm export: {{message}}\n',
} as const;
