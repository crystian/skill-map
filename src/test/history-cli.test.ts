/**
 * Step 5.3 / 5.4 acceptance tests for `sm history` and `sm history stats`.
 *
 * Tests instantiate each Command class directly and call `execute()`
 * against a captured context (same pattern as `scan-readers.test.ts`). DB
 * is primed via `insertExecution` since `sm record` (the production
 * writer) doesn't land until Step 9.
 */

import { describe, it, before, after } from 'node:test';
import {
  deepStrictEqual,
  match,
  ok,
  strictEqual,
} from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import {
  HistoryCommand,
  HistoryStatsCommand,
} from '../cli/commands/history.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { insertExecution } from '../kernel/adapters/sqlite/history.js';
import { loadSchemaValidators } from '../kernel/adapters/schema-validators.js';
import type { ExecutionRecord, HistoryStats } from '../kernel/types.js';

let tmpRoot: string;
let counter = 0;

function freshDbPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.db`);
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-history-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

interface IHistoryOverrides {
  db?: string | undefined;
  global?: boolean;
  node?: string | undefined;
  action?: string | undefined;
  status?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  limit?: string | undefined;
  json?: boolean;
  quiet?: boolean;
}

function buildHistory(overrides: IHistoryOverrides = {}): HistoryCommand {
  const cmd = new HistoryCommand();
  cmd.global = overrides.global ?? false;
  cmd.db = overrides.db;
  cmd.node = overrides.node;
  cmd.action = overrides.action;
  cmd.status = overrides.status;
  cmd.since = overrides.since;
  cmd.until = overrides.until;
  cmd.limit = overrides.limit;
  cmd.json = overrides.json ?? false;
  cmd.quiet = overrides.quiet ?? true; // tests run quiet by default
  return cmd;
}

interface IHistoryStatsOverrides {
  db?: string | undefined;
  global?: boolean;
  since?: string | undefined;
  until?: string | undefined;
  period?: string | undefined;
  top?: string | undefined;
  json?: boolean;
  quiet?: boolean;
}

function buildHistoryStats(overrides: IHistoryStatsOverrides = {}): HistoryStatsCommand {
  const cmd = new HistoryStatsCommand();
  cmd.global = overrides.global ?? false;
  cmd.db = overrides.db;
  cmd.since = overrides.since;
  cmd.until = overrides.until;
  cmd.period = overrides.period;
  cmd.top = overrides.top;
  cmd.json = overrides.json ?? false;
  cmd.quiet = overrides.quiet ?? true;
  return cmd;
}

function makeExec(partial: Partial<ExecutionRecord> & Pick<ExecutionRecord, 'id' | 'startedAt'>): ExecutionRecord {
  return {
    kind: 'action',
    extensionId: 'a1',
    extensionVersion: '1.0.0',
    nodeIds: ['skills/foo.md'],
    contentHash: null,
    status: 'completed',
    failureReason: null,
    exitCode: 0,
    runner: 'cli',
    finishedAt: partial.startedAt + 1000,
    durationMs: 1000,
    tokensIn: 10,
    tokensOut: 5,
    reportPath: null,
    jobId: null,
    ...partial,
  };
}

async function primeFiveExecs(dbPath: string): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    const t0 = Date.UTC(2026, 3, 26, 10, 0, 0, 0);
    const day = 24 * 60 * 60 * 1000;
    await insertExecution(adapter.db, makeExec({ id: 'e1', startedAt: t0,         extensionId: 'a1', nodeIds: ['skills/foo.md'] }));
    await insertExecution(adapter.db, makeExec({ id: 'e2', startedAt: t0 + day,   extensionId: 'a1', nodeIds: ['skills/bar.md'], status: 'failed', failureReason: 'timeout' }));
    await insertExecution(adapter.db, makeExec({ id: 'e3', startedAt: t0 + 2*day, extensionId: 'a2', nodeIds: ['skills/foo.md'] }));
    await insertExecution(adapter.db, makeExec({ id: 'e4', startedAt: t0 + 3*day, extensionId: 'a2', nodeIds: ['skills/foo.md', 'skills/bar.md'], status: 'cancelled', failureReason: 'user-cancelled' }));
    await insertExecution(adapter.db, makeExec({ id: 'e5', startedAt: t0 + 4*day, extensionId: 'a2', nodeIds: ['skills/foo.md'], tokensIn: 100, tokensOut: 50 }));
  } finally {
    await adapter.close();
  }
}

// --- sm history -----------------------------------------------------------

describe('sm history', () => {
  it('DB missing → exit 5 with helpful stderr', async () => {
    const cap = captureContext();
    const cmd = buildHistory({ db: '/nope/missing.db' });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 5);
    match(cap.stderr(), /DB not found/);
  });

  it('empty DB → exit 0, "No executions found." human path', async () => {
    const dbPath = freshDbPath('history-empty');
    // init schema by opening once
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);
    match(cap.stdout(), /No executions found/);
  });

  it('--json emits an array conforming to execution-record.schema.json', async () => {
    const dbPath = freshDbPath('history-json');
    await primeFiveExecs(dbPath);

    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);

    const parsed = JSON.parse(cap.stdout()) as unknown[];
    ok(Array.isArray(parsed), 'array shape');
    strictEqual(parsed.length, 5);

    const validators = loadSchemaValidators();
    for (const exec of parsed) {
      const result = validators.validate('execution-record', exec);
      ok(result.ok, `each row validates: ${result.ok ? '' : result.errors}`);
    }
  });

  it('-n filters by nodePath (JSON-array containment)', async () => {
    const dbPath = freshDbPath('history-node');
    await primeFiveExecs(dbPath);

    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath, node: 'skills/bar.md', json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);
    const parsed = JSON.parse(cap.stdout()) as ExecutionRecord[];
    deepStrictEqual(parsed.map((r) => r.id).sort(), ['e2', 'e4']);
  });

  it('--status accepts a comma-separated subset', async () => {
    const dbPath = freshDbPath('history-status');
    await primeFiveExecs(dbPath);

    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath, status: 'failed,cancelled', json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);
    const parsed = JSON.parse(cap.stdout()) as ExecutionRecord[];
    deepStrictEqual(parsed.map((r) => r.id).sort(), ['e2', 'e4']);
  });

  it('--since inclusive, --until exclusive boundary', async () => {
    const dbPath = freshDbPath('history-window');
    await primeFiveExecs(dbPath);

    const since = new Date(Date.UTC(2026, 3, 27, 10, 0, 0, 0)).toISOString();
    const until = new Date(Date.UTC(2026, 3, 29, 10, 0, 0, 0)).toISOString();
    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath, since, until, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);
    const parsed = JSON.parse(cap.stdout()) as ExecutionRecord[];
    // since covers e2 onward; until excludes e4 (exact match) and beyond.
    deepStrictEqual(parsed.map((r) => r.id).sort(), ['e2', 'e3']);
  });

  it('--since with malformed ISO → exit 2', async () => {
    const dbPath = freshDbPath('history-bad-iso');
    await primeFiveExecs(dbPath);

    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath, since: 'not-a-date' });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 2);
    match(cap.stderr(), /--since: expected an ISO-8601/);
  });

  it('--status with unknown value → exit 2', async () => {
    const dbPath = freshDbPath('history-bad-status');
    await primeFiveExecs(dbPath);

    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath, status: 'completed,bogus' });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 2);
    match(cap.stderr(), /--status: invalid value/);
  });

  it('--limit non-positive integer → exit 2', async () => {
    const dbPath = freshDbPath('history-bad-limit');
    await primeFiveExecs(dbPath);

    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath, limit: '-1' });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 2);
    match(cap.stderr(), /--limit: expected a positive integer/);
  });
});

// --- Step 5.10 polish: human table column widths --------------------------

describe('sm history (human renderer — Step 5.10)', () => {
  it('table columns do not collapse: ISO STARTED is separated from ACTION by ≥2 spaces', async () => {
    const dbPath = freshDbPath('history-cols');
    await primeFiveExecs(dbPath);

    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);

    const out = cap.stdout();
    // Each data row must contain the ISO timestamp followed by ≥2 spaces
    // before the action id. With the pre-5.10 padEnd(11), the 20-char ISO
    // would get zero padding and pegarse al action — the regex below
    // catches that regression.
    const isoSep = /2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z {2,}\S/;
    ok(isoSep.test(out), `STARTED column must be separated from ACTION; got:\n${out}`);
  });

  it('Step 5.11: failed/cancelled rows show failure_reason in human STATUS column', async () => {
    const dbPath = freshDbPath('history-failure-reason');
    await primeFiveExecs(dbPath);

    const cap = captureContext();
    const cmd = buildHistory({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);

    const out = cap.stdout();
    // primeFiveExecs seeds e2 as failed/timeout and e3 as cancelled/user-cancelled.
    match(out, /failed \(timeout\)/);
    match(out, /cancelled \(user-cancelled\)/);
    // completed rows MUST stay just "completed" (no parens noise).
    ok(/completed(?! \()/.test(out), 'completed rows must not gain a (reason) suffix');
  });
});

// --- sm history stats -----------------------------------------------------

describe('sm history stats', () => {
  it('--json self-validates against history-stats.schema.json', async () => {
    const dbPath = freshDbPath('stats-json');
    await primeFiveExecs(dbPath);

    const cap = captureContext();
    const cmd = buildHistoryStats({ db: dbPath, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);

    const parsed = JSON.parse(cap.stdout()) as HistoryStats;
    strictEqual(parsed.schemaVersion, 1);
    ok(typeof parsed.elapsedMs === 'number' && parsed.elapsedMs >= 0);
    // All 6 failure-reason keys present.
    strictEqual(Object.keys(parsed.errorRates.perFailureReason).length, 6);
  });

  it('--period day buckets executions by UTC day', async () => {
    const dbPath = freshDbPath('stats-day');
    await primeFiveExecs(dbPath);

    // Explicit window — `primeFiveExecs` seeds 2026-04-26 .. 2026-04-30,
    // which is in the future for the test runner's wall-clock today and
    // would otherwise be excluded by the default `--until = Date.now()`.
    const cap = captureContext();
    const cmd = buildHistoryStats({
      db: dbPath,
      since: '2026-04-26T00:00:00Z',
      until: '2026-05-01T00:00:00Z',
      period: 'day',
      json: true,
    });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);
    const parsed = JSON.parse(cap.stdout()) as HistoryStats;
    strictEqual(parsed.executionsPerPeriod.length, 5);
    // First bucket covers t0 (2026-04-26) → ISO string.
    strictEqual(
      parsed.executionsPerPeriod[0]!.periodStart,
      new Date(Date.UTC(2026, 3, 26, 0, 0, 0, 0)).toISOString(),
    );
    strictEqual(parsed.executionsPerPeriod[0]!.periodUnit, 'day');
  });

  it('--period invalid → exit 2', async () => {
    const dbPath = freshDbPath('stats-bad-period');
    await primeFiveExecs(dbPath);
    const cap = captureContext();
    const cmd = buildHistoryStats({ db: dbPath, period: 'year' });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 2);
    match(cap.stderr(), /--period: invalid value/);
  });

  // Audit H2 — `extension_id` flows from extension code (action manifest
  // → `state_executions.extension_id` row → human renderer
  // `tokensPerAction`). A hostile or buggy action could plant a C0
  // escape in its id; the human renderer must sanitize before printing
  // so the user's terminal does not get repainted by a row in the
  // table. JSON path is unaffected (escapes get JSON-encoded).
  it('audit H2 — human renderer strips C0 escapes from extension_id (tokensPerAction column)', async () => {
    const dbPath = freshDbPath('stats-sanitize');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      // The schema does not CHECK `extension_id`, so a raw insert can
      // plant arbitrary bytes — the same path a hostile action would
      // take when persisting its execution record.
      const t0 = Date.UTC(2026, 3, 26, 10, 0, 0, 0);
      await insertExecution(
        adapter.db,
        makeExec({
          id: 'evil-1',
          startedAt: t0,
          extensionId: 'shouty\x1b[2J',
          nodeIds: ['skills/foo.md'],
          tokensIn: 100,
          tokensOut: 50,
        }),
      );
    } finally {
      await adapter.close();
    }

    const cap = captureContext();
    const cmd = buildHistoryStats({
      db: dbPath,
      since: '2026-04-25T00:00:00Z',
      until: '2026-05-01T00:00:00Z',
    });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);
    const out = cap.stdout();
    // The visible portion of the id ("shouty") must remain; the ESC
    // byte must NOT appear anywhere in stdout.
    ok(out.includes('shouty'), `expected visible id portion in stdout; got:\n${out}`);
    ok(!out.includes('\x1b'), `expected no ESC byte in stdout; got:\n${JSON.stringify(out)}`);
  });

  it('--top caps the topNodes length', async () => {
    const dbPath = freshDbPath('stats-top');
    await primeFiveExecs(dbPath);
    const cap = captureContext();
    const cmd = buildHistoryStats({
      db: dbPath,
      since: '2026-04-26T00:00:00Z',
      until: '2026-05-01T00:00:00Z',
      top: '1',
      json: true,
    });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);
    const parsed = JSON.parse(cap.stdout()) as HistoryStats;
    strictEqual(parsed.topNodes.length, 1);
    // foo.md has 4 vs bar.md 2 — foo wins.
    strictEqual(parsed.topNodes[0]!.nodePath, 'skills/foo.md');
  });

  it('range.since: null when --since omitted, ISO string when present', async () => {
    const dbPath = freshDbPath('stats-range');
    await primeFiveExecs(dbPath);

    const cap1 = captureContext();
    const cmd1 = buildHistoryStats({ db: dbPath, json: true });
    cmd1.context = cap1.context;
    await cmd1.execute();
    const noSince = JSON.parse(cap1.stdout()) as HistoryStats;
    strictEqual(noSince.range.since, null);

    const cap2 = captureContext();
    const cmd2 = buildHistoryStats({
      db: dbPath,
      since: '2026-04-25T00:00:00Z',
      json: true,
    });
    cmd2.context = cap2.context;
    await cmd2.execute();
    const withSince = JSON.parse(cap2.stdout()) as HistoryStats;
    strictEqual(withSince.range.since, '2026-04-25T00:00:00.000Z');
  });

  it('empty DB → exit 0, all-zero totals, all 6 failure-reason keys present', async () => {
    const dbPath = freshDbPath('stats-empty');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const cap = captureContext();
    const cmd = buildHistoryStats({ db: dbPath, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();
    strictEqual(code, 0);
    const parsed = JSON.parse(cap.stdout()) as HistoryStats;
    strictEqual(parsed.totals.executionsCount, 0);
    strictEqual(parsed.errorRates.global, 0);
    strictEqual(Object.keys(parsed.errorRates.perFailureReason).length, 6);
  });
});
