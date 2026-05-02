/**
 * Invariant test for spec/cli-contract.md §Elapsed time:
 *
 *   "<verb> MUST report wall-clock duration on stderr as `done in <…>`"
 *
 * This file gates every read-side verb that honours `--db` so the
 * trailing line cannot regress silently. Verbs that depend on the
 * cwd (`sm scan`, `sm init`) or external binaries (`sm db dump`,
 * `sm db shell`) are out of scope for this matrix; their dedicated
 * `*-cli.test.ts` files cover the lifecycle.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { BaseContext } from 'clipanion';

import { CheckCommand } from '../cli/commands/check.js';
import { DbMigrateCommand } from '../cli/commands/db.js';
import { ExportCommand } from '../cli/commands/export.js';
import { HistoryCommand, HistoryStatsCommand } from '../cli/commands/history.js';
import { ListCommand } from '../cli/commands/list.js';
import { PluginsDoctorCommand, PluginsListCommand } from '../cli/commands/plugins.js';
import { ShowCommand } from '../cli/commands/show.js';
import type { SmCommand } from '../cli/util/sm-command.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';

const ELAPSED_REGEX = /^done in (\d+ms|\d+\.\d+s|\d+m \d+s)\n?$/m;

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
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
let dbPath: string;
let nodePath: string;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-elapsed-'));
  // The invariant being asserted ("`done in <…>` is always emitted")
  // does NOT require a populated DB — the trailing line lives in
  // SmCommand's `finally` block and fires even on read-side failures
  // (NotFound / Error). An empty migrated DB is enough for every
  // verb's `assertDbExists` precondition to clear, then their own
  // body returns whatever it likes.
  nodePath = '.claude/agents/architect.md';
  dbPath = join(tmpRoot, 'skill-map.db');
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  await adapter.close();
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface IInvariantCase<T extends SmCommand> {
  cmd: T;
  capture: ICapturedContext;
}

/**
 * Reset SmCommand globals to runtime defaults. Without this, freshly
 * instantiated Clipanion commands hold the un-resolved `Option.*`
 * descriptors instead of the fallback values, so reads like
 * `this.quiet` see an object instead of `false`. The same workaround
 * shows up in `scan-readers.test.ts:buildList` for verb-local options.
 */
function applySmDefaults(cmd: SmCommand): void {
  cmd.global = false;
  cmd.json = false;
  cmd.quiet = false;
  cmd.noColor = false;
  cmd.verbose = 0;
  cmd.db = dbPath;
}

function build<T extends SmCommand>(
  ctor: new () => T,
  configure: (cmd: T) => void = () => {},
): IInvariantCase<T> {
  const cap = captureContext();
  const cmd = new ctor();
  applySmDefaults(cmd);
  configure(cmd);
  cmd.context = cap.context;
  return { cmd, capture: cap };
}

describe('spec § Elapsed time — every read-side verb emits `done in <…>` on stderr', () => {
  it('sm check', async () => {
    const c = build(CheckCommand, (cmd) => {
      cmd.node = undefined;
      cmd.rules = undefined;
      cmd.includeProb = false;
      cmd.async = false;
      cmd.noPlugins = false;
    });
    await c.cmd.execute();
    assert.match(c.capture.stderr(), ELAPSED_REGEX, c.capture.stderr());
  });

  it('sm list', async () => {
    const c = build(ListCommand, (cmd) => {
      cmd.kind = undefined;
      cmd.issue = false;
      cmd.sortBy = undefined;
      cmd.limit = undefined;
    });
    await c.cmd.execute();
    assert.match(c.capture.stderr(), ELAPSED_REGEX, c.capture.stderr());
  });

  it('sm show', async () => {
    const c = build(ShowCommand, (cmd) => { cmd.nodePath = nodePath; });
    await c.cmd.execute();
    assert.match(c.capture.stderr(), ELAPSED_REGEX, c.capture.stderr());
  });

  it('sm export', async () => {
    const c = build(ExportCommand, (cmd) => {
      cmd.query = '';
      cmd.format = 'json';
    });
    await c.cmd.execute();
    assert.match(c.capture.stderr(), ELAPSED_REGEX, c.capture.stderr());
  });

  it('sm history', async () => {
    const c = build(HistoryCommand, (cmd) => {
      cmd.node = undefined;
      cmd.action = undefined;
      cmd.status = undefined;
      cmd.since = undefined;
      cmd.until = undefined;
      cmd.limit = undefined;
    });
    await c.cmd.execute();
    assert.match(c.capture.stderr(), ELAPSED_REGEX, c.capture.stderr());
  });

  it('sm history stats', async () => {
    const c = build(HistoryStatsCommand, (cmd) => {
      cmd.since = undefined;
      cmd.until = undefined;
      cmd.period = undefined;
      cmd.top = undefined;
    });
    await c.cmd.execute();
    assert.match(c.capture.stderr(), ELAPSED_REGEX, c.capture.stderr());
  });

  it('sm db migrate --status', async () => {
    const c = build(DbMigrateCommand, (cmd) => {
      cmd.dryRun = false;
      cmd.status = true;
      cmd.to = undefined;
      cmd.noBackup = true;
      cmd.kernelOnly = true;
      cmd.pluginId = undefined;
    });
    await c.cmd.execute();
    assert.match(c.capture.stderr(), ELAPSED_REGEX, c.capture.stderr());
  });

  it('sm plugins list', async () => {
    const c = build(PluginsListCommand, (cmd) => {
      cmd.pluginDir = undefined;
    });
    await c.cmd.execute();
    assert.match(c.capture.stderr(), ELAPSED_REGEX, c.capture.stderr());
  });

  it('sm plugins doctor', async () => {
    const c = build(PluginsDoctorCommand, (cmd) => {
      cmd.pluginDir = undefined;
    });
    await c.cmd.execute();
    assert.match(c.capture.stderr(), ELAPSED_REGEX, c.capture.stderr());
  });

  it('--quiet suppresses the trailing line', async () => {
    const c = build(ListCommand, (cmd) => {
      cmd.kind = undefined;
      cmd.issue = false;
      cmd.sortBy = undefined;
      cmd.limit = undefined;
      cmd.quiet = true;
    });
    await c.cmd.execute();
    assert.doesNotMatch(c.capture.stderr(), ELAPSED_REGEX, `quiet should suppress: stderr=${c.capture.stderr()}`);
  });
});
