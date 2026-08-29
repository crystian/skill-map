/**
 * Per-node and per-spawn activity detail (see
 * `spec/provider-activity.md` §Execution stats + §Conversation capture):
 *
 *   - `GET /api/activity/node/:pathB64` → `{ stats, recent, spawns,
 *     captureEnabled, runs }` for the inspector's Activity section. The
 *     path param follows the exact base64url convention of
 *     `GET /api/nodes/:pathB64` (malformed → 404, same as unknown). A
 *     path that is not a scanned node → 404; a scanned node with no
 *     recorded activity → zeroed stats, never 404. `runs` is the node's
 *     persistent AI-run history (`state_executions`, newest-first,
 *     capped at 15, lean projection); a missing DB degrades to
 *     `runs: []` with the runtime half still answering.
 *   - `GET /api/activity/spawns/:spawnId` → one spawn record (the
 *     spawn-edge click surface), 404 for an unknown id.
 *   - `DELETE /api/activity/node/:pathB64` → the Activity clear-all:
 *     hard-deletes the node's `state_executions` rows (same JSON1
 *     containment the GET's `runs` filter uses), forgets its runtime
 *     stats + pair counters, and drops its retained spawn records.
 *     Regenerable machine data, so no consent (mirror of the summaries
 *     delete); success `204`, one `activity.clear` operations-log line.
 *
 * All are loopback-gated like every `/api/*` route and take NO
 * serve.json token (operator UI surface). Spawn records serve metadata
 * always; the conversation halves (`prompt` / `response`) are stripped
 * whenever the capture gate is off (`captureEnabled` rides every
 * response so the SPA can explain the gap). While the gate is off the
 * store is empty anyway (recording is a no-op and disabling clears),
 * so the strip is defence in depth, not the primary gate.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { appendOperation } from '../../core/operations-log.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import type {
  ExecutionFailureReason,
  ExecutionRecord,
  ExecutionStatus,
} from '../../kernel/types.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import type {
  ActivityConversationStore,
  IConversationRecord,
} from '../activity-conversations.js';
import type { ActivityStatsService } from '../activity-stats.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { decodeNodePath, PathCodecError } from '../path-codec.js';
import type { IRouteDeps } from './deps.js';

export interface IActivityDetailRouteDeps extends IRouteDeps {
  /** Boot-scoped stats accumulator (composition-root owned). */
  stats: ActivityStatsService;
  /**
   * Consent-gated conversation store. Explicit extra dep by custody
   * contract (never on `IRouteDeps`, see `activity-conversations.ts`).
   */
  conversations: ActivityConversationStore;
}

/**
 * Spec cap on the `runs` list (`spec/provider-activity.md`
 * §`GET /api/activity/node/<pathB64>`): newest-first, at most 15.
 */
export const RUNS_LIMIT = 15;

/**
 * One wire entry of the node's AI-run history. Identity + outcome only:
 * NO report content, NO nonce, NO `reportPath` (the wire stays lean and
 * leak-safe by construction).
 */
interface IRunEntry {
  executionId: string;
  extensionId: string;
  status: ExecutionStatus;
  model: string | null;
  durationMs: number | null;
  finishedAt: number | null;
  failureReason: ExecutionFailureReason | null;
}

/**
 * Outcome of the single per-request DB open. `null` from the seam means
 * the DB file is missing, which is NOT a 404: the runtime half still
 * answers, with `runs` degraded to `[]` (spec mandate).
 */
type TNodeDbRead =
  | { kind: 'unknown-node' }
  | { kind: 'found'; runs: IRunEntry[] };

