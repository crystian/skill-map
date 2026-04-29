/**
 * CLI strings emitted by `sm init` — `cli/commands/init.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Where the live mode would render plural-vs-singular text (e.g.
 * "1 entry" / "N entries"), we keep TWO templates and let the caller
 * pick. Conditional logic does not live inside the template.
 */

export const INIT_TEXTS = {
  alreadyInitialised: 'sm init: {{settingsPath}} already exists. Pass --force to overwrite.\n',

  gitignoreUpdatedSingular: 'Updated {{path}} (added 1 entry)\n',
  gitignoreUpdatedPlural: 'Updated {{path}} (added {{count}} entries)\n',

  initialised: 'Initialised {{skillMapDir}}\n',

  runningFirstScan: 'Running first scan...\n',

  configLoadFailure: 'sm init: {{message}}\n',

  scanFailed: 'sm init: scan failed: {{message}}\n',

  firstScanSummary: 'First scan: {{nodes}} node(s), {{links}} link(s), {{issues}} issue(s).\n',

  // --- dry-run previews --------------------------------------------------
  dryRunHeader: '(dry-run — no files written, no DB provisioned)\n',
  dryRunWouldCreateDir: 'would create   {{path}}/\n',
  dryRunWouldWriteFile: 'would write    {{path}}\n',
  dryRunWouldOverwriteFile: 'would overwrite {{path}}\n',
  dryRunWouldLeaveGitignoreUnchanged:
    'would leave    {{path}} unchanged (entries already present)\n',
  dryRunWouldUpdateGitignoreSingular:
    'would update   {{path}} (add 1 entry: {{entries}})\n',
  dryRunWouldUpdateGitignorePlural:
    'would update   {{path}} (add {{count}} entries: {{entries}})\n',
  dryRunWouldProvisionDb:
    'would provision DB at {{path}} (apply pending migrations)\n',
  dryRunWouldRunFirstScan: 'would run first scan (no persistence in dry-run)\n',
  dryRunWouldSkipFirstScan: 'would skip first scan (--no-scan)\n',
} as const;
