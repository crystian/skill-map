import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { WsEventStreamService, type IWsLike } from './ws-event-stream';
import { SKILL_MAP_MODE } from './data-source/runtime-mode';
import type { IWsEvent } from '../models/ws-event';

/**
 * Fake WebSocket — the service treats it as an `IWsLike`. The harness
 * exposes `simulateOpen()` / `simulateMessage(json)` / `simulateClose()`
 * / `simulateError()` so each test drives the lifecycle deterministically.
 */
class FakeWebSocket implements IWsLike {
  static readonly READY_OPEN = 1;
  static readonly READY_CLOSED = 3;

  readyState = 0;
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  onopen: ((this: IWsLike, ev: unknown) => unknown) | null = null;
  onclose: ((this: IWsLike, ev: { code: number; reason: string }) => unknown) | null = null;
  onmessage: ((this: IWsLike, ev: { data: unknown }) => unknown) | null = null;
  onerror: ((this: IWsLike, ev: unknown) => unknown) | null = null;

  constructor(public readonly url: string) {}

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.READY_CLOSED;
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.READY_OPEN;
    this.onopen?.call(this, {});
  }

  simulateMessage(payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.onmessage?.call(this, { data });
  }

  simulateRawMessage(data: unknown): void {
    this.onmessage?.call(this, { data });
  }

  simulateClose(code: number, reason = ''): void {
    this.readyState = FakeWebSocket.READY_CLOSED;
    this.onclose?.call(this, { code, reason });
  }

  simulateError(message = 'boom'): void {
    this.onerror?.call(this, { message });
  }
}

interface IHarness {
  service: WsEventStreamService;
  factory: ReturnType<typeof vi.fn>;
  sockets: FakeWebSocket[];
}

function createHarness(mode: 'live' | 'demo' = 'live'): IHarness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SKILL_MAP_MODE, useValue: mode },
      WsEventStreamService,
    ],
  });
  const sockets: FakeWebSocket[] = [];
  const factory = vi.fn((url: string) => {
    const ws = new FakeWebSocket(url);
    sockets.push(ws);
    return ws;
  });
  const service = TestBed.inject(WsEventStreamService);
  // Inject the fake factory + URL BEFORE the first subscription so the
  // service never reaches for the real `WebSocket` constructor.
  service._setSocketFactory(factory);
  service._setUrl('ws://test/ws');
  return { service, factory, sockets };
}

describe('WsEventStreamService — lifecycle', () => {
  let harness: IHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    // Silence the developer console warnings under fake-timer churn.
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    harness?.service.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not open a socket until events$ has at least one subscriber', () => {
    harness = createHarness('live');
    expect(harness.factory).not.toHaveBeenCalled();
    expect(harness.sockets).toHaveLength(0);

    const sub = harness.service.events$.subscribe();
    expect(harness.factory).toHaveBeenCalledTimes(1);
    expect(harness.sockets).toHaveLength(1);
    sub.unsubscribe();
  });

  it('multicasts incoming frames to every active subscriber', () => {
    harness = createHarness('live');
    const a: IWsEvent[] = [];
    const b: IWsEvent[] = [];
    const subA = harness.service.events$.subscribe((e) => a.push(e));
    const subB = harness.service.events$.subscribe((e) => b.push(e));
    expect(harness.sockets).toHaveLength(1);

    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateMessage({
      type: 'scan.completed',
      timestamp: 123,
      runId: 'r-x',
      jobId: null,
      data: { nodes: 2, links: 0, issues: 0, durationMs: 5 },
    });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.type).toBe('scan.completed');
    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('keeps the socket open after refcount drops to zero (resetOnRefCountZero: false)', () => {
    harness = createHarness('live');
    const sub = harness.service.events$.subscribe();
    expect(harness.sockets).toHaveLength(1);
    const ws = harness.sockets[0]!;
    sub.unsubscribe();
    // No close call — the service deliberately holds the socket open
    // so the next subscriber doesn't pay the reconnect cost.
    expect(ws.closeCalls).toHaveLength(0);
  });

  it('drops malformed JSON frames without throwing', () => {
    harness = createHarness('live');
    const received: IWsEvent[] = [];
    harness.service.events$.subscribe((e) => received.push(e));
    const ws = harness.sockets[0]!;
    ws.simulateOpen();
    ws.simulateMessage('not json {{{');
    ws.simulateMessage({ missingType: true, timestamp: 0, data: {} });
    expect(received).toHaveLength(0);

    ws.simulateMessage({ type: 'scan.started', timestamp: 1, data: {} });
    expect(received).toHaveLength(1);
  });

  it('drops non-string frames (Blob / ArrayBuffer) defensively', () => {
    harness = createHarness('live');
    const received: IWsEvent[] = [];
    harness.service.events$.subscribe((e) => received.push(e));
    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateRawMessage(new ArrayBuffer(8));
    expect(received).toHaveLength(0);
  });

  it('rejects an envelope with an empty type string', () => {
    harness = createHarness('live');
    const received: IWsEvent[] = [];
    harness.service.events$.subscribe((e) => received.push(e));
    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateMessage({ type: '', timestamp: 0, data: {} });
    expect(received).toHaveLength(0);
  });
});

