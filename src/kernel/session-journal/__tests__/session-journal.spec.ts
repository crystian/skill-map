/**
 * Session-journal reader + observed-relations fold
 * (`kernel/session-journal/index.ts`, contract in
 * `spec/provider-activity.md` §Session journal · Consumption).
 *
 * Reader: AJV-gated file loads, off-shape files skipped silently,
 * absent directory reads as empty. Fold: MCP invocations correlate to
 * their calling unit by owner, spawns count once per `spawnId`, reads
 * are ignored (deferred), sessions count DISTINCT recordings.
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  foldObservedActivity,
  readSessionJournal,
  type SessionRecording,
} from '../index.js';

/** Relations half of the fold (most cases pin only this side). */
function foldRelations(
  recordings: SessionRecording[],
): ReturnType<typeof foldObservedActivity>['relations'] {
  return foldObservedActivity(recordings).relations;
}

const roots: string[] = [];

function freshDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-map-session-journal-'));
  roots.push(root);
  const dir = join(root, 'sessions');
  mkdirSync(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function recording(over: Partial<SessionRecording>): SessionRecording {
  return {
    schemaVersion: 1,
    rootOwner: 'main:s1',
    startedAt: 1_723_800_000_000,
    frames: [],
    ...over,
  };
}

const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/architect.md';
const MCP = 'mcp://notion';

describe('readSessionJournal', () => {
  it('reads valid recordings in name order and skips off-shape files silently', () => {
    const dir = freshDir();
    writeFileSync(
      join(dir, '2026-08-16T100000.000Z-s1.json'),
      JSON.stringify(recording({ rootOwner: 'main:s1' })),
    );
    // Off-shape: missing required `rootOwner`.
    writeFileSync(
      join(dir, '2026-08-16T110000.000Z-bad.json'),
      JSON.stringify({ schemaVersion: 1, startedAt: 1, frames: [] }),
    );
    // Unparseable JSON.
    writeFileSync(join(dir, '2026-08-16T120000.000Z-corrupt.json'), '{ not json');
    // Not a journal file at all.
    writeFileSync(join(dir, 'README.txt'), 'hola');

    const recordings = readSessionJournal(dir);
    assert.equal(recordings.length, 1);
    assert.equal(recordings[0]!.rootOwner, 'main:s1');
  });

  it('reads an absent directory as an empty journal', () => {
    const dir = join(freshDir(), 'nope');
    assert.deepEqual(readSessionJournal(dir), []);
  });
});

describe('foldObservedActivity relations', () => {
  it('correlates an MCP invocation to the calling unit by owner', () => {
    const rec = recording({
      frames: [
        {
          tMs: 1,
          type: 'node.activity',
          data: { nodePath: SKILL, phase: 'start', owner: 'main:s1' },
        },
        {
          tMs: 2,
          type: 'node.activity',
          data: {
            nodePath: MCP,
            phase: 'start',
            owner: 'main:s1',
            access: 'mcp',
            detail: 'notion-create-pages',
          },
        },
      ],
    });
    const folded = foldRelations([rec]);
    assert.equal(folded.size, 1);
    const entry = [...folded.values()][0]!;
    assert.equal(entry.source, SKILL);
    assert.equal(entry.target, MCP);
    assert.equal(entry.relation, 'invokes');
    assert.equal(entry.count, 1);
    assert.equal(entry.sessions, 1);
    assert.equal(entry.lastSeenAt, 2);
  });

  it('drops an MCP frame whose owner has no prior unit claim (no guessing)', () => {
    const rec = recording({
      frames: [
        {
          tMs: 1,
          type: 'node.activity',
          data: { nodePath: MCP, phase: 'start', owner: 'main:s1', access: 'mcp' },
        },
      ],
    });
    assert.equal(foldRelations([rec]).size, 0);
  });

  it('correlates a read to the reading unit; the read never becomes the current unit', () => {
    const rec = recording({
      frames: [
        {
          tMs: 1,
          type: 'node.activity',
          data: { nodePath: SKILL, phase: 'start', owner: 'main:s1' },
        },
        {
          tMs: 2,
          type: 'node.activity',
          data: { nodePath: 'README.md', phase: 'start', owner: 'main:s1', access: 'read' },
        },
        // The MCP call still correlates to the UNIT, not the read doc.
        {
          tMs: 3,
          type: 'node.activity',
          data: { nodePath: MCP, phase: 'start', owner: 'main:s1', access: 'mcp' },
        },
      ],
    });
    const folded = foldRelations([rec]);
    assert.equal(folded.size, 2);
    const read = folded.get(`${SKILL}\x00README.md`)!;
    assert.equal(read.relation, 'reads');
    assert.equal(read.count, 1);
    const invoke = folded.get(`${SKILL}\x00${MCP}`)!;
    assert.equal(invoke.relation, 'invokes');
  });

  it('a shell sighting folds as a read of the sighted file (heuristic, admitted 2026-08-30)', () => {
    const rec = recording({
      frames: [
        {
          tMs: 1,
          type: 'node.activity',
          data: { nodePath: SKILL, phase: 'start', owner: 'main:s1' },
        },
        // Rung-5 frame: the command named the file, so the unit that ran
        // the command is observed reading it. The sighted path never
        // becomes the owner's current unit, like a plain read.
        {
          tMs: 2,
          type: 'node.activity',
          data: { nodePath: 'README.md', phase: 'start', owner: 'main:s1', access: 'shell' },
        },
        {
          tMs: 3,
          type: 'node.activity',
          data: { nodePath: MCP, phase: 'start', owner: 'main:s1', access: 'mcp' },
        },
      ],
    });
    const folded = foldRelations([rec]);
    assert.equal(folded.size, 2);
    const sighted = folded.get(`${SKILL}\x00README.md`)!;
    assert.equal(sighted.relation, 'reads');
    assert.equal(sighted.count, 1);
    assert.equal(folded.get(`${SKILL}\x00${MCP}`)?.relation, 'invokes');
  });

  it('a turnEnd cuts the unit attribution: later-turn accesses never blame an earlier unit', () => {
    const rec = recording({
      frames: [
        {
          tMs: 1,
          type: 'node.activity',
          data: { nodePath: SKILL, phase: 'start', owner: 'main:s1' },
        },
        // Same turn: attributed to the skill.
        {
          tMs: 2,
          type: 'node.activity',
          data: { nodePath: 'docs/A.md', phase: 'start', owner: 'main:s1', access: 'read' },
        },
        { tMs: 3, type: 'node.activity', data: { phase: 'end', owner: 'main:s1', turnEnd: true } },
        // NEXT turn, no unit ran: the read attributes to nothing.
        {
          tMs: 4,
          type: 'node.activity',
          data: { nodePath: 'docs/B.md', phase: 'start', owner: 'main:s1', access: 'read' },
        },
      ],
    });
    const folded = foldRelations([rec]);
    assert.equal(folded.size, 1);
    assert.ok(folded.has(`${SKILL}\x00docs/A.md`));
  });

  it('drops a read whose owner has no prior unit claim (no guessing)', () => {
    const rec = recording({
      frames: [
        {
          tMs: 1,
          type: 'node.activity',
          data: { nodePath: 'README.md', phase: 'start', owner: 'main:s1', access: 'read' },
        },
      ],
    });
    assert.equal(foldRelations([rec]).size, 0);
  });

  it('counts a spawn ONCE per spawnId (start / handoff / end trio merges)', () => {
    const spawnData = {
      spawnId: 'tool-1',
      parentOwner: 'agent-0',
      parentNodePath: AGENT,
      childNodePath: SKILL,
    };
    const rec = recording({
      frames: [
        { tMs: 1, type: 'agent.spawn', data: { ...spawnData, phase: 'start' } },
        { tMs: 2, type: 'agent.spawn', data: { ...spawnData, phase: 'handoff', childOwner: 'agent-1' } },
        { tMs: 3, type: 'agent.spawn', data: { ...spawnData, phase: 'end' } },
      ],
    });
    const folded = foldRelations([rec]);
    assert.equal(folded.size, 1);
    const entry = [...folded.values()][0]!;
    assert.equal(entry.relation, 'spawns');
    assert.equal(entry.count, 1);
    assert.equal(entry.lastSeenAt, 1);
  });

  it('skips spawns missing either resolved path (no edge to a phantom)', () => {
    const rec = recording({
      frames: [
        {
          tMs: 1,
          type: 'agent.spawn',
          data: { spawnId: 's-1', phase: 'start', parentOwner: 'main:s1', childName: 'worker' },
        },
      ],
    });
    assert.equal(foldRelations([rec]).size, 0);
  });

  it('counts DISTINCT sessions per pair and totals observations across recordings', () => {
    const frames: SessionRecording['frames'] = [
      {
        tMs: 1,
        type: 'node.activity',
        data: { nodePath: SKILL, phase: 'start', owner: 'o1' },
      },
      {
        tMs: 2,
        type: 'node.activity',
        data: { nodePath: MCP, phase: 'start', owner: 'o1', access: 'mcp' },
      },
      {
        tMs: 3,
        type: 'node.activity',
        data: { nodePath: MCP, phase: 'start', owner: 'o1', access: 'mcp' },
      },
    ];
    const recA = recording({ rootOwner: 'main:a', startedAt: 100, frames });
    const recB = recording({ rootOwner: 'main:b', startedAt: 200, frames });
    const folded = foldRelations([recA, recB]);
    const entry = [...folded.values()][0]!;
    assert.equal(entry.count, 4);
    assert.equal(entry.sessions, 2);
  });
});

describe('foldObservedActivity executions', () => {
  it('counts unit runs per node; custody heartbeats and resource accesses do not count', () => {
    const rec = recording({
      frames: [
        { tMs: 1, type: 'node.activity', data: { nodePath: SKILL, phase: 'start', owner: 'o1' } },
        // Custody heartbeat: keeps the claim alive, is NOT a new run.
        {
          tMs: 2,
          type: 'node.activity',
          data: { nodePath: SKILL, phase: 'start', owner: 'o1', keepAlive: true },
        },
        // Sticky agent span: counts once per claim (once per spawn).
        {
          tMs: 3,
          type: 'node.activity',
          data: { nodePath: AGENT, phase: 'start', owner: 'a1', sticky: true },
        },
        // Resource accesses are not the node's own run.
        {
          tMs: 4,
          type: 'node.activity',
          data: { nodePath: 'README.md', phase: 'start', owner: 'o1', access: 'read' },
        },
        {
          tMs: 5,
          type: 'node.activity',
          data: { nodePath: MCP, phase: 'start', owner: 'o1', access: 'mcp' },
        },
        // A second real run of the same unit.
        { tMs: 6, type: 'node.activity', data: { nodePath: SKILL, phase: 'start', owner: 'o1' } },
      ],
    });
    const { executions } = foldObservedActivity([rec]);
    assert.equal(executions.byPath.size, 2);
    assert.equal(executions.activeSessions, 1);
    const skill = executions.byPath.get(SKILL)!;
    assert.equal(skill.count, 2);
    assert.equal(skill.sessions, 1);
    assert.equal(skill.lastSeenAt, 6);
    assert.equal(executions.byPath.get(AGENT)!.count, 1);
    assert.equal(executions.byPath.has('README.md'), false);
    assert.equal(executions.byPath.has(MCP), false);
  });

  it('counts DISTINCT sessions per node across recordings', () => {
    const frames: SessionRecording['frames'] = [
      { tMs: 1, type: 'node.activity', data: { nodePath: SKILL, phase: 'start', owner: 'o1' } },
    ];
    const recA = recording({ rootOwner: 'main:a', startedAt: 100, frames });
    const recB = recording({ rootOwner: 'main:b', startedAt: 200, frames });
    const { executions } = foldObservedActivity([recA, recB]);
    assert.equal(executions.activeSessions, 2);
    const entry = executions.byPath.get(SKILL)!;
    assert.equal(entry.count, 2);
    assert.equal(entry.sessions, 2);
  });
});
