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
  backupWritten: 'Backup written: {{outPath}}\n',

  // --- migrate (sm db migrate) -----------------------------------------
  migrateKernelOnlyAndPluginMutex: '--kernel-only and --plugin are mutually exclusive.\n',
  migratePluginNotFound:
    '--plugin {{pluginId}}: no loaded plugin with that id and `storage.mode = "dedicated"`.\n',
  migrateStatusKernelHeader: 'kernel · Applied: {{applied}} · Pending: {{pending}}\n',
  migrateStatusPluginHeader:
    '\nplugin {{pluginId}} · Applied: {{applied}} · Pending: {{pending}}\n',
  migrateStatusPending: '  pending  {{name}}\n',
  migrateStatusApplied: '  applied  {{name}}\n',
  migrateInvalidTo: '--to expects an integer, got {{to}}\n',

  // --- shell / dump (system sqlite3 binary required) ------------------
  shellSqlite3NotFound:
    'sqlite3 binary not found on PATH. Install it (macOS: brew install sqlite; Debian/Ubuntu: apt install sqlite3) or use `sm db dump` for read-only inspection.\n',
  dumpSqlite3NotFound:
    'sqlite3 binary not found on PATH. Install it to use `sm db dump`.\n',
  dumpInvalidTable:
    '--tables: refusing non-identifier name {{table}}. Table names must match [a-zA-Z_][a-zA-Z0-9_]*\n',

  // --- plugin migration runner -----------------------------------------
  pluginMigrateFailure: 'plugin {{pluginId}} · {{reason}}\n',
  pluginMigrateDryNothing: 'plugin {{pluginId}} · Nothing to apply.\n',
  pluginMigrateDryHeader:
    'plugin {{pluginId}} · Would apply {{count}} migration(s):\n{{lines}}\n',
  pluginMigrateUpToDate: 'plugin {{pluginId}} · Already up to date.\n',
  pluginMigrateApplied: 'plugin {{pluginId}} · Applied {{count}} migration(s)\n',
  pluginMigrateIntrusion:
    'plugin {{pluginId}} · catalog intrusion detected: {{intrusions}}\n',

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
