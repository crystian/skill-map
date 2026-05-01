/**
 * Strings emitted by `cli/commands/jobs.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const JOBS_TEXTS = {
  pruneErrorPrefix: 'sm job prune: {{message}}\n',

  // --- printPretty (sm job prune human output) ---------------------------
  pruneTagDryRun: 'sm job prune (dry-run)',
  pruneTagApply: 'sm job prune',
  pruneRetentionRow:
    '  {{label}} policy {{policy}}, {{rows}} row(s) {{rowsVerb}}, {{files}} file(s) {{filesVerb}}\n',
  pruneOrphanFilesRow: '  orphan-files: {{count}} file(s) {{verb}}\n',

  pruneRowsVerbDryRun: 'would be deleted',
  pruneRowsVerbApply: 'deleted',
  pruneFilesVerbDryRun: 'would be unlinked',
  pruneFilesVerbApply: 'unlinked',
  pruneOrphanFilesVerbDryRun: 'would be removed',
  pruneOrphanFilesVerbApply: 'removed',

  pruneLabelCompleted: 'completed:',
  pruneLabelFailed: 'failed:   ',

  pruneRetentionPolicyNever: 'never',
} as const;
