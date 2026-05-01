/**
 * CLI strings emitted by `sm version` (`cli/commands/version.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const VERSION_TEXTS = {
  // One row of the human-mode version matrix. `key` is left-padded by the
  // command itself so the column width matches the widest label dynamically.
  matrixRow: '{{key}}{{value}}\n',
} as const;
