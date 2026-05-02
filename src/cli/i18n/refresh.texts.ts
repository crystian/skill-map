/**
 * CLI strings emitted by `sm refresh` and `sm refresh --stale`
 * (`cli/commands/refresh.ts`).
 *
 * `sm refresh` is the granular companion to the universal enrichment
 * layer (spec § A.8). It re-runs Extractors against a single node (or
 * the set of nodes whose probabilistic enrichment rows are flagged
 * `stale`) so the kernel-curated overlay refreshes against the current
 * body. Pre-job-subsystem the prob path is stubbed; det extractors run
 * for real.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const REFRESH_TEXTS = {
  // --- argument validation --------------------------------------------------
  nodeAndStaleMutex:
    'sm refresh: --stale cannot be combined with a positional <node.path>.\n',

  noTargetSpecified:
    'sm refresh: pass <node.path> for a single-node refresh, or --stale to ' +
    'refresh every node with a stale enrichment row.\n',

  // --- node lookup ----------------------------------------------------------
  nodeNotFound:
    'sm refresh: node not found in the persisted scan: {{nodePath}}\n' +
    'Run `sm scan` first, then retry with the path as it appears in `sm list`.\n',

  // --- happy path -----------------------------------------------------------
  refreshingNode: 'Refreshing enrichments for {{nodePath}}\n',
  refreshingStale:
    'Refreshing {{count}} stale enrichment row(s) across {{nodeCount}} node(s).\n',

  refreshingStaleNone:
    'sm refresh --stale: no stale enrichment rows in the DB. Nothing to do.\n',

  // --- summary --------------------------------------------------------------
  detPersisted:
    'Persisted {{detCount}} deterministic enrichment row(s).\n',

  // --- prob stub ------------------------------------------------------------
  probStubSkipped:
    'sm refresh: probabilistic refresh requires the job subsystem (Step 10). ' +
    'Stub implementation: skipped {{count}} probabilistic extractor invocation(s) ' +
    'across {{nodeCount}} node(s). Full probabilistic refresh lands when the job ' +
    'subsystem ships.\n',

  // --- failures -------------------------------------------------------------
  refreshFailed: 'sm refresh: {{message}}\n',

  /**
   * Sub-detail composed inside `refreshFailed` when the failure is a
   * filesystem read on a specific node body. Catalogued separately so the
   * "read failed for <path>: <err>" copy lives in the i18n surface, not
   * in a TS string template.
   */
  readFailedDetail: 'read failed for {{path}}: {{message}}',
} as const;
