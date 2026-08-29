import { describe, expect, it } from 'vitest';

import { buildTrailIndex, DIRECTOR_HOLD, EMPTY_TRAIL_INDEX, resolveDirectorTargets } from '../director';

const AGENT = '.claude/agents/reviewer.md';
const SKILL = '.claude/skills/deploy/SKILL.md';
const MEMBERSHIP: ReadonlySet<string> = new Set([AGENT, SKILL]);

describe('resolveDirectorTargets', () => {
  it('frames the whole membership outside a replay or with the director off', () => {
    const caption = { kind: 'start', path: AGENT } as const;
    expect(
      resolveDirectorTargets({ replayOn: false, director: true, atEnd: false, caption, membership: MEMBERSHIP }),
    ).toBe(MEMBERSHIP);
    expect(
      resolveDirectorTargets({ replayOn: true, director: false, atEnd: false, caption, membership: MEMBERSHIP }),
    ).toBe(MEMBERSHIP);
  });

  it('close-up on the node a start frame is about, and on the child of a spawn', () => {
    expect(
      resolveDirectorTargets({
        replayOn: true,
        director: true,
        atEnd: false,
        caption: { kind: 'start', path: SKILL },
        membership: MEMBERSHIP,
      }),
    ).toEqual(new Set([SKILL]));
    expect(
      resolveDirectorTargets({
        replayOn: true,
        director: true,
        atEnd: false,
        caption: { kind: 'spawn', phase: 'start', parent: AGENT, child: SKILL },
        membership: MEMBERSHIP,
      }),
    ).toEqual(new Set([SKILL]));
  });

  it('holds on frames about nothing on the map (ends, boundaries, nameless spawns)', () => {
    const base = { replayOn: true, director: true, atEnd: false, membership: MEMBERSHIP };
    expect(resolveDirectorTargets({ ...base, caption: { kind: 'end', path: SKILL } })).toBe(DIRECTOR_HOLD);
    expect(resolveDirectorTargets({ ...base, caption: { kind: 'owner-end', owner: 'a' } })).toBe(DIRECTOR_HOLD);
    expect(resolveDirectorTargets({ ...base, caption: { kind: 'turn-end' } })).toBe(DIRECTOR_HOLD);
    expect(resolveDirectorTargets({ ...base, caption: { kind: 'spawn', phase: 'start' } })).toBe(DIRECTOR_HOLD);
  });

  it('overview before the first frame and pull-back at the end of the tape', () => {
    const base = { replayOn: true, director: true, membership: MEMBERSHIP };
    expect(resolveDirectorTargets({ ...base, atEnd: false, caption: null })).toBe(MEMBERSHIP);
    expect(
      resolveDirectorTargets({ ...base, atEnd: true, caption: { kind: 'start', path: SKILL } }),
    ).toBe(MEMBERSHIP);
  });
});

describe('buildTrailIndex', () => {
  it('shares the empty sentinel for an empty route', () => {
    expect(buildTrailIndex([])).toBe(EMPTY_TRAIL_INDEX);
  });

  it('numbers steps 1-based and fades recency from the latest (0) to the oldest (1)', () => {
    const index = buildTrailIndex([AGENT, SKILL, 'mcp://db']);
    expect(index.get(AGENT)).toEqual({ step: 1, recency: 1 });
    expect(index.get(SKILL)).toEqual({ step: 2, recency: 0.5 });
    expect(index.get('mcp://db')).toEqual({ step: 3, recency: 0 });
  });

  it('a single-step route is the latest step, never a faded one', () => {
    expect(buildTrailIndex([AGENT]).get(AGENT)).toEqual({ step: 1, recency: 0 });
  });
});
