import { describe, expect, it } from 'vitest';

import type { ISessionRecordingApi } from '../../models/api';
import type { IWsAgentSpawnData, IWsNodeActivityData } from '../../models/ws-event';
import type { TRecordedEvent } from '../activity-recorder';
import {
  EMPTY_JOURNAL_CATALOG,
  findSessionAgent,
  foldJournalRecordings,
  resolveReplayTarget,
  sessionTitle,
} from '../session-catalog';
import { computeSessionIndex } from '../session-index';

const T0 = 1_700_000_000_000;
const SKILL = '.claude/skills/deploy/SKILL.md';
const LINT = '.claude/skills/lint/SKILL.md';

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

const TAPE: TRecordedEvent[] = [
  activity(T0, { phase: 'start', nodePath: SKILL, owner: 'main:s1' }),
  spawn(T0 + 100, { spawnId: 'sp-1', phase: 'start', parentOwner: 'main:s1', childName: 'reviewer' }),
  activity(T0 + 200, { phase: 'start', nodePath: LINT, owner: 'main:s1' }),
];

function recording(rootOwner: string, frames: TRecordedEvent[]): ISessionRecordingApi {
  return { schemaVersion: 1, rootOwner, startedAt: T0, frames } as unknown as ISessionRecordingApi;
}

describe('session-catalog', () => {
  it('folds journal recordings into entries + frames, skipping roots the tape carries', () => {
    const tape = computeSessionIndex(TAPE).sessions;
    const journal = foldJournalRecordings(tape, [
      recording('main:s1', TAPE), // duplicate of the live tape: skipped
      recording('main:j1', [activity(T0 + 5000, { phase: 'start', nodePath: LINT, owner: 'main:j1' })]),
    ]);
    expect(journal.entries.map((e) => e.rootOwner)).toEqual(['main:j1']);
    expect(journal.frames.get('main:j1')).toHaveLength(1);
    expect(foldJournalRecordings(tape, [])).toBe(EMPTY_JOURNAL_CATALOG);
  });

  it('titles a session by its touched names, counters when nothing was touched', () => {
    const [session] = computeSessionIndex(TAPE).sessions;
    expect(sessionTitle(session!)).toBe('deploy · lint');
  });

  it('resolves a tape session (no source frames) and a journal one (with them)', () => {
    const tape = computeSessionIndex(TAPE).sessions;
    const journalFrames = [activity(T0 + 5000, { phase: 'start', nodePath: LINT, owner: 'main:j1' })];
    const journal = foldJournalRecordings(tape, [recording('main:j1', journalFrames)]);

    expect(resolveReplayTarget({ rootOwner: 'main:s1', tapeSessions: tape, journal })).toEqual({
      selection: { rootOwner: 'main:s1' },
      label: 'deploy · lint',
    });
    const fromJournal = resolveReplayTarget({ rootOwner: 'main:j1', tapeSessions: tape, journal });
    expect(fromJournal?.selection.sourceFrames).toBe(journalFrames);
    expect(fromJournal?.label).toBe('lint');
    expect(resolveReplayTarget({ rootOwner: 'main:gone', tapeSessions: tape, journal })).toBeNull();
  });

  it('resolves an agent branch by spawn id with the agent label, null for an unknown agent', () => {
    const tape = computeSessionIndex(TAPE).sessions;
    const [session] = tape;
    expect(findSessionAgent(session!.agents, 'sp-1')?.name).toBe('reviewer');
    const target = resolveReplayTarget({
      rootOwner: 'main:s1',
      agentSpawnId: 'sp-1',
      tapeSessions: tape,
      journal: EMPTY_JOURNAL_CATALOG,
    });
    expect(target?.selection).toEqual({ rootOwner: 'main:s1', agentSpawnId: 'sp-1' });
    expect(target?.label).toContain('reviewer');
    expect(
      resolveReplayTarget({
        rootOwner: 'main:s1',
        agentSpawnId: 'sp-404',
        tapeSessions: tape,
        journal: EMPTY_JOURNAL_CATALOG,
      }),
    ).toBeNull();
  });
});
