/**
 * `ActivityPlaybackService` transport tests: the frozen tape, the
 * 1 event/sec stepper, auto-pause at the end, replay-from-end, and
 * scrubbing. Fake timers; the recorder is stubbed to a plain signal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ActivityPlaybackService, EMBED_PLAYBACK_STEP_MS, PLAYBACK_STEP_MS } from '../activity-playback';
import { ActivityRecorderService, type TRecordedEvent } from '../activity-recorder';
import type { IWsNodeActivityData } from '../../models/ws-event';

const T0 = 1_700_000_000_000;
const SKILL = '.claude/skills/deploy/SKILL.md';

function frame(tMs: number, nodePath: string): TRecordedEvent {
  return {
    tMs,
    type: 'node.activity',
    data: { nodePath, phase: 'start', owner: 'a' } as IWsNodeActivityData,
  };
}

function bootstrap(initial: TRecordedEvent[] = []) {
  TestBed.resetTestingModule();
  const events = signal<readonly TRecordedEvent[]>(initial);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ActivityRecorderService,
        useValue: { events: events.asReadonly() } as unknown as ActivityRecorderService,
      },
    ],
  });
  const service = TestBed.inject(ActivityPlaybackService);
  return { service, events };
}

const TAPE = [frame(T0, SKILL), frame(T0 + 500, 'b.md'), frame(T0 + 900, 'c.md')];

describe('ActivityPlaybackService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enter snapshots the tape, rewinds, and auto-plays one event per second', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    expect(service.active()).toBe(true);
    expect(service.playing()).toBe(true);
    expect(service.cursor()).toBe(-1);
    expect(service.total()).toBe(3);

    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(0);
    expect(service.state().executing.has(SKILL)).toBe(true);

    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(1);
  });

  it('auto-pauses on the last event and play() from the end restarts', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 5);
    expect(service.cursor()).toBe(2);
    expect(service.playing()).toBe(false);

    service.play();
    expect(service.cursor()).toBe(-1); // watch it again
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(0);
  });

  it('pause holds the cursor; play resumes from there', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    service.pause();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 3);
    expect(service.cursor()).toBe(0);

    service.play();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(1);
  });

  it('live frames recorded mid-replay never shift the frozen tape', () => {
    const { service, events } = bootstrap(TAPE);
    service.enter();
    events.set([...TAPE, frame(T0 + 2000, 'late.md')]);
    expect(service.total()).toBe(3);

    // A fresh enter picks the newer tape up.
    service.exit();
    service.enter();
    expect(service.total()).toBe(4);
  });

  it('seek clamps and stepBack/stepForward move one event', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    service.pause();
    service.seek(99);
    expect(service.cursor()).toBe(2);
    service.seek(-5);
    expect(service.cursor()).toBe(-1);
    service.stepForward();
    expect(service.cursor()).toBe(0);
    service.stepBack();
    expect(service.cursor()).toBe(-1);
  });

  it('exit stops the stepper and drops the tape', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    service.exit();
    expect(service.active()).toBe(false);
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 3);
    expect(service.cursor()).toBe(-1);
    expect(service.total()).toBe(0);
  });

  it('deleting the recording stands the replay down, wherever the delete came from', () => {
    const { service, events } = bootstrap(TAPE);
    service.enter();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.active()).toBe(true);

    // The Settings row (or the bar shortcut) clears the recorder; the
    // frozen tape now describes something that no longer exists.
    events.set([]);
    TestBed.tick();
    expect(service.active()).toBe(false);
    expect(service.playing()).toBe(false);
    expect(service.total()).toBe(0);
  });

  it('the replay source defaults to whole-tape, rides enter(), and resets on exit', () => {
    const { service } = bootstrap(TAPE);
    expect(service.source()).toEqual({ kind: 'whole-tape' });

    service.enter(TAPE, 'Session 1', { kind: 'tape-session', rootOwner: 'main:s1' });
    expect(service.source()).toEqual({ kind: 'tape-session', rootOwner: 'main:s1' });
    service.exit();
    expect(service.source()).toEqual({ kind: 'whole-tape' });

    service.enter(TAPE, 'journal row', { kind: 'journal', rootOwner: 'main:j1' });
    expect(service.source()).toEqual({ kind: 'journal', rootOwner: 'main:j1' });
    service.exit();

    // Entering without a source keeps the historical default.
    service.enter(TAPE);
    expect(service.source()).toEqual({ kind: 'whole-tape' });
    service.exit();
  });

  it('entering with an empty tape stays inert (nothing to play)', () => {
    const { service } = bootstrap([]);
    service.enter();
    expect(service.active()).toBe(true);
    expect(service.playing()).toBe(false);
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 2);
    expect(service.cursor()).toBe(-1);
  });

  it('enter with a scoped tape plays that slice, not the recorder', () => {
    const { service } = bootstrap(TAPE);
    const slice = TAPE.slice(0, 2);
    service.enter(slice, 'Session 1');
    expect(service.total()).toBe(2);
    expect(service.scopeLabel()).toBe('Session 1');
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.state().executing.has(SKILL)).toBe(true);
  });

  it('exit clears the scope label; a plain enter never sets one', () => {
    const { service } = bootstrap(TAPE);
    service.enter(TAPE.slice(0, 1), 'Session 1');
    service.exit();
    expect(service.scopeLabel()).toBeNull();
    service.enter();
    expect(service.scopeLabel()).toBeNull();
    expect(service.total()).toBe(3);
  });

  it('deleting the recording stands a SCOPED replay down too', () => {
    const { service, events } = bootstrap(TAPE);
    service.enter(TAPE.slice(0, 2), 'Session 1');
    expect(service.active()).toBe(true);
    events.set([]);
    TestBed.tick();
    expect(service.active()).toBe(false);
    expect(service.scopeLabel()).toBeNull();
  });
});

describe('ActivityPlaybackService, loop (embedded replay)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rewinds after the last event and keeps playing instead of pausing', () => {
    const { service } = bootstrap(TAPE);
    service.setLoop(true);
    service.enter();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 3);
    expect(service.cursor()).toBe(2);
    expect(service.playing()).toBe(true);

    // One blank beat (the fold at -1 paints nothing), then the film restarts.
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(-1);
    expect(service.playing()).toBe(true);
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(0);
    expect(service.playing()).toBe(true);
  });

  it('a seek to the end does not pause under loop', () => {
    const { service } = bootstrap(TAPE);
    service.setLoop(true);
    service.enter();
    service.seek(2);
    expect(service.playing()).toBe(true);
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(-1);
  });

  it('off by default: the last event still auto-pauses', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 3);
    expect(service.cursor()).toBe(2);
    expect(service.playing()).toBe(false);
    expect(service.loop()).toBe(false);
  });
});

describe('ActivityPlaybackService, cadence override', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('setStepMs paces the stepper from the next tick', () => {
    const { service } = bootstrap(TAPE);
    service.setStepMs(EMBED_PLAYBACK_STEP_MS);
    service.enter();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(-1);
    vi.advanceTimersByTime(EMBED_PLAYBACK_STEP_MS - PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(0);
  });
});
