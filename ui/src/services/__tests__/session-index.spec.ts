/**
 * Pure-fold tests for the session index behind the Sessions rail tab:
 * root derivation (structural + first-sight), the agent tree from the
 * spawn graph, temporal re-spawn attribution, stat bubbling, the
 * unattributed bucket, and both replay filter scopes. No TestBed, no
 * timers: the index is a function of the tape.
 */

import { describe, expect, it } from 'vitest';

import type { TRecordedEvent } from '../activity-recorder';
import {
  computeSessionIndex,
  filterTapeForSession,
  sessionKeyOf,
  type ISessionAgentNode,
} from '../session-index';
import type { IWsAgentSpawnData, IWsNodeActivityData } from '../../models/ws-event';

const T0 = 1_700_000_000_000;
const MAIN = 'main:sess-1';
const MAIN_B = 'main:sess-2';
const SKILL = '.claude/skills/deploy/SKILL.md';
const DOC = 'docs/guide.md';
const AGENT_NODE = '.claude/agents/reviewer.md';

function activity(
  tMs: number,
  data: Partial<IWsNodeActivityData> & Pick<IWsNodeActivityData, 'phase'>,
): TRecordedEvent {
  return { tMs, type: 'node.activity', data: data as IWsNodeActivityData };
}

function spawn(
  tMs: number,
  data: Partial<IWsAgentSpawnData> & Pick<IWsAgentSpawnData, 'spawnId' | 'phase' | 'parentOwner'>,
): TRecordedEvent {
  return { tMs, type: 'agent.spawn', data: data as IWsAgentSpawnData };
}

