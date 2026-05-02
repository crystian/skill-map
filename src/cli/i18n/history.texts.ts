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

  periodInvalid: '--period: invalid value "{{value}}". Allowed: {{allowed}}.\n',
  schemaValidationFailed: 'internal: history-stats output failed schema validation — {{errors}}\n',

  // --- renderStats labels ------------------------------------------------
  statsAllTimeWindow: '(all time)',
  statsWindow: 'Window: {{since}} → {{until}}\n',
  statsTotals:
    'Totals: {{count}} executions ({{ok}} ok, {{failed}} failed) — ' +
    'tokens {{tokensIn}} in / {{tokensOut}} out — duration {{duration}}\n',
  statsGlobalErrorRate: 'Global error rate: {{rate}}%\n',
  statsTopActionsHeader: 'Top actions by tokens:\n',
  statsTopActionsRow: '  {{id}}@{{version}}: {{runs}} runs, {{tokensIn}} in / {{tokensOut}} out\n',
  statsTopNodesHeader: 'Top nodes:\n',
  statsTopNodesRow: '  {{path}}: {{runs}} runs\n',
  statsFailuresByReasonHeader: 'Failures by reason:\n',
  statsFailuresByReasonRow: '  {{reason}}: {{count}}\n',

  /**
   * Status cell composition: `<status> (<failureReason>)` when a failure
   * reason is present, plain `<status>` otherwise. Caller picks the
   * variant.
   */
  statusWithReason: '{{status}} ({{reason}})',

  // --- renderTable labels ------------------------------------------------
  tableHeaderId: 'ID',
  tableHeaderStarted: 'STARTED',
  tableHeaderAction: 'ACTION',
  tableHeaderStatus: 'STATUS',
  tableHeaderDuration: 'DURATION',
  tableHeaderTokens: 'TOKENS',
  tableHeaderNodes: 'NODES',
} as const;
