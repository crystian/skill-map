/**
 * Strings emitted by `cli/commands/orphans.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ORPHANS_TEXTS = {
  noIssues: 'No orphan / auto-rename issues.\n',
  aborted: 'Aborted.\n',
} as const;
