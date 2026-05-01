/**
 * CLI strings emitted by `sm watch` (alias `sm scan --watch`) —
 * `cli/commands/watch.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const WATCH_TEXTS = {
  configLoadFailure: 'sm watch: {{message}}\n',

  initialScanFailed: 'sm watch: initial scan failed — {{message}}\n',

  batchFailed: 'sm watch: batch failed — {{message}}\n',

  scanFailed: 'sm watch: scan failed — {{message}}\n',

  watcherError: 'sm watch: watcher error — {{message}}\n',

  starting: 'sm watch: starting on {{rootsCount}} root(s), debounce {{debounceMs}}ms\n',

  ready: 'sm watch: ready. Press Ctrl+C to stop.\n',

  stopped: 'sm watch: stopped after {{batchCount}} batch(es).\n',

  scannedSummary:
    'scanned {{nodes}} nodes / {{links}} links / {{issues}} issues in {{durationMs}}ms\n',

  priorSchemaValidationFailed:
    'prior scan-result loaded from DB failed schema validation: {{errors}}',
} as const;
