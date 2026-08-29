/**
 * `ActivityRecorderService` unit tests: raw-frame capture with server
 * timestamps, type filtering, the Real Time gate, the oldest-first cap
 * with drop accounting, and the clear anchor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';

import type { IWsEvent } from '../../models/ws-event';
import {
  ACTIVITY_RECORDER_CAP,
  ACTIVITY_RECORDING_KEY,
  ActivityRecorderService,
  PERSISTED_CHAR_BUDGET,
  PERSISTED_EVENT_CAP,
} from '../activity-recorder';
import { DATA_SOURCE } from '../data-source/data-source.port';
import { LivePreferencesService } from '../live-preferences';
import { WsEventStreamService } from '../ws-event-stream';

const SKILL = '.claude/skills/deploy/SKILL.md';
const T0 = 1_700_000_000_000;

function activityFrame(tMs: number, nodePath = SKILL): IWsEvent {
  return {
    type: 'node.activity',
    timestamp: tMs,
    data: { nodePath, phase: 'start', owner: 'main:abc' },
  } as IWsEvent;
}

function spawnFrame(tMs: number): IWsEvent {
  return {
    type: 'agent.spawn',
    timestamp: tMs,
    data: {
      spawnId: 'toolu_01',
      phase: 'start',
      parentOwner: 'main:abc',
      parentNodePath: '.claude/agents/reviewer.md',
      childNodePath: SKILL,
    },
  } as IWsEvent;
}

function bootstrap(activityEnabled = true, recording = true, serverRecording = false) {
  TestBed.resetTestingModule();
  const events$ = new Subject<IWsEvent>();
  const enabled = signal(activityEnabled);
  const setSessionRecording = vi.fn().mockResolvedValue(true);
  const getSessionJournal = vi
    .fn()
    .mockResolvedValue({ sessions: [], recording: serverRecording, captureLevel: 'mcp', shellCapture: false });
  TestBed.configureTestingModule({
    providers: [
      { provide: WsEventStreamService, useValue: { events$ } as unknown as WsEventStreamService },
      {
        provide: LivePreferencesService,
        useValue: { activityEnabled: enabled.asReadonly() } as unknown as LivePreferencesService,
      },
      { provide: DATA_SOURCE, useValue: { getSessionJournal, setSessionRecording } },
    ],
  });
  const service = TestBed.inject(ActivityRecorderService);
  // Capture is a manual gate since 2026-08-16 (the Sessions rail's
  // record control): almost every case exercises the capturing path, so
  // the harness arms it by default. `start()` no-ops while Real Time is
  // off, which is exactly what the gate cases assert.
  if (recording) service.start();
  return { service, events$, enabled, setSessionRecording, getSessionJournal };
}

async function flushed(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

/** Past the flush macrotask AND the 2s persist debounce. */
async function persisted(): Promise<void> {
  await vi.advanceTimersByTimeAsync(2_500);
}

function storedTape(): unknown[] {
  const raw = localStorage.getItem(ACTIVITY_RECORDING_KEY);
  return raw === null ? [] : (JSON.parse(raw) as unknown[]);
}

