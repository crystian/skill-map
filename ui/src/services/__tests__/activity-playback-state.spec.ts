/**
 * Pure-fold tests for the Live lens replay: virtual-time claim decay,
 * the owner heartbeat, scoped ends, invocation correlation, spawn and
 * co-lit accumulation, and the ticker captions. No TestBed, no timers:
 * the state at step K is a function of the list.
 */

import { describe, expect, it } from 'vitest';

import {
  computePlaybackState,
  type IPlaybackState,
} from '../activity-playback-state';
import type { TRecordedEvent } from '../activity-recorder';
import type { IWsAgentSpawnData, IWsNodeActivityData } from '../../models/ws-event';

const T0 = 1_700_000_000_000;
const AGENT = '.claude/agents/reviewer.md';
const SKILL = '.claude/skills/deploy/SKILL.md';
const MCP = 'mcp://database';

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

function stateAtEnd(events: TRecordedEvent[]): IPlaybackState {
  return computePlaybackState(events, events.length - 1);
}

describe('computePlaybackState', () => {
  it('cursor -1 is the empty state', () => {
    const state = computePlaybackState([activity(T0, { phase: 'start', nodePath: SKILL })], -1);
    expect(state.executing.size).toBe(0);
    expect(state.members.size).toBe(0);
    expect(state.caption).toBeNull();
  });

  it('a start lights the node; the momentary claim decays in virtual time', () => {
    const events = [
      activity(T0, { phase: 'start', nodePath: SKILL, owner: 'a' }),
      // 20s later (past the 12s momentary window), another node starts
      // under ANOTHER owner, so no heartbeat refreshes the first claim.
      activity(T0 + 20_000, { phase: 'start', nodePath: AGENT, owner: 'b' }),
    ];
    const afterFirst = computePlaybackState(events, 0);
    expect(afterFirst.executing.has(SKILL)).toBe(true);
    expect(afterFirst.virtualNowMs).toBe(T0);

    const afterSecond = stateAtEnd(events);
    expect(afterSecond.executing.has(SKILL)).toBe(false); // decayed
    expect(afterSecond.executing.has(AGENT)).toBe(true);
    expect(afterSecond.members.has(SKILL)).toBe(true); // history stays
  });

  it('a sticky claim survives the same gap', () => {
    const events = [
      activity(T0, { phase: 'start', nodePath: AGENT, owner: 'a', sticky: true }),
      activity(T0 + 20_000, { phase: 'start', nodePath: SKILL, owner: 'b' }),
    ];
    expect(stateAtEnd(events).executing.has(AGENT)).toBe(true);
  });

  it('the owner heartbeat keeps a chain alive across quiet nodes', () => {
    // The SAME owner keeps signaling elsewhere: each frame refreshes
    // every claim it holds, so the first momentary claim outlives 3x
    // its window.
    const events = [
      activity(T0, { phase: 'start', nodePath: SKILL, owner: 'a' }),
      activity(T0 + 10_000, { phase: 'start', nodePath: AGENT, owner: 'a' }),
      activity(T0 + 20_000, { phase: 'start', nodePath: MCP, owner: 'a', detail: 'query' }),
      activity(T0 + 30_000, { phase: 'start', nodePath: AGENT, owner: 'a' }),
    ];
    expect(stateAtEnd(events).executing.has(SKILL)).toBe(true);
  });

  it('an explicit end releases the claim; an owner-scoped end releases everything', () => {
    const ended = stateAtEnd([
      activity(T0, { phase: 'start', nodePath: SKILL, owner: 'a' }),
      activity(T0 + 100, { phase: 'end', nodePath: SKILL, owner: 'a' }),
    ]);
    expect(ended.executing.has(SKILL)).toBe(false);

    const ownerEnded = stateAtEnd([
      activity(T0, { phase: 'start', nodePath: SKILL, owner: 'a', sticky: true }),
      activity(T0 + 50, { phase: 'start', nodePath: AGENT, owner: 'a', sticky: true }),
      activity(T0 + 100, { phase: 'end', ownerScope: true, owner: 'a' }),
    ]);
    expect(ownerEnded.executing.size).toBe(0);
    expect(ownerEnded.caption).toEqual({ kind: 'owner-end', owner: 'a' });
  });

  it('a session-scoped end releases every owner grouped under the session', () => {
    const state = stateAtEnd([
      activity(T0, { phase: 'start', nodePath: SKILL, owner: 'a', session: 's1', sticky: true }),
      activity(T0 + 10, { phase: 'start', nodePath: AGENT, owner: 'b', session: 's1', sticky: true }),
      activity(T0 + 100, { phase: 'end', sessionScope: true, session: 's1' }),
    ]);
    expect(state.executing.size).toBe(0);
    expect(state.caption).toEqual({ kind: 'session-end', session: 's1' });
  });

  it('the trail lists every lit node once, in first-touch order, ignoring spawn frames', () => {
    const events = [
      activity(T0, { phase: 'start', nodePath: AGENT, owner: 'a' }),
      spawn(T0 + 100, {
        spawnId: 's1',
        phase: 'start',
        parentOwner: 'a',
        parentNodePath: AGENT,
        childNodePath: SKILL,
      }),
      activity(T0 + 200, { phase: 'start', nodePath: SKILL, owner: 'b' }),
      activity(T0 + 300, { phase: 'start', nodePath: MCP, owner: 'b', detail: 'query' }),
      activity(T0 + 400, { phase: 'end', nodePath: SKILL, owner: 'b' }),
      activity(T0 + 500, { phase: 'start', nodePath: AGENT, owner: 'a' }),
    ];
    expect(computePlaybackState(events, -1).trail).toEqual([]);
    // The spawn frame adds SKILL to members but not to the trail yet.
    expect(computePlaybackState(events, 1).trail).toEqual([AGENT]);
    expect(computePlaybackState(events, 1).members.has(SKILL)).toBe(true);
    // A node's second start never re-enters the route.
    expect(stateAtEnd(events).trail).toEqual([AGENT, SKILL, MCP]);
  });

  it('correlates an mcp invocation to the most recent unit of the same owner', () => {
    const state = stateAtEnd([
      activity(T0, { phase: 'start', nodePath: AGENT, owner: 'a', sticky: true }),
      activity(T0 + 100, { phase: 'start', nodePath: MCP, owner: 'a', detail: 'mcp__db__query' }),
    ]);
    expect(state.invocations).toHaveLength(1);
    expect(state.invocations[0]).toMatchObject({
      caller: AGENT,
      target: MCP,
      label: 'mcp__db__query',
    });
  });

  it('a bare main-session mcp call records no invocation', () => {
    const state = stateAtEnd([
      activity(T0, { phase: 'start', nodePath: MCP, owner: 'a', detail: 'mcp__db__query' }),
    ]);
    expect(state.invocations).toHaveLength(0);
    expect(state.executing.has(MCP)).toBe(true);
  });

  it('invocations accumulate past owner ends (history does not un-happen)', () => {
    const state = stateAtEnd([
      activity(T0, { phase: 'start', nodePath: AGENT, owner: 'a', sticky: true }),
      activity(T0 + 100, { phase: 'start', nodePath: MCP, owner: 'a', detail: 'query' }),
      activity(T0 + 200, { phase: 'end', ownerScope: true, owner: 'a' }),
    ]);
    expect(state.invocations).toHaveLength(1);
  });

  it('spawn relations accumulate with the latest spawnId; membership includes both ends', () => {
    const state = stateAtEnd([
      spawn(T0, {
        spawnId: 's1',
        phase: 'start',
        parentOwner: 'main',
        parentNodePath: AGENT,
        childNodePath: SKILL,
      }),
      spawn(T0 + 100, { spawnId: 's1', phase: 'end', parentOwner: 'main', parentNodePath: AGENT, childNodePath: SKILL }),
      spawn(T0 + 200, {
        spawnId: 's2',
        phase: 'start',
        parentOwner: 'main',
        parentNodePath: AGENT,
        childNodePath: SKILL,
      }),
    ]);
    expect(state.spawns).toHaveLength(1);
    expect(state.spawns[0]?.lastSpawnId).toBe('s2');
    expect(state.members.has(AGENT)).toBe(true);
    expect(state.members.has(SKILL)).toBe(true);
  });

  it('records both orientations of a co-lit pair', () => {
    const state = stateAtEnd([
      activity(T0, { phase: 'start', nodePath: AGENT, owner: 'a', sticky: true }),
      activity(T0 + 100, { phase: 'start', nodePath: SKILL, owner: 'a' }),
    ]);
    expect(state.coLitPairs.has(`${AGENT}|${SKILL}`)).toBe(true);
    expect(state.coLitPairs.has(`${SKILL}|${AGENT}`)).toBe(true);
  });

  it('details ride only executing nodes (swept with the glow, like live)', () => {
    const events = [
      activity(T0, { phase: 'start', nodePath: SKILL, owner: 'a', detail: 'Skill' }),
      activity(T0 + 20_000, { phase: 'start', nodePath: AGENT, owner: 'b' }),
    ];
    const early = computePlaybackState(events, 0);
    expect(early.details.get(SKILL)).toBe('Skill');
    const late = stateAtEnd(events);
    expect(late.details.has(SKILL)).toBe(false);
  });

  it('captions narrate the cursor event', () => {
    const events = [
      activity(T0, { phase: 'start', nodePath: SKILL, owner: 'a', detail: 'Read' }),
      activity(T0 + 10, { phase: 'end', nodePath: SKILL, owner: 'a' }),
      spawn(T0 + 20, {
        spawnId: 's1',
        phase: 'start',
        parentOwner: 'main',
        parentNodePath: AGENT,
        childNodePath: SKILL,
        childName: 'deploy',
      }),
    ];
    expect(computePlaybackState(events, 0).caption).toEqual({
      kind: 'start',
      path: SKILL,
      detail: 'Read',
      owner: 'a',
    });
    expect(computePlaybackState(events, 1).caption).toEqual({ kind: 'end', path: SKILL });
    expect(computePlaybackState(events, 2).caption).toEqual({
      kind: 'spawn',
      phase: 'start',
      parent: AGENT,
      child: SKILL,
      childName: 'deploy',
    });
  });

  it('node-less custody frames caption too (a blank ticker reads broken)', () => {
    const events = [
      activity(T0, { phase: 'end', owner: 'main:s1', turnEnd: true }),
      activity(T0 + 10, { phase: 'start', owner: 'main:s1' }),
    ];
    expect(computePlaybackState(events, 0).caption).toEqual({ kind: 'turn-end' });
    expect(computePlaybackState(events, 1).caption).toEqual({ kind: 'other' });
  });

  it('a cursor past the end clamps to the last event', () => {
    const events = [activity(T0, { phase: 'start', nodePath: SKILL, owner: 'a' })];
    const state = computePlaybackState(events, 99);
    expect(state.executing.has(SKILL)).toBe(true);
    expect(state.virtualNowMs).toBe(T0);
  });
});