function agentBySpawnId(
  agents: readonly ISessionAgentNode[],
  spawnId: string,
): ISessionAgentNode | undefined {
  for (const agent of agents) {
    if (agent.spawnId === spawnId) return agent;
    const nested = agentBySpawnId(agent.children, spawnId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

describe('computeSessionIndex', () => {
  it('an empty tape yields an empty index', () => {
    const index = computeSessionIndex([]);
    expect(index.sessions).toEqual([]);
    expect(index.unattributed.eventCount).toBe(0);
    expect(index.unattributed.agents).toEqual([]);
  });

  it('a spawn-less owner becomes a session on first sight (conversation-id providers)', () => {
    const index = computeSessionIndex([
      activity(T0, { phase: 'start', nodePath: SKILL, owner: 'conv-1' }),
      activity(T0 + 1000, { phase: 'start', nodePath: DOC, owner: 'conv-1' }),
    ]);
    expect(index.sessions).toHaveLength(1);
    const session = index.sessions[0];
    expect(session?.rootOwner).toBe('conv-1');
    expect(session?.sessionId).toBeUndefined();
    expect(session?.eventCount).toBe(2);
    expect(session?.touchedPaths).toEqual(new Set([SKILL, DOC]));
    expect(session?.agentCount).toBe(0);
  });

  it('derives sessionId from the main: prefix and from a stamped session field', () => {
    const index = computeSessionIndex([
      activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN }),
      activity(T0 + 500, { phase: 'start', nodePath: DOC, owner: 'conv-9', session: 'stamped-id' }),
    ]);
    expect(index.sessions.map((s) => s.sessionId)).toEqual(['sess-1', 'stamped-id']);
  });

  it('builds a depth-3 agent tree from the spawn graph and bubbles stats', () => {
    const child = 'agent-a';
    const grandchild = 'agent-b';
    const tape = [
      activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN }),
      // main (session context: no parentNodePath) spawns agent-a.
      spawn(T0 + 100, {
        spawnId: 'sp-1',
        phase: 'start',
        parentOwner: MAIN,
        childName: 'Explore',
      }),
      spawn(T0 + 200, {
        spawnId: 'sp-1',
        phase: 'handoff',
        parentOwner: MAIN,
        childName: 'Explore',
        childOwner: child,
      }),
      activity(T0 + 300, { phase: 'start', nodePath: DOC, owner: child }),
      // agent-a (agent context: parentNodePath present) spawns agent-b.
      spawn(T0 + 400, {
        spawnId: 'sp-2',
        phase: 'handoff',
        parentOwner: child,
        parentNodePath: AGENT_NODE,
        childName: 'worker',
        childOwner: grandchild,
      }),
      activity(T0 + 500, { phase: 'start', nodePath: SKILL, owner: grandchild }),
    ];
    const index = computeSessionIndex(tape);
    expect(index.sessions).toHaveLength(1);
    const session = index.sessions[0];
    expect(session?.rootOwner).toBe(MAIN);
    expect(session?.agentCount).toBe(2);
    expect(session?.agents).toHaveLength(1);
    const top = session?.agents[0];
    expect(top?.spawnId).toBe('sp-1');
    expect(top?.name).toBe('Explore');
    expect(top?.owner).toBe(child);
    expect(top?.children).toHaveLength(1);
    expect(top?.children[0]?.spawnId).toBe('sp-2');
    expect(top?.children[0]?.owner).toBe(grandchild);
    // Bubbling: 1 root frame + 2 sp-1 spawn frames + 1 agent-a frame
    // + 1 sp-2 spawn frame + 1 agent-b frame.
    expect(session?.eventCount).toBe(6);
    expect(session?.touchedPaths).toEqual(new Set([SKILL, DOC]));
    expect(session?.firstTMs).toBe(T0);
    expect(session?.lastTMs).toBe(T0 + 500);
    // Direct stats stay per node: agent-a holds its spawn trio-so-far
    // (2 frames) plus its own activity, plus nothing of agent-b's.
    expect(top?.eventCount).toBe(3);
    expect(top?.touchedPaths).toEqual(new Set([DOC]));
  });

  it('collects internal steps per context (main + each agent); custody, lifecycle and ends excluded', () => {
    const child = 'agent-a';
    const tape = [
      activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN, detail: 'Skill' }),
      // Custody claim (parent held lit through a spawn): never a step.
      activity(T0 + 50, { phase: 'start', nodePath: AGENT_NODE, owner: MAIN, keepAlive: true }),
      spawn(T0 + 100, {
        spawnId: 'sp-1',
        phase: 'handoff',
        parentOwner: MAIN,
        childName: 'Explore',
        childOwner: child,
      }),
      // Lifecycle claim (the agent's own span): the row itself, not a step.
      activity(T0 + 150, { phase: 'start', nodePath: AGENT_NODE, owner: child, sticky: true }),
      activity(T0 + 200, { phase: 'start', nodePath: DOC, owner: child, access: 'read', detail: 'Read' }),
      activity(T0 + 250, {
        phase: 'start',
        nodePath: 'mcp://notion',
        owner: child,
        access: 'mcp',
        detail: 'notion-create-pages',
      }),
      // Ends never list either.
      activity(T0 + 300, { phase: 'end', nodePath: DOC, owner: child }),
    ];
    const index = computeSessionIndex(tape);
    const session = index.sessions[0];
    expect(session?.steps).toEqual([{ tMs: T0, path: SKILL, detail: 'Skill' }]);
    const top = session?.agents[0];
    expect(top?.steps).toEqual([
      { tMs: T0 + 200, path: DOC, detail: 'Read', access: 'read' },
      { tMs: T0 + 250, path: 'mcp://notion', detail: 'notion-create-pages', access: 'mcp' },
    ]);
  });

  it('keeps two interleaved sessions apart and orders ordinals chronologically', () => {
    const index = computeSessionIndex([
      activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN }),
      activity(T0 + 100, { phase: 'start', nodePath: DOC, owner: MAIN_B }),
      activity(T0 + 200, { phase: 'end', nodePath: SKILL, owner: MAIN }),
      activity(T0 + 300, { phase: 'end', nodePath: DOC, owner: MAIN_B }),
    ]);
    expect(index.sessions.map((s) => [s.rootOwner, s.ordinal, s.eventCount])).toEqual([
      [MAIN, 1, 2],
      [MAIN_B, 2, 2],
    ]);
  });

  it('attributes a re-spawned owner temporally (latest claim at or before the frame)', () => {
    const owner = 'agent-reused';
    const tape = [
      spawn(T0, { spawnId: 'sp-1', phase: 'handoff', parentOwner: MAIN, childOwner: owner }),
      activity(T0 + 100, { phase: 'start', nodePath: SKILL, owner }),
      spawn(T0 + 200, { spawnId: 'sp-2', phase: 'handoff', parentOwner: MAIN, childOwner: owner }),
      activity(T0 + 300, { phase: 'start', nodePath: DOC, owner }),
    ];
    const index = computeSessionIndex(tape);
    const first = agentBySpawnId(index.sessions[0]?.agents ?? [], 'sp-1');
    const second = agentBySpawnId(index.sessions[0]?.agents ?? [], 'sp-2');
    expect(first?.touchedPaths).toEqual(new Set([SKILL]));
    expect(second?.touchedPaths).toEqual(new Set([DOC]));
  });

  it('synthesizes a node for an end without a start', () => {
    const index = computeSessionIndex([
      spawn(T0, { spawnId: 'sp-x', phase: 'end', parentOwner: MAIN, childName: 'late' }),
    ]);
    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0]?.agents[0]?.spawnId).toBe('sp-x');
    expect(index.sessions[0]?.agents[0]?.name).toBe('late');
  });

  it('parents a trimmed chain into the unattributed bucket', () => {
    // The parent is an AGENT context (parentNodePath present) whose own
    // claim the tape never saw: nothing can place this subtree.
    const index = computeSessionIndex([
      spawn(T0, {
        spawnId: 'sp-orphan',
        phase: 'handoff',
        parentOwner: 'gone-agent',
        parentNodePath: AGENT_NODE,
        childOwner: 'orphan-child',
      }),
      activity(T0 + 100, { phase: 'start', nodePath: DOC, owner: 'orphan-child' }),
    ]);
    expect(index.sessions).toHaveLength(0);
    expect(index.unattributed.agents).toHaveLength(1);
    expect(index.unattributed.agents[0]?.spawnId).toBe('sp-orphan');
    // The spawn frame + the child's activity frame.
    expect(index.unattributed.eventCount).toBe(2);
  });

  it('routes ownerless frames by session match, else to unattributed', () => {
    const index = computeSessionIndex([
      activity(T0, { phase: 'start', nodePath: SKILL, owner: 'o-1', session: 'the-id' }),
      activity(T0 + 100, { phase: 'end', sessionScope: true, session: 'the-id' }),
      activity(T0 + 200, { phase: 'end', sessionScope: true, session: 'unknown-id' }),
    ]);
    expect(index.sessions[0]?.eventCount).toBe(2);
    expect(index.unattributed.eventCount).toBe(1);
  });

  it('partitions the same runtime session by Record gesture; the tape filter scopes to one window', () => {
    const rec = (event: TRecordedEvent, recordedAt: number): TRecordedEvent => ({ ...event, recordedAt });
    const events: TRecordedEvent[] = [
      rec(activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN }), 1000),
      rec(activity(T0 + 100, { phase: 'start', nodePath: DOC, owner: MAIN }), 1000),
      rec(activity(T0 + 5000, { phase: 'start', nodePath: SKILL, owner: MAIN }), 2000),
    ];
    const index = computeSessionIndex(events);
    expect(index.sessions.map((s) => [s.rootOwner, s.recordedAt, s.eventCount])).toEqual([
      [MAIN, 1000, 2],
      [MAIN, 2000, 1],
    ]);
    expect(index.sessions.map((s) => sessionKeyOf(s))).toEqual([`${MAIN}|1000`, `${MAIN}|2000`]);
    // The second recording replays ITS frames only.
    expect(filterTapeForSession(events, { rootOwner: MAIN, tapeWindow: 2000 })).toEqual([events[2]]);
    // A legacy selection (no window) still scopes by owner alone.
    expect(filterTapeForSession(events, { rootOwner: MAIN })).toHaveLength(3);
  });

  it('a session that only ever spawned still gets its row', () => {
    const index = computeSessionIndex([
      spawn(T0, { spawnId: 'sp-1', phase: 'start', parentOwner: MAIN, childName: 'Explore' }),
    ]);
    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0]?.rootOwner).toBe(MAIN);
    expect(index.sessions[0]?.agentCount).toBe(1);
  });
});

