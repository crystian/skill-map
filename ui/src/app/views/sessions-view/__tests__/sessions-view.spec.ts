/**
 * SessionsView tests: empty state, rows + stats from the fold, the
 * expandable agent tree, the trimmed-tape notice, and the Play gesture
 * routing through `SESSION_REPLAY_INTENT` (with its lens-availability
 * gating). Recorder and lens are stubbed to plain signal shapes.
 */

import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { SessionsView } from '../sessions-view';
import type { ISessionRecordingApi } from '../../../../models/api';
import { ActivityPlaybackService } from '../../../../services/activity-playback';
import { ActivityRecorderService, type TRecordedEvent } from '../../../../services/activity-recorder';
import { DATA_SOURCE } from '../../../../services/data-source/data-source.port';
import { LiveLensService } from '../../../../services/live-lens';
import { NodeActivityService } from '../../../../services/node-activity';
import { CaptureLevelService } from '../../../../services/capture-level';
import { SessionPurgeService } from '../../../../services/session-purge';
import { SESSION_RECORD_INTENT } from '../../../slots/session-record-intent';
import { SESSION_REPLAY_INTENT } from '../../../slots/session-replay-intent';
import type { IWsAgentSpawnData, IWsNodeActivityData } from '../../../../models/ws-event';

const T0 = 1_700_000_000_000;
const MAIN = 'main:sess-1';
const SKILL = '.claude/skills/deploy/SKILL.md';

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
  activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN }),
  spawn(T0 + 100, {
    spawnId: 'sp-1',
    phase: 'handoff',
    parentOwner: MAIN,
    childName: 'Explore',
    childOwner: 'agent-a',
  }),
  activity(T0 + 200, { phase: 'start', nodePath: 'docs/guide.md', owner: 'agent-a' }),
];

function makeFixture(init?: {
  tape?: TRecordedEvent[];
  dropped?: number;
  replayAvailable?: boolean;
  activityEnabled?: boolean;
  recording?: boolean;
  recordingSince?: number | null;
  replaying?: boolean;
  /** The replay transport's scoped tape / cursor / source (defaults: empty, -1, whole tape). */
  replayTape?: TRecordedEvent[];
  cursor?: number;
  source?: { kind: 'whole-tape' } | { kind: 'tape-session' | 'journal'; rootOwner: string; agentSpawnId?: string };
  /** Server-journal recordings the hydration fetch resolves. */
  journal?: ISessionRecordingApi[];
  journalCaptureLevel?: string;
  shellCapture?: boolean;
  dismissedNotes?: string[];
}) {
  const recording = signal(init?.recording ?? false);
  const replaying = signal(init?.replaying ?? false);
  const playbackExit = vi.fn(() => replaying.set(false));
  const playback = {
    active: replaying.asReadonly(),
    // The stub replay "plays" while active: the record control's
    // replaying hint follows `playing`, like REC follows capture.
    playing: replaying.asReadonly(),
    exit: playbackExit,
    tape: signal<readonly TRecordedEvent[]>(init?.replayTape ?? []).asReadonly(),
    cursor: signal(init?.cursor ?? -1).asReadonly(),
    source: signal(init?.source ?? { kind: 'whole-tape' }).asReadonly(),
  } as unknown as ActivityPlaybackService;
  const recorder = {
    events: signal<readonly TRecordedEvent[]>(init?.tape ?? TAPE).asReadonly(),
    size: signal((init?.tape ?? TAPE).length).asReadonly(),
    droppedCount: signal(init?.dropped ?? 0).asReadonly(),
    recording: recording.asReadonly(),
    recordingSince: signal(init?.recordingSince ?? null).asReadonly(),
  } as unknown as ActivityRecorderService;
  const lens = {
    available: signal(true).asReadonly(),
    replayAvailable: signal(init?.replayAvailable ?? true).asReadonly(),
  } as unknown as LiveLensService;
  const nodeActivity = {
    enabled: signal(init?.activityEnabled ?? true).asReadonly(),
  } as unknown as NodeActivityService;
  const replaySession = vi.fn();
  const startRecording = vi.fn(() => recording.set(true));
  const stopRecording = vi.fn(() => recording.set(false));
  const getSessionJournal = vi
    .fn()
    .mockResolvedValue({ sessions: init?.journal ?? [], recording: false, captureLevel: init?.journalCaptureLevel ?? 'mcp', shellCapture: init?.shellCapture ?? false });
  const setCaptureLevel = vi.fn((level: string) => Promise.resolve(level));
  const getPreferences = vi
    .fn()
    .mockResolvedValue({ ui: { dismissedNotes: init?.dismissedNotes ?? ['sessions-recording-intro'] } });
  const setPreferences = vi.fn().mockResolvedValue({});
  const purgedAt = signal(0);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [SessionsView],
    providers: [
      { provide: ActivityRecorderService, useValue: recorder },
      { provide: ActivityPlaybackService, useValue: playback },
      { provide: LiveLensService, useValue: lens },
      { provide: NodeActivityService, useValue: nodeActivity },
      { provide: DATA_SOURCE, useValue: { getSessionJournal, setCaptureLevel, getPreferences, setPreferences } },
      { provide: SESSION_REPLAY_INTENT, useValue: { replaySession } },
      { provide: SESSION_RECORD_INTENT, useValue: { startRecording, stopRecording } },
      {
        provide: SessionPurgeService,
        useValue: { purgedAt: purgedAt.asReadonly() } as unknown as SessionPurgeService,
      },
    ],
  });
  const fixture = TestBed.createComponent(SessionsView);
  fixture.detectChanges();
  return {
    fixture,
    replaySession,
    startRecording,
    stopRecording,
    playbackExit,
    getSessionJournal,
    setCaptureLevel,
    setPreferences,
    purgedAt,
  };
}

