/**
 * CLI strings emitted by `sm db *` — `cli/commands/db.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Includes the `--dry-run` previews for `sm db reset` (default /
 * --state / --hard) and `sm db restore`, per `cli-contract.md`
 * §Dry-run.
 */

export const DB_TEXTS = {
  // --- reset -----------------------------------------------------------
  resetStateAndHardMutex: '--state and --hard are mutually exclusive.\n',

  resetCleared: 'Cleared {{tableCount}} table(s): {{tableNames}}\n',
  resetClearedNone: 'Cleared 0 table(s): (none)\n',

  resetHardConfirm: 'Delete DB file {{path}}?',
  resetHardDeleted: 'Deleted {{path}}\n',

  resetStateConfirm: 'Drop scan_* AND state_* in {{path}}?',

  // --- restore ---------------------------------------------------------
  restoreSourceNotFound: 'Backup not found: {{sourcePath}}\n',
  restoreConfirm: 'Restore {{sourcePath}} over {{target}}? This overwrites the current DB.',
  restoreDone: 'Restored {{sourcePath}} → {{target}}\n',

  // --- shared ----------------------------------------------------------
  aborted: 'Aborted.\n',

  // --- dry-run previews ------------------------------------------------
  dryRunHeader: '(dry-run — no DB writes, no file unlinks)\n',

  dryRunResetWouldClearNone:
    'would clear   0 table(s): (none — DB schema is empty)\n',

  // The `lines` arg is a pre-built multi-line block, one "  - name: N row(s)"
  // per table, joined with `\n`.
  dryRunResetWouldClearWithRowCounts:
    'would clear   {{tableCount}} table(s) ({{totalRows}} total row(s)):\n{{lines}}\n',

  dryRunResetHardWouldDelete: 'would delete  {{path}} ({{sizeBytes}} bytes)\n',
  dryRunResetHardWouldDeleteMissing:
    'would delete  {{path}} (file does not exist — no-op)\n',

  // The `targetClause` arg is one of two pre-built strings:
  //   "(exists, would be overwritten)"  /  "(does not exist, would be created)".
  dryRunRestoreWouldOverwrite:
    'would copy    {{sourcePath}} ({{sourceBytes}} bytes) → {{target}} {{targetClause}}\n' +
    'would delete  {{target}}-wal and {{target}}-shm sidecars if present\n',

  dryRunRestoreTargetExistsClause: '(exists, would be overwritten)',
  dryRunRestoreTargetMissingClause: '(does not exist, would be created)',
} as const;
