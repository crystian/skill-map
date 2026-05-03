/**
 * `WsEventStreamService` — RxJS-backed wrapper around the BFF's `/ws`
 * channel. Step 14.4.b consumer-side surface.
 *
 * Lifecycle
 * ---------
 *   - The constructor is cheap. It does NOT open a WebSocket.
 *   - The first subscriber to `events$` triggers `connect()` (when
 *     `mode === 'live'`; demo mode returns `EMPTY` and never opens a
 *     socket).
 *   - The stream is multicast: every subscriber receives every event
 *     while the socket stays open. Late subscribers do NOT replay past
 *     events (`bufferSize: 0`) — they just start receiving from the next
 *     frame onward. This matches the broadcaster's contract on the BFF
 *     (server-push, no per-client replay).
 *   - On normal close (RFC 6455 codes 1000 / 1001 — server initiated) we
 *     do NOT auto-reconnect. The server intentionally went away.
 *   - On abnormal close (any other code, including 1006 network drop)
 *     we reconnect with exponential backoff: 1s, 2s, 4s, 8s, 16s, capped
 *     at 30s. Reset to 1s on a successful open. Cap at
 *     `MAX_RECONNECT_ATTEMPTS` total attempts before giving up + emitting
 *     a final error to subscribers.
 *
 * Concurrency / multicast strategy
 * --------------------------------
 *   We hold one long-lived `Subject<IWsEvent>` and one `Observable` view
 *   built with `share({ resetOnRefCountZero: false })`. When refcount
 *   drops to zero we DO keep the socket open until `disconnect()` is
 *   called explicitly — the EventLog and the CollectionLoader subscribe
 *   independently, and a transient navigation away from the EventLog
 *   shouldn't tear down the connection the loader still relies on.
 *
 *   The choice is documented because the alternative ("close on last
 *   unsubscribe") would teach the loader to re-trigger reconnect on
 *   every fresh subscribe, multiplying connect cost. Demo / test
 *   harnesses that need a clean socket call `disconnect()` explicitly.
 *
 * Wire shape
 * ----------
 *   The BFF sends one JSON object per text frame matching
 *   `IWsEventEnvelope` (see `src/server/events.ts`). The service runs
 *   `JSON.parse` + `isWsEvent()` on every frame; malformed frames are
 *   logged and dropped (no throw — a bad frame must not poison the
 *   stream).
 *
 * Demo-mode contract
 * ------------------
 *   `inject(SKILL_MAP_MODE) === 'demo'` ⇒ `events$` is `EMPTY` (completes
 *   immediately for every subscriber). `connect()` / `disconnect()` are
 *   no-ops. The service registers in DI so the data-source factory can
 *   inject it unconditionally.
 *
 * Why `WebSocket` is constructed via an indirection (`socketFactory`)
 * --------------------------------------------------------------------
 *   The default factory is `(url) => new WebSocket(url)` (browser API).
 *   The unit tests override this slot via the optional constructor
 *   argument, supplying a `FakeWebSocket` that simulates `onopen` /
 *   `onmessage` / `onclose` / `onerror`. Indirection lives at the
 *   boundary so production code never touches a mock.
 */

import { DestroyRef, Injectable, OnDestroy, inject } from '@angular/core';
import { EMPTY, Observable, Subject, share } from 'rxjs';

import { isWsEvent, type IWsEvent } from '../models/ws-event';
import { SKILL_MAP_MODE } from './data-source/runtime-mode';
import { WS_TEXTS } from '../i18n/ws.texts';

/** Backoff schedule (ms). Index = attempt number. After the last entry, we stay capped at 30s until `MAX_RECONNECT_ATTEMPTS`. */
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
/** Hard cap on consecutive reconnect attempts before we surface an error and stop. */
const MAX_RECONNECT_ATTEMPTS = 10;
/** RFC 6455 normal-close codes — these mean "server is intentionally going away", do NOT reconnect. */
const NORMAL_CLOSE_CODES: ReadonlySet<number> = new Set([1000, 1001]);

/**
 * Minimal contract the service needs from a WebSocket implementation.
 * The browser `WebSocket` matches it natively; tests inject a fake.
 */
export interface IWsLike {
  readyState: number;
  close(code?: number, reason?: string): void;
  onopen: ((this: IWsLike, ev: unknown) => unknown) | null;
  onclose: ((this: IWsLike, ev: { code: number; reason: string }) => unknown) | null;
  onmessage: ((this: IWsLike, ev: { data: unknown }) => unknown) | null;
  onerror: ((this: IWsLike, ev: unknown) => unknown) | null;
}

/** Factory signature — `(url) => IWsLike`. Production: `new WebSocket(url)`. */
export type TWsSocketFactory = (url: string) => IWsLike;

/**
 * Build the `/ws` URL relative to the document origin. Works under both
 * `http://` (→ `ws://`) and `https://` (→ `wss://`). Always rooted at
 * `/ws` per the BFF route registered in `src/server/ws.ts`.
 */