describe('filterTapeForSession', () => {
  const child = 'agent-a';
  const grandchild = 'agent-b';
  const tape: TRecordedEvent[] = [
    activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN, session: 'sess-1' }),
    activity(T0 + 50, { phase: 'start', nodePath: DOC, owner: MAIN_B }),
    spawn(T0 + 100, {
      spawnId: 'sp-1',
      phase: 'handoff',
      parentOwner: MAIN,
      childName: 'Explore',
      childOwner: child,
    }),
    activity(T0 + 200, { phase: 'start', nodePath: DOC, owner: child }),
    spawn(T0 + 300, {
      spawnId: 'sp-2',
      phase: 'handoff',
      parentOwner: child,
      parentNodePath: AGENT_NODE,
      childName: 'worker',
      childOwner: grandchild,
    }),
    activity(T0 + 400, { phase: 'start', nodePath: SKILL, owner: grandchild }),
    activity(T0 + 500, { phase: 'end', sessionScope: true, session: 'sess-1' }),
  ];

  it('whole-session scope keeps the subtree, session-matched ownerless frames, and order', () => {
    const filtered = filterTapeForSession(tape, { rootOwner: MAIN });
    // Everything except MAIN_B's frame.
    expect(filtered).toHaveLength(6);
    expect(filtered.map((e) => e.tMs)).toEqual([
      T0,
      T0 + 100,
      T0 + 200,
      T0 + 300,
      T0 + 400,
      T0 + 500,
    ]);
  });

  it('agent-branch scope narrows to the subtree and drops session frames', () => {
    const filtered = filterTapeForSession(tape, { rootOwner: MAIN, agentSpawnId: 'sp-1' });
    // sp-1's spawn frame, agent-a's activity, sp-2 (parentOwner in the
    // subtree), agent-b's activity. Not the root's frame, not the
    // session-scoped end.
    expect(filtered.map((e) => e.tMs)).toEqual([T0 + 100, T0 + 200, T0 + 300, T0 + 400]);
  });

  it('an unknown root or spawn id yields an empty tape', () => {
    expect(filterTapeForSession(tape, { rootOwner: 'nope' })).toEqual([]);
    expect(filterTapeForSession(tape, { rootOwner: MAIN, agentSpawnId: 'nope' })).toEqual([]);
  });
});
