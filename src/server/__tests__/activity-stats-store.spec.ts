/**
 * `activity-stats-store.ts` integration: the checkpoint sink writes the
 * accumulator's dirty rows into a real project DB and the boot
 * hydration reads them back into a fresh accumulator, so a restart
 * keeps every count (spec/provider-activity.md §Execution stats). A
 * missing DB degrades to the memory-only behaviour on both sides.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { ActivityStatsService, pairKeyOf } from '../activity-stats.js';
import { createActivityStatsSink, hydrateActivityStats } from '../activity-stats-store.js';

const NODE = '.claude/skills/deploy/SKILL.md';
const CHILD = '.claude/agents/reviewer.md';

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm-activity-store-'));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function createDb(name: string): Promise<string> {
  const dbPath = join(dir, name);
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  await adapter.close();
  return dbPath;
}

describe('activity-stats-store', () => {
  it('a restart keeps the counts: sink -> DB -> hydrate', async () => {
    const dbPath = await createDb('restart.db');
    const before = new ActivityStatsService({ sink: createActivityStatsSink(dbPath), flushDelayMs: 0 });
    before.record({ nodePath: NODE, phase: 'start', owner: 'main:s1', detail: 'Skill' });
    before.record({ nodePath: 'docs/notes.md', phase: 'start', owner: 'main:s1', detail: 'Bash', access: 'shell' });
    before.recordSpawn({ phase: 'start', parentOwner: 'main:s1', parentNodePath: NODE, childNodePath: CHILD });
    await before.flush();

    const after = new ActivityStatsService();
    assert.equal(await hydrateActivityStats(after, dbPath), true);
    assert.equal(after.nodeDetail(NODE).stats.count, 1);
    // The skill's log keeps its own start AND the mirrored shell sighting it triggered.
    assert.deepEqual(
      after.nodeDetail(NODE).recent.map((e) => e.detail),
      ['Bash', 'Skill'],
    );
    // The sighted-only node survives too: count 0, log intact.
    assert.equal(after.nodeDetail('docs/notes.md').stats.count, 0);
    assert.equal(after.nodeDetail('docs/notes.md').recent[0]?.kind, 'shell');
    assert.equal(after.pairSnapshot()[pairKeyOf(NODE, CHILD)]?.count, 1);
    assert.equal(after.sinceMs, before.sinceMs);
  });

  it('no DB file: the sink is a no-op and hydration adopts nothing', async () => {
    const dbPath = join(dir, 'absent.db');
    const stats = new ActivityStatsService({ sink: createActivityStatsSink(dbPath), flushDelayMs: 0 });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    await stats.flush();
    assert.equal(stats.nodeDetail(NODE).stats.count, 1);
    assert.equal(await hydrateActivityStats(new ActivityStatsService(), dbPath), false);
  });
});