describe('ActivityRecorderService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('records activity and spawn frames with their server timestamps', async () => {
    const { service, events$ } = bootstrap();
    events$.next(activityFrame(T0 + 5));
    events$.next(spawnFrame(T0 + 9));
    await flushed();

    expect(service.size()).toBe(2);
    expect(service.events()[0]).toMatchObject({ tMs: T0 + 5, type: 'node.activity' });
    expect(service.events()[1]).toMatchObject({ tMs: T0 + 9, type: 'agent.spawn' });
  });

  it('stamps every captured frame with its Record gesture, a new stamp per press', async () => {
    const { service, events$ } = bootstrap();
    const first = service.recordingSince();
    events$.next(activityFrame(T0 + 5));
    await flushed();
    expect(first).not.toBeNull();
    expect(service.events()[0]).toMatchObject({ recordedAt: first });

    // Stop, let the clock move, record again: the next frame carries the new stamp.
    service.stop();
    vi.setSystemTime(T0 + 60_000);
    service.start();
    const second = service.recordingSince();
    events$.next(activityFrame(T0 + 60_010));
    await flushed();
    expect(second).not.toBe(first);
    expect(service.events()[1]).toMatchObject({ recordedAt: second });
  });

  it('ignores every other frame type (the scan fan-out must not flood the tape)', async () => {
    const { service, events$ } = bootstrap();
    events$.next({ type: 'scan.completed', timestamp: T0, data: {} } as IWsEvent);
    events$.next({
      type: 'scan.progress',
      timestamp: T0,
      data: { index: 1, path: SKILL, kind: 'markdown', cached: false },
    } as IWsEvent);
    events$.next(activityFrame(T0 + 1));
    await flushed();

    expect(service.size()).toBe(1);
    expect(service.events()[0]?.type).toBe('node.activity');
  });

  it('drops frames while Real Time is off (start() cannot even arm)', async () => {
    const { service, events$, enabled } = bootstrap(false);
    events$.next(activityFrame(T0 + 1));
    await flushed();
    expect(service.size()).toBe(0);
    expect(service.recording()).toBe(false);

    enabled.set(true);
    service.start();
    events$.next(activityFrame(T0 + 2));
    await flushed();
    expect(service.size()).toBe(1);
  });

  it('captures NOTHING unless the operator pressed record (manual gate, never automatic)', async () => {
    const { service, events$ } = bootstrap(true, false);
    events$.next(activityFrame(T0 + 1));
    await flushed();
    expect(service.size()).toBe(0);
    expect(localStorage.getItem(ACTIVITY_RECORDING_KEY)).toBeNull();

    service.start();
    events$.next(activityFrame(T0 + 2));
    await flushed();
    expect(service.size()).toBe(1);

    service.stop();
    events$.next(activityFrame(T0 + 3));
    await flushed();
    // The tape stays (ready to replay); only the capture stopped.
    expect(service.size()).toBe(1);
  });

  it('Real Time flipping off stops an in-flight recording (server disengaged too)', async () => {
    const { service, enabled, setSessionRecording } = bootstrap();
    expect(service.recording()).toBe(true);
    enabled.set(false);
    TestBed.tick();
    expect(service.recording()).toBe(false);
    expect(setSessionRecording).toHaveBeenLastCalledWith(false);
  });

  it('start/stop mirror the gesture to the SERVER journal (capture on both memories)', () => {
    const { service, setSessionRecording } = bootstrap(true, false);
    service.start();
    expect(setSessionRecording).toHaveBeenLastCalledWith(true);
    service.stop();
    expect(setSessionRecording).toHaveBeenLastCalledWith(false);
  });

  it('boot probe resumes local capture when the server was recording across a reload', async () => {
    const { service } = bootstrap(true, false, true);
    await vi.advanceTimersByTimeAsync(1); // settle the probe promise
    expect(service.recording()).toBe(true);
  });

  it('boot probe STOPS an orphan server recording this client cannot honour (Real Time off)', async () => {
    const { service, setSessionRecording } = bootstrap(false, false, true);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.recording()).toBe(false);
    expect(setSessionRecording).toHaveBeenLastCalledWith(false);
  });

  it('caps the tape oldest-first and counts the drops', async () => {
    const { service, events$ } = bootstrap();
    for (let i = 0; i < ACTIVITY_RECORDER_CAP + 10; i++) {
      events$.next(activityFrame(T0 + i));
    }
    await flushed();

    expect(service.size()).toBe(ACTIVITY_RECORDER_CAP);
    expect(service.droppedCount()).toBe(10);
    // The head is the oldest SURVIVING frame.
    expect(service.events()[0]?.tMs).toBe(T0 + 10);
  });

  it('removeAll() drops ONLY the given frames (identity) and mirrors after the debounce', async () => {
    const { service, events$ } = bootstrap();
    events$.next(activityFrame(T0 + 1));
    events$.next(activityFrame(T0 + 2, '.claude/agents/other.md'));
    events$.next(activityFrame(T0 + 3));
    await flushed();
    expect(service.size()).toBe(3);

    // Identity-based: hand back the exact frame objects from events().
    const mine = service.events().filter((e) => e.tMs !== T0 + 2);
    service.removeAll(mine);
    expect(service.size()).toBe(1);
    expect(service.events()[0]?.tMs).toBe(T0 + 2);

    // The storage mirror follows on the standard debounce.
    await persisted();
    expect(storedTape()).toHaveLength(1);

    // Empty input is a no-op.
    service.removeAll([]);
    expect(service.size()).toBe(1);
  });

  it('clear() drops the tape and the pending batch', async () => {
    const { service, events$ } = bootstrap();
    events$.next(activityFrame(T0 + 1));
    await flushed();
    events$.next(activityFrame(T0 + 2)); // still pending
    service.clear();
    await flushed();

    expect(service.size()).toBe(0);
    expect(service.droppedCount()).toBe(0);
  });

  // --- persistence (the tape survives a reload; the operator deletes it) ---

  it('mirrors the tape to storage after the debounce, not per frame', async () => {
    const { service, events$ } = bootstrap();
    events$.next(activityFrame(T0 + 1));
    await flushed();
    // Flushed into memory, but the debounce has not landed the write yet.
    expect(service.size()).toBe(1);
    expect(localStorage.getItem(ACTIVITY_RECORDING_KEY)).toBeNull();

    await persisted();
    expect(storedTape()).toHaveLength(1);
    expect(service.storedChars()).toBeGreaterThan(0);
  });

  it('hydrates the stored tape at construction, before live frames append', async () => {
    const first = bootstrap();
    first.events$.next(activityFrame(T0 + 1));
    first.events$.next(spawnFrame(T0 + 2));
    await persisted();

    // A new page: the recorder starts from the mirrored history.
    const second = bootstrap();
    expect(second.service.size()).toBe(2);

    second.events$.next(activityFrame(T0 + 3));
    await flushed();
    expect(second.service.size()).toBe(3);
    // Order holds: history first, then the live frame.
    expect(second.service.events()[2]?.tMs).toBe(T0 + 3);
  });

  it('drops a corrupt stored tape instead of carrying it into the fold', () => {
    localStorage.setItem(ACTIVITY_RECORDING_KEY, '{not json');
    expect(bootstrap().service.size()).toBe(0);
    expect(localStorage.getItem(ACTIVITY_RECORDING_KEY)).toBeNull();

    // Valid JSON, wrong shape: same treatment.
    localStorage.setItem(ACTIVITY_RECORDING_KEY, JSON.stringify([{ nope: true }]));
    expect(bootstrap().service.size()).toBe(0);
    expect(localStorage.getItem(ACTIVITY_RECORDING_KEY)).toBeNull();
  });

  it('mirrors only the trailing slice, bounded by the event cap', async () => {
    const { service, events$ } = bootstrap();
    const total = PERSISTED_EVENT_CAP + 25;
    for (let i = 0; i < total; i++) events$.next(activityFrame(T0 + i));
    await persisted();

    // Memory keeps everything (the ring is far larger); storage keeps
    // the most recent slice.
    expect(service.size()).toBe(total);
    const stored = storedTape() as Array<{ tMs: number }>;
    expect(stored).toHaveLength(PERSISTED_EVENT_CAP);
    expect(stored[0]?.tMs).toBe(T0 + 25); // oldest 25 trimmed
  });

  it('stays inside the character budget when frames are fat', async () => {
    const { events$ } = bootstrap();
    // ~1.2 KB of detail per frame: 2000 frames is well past the budget.
    const fatDetail = 'x'.repeat(1_200);
    for (let i = 0; i < 2_000; i++) {
      events$.next({
        type: 'node.activity',
        timestamp: T0 + i,
        data: { nodePath: SKILL, phase: 'start', owner: 'main:abc', detail: fatDetail },
      } as IWsEvent);
    }
    await persisted();

    const raw = localStorage.getItem(ACTIVITY_RECORDING_KEY) ?? '';
    expect(raw.length).toBeLessThanOrEqual(PERSISTED_CHAR_BUDGET);
    // Trimmed, but not emptied: a bounded tape is still worth keeping.
    expect(storedTape().length).toBeGreaterThan(50);
  });

  it('clear() deletes the stored recording too', async () => {
    const { service, events$ } = bootstrap();
    events$.next(activityFrame(T0 + 1));
    await persisted();
    expect(localStorage.getItem(ACTIVITY_RECORDING_KEY)).not.toBeNull();

    service.clear();
    expect(localStorage.getItem(ACTIVITY_RECORDING_KEY)).toBeNull();
    expect(service.storedChars()).toBe(0);

    // And a fresh page starts empty.
    expect(bootstrap().service.size()).toBe(0);
  });

  it('survives a storage write failure without losing the in-memory tape', async () => {
    const { service, events$ } = bootstrap();
    // Spy the INSTANCE, not `Storage.prototype`: the test environment's
    // localStorage carries its own `setItem`, so a prototype spy never
    // intercepts and the write quietly succeeds.
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    events$.next(activityFrame(T0 + 1));
    await persisted();

    expect(service.size()).toBe(1); // recording keeps working
    expect(service.storedChars()).toBe(0); // the mirror stood down
    setItem.mockRestore();
  });
});
