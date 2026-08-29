/**
 * `ActivityStatsService` unit tests, pure (no DB, no server boot).
 * Counting semantics are normative in `spec/provider-activity.md`
 * §Execution stats; each case below pins one rule.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ActivityStatsService,
  type IActivityStatsSink,
  DISTINCT_OWNERS_CAP,
  RECENT_RING_SIZE,
  STICKY_DEDUPE_CAP,
  pairKeyOf,
} from '../activity-stats.js';

const NODE = '.claude/skills/deploy/SKILL.md';

describe('ActivityStatsService.record', () => {
  it('counts a non-sticky start on EVERY signal', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    const second = stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    assert.equal(second?.count, 2);
    assert.equal(second?.distinctOwners, 1);
  });

  it('stacks the per-frame detail (invoked tool) into the recent history, most-recent first', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1', detail: 'notion-search' });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1', detail: 'notion-create-pages' });
    const detail = stats.nodeDetail(NODE);
    assert.equal(detail.recent.length, 2);
    assert.equal(detail.recent[0]?.detail, 'notion-create-pages');
    assert.equal(detail.recent[1]?.detail, 'notion-search');
  });

  it('attributes the caller on an mcp invocation and mirrors it (typed) onto the invoker recent', () => {
    const stats = new ActivityStatsService();
    const skill = '.claude/skills/demo/SKILL.md';
    const mcp = 'mcp://notion';
    stats.record({ nodePath: skill, phase: 'start', owner: 'main:s1' });
    stats.record({
      nodePath: mcp,
      phase: 'start',
      owner: 'main:s1',
      detail: 'notion-create-pages',
      access: 'mcp',
    });
    const mcpDetail = stats.nodeDetail(mcp);
    assert.equal(mcpDetail.recent[0]?.caller, skill);
    assert.equal(mcpDetail.recent[0]?.detail, 'notion-create-pages');
    assert.equal(mcpDetail.recent[0]?.kind, 'mcp');
    assert.equal(mcpDetail.recent[0]?.target, undefined);
    const mirrored = stats.nodeDetail(skill).recent.find((e) => e.target !== undefined);
    assert.equal(mirrored?.target, mcp);
    assert.equal(mirrored?.detail, 'notion-create-pages');
    assert.equal(mirrored?.kind, 'mcp');
    assert.equal(mirrored?.caller, undefined);
  });

  it('mirrors a file READ onto the reader, typed read, no tool detail', () => {
    const stats = new ActivityStatsService();
    const skill = '.claude/skills/demo/SKILL.md';
    const file = 'docs/notes.md';
    stats.record({ nodePath: skill, phase: 'start', owner: 'main:s1' });
    stats.record({ nodePath: file, phase: 'start', owner: 'main:s1', access: 'read' });
    const fileDetail = stats.nodeDetail(file);
    assert.equal(fileDetail.recent[0]?.caller, skill);
    assert.equal(fileDetail.recent[0]?.kind, 'read');
    assert.equal(fileDetail.recent[0]?.detail, undefined);
    const mirrored = stats.nodeDetail(skill).recent.find((e) => e.target === file);
    assert.equal(mirrored?.target, file);
    assert.equal(mirrored?.kind, 'read');
    assert.equal(mirrored?.detail, undefined);
  });

  it('leaves a unit execution untyped (no access, no mirror, no caller)', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: '.claude/skills/demo/SKILL.md', phase: 'start', owner: 'main:s1' });
    const d = stats.nodeDetail('.claude/skills/demo/SKILL.md');
    assert.equal(d.recent[0]?.kind, undefined);
    assert.equal(d.recent[0]?.caller, undefined);
    assert.equal(d.recent[0]?.target, undefined);
  });

  it('a detail-bearing UNIT start stays untyped: detail rides the recent entry, no caller', () => {
    // spec/provider-activity.md §detail: unit frames may carry the
    // literal invoking tool name (e.g. `Skill`); without `access` the
    // frame is still a unit execution, never an invocation.
    const stats = new ActivityStatsService();
    stats.record({
      nodePath: '.claude/skills/demo/SKILL.md',
      phase: 'start',
      owner: 'main:s1',
      detail: 'Skill',
    });
    const d = stats.nodeDetail('.claude/skills/demo/SKILL.md');
    assert.equal(d.recent[0]?.detail, 'Skill');
    assert.equal(d.recent[0]?.kind, undefined);
    assert.equal(d.recent[0]?.caller, undefined);
    assert.equal(d.recent[0]?.target, undefined);
  });

  it('attributes no caller for a bare access with nothing lit under the owner', () => {
    const stats = new ActivityStatsService();
    stats.record({
      nodePath: 'mcp://notion',
      phase: 'start',
      owner: 'main:bare',
      detail: 'notion-search',
      access: 'mcp',
    });
    assert.equal(stats.nodeDetail('mcp://notion').recent[0]?.caller, undefined);
  });

  it('a shell SIGHTING never counts as an execution (spec §Capture level rung 5)', () => {
    const stats = new ActivityStatsService();
    const skill = '.claude/skills/demo/SKILL.md';
    const file = 'docs/notes.md';
    stats.record({ nodePath: skill, phase: 'start', owner: 'main:s1' });
    const enriched = stats.record({
      nodePath: file,
      phase: 'start',
      owner: 'main:s1',
      detail: 'Bash',
      access: 'shell',
    });
    // The frame rides WITH the node's unchanged stats (count stays 0),
    // so a client learns the node has a log to show...
    assert.equal(enriched?.count, 0);
    assert.equal(enriched?.lastStartAt, 0);
    // ...and no execution stat mutates: count, lastStartAt, owners all zero.
    const detail = stats.nodeDetail(file);
    assert.equal(detail.stats.count, 0);
    assert.equal(detail.stats.lastStartAt, 0);
    assert.equal(detail.stats.distinctOwners, 0);
    // The typed recent log still carries the sighting on BOTH ends.
    assert.equal(detail.recent[0]?.kind, 'shell');
    assert.equal(detail.recent[0]?.detail, 'Bash');
    assert.equal(detail.recent[0]?.caller, skill);
    const mirrored = stats.nodeDetail(skill).recent.find((e) => e.target === file);
    assert.equal(mirrored?.kind, 'shell');
    assert.equal(mirrored?.detail, 'Bash');
  });

  it('a shell sighting never becomes a future caller for later accesses', () => {
    const stats = new ActivityStatsService();
    const file = 'docs/notes.md';
    // Sighting with no unit lit under the owner: nothing to attribute...
    stats.record({ nodePath: file, phase: 'start', owner: 'main:s1', detail: 'Bash', access: 'shell' });
    assert.equal(stats.nodeDetail(file).recent[0]?.caller, undefined);
    // ...and the sighted file must NOT register as the owner's unit.
    stats.record({ nodePath: 'mcp://notion', phase: 'start', owner: 'main:s1', detail: 'notion-search', access: 'mcp' });
    assert.equal(stats.nodeDetail('mcp://notion').recent[0]?.caller, undefined);
  });

  it('dedupes sticky starts per (nodePath, owner) pair', () => {
    const stats = new ActivityStatsService();
    const first = stats.record({ nodePath: NODE, phase: 'start', owner: 'a1', sticky: true });
    assert.equal(first?.count, 1);
    // Same pair again: no recount.
    assert.equal(stats.record({ nodePath: NODE, phase: 'start', owner: 'a1', sticky: true }), null);
    // Same owner on ANOTHER node is a distinct pair.
    const other = stats.record({
      nodePath: '.claude/agents/worker.md',
      phase: 'start',
      owner: 'a1',
      sticky: true,
    });
    assert.equal(other?.count, 1);
    // A fresh instance (fresh owner id) counts again on the first node.
    const fresh = stats.record({ nodePath: NODE, phase: 'start', owner: 'a2', sticky: true });
    assert.equal(fresh?.count, 2);
  });

  it('a pause/resume sequence (start, ownerScope end, start) counts ONCE', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'a1', sticky: true });
    // The dedupe memory is append-only: the owner-scoped end does NOT
    // forget the owner, so the resume start below must not recount.
    stats.record({ nodePath: NODE, phase: 'end', owner: 'a1', ownerScope: true });
    assert.equal(stats.record({ nodePath: NODE, phase: 'start', owner: 'a1', sticky: true }), null);
    assert.equal(stats.snapshot()[NODE]?.count, 1);
  });

  it('keepAlive starts never count and never touch the owner set', () => {
    const stats = new ActivityStatsService();
    const custody = stats.record({
      nodePath: NODE,
      phase: 'start',
      owner: 'spawn:t1',
      sticky: true,
      keepAlive: true,
    });
    assert.equal(custody, null);
    assert.deepEqual(stats.snapshot(), {});
    // A later counted start shows no trace of the custody owner.
    const counted = stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    assert.equal(counted?.distinctOwners, 1);
  });

  it('ends and node-less owner releases never mutate', () => {
    const stats = new ActivityStatsService();
    assert.equal(stats.record({ nodePath: NODE, phase: 'end', owner: 'a1' }), null);
    assert.equal(stats.record({ phase: 'end', owner: 'a1', ownerScope: true }), null);
    assert.deepEqual(stats.snapshot(), {});
  });

  it('OWNERLESS sticky starts count each time (nothing to dedupe on)', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', sticky: true });
    const second = stats.record({ nodePath: NODE, phase: 'start', sticky: true });
    assert.equal(second?.count, 2);
    assert.equal(second?.distinctOwners, 0);
  });

  it('distinctOwners saturates at the cap', () => {
    const stats = new ActivityStatsService();
    for (let i = 0; i < DISTINCT_OWNERS_CAP + 40; i += 1) {
      stats.record({ nodePath: NODE, phase: 'start', owner: `o${i}` });
    }
    const snap = stats.snapshot()[NODE];
    assert.equal(snap?.count, DISTINCT_OWNERS_CAP + 40);
    assert.equal(snap?.distinctOwners, DISTINCT_OWNERS_CAP);
  });

  it('the sticky dedupe memory evicts oldest-first at its cap', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'first', sticky: true });
    // Fill the memory on another node until the first pair is evicted.
    for (let i = 0; i < STICKY_DEDUPE_CAP; i += 1) {
      stats.record({ nodePath: 'other.md', phase: 'start', owner: `f${i}`, sticky: true });
    }
    // The evicted pair counts again; bounded memory trades a rare
    // recount for never erroring.
    const recounted = stats.record({ nodePath: NODE, phase: 'start', owner: 'first', sticky: true });
    assert.equal(recounted?.count, 2);
  });

  it('lastOwner mirrors the last COUNTED start (absent when ownerless)', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'a1' });
    assert.equal(stats.snapshot()[NODE]?.lastOwner, 'a1');
    stats.record({ nodePath: NODE, phase: 'start' });
    assert.equal(stats.snapshot()[NODE]?.lastOwner, undefined);
    // A non-counted sticky duplicate does not move it either.
    stats.record({ nodePath: NODE, phase: 'start', owner: 'b1', sticky: true });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'b1', sticky: true });
    assert.equal(stats.snapshot()[NODE]?.lastOwner, 'b1');
  });
});

describe('ActivityStatsService reads', () => {
  it('record() and snapshot() hand out copies (mutations never leak back)', () => {
    const stats = new ActivityStatsService();
    const returned = stats.record({ nodePath: NODE, phase: 'start', owner: 'a1' });
    returned!.count = 999;
    const snap = stats.snapshot();
    assert.equal(snap[NODE]?.count, 1);
    snap[NODE]!.count = 500;
    assert.equal(stats.snapshot()[NODE]?.count, 1);
  });

  it('nodeDetail() returns zeroed stats for an untracked path and copies otherwise', () => {
    const stats = new ActivityStatsService();
    assert.deepEqual(stats.nodeDetail('unknown.md'), {
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
    });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'a1' });
    const detail = stats.nodeDetail(NODE);
    detail.recent[0]!.owner = 'tampered';
    assert.equal(stats.nodeDetail(NODE).recent[0]?.owner, 'a1');
  });

  it('the recent ring is most-recent-first and bounded at RECENT_RING_SIZE', () => {
    const stats = new ActivityStatsService();
    const total = RECENT_RING_SIZE + 5;
    for (let i = 0; i < total; i += 1) {
      stats.record({ nodePath: NODE, phase: 'start', owner: `o${i}` });
    }
    const { recent } = stats.nodeDetail(NODE);
    assert.equal(recent.length, RECENT_RING_SIZE);
    assert.equal(recent[0]?.owner, `o${total - 1}`);
    assert.equal(recent[RECENT_RING_SIZE - 1]?.owner, `o${total - RECENT_RING_SIZE}`);
    // Monotone timestamps, newest at index 0.
    assert.ok(recent[0]!.at >= recent[RECENT_RING_SIZE - 1]!.at);
  });

  it('sinceMs is a boot-time unix-ms stamp', () => {
    const before = Date.now();
    const stats = new ActivityStatsService();
    assert.ok(stats.sinceMs >= before);
    assert.ok(stats.sinceMs <= Date.now());
  });
});

describe('ActivityStatsService pair counters', () => {
  const START = {
    phase: 'start' as const,
    parentOwner: 'a4e825faeafee3619',
    parentNodePath: '.claude/agents/orchestrator.md',
    childNodePath: '.claude/agents/worker.md',
  };

  it('counts start frames per directional pair and returns the running count', () => {
    const stats = new ActivityStatsService();
    assert.equal(stats.recordSpawn(START), 1);
    assert.equal(stats.recordSpawn(START), 2);
    // Non-start frames never mutate, but report the current count.
    assert.equal(stats.recordSpawn({ ...START, phase: 'end' }), 2);
    const pairs = stats.pairSnapshot();
    const key = pairKeyOf('.claude/agents/orchestrator.md', '.claude/agents/worker.md');
    assert.equal(pairs[key]!.count, 2);
    assert.ok(pairs[key]!.lastStartAt > 0);
  });

  it('session parents key by parentOwner; unresolved children are untracked', () => {
    const stats = new ActivityStatsService();
    assert.equal(
      stats.recordSpawn({
        phase: 'start',
        parentOwner: 'main:6cfe5636',
        childNodePath: '.claude/agents/worker.md',
      }),
      1,
    );
    assert.ok(
      stats.pairSnapshot()[pairKeyOf('main:6cfe5636', '.claude/agents/worker.md')],
    );
    // No childNodePath: an edge label needs both endpoints.
    assert.equal(stats.recordSpawn({ phase: 'start', parentOwner: 'main:6cfe5636' }), null);
    // A non-start frame of an untracked pair reports nothing.
    assert.equal(
      stats.recordSpawn({
        phase: 'handoff',
        parentOwner: 'other',
        childNodePath: '.claude/agents/worker.md',
      }),
      null,
    );
  });

  it('pairSnapshot hands out copies', () => {
    const stats = new ActivityStatsService();
    stats.recordSpawn(START);
    const key = pairKeyOf('.claude/agents/orchestrator.md', '.claude/agents/worker.md');
    const copy = stats.pairSnapshot();
    copy[key]!.count = 999;
    assert.equal(stats.pairSnapshot()[key]!.count, 1);
  });
});

describe('ActivityStatsService execution aggregates', () => {
  const NODE = '.claude/agents/worker.md';

  it('sums toolUses and tokens across summarized runs and projects them', () => {
    const stats = new ActivityStatsService();
    stats.recordExecution(NODE, { durationMs: 1000, tokens: 400, toolUses: 3 });
    stats.recordExecution(NODE, { tokens: 600, toolUses: 2 });
    const detail = stats.nodeDetail(NODE);
    assert.equal(detail.stats.toolUses, 5);
    assert.equal(detail.stats.tokens, 1000);
    assert.equal(detail.stats.summarizedRuns, 2);
  });

  it('a summary with nothing summable is a no-op, and quiet nodes omit the fields', () => {
    const stats = new ActivityStatsService();
    stats.recordExecution(NODE, { durationMs: 1000 });
    assert.equal(stats.nodeDetail(NODE).stats.summarizedRuns, undefined);
    // Counted-but-never-summarized nodes omit the aggregates too.
    stats.record({ nodePath: NODE, phase: 'start', owner: 'a1' });
    const projected = stats.nodeDetail(NODE).stats;
    assert.equal(projected.count, 1);
    assert.equal(projected.toolUses, undefined);
    assert.equal(projected.tokens, undefined);
  });
});

describe('ActivityStatsService checkpoint', () => {
  it('export -> hydrate round-trips counts, owners, the recent log, aggregates and pairs', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1', detail: 'Skill' });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s2' });
    stats.recordExecution(NODE, { toolUses: 3, tokens: 400 });
    stats.recordSpawn({ phase: 'start', parentOwner: 'main:s1', parentNodePath: NODE, childNodePath: 'b.md' });
    const nodes = stats.exportNodes([NODE]);
    const pairs = stats.exportPairs([pairKeyOf(NODE, 'b.md')]);
    assert.equal(nodes.length, 1);
    assert.equal(pairs.length, 1);

    const reborn = new ActivityStatsService();
    reborn.hydrate(nodes, pairs);
    const detail = reborn.nodeDetail(NODE);
    assert.equal(detail.stats.count, 2);
    assert.equal(detail.stats.distinctOwners, 2);
    assert.equal(detail.stats.lastOwner, 'main:s2');
    assert.equal(detail.stats.toolUses, 3);
    assert.equal(detail.stats.tokens, 400);
    assert.equal(detail.recent.length, 2);
    assert.equal(detail.recent[1]?.detail, 'Skill');
    assert.deepEqual(reborn.pairSnapshot()[pairKeyOf(NODE, 'b.md')]?.count, 1);
    // `since` follows the hydrated first sighting, not the reborn boot.
    assert.equal(reborn.sinceMs, nodes[0]?.firstSeenAt);
  });

  it('hands dirty rows to the sink once per window, and keeps them dirty when the write fails', async () => {
    const written: { nodes: string[][]; pairs: string[][] } = { nodes: [], pairs: [] };
    let fail = false;
    const sink: IActivityStatsSink = {
      async upsertNodes(rows) {
        if (fail) throw new Error('db gone');
        written.nodes.push(rows.map((r) => r.nodePath));
      },
      async upsertPairs(rows) {
        written.pairs.push(rows.map((r) => `${r.parent}>>${r.childNodePath}`));
      },
    };
    const stats = new ActivityStatsService({ sink, flushDelayMs: 0 });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    stats.recordSpawn({ phase: 'start', parentOwner: 'main:s1', childNodePath: 'b.md' });
    await stats.flush();
    // One write per window with the coalesced rows, not one per frame.
    assert.deepEqual(written.nodes, [[NODE]]);
    assert.deepEqual(written.pairs, [['main:s1>>b.md']]);

    fail = true;
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    await stats.flush();
    assert.equal(written.nodes.length, 1);
    fail = false;
    await stats.flush();
    // The failed row stayed dirty and lands on the next window.
    assert.deepEqual(written.nodes, [[NODE], [NODE]]);
  });

  it('clearNode drops the node from the pending checkpoint too', async () => {
    const written: string[][] = [];
    const sink: IActivityStatsSink = {
      async upsertNodes(rows) {
        written.push(rows.map((r) => r.nodePath));
      },
      async upsertPairs() {},
    };
    const stats = new ActivityStatsService({ sink, flushDelayMs: 0 });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    stats.clearNode(NODE);
    await stats.flush();
    assert.deepEqual(written, []);
  });
});
