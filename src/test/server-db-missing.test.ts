/**
 * DB-resilience tests for `sm serve` (Step 14.1).
 *
 * Two contracts:
 *
 *   1. `sm serve --db <missing>` exits with `ExitCode.NotFound` (5) and
 *      writes a clear hint to stderr. The `--db` flag is the explicit
 *      escape hatch; if the user named a path, missing means error.
 *   2. With no `--db` and no project DB, the server boots cleanly. The
 *      `/api/health` endpoint reports `db: 'missing'` so the SPA can
 *      render an empty-state CTA. Boot resilience is the documented
 *      14.1 behaviour (Decision-locked at the Step 14 pivot).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Builtins, Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { ServeCommand } from '../cli/commands/serve.js';
import { ExitCode } from '../cli/util/exit-codes.js';
import { createServer, type IServerOptions } from '../server/index.js';

interface ICapture {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapture {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-server-db-missing-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm serve — DB resilience', () => {
  it('exits 5 (NotFound) when --db <path> does not exist', async () => {
    const missing = join(tmpRoot, 'never-existed.db');
    const cap = captureContext();
    const cli = new Cli({ binaryName: 'sm', binaryLabel: 'skill-map', binaryVersion: '0.0.0' });
    cli.register(Builtins.HelpCommand);
    cli.register(ServeCommand);

    const exit = await cli.run(['serve', '--db', missing], cap.context);
    assert.equal(exit, ExitCode.NotFound);
    assert.match(cap.stderr(), /--db .* does not exist/, cap.stderr());
  });

  it('boots cleanly when the default DB is absent and reports db: missing on /api/health', async () => {
    // Boot the server directly via `createServer` so we control the
    // listener lifecycle (Cli.run would never return for a long-running
    // verb). The flag-mediated path that the verb takes when the project
    // DB is missing is exercised in `server-boot.test.ts`'s db-state test;
    // here we drive the kernel boundary directly to assert no surprising
    // exception leaks out.
    const opts: IServerOptions = {
      port: 0,
      host: '127.0.0.1',
      scope: 'project',
      dbPath: join(tmpRoot, 'absent', '.skill-map', 'skill-map.db'),
      uiDist: null,
      noBuiltIns: false,
      noPlugins: false,
      open: false,
      devCors: false,
    };

    const handle = await createServer(opts);
    try {
      const res = await fetch(`http://127.0.0.1:${handle.address.port}/api/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['db'], 'missing', 'expected health to report db: missing');
      assert.equal(body['ok'], true);
    } finally {
      await handle.close();
    }
  });
});