describe('WsEventStreamService — reconnect', () => {
  let harness: IHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    harness?.service.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does NOT reconnect on a normal close (code 1000)', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateClose(1000, 'normal');

    vi.advanceTimersByTime(10_000);
    expect(harness.factory).toHaveBeenCalledTimes(1);
  });

  it('does NOT reconnect on a server-shutdown close (code 1001)', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateClose(1001, 'going away');

    vi.advanceTimersByTime(10_000);
    expect(harness.factory).toHaveBeenCalledTimes(1);
  });

  it('reconnects with exponential backoff on abnormal close (1006 → 1s, 2s, 4s, 8s, 16s, 30s cap)', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();

    // Attempt 1 → 1s
    harness.sockets[0]!.simulateClose(1006);
    expect(harness.factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(harness.factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(harness.factory).toHaveBeenCalledTimes(2);

    // Attempt 2 → 2s
    harness.sockets[1]!.simulateClose(1006);
    vi.advanceTimersByTime(2_000);
    expect(harness.factory).toHaveBeenCalledTimes(3);

    // Attempt 3 → 4s
    harness.sockets[2]!.simulateClose(1006);
    vi.advanceTimersByTime(4_000);
    expect(harness.factory).toHaveBeenCalledTimes(4);

    // Attempt 4 → 8s
    harness.sockets[3]!.simulateClose(1006);
    vi.advanceTimersByTime(8_000);
    expect(harness.factory).toHaveBeenCalledTimes(5);

    // Attempt 5 → 16s
    harness.sockets[4]!.simulateClose(1006);
    vi.advanceTimersByTime(16_000);
    expect(harness.factory).toHaveBeenCalledTimes(6);

    // Attempt 6 → cap at 30s
    harness.sockets[5]!.simulateClose(1006);
    vi.advanceTimersByTime(29_999);
    expect(harness.factory).toHaveBeenCalledTimes(6);
    vi.advanceTimersByTime(1);
    expect(harness.factory).toHaveBeenCalledTimes(7);
  });

  it('resets backoff after a successful open', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateClose(1006); // attempt 1 scheduled (1s)
    vi.advanceTimersByTime(1_000);
    expect(harness.factory).toHaveBeenCalledTimes(2);
    expect(harness.service._reconnectAttempt).toBe(1);

    // Successful open resets the counter.
    harness.sockets[1]!.simulateOpen();
    expect(harness.service._reconnectAttempt).toBe(0);

    // Next abnormal close starts the schedule from 1s again, not 2s.
    harness.sockets[1]!.simulateClose(1006);
    vi.advanceTimersByTime(1_000);
    expect(harness.factory).toHaveBeenCalledTimes(3);
  });

  it('gives up + emits stream error after MAX_RECONNECT_ATTEMPTS', () => {
    harness = createHarness('live');
    let receivedError: unknown = null;
    harness.service.events$.subscribe({
      next: () => undefined,
      error: (err) => {
        receivedError = err;
      },
    });

    // Burn through all 10 attempts.
    for (let i = 0; i < 10; i += 1) {
      const ws = harness.sockets[i]!;
      ws.simulateClose(1006);
      // Use the cap (30s) to make sure each scheduled reconnect fires
      // even after the schedule plateau.
      vi.advanceTimersByTime(30_000);
    }
    // Eleventh close → exceeded; service errors out without scheduling.
    const last = harness.sockets[10]!;
    last.simulateClose(1006);
    expect(receivedError).toBeInstanceOf(Error);
    expect(String(receivedError)).toMatch(/giving up/);
  });
});

describe('WsEventStreamService — disconnect', () => {
  let harness: IHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes the open socket with code 1000 and completes the stream', () => {
    harness = createHarness('live');
    let completed = false;
    harness.service.events$.subscribe({ complete: () => (completed = true) });
    harness.sockets[0]!.simulateOpen();

    harness.service.disconnect();
    expect(harness.sockets[0]!.closeCalls).toEqual([{ code: 1000, reason: 'client disconnect' }]);
    expect(completed).toBe(true);
  });

  it('cancels a pending reconnect timer', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateClose(1006); // schedules reconnect

    harness.service.disconnect();
    vi.advanceTimersByTime(60_000);
    // Only the original socket was created; reconnect was cancelled.
    expect(harness.factory).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — second call is a no-op', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateOpen();

    harness.service.disconnect();
    harness.service.disconnect();
    expect(harness.sockets[0]!.closeCalls).toHaveLength(1);
  });
});

describe('WsEventStreamService — demo mode', () => {
  let harness: IHarness;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    harness?.service.disconnect();
    vi.restoreAllMocks();
  });

  it('returns EMPTY (immediate complete) and never opens a socket', () => {
    harness = createHarness('demo');
    let nextCalls = 0;
    let completed = false;
    harness.service.events$.subscribe({
      next: () => (nextCalls += 1),
      complete: () => (completed = true),
    });
    expect(nextCalls).toBe(0);
    expect(completed).toBe(true);
    expect(harness.factory).not.toHaveBeenCalled();
  });

  it('disconnect() is a safe no-op in demo mode', () => {
    harness = createHarness('demo');
    expect(() => harness.service.disconnect()).not.toThrow();
  });
});
