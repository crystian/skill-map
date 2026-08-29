import { describe, expect, it } from 'vitest';

import { EMPTY_COMET_EDGES, resolveCometOverlay } from '../comet-overlay';
import type { IGraphEdge } from '../graph-layout';

const AGENT = '.claude/agents/reviewer.md';
const SKILL = '.claude/skills/deploy/SKILL.md';
const OTHER = '.claude/skills/lint/SKILL.md';

function edge(from: string, to: string, id = `${from}|${to}`): IGraphEdge {
  return { id, from, to, kind: 'references', confidence: 1 };
}

describe('resolveCometOverlay', () => {
  it('emits one source -> target track per executing pair', () => {
    const tracks = resolveCometOverlay({
      edges: [edge(AGENT, SKILL), edge(AGENT, OTHER)],
      isExecuting: (e) => e.to === SKILL,
      isSpawnActive: () => false,
    });
    expect(tracks).toEqual([{ key: `${AGENT}>>${SKILL}`, sourceId: AGENT, targetId: SKILL }]);
  });

  it('draws nothing while no pair executes, sharing the empty sentinel', () => {
    const tracks = resolveCometOverlay({
      edges: [edge(AGENT, SKILL)],
      isExecuting: () => false,
      isSpawnActive: () => false,
    });
    expect(tracks).toBe(EMPTY_COMET_EDGES);
  });

  it('skips a spawn-active pair: the marching spawn dash is already the flow signal', () => {
    const tracks = resolveCometOverlay({
      edges: [edge(AGENT, SKILL), edge(AGENT, OTHER)],
      isExecuting: () => true,
      isSpawnActive: (e) => e.to === SKILL,
    });
    expect(tracks.map((t) => t.key)).toEqual([`${AGENT}>>${OTHER}`]);
  });

  it('collapses several link kinds on one directed pair into a single track', () => {
    const tracks = resolveCometOverlay({
      edges: [edge(AGENT, SKILL, 'ref'), edge(AGENT, SKILL, 'mention')],
      isExecuting: () => true,
      isSpawnActive: () => false,
    });
    expect(tracks).toHaveLength(1);
  });

  it('keeps the two directions of a pair as two tracks', () => {
    const tracks = resolveCometOverlay({
      edges: [edge(AGENT, SKILL), edge(SKILL, AGENT)],
      isExecuting: () => true,
      isSpawnActive: () => false,
    });
    expect(tracks.map((t) => t.key)).toEqual([`${AGENT}>>${SKILL}`, `${SKILL}>>${AGENT}`]);
  });
});
