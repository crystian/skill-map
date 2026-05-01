/**
 * Strings emitted by `cli/commands/jobs.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const JOBS_TEXTS = {
  pruneErrorPrefix: 'sm job prune: {{message}}\n',
} as const;