function buildDefaultWsUrl(): string {
  // SSR / test rigs without a `window` use `127.0.0.1:4242` as a
  // defensive default. The service never tries to connect in test
  // because the spec injects a `mode` of its choosing.
  if (typeof window === 'undefined' || !window.location) {
    return 'ws://127.0.0.1:4242/ws';
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

@Injectable({ providedIn: 'root' })
export class WsEventStreamService implements OnDestroy {
  private readonly mode = inject(SKILL_MAP_MODE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly subject = new Subject<IWsEvent>();
  private socket: IWsLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  /** Set true by `disconnect()` (and on `OnDestroy`). Suppresses any pending or future reconnect. */
  private disposed = false;

  /** Socket constructor — defaults to `new WebSocket(url)`. Tests inject a fake via `setSocketFactory`. */
  private socketFactory: TWsSocketFactory = (url) => new WebSocket(url) as unknown as IWsLike;
  /** Target URL — defaults to the page-relative `/ws`. Tests override via `setUrl`. */
  private url: string = buildDefaultWsUrl();

  /**
   * Multicast view of the underlying subject. Subscribing kicks the
   * socket open in live mode; subscribing in demo mode receives an
   * immediate `complete()` (via `EMPTY`).
   */
  readonly events$: Observable<IWsEvent>;

  /**
   * Test seam — replace the `WebSocket` constructor with a fake. MUST
   * be called before the first subscription so the production factory
   * is never invoked. Has no production caller.
   */
  _setSocketFactory(factory: TWsSocketFactory): void {
    this.socketFactory = factory;
  }

  /**
   * Test seam — override the WS URL. MUST be called before the first
   * subscription. Has no production caller.
   */
  _setUrl(url: string): void {
    this.url = url;
  }

  constructor() {
    if (this.mode !== 'live') {
      // Demo mode: never open a socket. Subscribers see immediate
      // completion. The service still registers in DI so the factory
      // can inject it unconditionally.
      this.events$ = EMPTY;
    } else {
      // `share` with `resetOnRefCountZero: false` keeps the socket open
      // even after refcount drops to zero (see class docstring for the
      // tradeoff).
      this.events$ = new Observable<IWsEvent>((subscriber) => {
        // Side effect: connect on first interest. Re-subscribers reuse
        // the still-open socket and just attach to the subject below.
        if (!this.socket && !this.disposed) {
          this.connect();
        }
        const sub = this.subject.subscribe(subscriber);
        return () => sub.unsubscribe();
      }).pipe(share({ resetOnRefCountZero: false }));
    }

    // Best-effort cleanup on injector teardown (mirrors `disconnect()`
    // contract). Tests that construct outside DI must call `disconnect()`
    // explicitly because `DestroyRef` won't fire.
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  /**
   * Tear down the socket cleanly: cancel any pending reconnect, close
   * the open socket with code 1000, and complete the subject so existing
   * subscribers see the natural end-of-stream signal.
   *
   * Idempotent — a second call is a no-op.
   */
  disconnect(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close(1000, 'client disconnect');
      } catch {
        // Ignore — the socket may already be closing / closed.
      }
      this.socket = null;
    }
    this.subject.complete();
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private connect(): void {
    if (this.disposed) return;
    let socket: IWsLike;
    try {
      socket = this.socketFactory(this.url);
    } catch (err) {
      // `new WebSocket(...)` can throw synchronously (bad URL scheme,
      // SecurityError under mixed-content, etc.). Treat as an abnormal
      // failure and schedule a reconnect — the loop below will give up
      // after `MAX_RECONNECT_ATTEMPTS` total attempts.
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- developer log; UI shows watcher.error toast separately
      console.warn(WS_TEXTS.socketError(message));
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = (): void => {
      // Successful open resets the backoff so the next abnormal close
      // doesn't inherit a long delay from a previous failure.
      this.reconnectAttempt = 0;
      // eslint-disable-next-line no-console -- developer log
      console.info(WS_TEXTS.connected(this.url));
    };

    socket.onmessage = (ev): void => {
      this.handleFrame(ev.data);
    };

    socket.onerror = (ev): void => {
      // Browsers don't expose a useful message on the error event — they
      // fire `onerror` then `onclose` back-to-back. Log a placeholder.
      const message =
        typeof ev === 'object' && ev !== null && 'message' in ev
          ? String((ev as { message?: unknown }).message ?? 'unknown')
          : 'unknown';
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.socketError(message));
    };

    socket.onclose = (ev): void => {
      // eslint-disable-next-line no-console -- developer log
      console.info(WS_TEXTS.closed(ev.code, ev.reason));
      this.socket = null;
      if (this.disposed) return;
      if (NORMAL_CLOSE_CODES.has(ev.code)) {
        // Server initiated a clean close. Don't reconnect — the user
        // either stopped the server or it's intentionally shutting down.
        return;
      }
      this.scheduleReconnect();
    };
  }

  private handleFrame(raw: unknown): void {
    if (typeof raw !== 'string') {
      // The BFF only sends text frames. Anything else (Blob, ArrayBuffer)
      // is unexpected — log and drop.
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.malformedFrame('non-string frame'));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.malformedFrame(message));
      return;
    }
    if (!isWsEvent(parsed)) {
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.malformedFrame('envelope shape'));
      return;
    }
    this.subject.next(parsed);
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.reconnectGiveUp(MAX_RECONNECT_ATTEMPTS));
      // Surface the failure as a stream error so a reactive consumer
      // (e.g. event-log) can render a "lost connection" notice. Note
      // that erroring the subject teardowns existing subscribers; the
      // SPA today doesn't auto-resubscribe (the service is providedIn
      // root and the user can refresh the page). Future work: a
      // user-initiated `reconnect()` that resets `disposed` + counter.
      this.subject.error(new Error(WS_TEXTS.reconnectGiveUp(MAX_RECONNECT_ATTEMPTS)));
      return;
    }
    const idx = Math.min(this.reconnectAttempt, BACKOFF_SCHEDULE_MS.length - 1);
    const delayMs = BACKOFF_SCHEDULE_MS[idx]!;
    this.reconnectAttempt += 1;
    // eslint-disable-next-line no-console -- developer log
    console.info(WS_TEXTS.reconnectScheduled(delayMs, this.reconnectAttempt));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  /**
   * Test seam — exposes the internal counter so a spec can assert that
   * a successful open resets backoff. Not part of the consumer-facing
   * API; the underscore signals "internal".
   */
  get _reconnectAttempt(): number {
    return this.reconnectAttempt;
  }
}
