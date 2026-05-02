/**
 * CLI strings emitted by `sm list` (`cli/commands/list.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const LIST_TEXTS = {
  invalidSortBy:
    '--sort-by: invalid sort field "{{value}}". Allowed: {{allowed}}.\n',

  noNodesFound: 'No nodes found.\n',

  // --- renderTable column headers ----------------------------------------
  tableHeaderPath: 'PATH',
  tableHeaderKind: 'KIND',
  tableHeaderOut: 'OUT',
  tableHeaderIn: 'IN',
  tableHeaderExt: 'EXT',
  tableHeaderIssues: 'ISSUES',
  tableHeaderBytes: 'BYTES',
} as const;