export function registerActivityDetailRoutes(
  app: Hono,
  deps: IActivityDetailRouteDeps,
): void {
  app.get('/api/activity/node/:pathB64', async (c) => {
    const nodePath = decodePathParamOr404(c.req.param('pathB64'));
    const dbRead = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      async (adapter): Promise<TNodeDbRead> => {
        if ((await adapter.scans.findNode(nodePath)) === null) return { kind: 'unknown-node' };
        const executions = await adapter.history.list({ nodePath, limit: RUNS_LIMIT });
        return { kind: 'found', runs: executions.map(projectRun) };
      },
    );
    if (dbRead?.kind === 'unknown-node') {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
      });
    }
    const runs = dbRead === null ? [] : dbRead.runs;
    const detail = deps.stats.nodeDetail(nodePath);
    const captureEnabled = deps.conversations.enabled;
    const spawns = deps.conversations
      .byNode(nodePath)
      .map((record) => projectRecord(record, captureEnabled));
    return c.json({ stats: detail.stats, recent: detail.recent, spawns, captureEnabled, runs });
  });

  app.delete('/api/activity/node/:pathB64', async (c) => {
    const nodePath = decodePathParamOr404(c.req.param('pathB64'));
    // Missing DB (`null` from the seam) is NOT a 404: the runtime half
    // still clears, mirroring the GET's degradation. Unknown node IS a
    // 404, same posture as the GET (same discriminated shape, since the
    // seam already spends `null` on "no DB").
    const dbResult = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (
        adapter,
      ): Promise<{ kind: 'unknown-node' } | { kind: 'cleared'; runs: number }> => {
        if ((await adapter.scans.findNode(nodePath)) === null) return { kind: 'unknown-node' };
        const runs = await adapter.history.deleteForNode(nodePath);
        await adapter.activity.deleteNode(nodePath);
        return { kind: 'cleared', runs };
      },
    );
    if (dbResult?.kind === 'unknown-node') {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
      });
    }
    const runs = dbResult === null ? 0 : dbResult.runs;
    deps.stats.clearNode(nodePath);
    const spawns = deps.conversations.deleteByNode(nodePath);
    appendOperation(deps.runtimeContext.cwd, {
      op: 'activity.clear',
      target: nodePath,
      channel: 'ui',
      outcome: 'ok',
      detail: `runs=${runs} spawns=${spawns}`,
    });
    return c.body(null, 204);
  });

  app.get('/api/activity/spawns/:spawnId', (c) => {
    const spawnId = c.req.param('spawnId');
    const record = deps.conversations.bySpawnId(spawnId);
    if (!record) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.activitySpawnUnknown, {
          spawnId: sanitizeForTerminal(spawnId),
        }),
      });
    }
    const captureEnabled = deps.conversations.enabled;
    return c.json({ spawn: projectRecord(record, captureEnabled), captureEnabled });
  });
}

/**
 * Mirror of the `GET /api/nodes/:pathB64` decode convention: malformed
 * base64url surfaces as 404 (from the client's view there's no such
 * node either way).
 */
function decodePathParamOr404(pathB64: string): string {
  try {
    return decodeNodePath(pathB64);
  } catch (err) {
    if (err instanceof PathCodecError) {
      throw new HTTPException(404, { message: SERVER_TEXTS.pathB64Malformed });
    }
    throw err;
  }
}

/**
 * Lean wire projection of one `state_executions` row (the spec `runs`
 * entry shape). Optional-and-absent audit fields flatten to `null`;
 * everything not named here (report content, `reportPath`, `jobId`,
 * token counts) never reaches the wire.
 */
function projectRun(exec: ExecutionRecord): IRunEntry {
  return {
    executionId: exec.id,
    extensionId: exec.extensionId,
    status: exec.status,
    model: exec.model ?? null,
    durationMs: exec.durationMs ?? null,
    finishedAt: exec.finishedAt,
    failureReason: exec.failureReason ?? null,
  };
}

/** Metadata-only projection while the gate is off; verbatim copy when on. */
function projectRecord(
  record: IConversationRecord,
  captureEnabled: boolean,
): IConversationRecord {
  if (captureEnabled) return record;
  const { prompt: _prompt, response: _response, ...metadata } = record;
  return metadata;
}
