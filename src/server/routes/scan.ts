/**
 * `GET /api/scan` — return the latest persisted `ScanResult`.
 * `GET /api/scan?fresh=1` — run a fresh in-memory scan (no persist).
 *
 * Both branches return the `ScanResult` shape 1:1 with
 * `spec/schemas/scan-result.schema.json` (byte-equal to `sm scan --json`).
 * No envelope wrap — the SPA branches on the same `schemaVersion` field
 * as every other ScanResult consumer.
 *
 * Behavior:
 *
 *   - DB missing + no `?fresh=1` → return the kernel's empty `ScanResult`
 *     shape (zero nodes / links / issues, synthetic meta). Rationale:
 *     `/api/health` already reports `db: 'missing'`; the SPA polls health
 *     and decides whether to render an empty-state CTA. A hard 404 here
 *     would force the SPA to special-case two failure modes.
 *
 *   - DB present (with or without rows) → `loadScanResult` returns the
 *     persisted snapshot (an empty DB yields an empty ScanResult — same
 *     shape, no error).
 *
 *   - `?fresh=1` + server booted with `--no-built-ins` or `--no-plugins`
 *     → 400 `bad-query`. A fresh scan with neither pipeline yields an
 *     empty / partial result that surprises the caller.
 *
 *   - `?fresh=1` otherwise → run `runScanForCommand` against the server's
 *     `runtimeContext`; the result is returned without persistence (the
 *     scan-runner's `dryRun: true` branch).
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import type { ScanResult } from '../../kernel/index.js';
import { runScanForCommand } from '../../cli/util/scan-runner.js';
import { tryWithSqlite } from '../../cli/util/with-sqlite.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import type { IRouteDeps } from './deps.js';

export function registerScanRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/scan', async (c) => {
    const fresh = c.req.query('fresh');
    if (fresh === '1' || fresh === 'true') {
      return c.json(await runFreshScan(deps));
    }
    return c.json(await loadPersistedScan(deps));
  });
}

async function loadPersistedScan(deps: IRouteDeps): Promise<ScanResult> {
  const loaded = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false },
    (adapter) => adapter.scans.load(),
  );
  if (loaded !== null) return loaded;
  // DB file absent — return the empty ScanResult shape so the SPA can
  // render an empty state without special-casing two failure modes.
  return emptyScanResult();
}

async function runFreshScan(deps: IRouteDeps): Promise<ScanResult> {
  if (deps.options.noBuiltIns || deps.options.noPlugins) {
    throw new HTTPException(400, { message: SERVER_TEXTS.freshScanRequiresPipeline });
  }
  // `process.stderr` for plugin warnings — same surface the CLI uses.
  // Fresh scans through the BFF are a development affordance; warnings
  // belong in the server's own log stream, not the JSON response.
  const outcome = await runScanForCommand({
    roots: [deps.runtimeContext.cwd],
    noBuiltIns: false,
    noPlugins: false,
    noTokens: false,
    dryRun: true,
    changed: false,
    allowEmpty: true,
    strict: false,
    stderr: process.stderr,
    ctx: deps.runtimeContext,
  });
  if (outcome.kind !== 'ok') {
    throw new HTTPException(500, {
      message: outcome.kind === 'guard-trip'
        ? `fresh scan refused (existing rows: ${outcome.existing})`
        : outcome.message,
    });
  }
  return outcome.result;
}

/**
 * Empty `ScanResult` returned when the DB file is absent. Mirrors the
 * shape `loadScanResult` produces against an empty migrated DB so the
 * SPA never sees a structurally different payload.
 */
function emptyScanResult(): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: Date.now(),
    scope: 'project',
    roots: ['.'],
    providers: [],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

