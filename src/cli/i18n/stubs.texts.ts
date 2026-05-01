/**
 * Strings emitted by `cli/commands/stubs.ts` (placeholder verbs that
 * aren't implemented yet).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const STUBS_TEXTS = {
  notImplemented: '{{verb}}: not yet implemented (planned).\n',
} as const;