/** Click the Nth capture-level option (PrimeNG togglebutton host). */
function clickLevelOption(fixture: { nativeElement: HTMLElement }, index: number): void {
  const selector = fixture.nativeElement.querySelector('[data-testid="capture-level-selector"]')!;
  const option = selector.querySelectorAll('p-togglebutton')[index] as HTMLElement;
  option.click();
  (option.querySelector('span') as HTMLElement | null)?.click();
}

/** Settle the mount-time journal fetch, then re-render. */
async function hydrated(fixture: { detectChanges(): void }): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

function query(fixture: { nativeElement: unknown }, testid: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);
}

describe('SessionsView', () => {
  it('shows the empty state on a blank tape, with the record control still reachable', () => {
    const { fixture } = makeFixture({ tape: [] });
    expect(query(fixture, 'sessions-empty-none')).not.toBeNull();
    expect(query(fixture, 'sessions-row-1')).toBeNull();
    // The record bar renders ABOVE the branch: with it inside the list
    // state, an empty panel could never record its first session.
    expect(query(fixture, 'sessions-record-toggle')).not.toBeNull();
  });

  it('the record control toggles capture through the intent, never the recorder directly', () => {
    const { fixture, startRecording, stopRecording } = makeFixture({ tape: [] });
    const button = (): HTMLButtonElement =>
      query(fixture, 'sessions-record-toggle')?.querySelector('button') as HTMLButtonElement;
    expect(query(fixture, 'sessions-recording-hint')).toBeNull();

    button().click();
    fixture.detectChanges();
    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(query(fixture, 'sessions-recording-hint')).not.toBeNull();

    button().click();
    fixture.detectChanges();
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(query(fixture, 'sessions-recording-hint')).toBeNull();
  });

  it('while a replay runs, the record control becomes its stop', () => {
    const { fixture, startRecording, playbackExit } = makeFixture({ replaying: true });
    const host = query(fixture, 'sessions-record-toggle');
    expect(host?.textContent).toContain('Stop replay');
    (host?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(playbackExit).toHaveBeenCalledTimes(1);
    expect(startRecording).not.toHaveBeenCalled();
    // Replay gone: the control returns to its record face.
    expect(query(fixture, 'sessions-record-toggle')?.textContent).toContain('Record session');
  });

  it('the record control disables while Real Time is off', () => {
    const { fixture } = makeFixture({ tape: [], activityEnabled: false });
    const button = query(fixture, 'sessions-record-toggle')?.querySelector(
      'button',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('renders a session row titled by what it touched, identity + stats as subtitle', () => {
    const { fixture } = makeFixture();
    const row = query(fixture, 'sessions-row-1');
    // Title: the touched names, first-touch order (usage over identity).
    expect(row?.textContent).toContain('deploy · guide');
    // Subtitle: the RUNTIME session id (the journal filename's suffix),
    // never the synthetic ordinal.
    expect(row?.textContent).toContain('sess-…');
    expect(row?.textContent).not.toContain('Session 1');
    expect(row?.textContent).toContain('3 events');
    expect(row?.textContent).toContain('2 files');
    expect(row?.textContent).toContain('1 agent');
  });

  it('expands into the agent tree on toggle', () => {
    const { fixture } = makeFixture();
    expect(query(fixture, 'sessions-agent-sp-1')).toBeNull();
    (query(fixture, 'sessions-toggle-1') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query(fixture, 'sessions-agent-sp-1')?.textContent).toContain('Explore');
  });

  it('lists the internal steps under the main context and under an expanded agent', () => {
    const tape: TRecordedEvent[] = [
      activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN, detail: 'Skill' }),
      spawn(T0 + 100, {
        spawnId: 'sp-1',
        phase: 'handoff',
        parentOwner: MAIN,
        childName: 'Explore',
        childOwner: 'agent-a',
      }),
      activity(T0 + 200, {
        phase: 'start',
        nodePath: 'docs/guide.md',
        owner: 'agent-a',
        access: 'read',
        detail: 'Read',
      }),
    ];
    const { fixture } = makeFixture({ tape });
    const dom = fixture.nativeElement as HTMLElement;
    // Collapsed: no step rows at all.
    expect(dom.querySelectorAll('[data-testid="sessions-step"]').length).toBe(0);
    // Session expanded: main's own step shows (the replay-ticker grammar).
    (query(fixture, 'sessions-toggle-1') as HTMLButtonElement).click();
    fixture.detectChanges();
    const mainSteps = dom.querySelectorAll('[data-testid="sessions-step"]');
    expect(mainSteps.length).toBe(1);
    expect(mainSteps[0]?.textContent).toContain('Skill deploy');
    // Agent expanded: its own read lists beneath it.
    const agentToggle = query(fixture, 'sessions-agent-sp-1')
      ?.closest('.sessions__agent')
      ?.querySelector('.sessions__chevron') as HTMLButtonElement;
    agentToggle.click();
    fixture.detectChanges();
    const allSteps = dom.querySelectorAll('[data-testid="sessions-step"]');
    expect(allSteps.length).toBe(2);
    expect(allSteps[1]?.textContent).toContain('Read guide');
  });

  it('while its session replays, the cursor row is current and the session auto-expands', () => {
    const tape: TRecordedEvent[] = [
      activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN, detail: 'Skill' }),
      activity(T0 + 500, { phase: 'start', nodePath: 'docs/guide.md', owner: MAIN }),
    ];
    const { fixture } = makeFixture({
      tape,
      replaying: true,
      replayTape: tape,
      cursor: 1,
      source: { kind: 'tape-session', rootOwner: MAIN },
    });
    // The rail follows the cursor: the session auto-expands, no click needed.
    fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    const steps = dom.querySelectorAll('[data-testid="sessions-step"]');
    expect(steps.length).toBe(2);
    expect(steps[0]?.getAttribute('aria-current')).toBeNull();
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
  });

  it('two recordings of the same runtime session are two rows, each replaying its own window', () => {
    const tape: TRecordedEvent[] = [
      { ...activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN }), recordedAt: 1000 },
      { ...activity(T0 + 60_000, { phase: 'start', nodePath: 'docs/guide.md', owner: MAIN }), recordedAt: 2000 },
    ];
    const { fixture, replaySession } = makeFixture({ tape });
    expect(query(fixture, 'sessions-toggle-1')).not.toBeNull();
    expect(query(fixture, 'sessions-toggle-2')).not.toBeNull();
    // Newest first: row 1 is the second recording; its Play scopes to its window.
    (query(fixture, 'sessions-play-1')?.querySelector('button') as HTMLButtonElement).click();
    expect(replaySession).toHaveBeenCalledWith(
      { rootOwner: MAIN, recordedAt: 2000, tapeWindow: 2000 },
      'guide',
    );
  });

  it('a step row deep-links: session selection + the step identity through the intent', () => {
    const tape: TRecordedEvent[] = [
      activity(T0, { phase: 'start', nodePath: SKILL, owner: MAIN, detail: 'Skill' }),
    ];
    const { fixture, replaySession } = makeFixture({ tape });
    (query(fixture, 'sessions-toggle-1') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query(fixture, 'sessions-step') as HTMLButtonElement).click();
    expect(replaySession).toHaveBeenCalledWith({ rootOwner: MAIN }, 'deploy', {
      tMs: T0,
      path: SKILL,
      detail: 'Skill',
    });
  });

  it('the in-flight session while recording cannot replay; finished ones can', async () => {
    // Tape frames are stamped T0.. (see TAPE); a watermark BEFORE them
    // marks the session as still receiving frames -> blocked.
    const { fixture } = makeFixture({ recording: true, recordingSince: 1 });
    const play = fixture.nativeElement.querySelector(
      '[data-testid="sessions-play-1"] button',
    ) as HTMLButtonElement;
    expect(play.disabled).toBe(true);

    // A watermark AFTER the last frame = a finished session -> replayable.
    const done = makeFixture({ recording: true, recordingSince: Number.MAX_SAFE_INTEGER });
    const donePlay = done.fixture.nativeElement.querySelector(
      '[data-testid="sessions-play-1"] button',
    ) as HTMLButtonElement;
    expect(donePlay.disabled).toBe(false);
  });

  it('shows the content-free intro note until dismissed; dismissing persists machine-wide', async () => {
    const { fixture, setPreferences } = makeFixture({ dismissedNotes: [] });
    await hydrated(fixture);
    const note = fixture.nativeElement.querySelector('[data-testid="sessions-intro-note"]');
    expect(note?.textContent).toContain('content-free');

    (
      fixture.nativeElement.querySelector(
        '[data-testid="sessions-intro-dismiss"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="sessions-intro-note"]'),
    ).toBeNull();
    expect(setPreferences).toHaveBeenCalledWith({
      ui: { dismissedNotes: ['sessions-recording-intro'] },
    });
  });

  it('a session row tags the capture level its recording was made under', async () => {
    const recording: ISessionRecordingApi = {
      schemaVersion: 1,
      sessionId: 'abc-123',
      rootOwner: 'main:abc-123',
      captureLevel: 'executions',
      startedAt: T0,
      frames: [
        {
          tMs: T0 + 1,
          type: 'node.activity',
          data: { nodePath: '.claude/skills/deploy/SKILL.md', phase: 'start', owner: 'main:abc-123', detail: 'Skill' },
        },
      ],
    };
    const { fixture } = makeFixture({ tape: [], journal: [recording] });
    await hydrated(fixture);
    const tag = fixture.nativeElement.querySelector('[data-testid="sessions-level-1"]');
    expect(tag?.textContent?.trim()).toBe('run');
  });

  it('the capture-level selector LOCKS while recording (clicks change nothing)', async () => {
    const locked = makeFixture({ recording: true });
    await hydrated(locked.fixture);
    clickLevelOption(locked.fixture, 0); // try to drop to executions
    locked.fixture.detectChanges();
    expect(locked.setCaptureLevel).not.toHaveBeenCalled();

    // Not recording: the same click moves the ladder.
    const open = makeFixture({ recording: false });
    await hydrated(open.fixture);
    clickLevelOption(open.fixture, 0);
    open.fixture.detectChanges();
    await hydrated(open.fixture);
    expect(open.setCaptureLevel).toHaveBeenCalledWith('executions');
  });

  it('the shell option unlocks only with the install opt-in (envelope shellCapture)', async () => {
    // Without the opt-in the fifth position is disabled: clicking it
    // never reaches the service.
    const locked = makeFixture({});
    await hydrated(locked.fixture);
    expect(TestBed.inject(CaptureLevelService).shellCapture()).toBe(false);
    clickLevelOption(locked.fixture, 4);
    locked.fixture.detectChanges();
    expect(locked.setCaptureLevel).not.toHaveBeenCalled();

    // With it, the same click moves the ladder to shell.
    const open = makeFixture({ shellCapture: true });
    await hydrated(open.fixture);
    expect(TestBed.inject(CaptureLevelService).shellCapture()).toBe(true);
    clickLevelOption(open.fixture, 4);
    open.fixture.detectChanges();
    await hydrated(open.fixture);
    expect(open.setCaptureLevel).toHaveBeenCalledWith('shell');
  });

  it('mounts the capture-level selector and hydrates the shared service from the envelope', async () => {
    const { fixture } = makeFixture({ journalCaptureLevel: 'reads' });
    await hydrated(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="capture-level-selector"]'),
    ).toBeTruthy();
    expect(TestBed.inject(CaptureLevelService).level()).toBe('reads');
  });

  it('a settled purge refetches the journal even with an already-empty tape', async () => {
    const { fixture, getSessionJournal, purgedAt } = makeFixture({ tape: [] });
    await hydrated(fixture);
    expect(getSessionJournal).toHaveBeenCalledTimes(1);

    // The Settings purge lands: no tape transition exists to piggyback
    // on (the tape was already empty), the purge signal alone must
    // trigger the refetch or stale journal rows survive until an F5.
    purgedAt.set(1);
    fixture.detectChanges();
    await vi.waitFor(() => {
      expect(getSessionJournal).toHaveBeenCalledTimes(2);
    });
  });

  it('hydrates journal-only sessions and replays them with the recording frames as source', async () => {
    const journalFrames = [
      {
        tMs: T0 - 500_000,
        type: 'node.activity' as const,
        data: { nodePath: SKILL, phase: 'start', owner: 'main:old-1' },
      },
    ];
    const { fixture, replaySession } = makeFixture({
      tape: [],
      journal: [
        {
          schemaVersion: 1,
          sessionId: 'old-1',
          rootOwner: 'main:old-1',
          provider: 'claude',
          startedAt: T0 - 500_000,
          endedAt: T0 - 400_000,
          frames: journalFrames,
        },
      ],
    });
    await hydrated(fixture);
    // The journal session lists despite an EMPTY client tape (that is
    // the whole point: sessions survive reloads on disk).
    expect(query(fixture, 'sessions-empty-none')).toBeNull();
    const row = query(fixture, 'sessions-row-1');
    expect(row?.textContent).toContain('old-1');
    // Its replay carries the recording's own frames: the client
    // recorder never saw them, so the tape cannot be the source.
    (query(fixture, 'sessions-play-1')?.querySelector('button') as HTMLButtonElement).click();
    expect(replaySession).toHaveBeenCalledWith(
      // A journal row carries its recording identity (the file's startedAt).
      { rootOwner: 'main:old-1', recordedAt: T0 - 500_000, sourceFrames: journalFrames },
      'deploy',
    );
  });

  it('the live tape wins over a journal recording of the SAME session (no double rows)', async () => {
    const { fixture } = makeFixture({
      journal: [
        {
          schemaVersion: 1,
          sessionId: 'sess-1',
          rootOwner: MAIN,
          startedAt: T0,
          frames: [
            {
              tMs: T0,
              type: 'node.activity' as const,
              data: { nodePath: SKILL, phase: 'start', owner: MAIN },
            },
          ],
        },
      ],
    });
    await hydrated(fixture);
    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelectorAll('[data-testid^="sessions-row-"]').length).toBe(1);
  });

  it('Play routes the whole-session selection through the intent', () => {
    const { fixture, replaySession } = makeFixture();
    (query(fixture, 'sessions-play-1')?.querySelector('button') as HTMLButtonElement).click();
    expect(replaySession).toHaveBeenCalledWith({ rootOwner: MAIN }, 'deploy · guide');
  });

  it('Play on an agent narrows the selection to that branch', () => {
    const { fixture, replaySession } = makeFixture();
    (query(fixture, 'sessions-toggle-1') as HTMLButtonElement).click();
    fixture.detectChanges();
    (
      query(fixture, 'sessions-play-agent-sp-1')?.querySelector('button') as HTMLButtonElement
    ).click();
    expect(replaySession).toHaveBeenCalledWith(
      { rootOwner: MAIN, agentSpawnId: 'sp-1' },
      'deploy · guide: Explore',
    );
  });

  it('Play is disabled while replay is unavailable', () => {
    const { fixture } = makeFixture({ replayAvailable: false });
    const button = query(fixture, 'sessions-play-1')?.querySelector('button');
    expect(button?.disabled).toBe(true);
  });

  it('flags a trimmed tape', () => {
    const { fixture } = makeFixture({ dropped: 12 });
    expect(query(fixture, 'sessions-trimmed')).not.toBeNull();
  });
});
