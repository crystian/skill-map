/**
 * CLI strings emitted by `sm list` (`cli/commands/list.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const LIST_TEXTS = {
  invalidSortBy:
    '--sort-by: invalid sort field "{{value}}". Allowed: {{allowed}}.\n',

  invalidLimit: '--limit: expected a positive integer, got "{{value}}".\n',

  noNodesFound: 'No nodes found.\n',
} as const;
