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

function recording(rootOwner: string, frames: TRecordedEvent[], startedAt = T0): ISessionRecordingApi {
  return { schemaVersion: 1, rootOwner, startedAt, frames } as unknown as ISessionRecordingApi;
}

describe('session-catalog', () => {
  it('folds journal recordings into entries + frames, skipping roots the tape carries', () => {
    const tape = computeSessionIndex(TAPE).sessions;
    const journal = foldJournalRecordings(tape, [
      recording('main:s1', TAPE), // duplicate of the live tape: skipped
      recording('main:j1', [activity(T0 + 5000, { phase: 'start', nodePath: LINT, owner: 'main:j1' })]),
    ]);
    expect(journal.entries.map((e) => e.rootOwner)).toEqual(['main:j1']);
    expect(journal.frames.get(`main:j1|${T0}`)).toHaveLength(1);
    expect(foldJournalRecordings(tape, [])).toBe(EMPTY_JOURNAL_CATALOG);
  });

  it('every recording file is its own row; the tape hides only the window it narrates', () => {
    const first = [activity(T0 + 10_000, { phase: 'start', nodePath: SKILL, owner: 'main:j1' })];
    const second = [activity(T0 + 20_000, { phase: 'start', nodePath: LINT, owner: 'main:j1' })];
    // No tape: two rows for the same runtime session, keyed by recording.
    const journal = foldJournalRecordings([], [
      recording('main:j1', first, T0 + 10_000),
      recording('main:j1', second, T0 + 20_000),
    ]);
    expect(journal.entries.map((e) => e.recordedAt)).toEqual([T0 + 10_000, T0 + 20_000]);
    expect([...journal.frames.keys()]).toEqual([`main:j1|${T0 + 10_000}`, `main:j1|${T0 + 20_000}`]);
    // The tape currently narrating the SECOND recording hides that file only.
    const tapeSecond = computeSessionIndex(second.map((e) => ({ ...e, recordedAt: T0 + 19_500 }))).sessions;
    const withTape = foldJournalRecordings(tapeSecond, [
      recording('main:j1', first, T0 + 10_000),
      recording('main:j1', second, T0 + 20_000),
    ]);
    expect(withTape.entries.map((e) => e.recordedAt)).toEqual([T0 + 10_000]);
    // Resolving names the exact recording, or the latest when unnamed.
    expect(resolveReplayTarget({ rootOwner: 'main:j1', recordedAt: T0 + 10_000, tapeSessions: [], journal })?.selection.sourceFrames).toBe(first);
    expect(resolveReplayTarget({ rootOwner: 'main:j1', tapeSessions: [], journal })?.selection.sourceFrames).toBe(second);
    // A tape row resolves to its window filter, identity included.
    expect(resolveReplayTarget({ rootOwner: 'main:j1', tapeSessions: tapeSecond, journal })?.selection).toEqual({
      rootOwner: 'main:j1',
      recordedAt: T0 + 19_500,
      tapeWindow: T0 + 19_500,
    });
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
