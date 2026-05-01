/**
 * Strings emitted by `cli/commands/history.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const HISTORY_TEXTS = {
  noExecutionsFound: 'No executions found.\n',

  invalidIsoDateTime: '{{flag}}: expected an ISO-8601 date-time, got "{{value}}".\n',
  statusEmpty: '--status: expected one or more of {{allowed}}.\n',
  statusInvalid: '--status: invalid value "{{value}}". Allowed: {{allowed}}.\n',
} as const;
