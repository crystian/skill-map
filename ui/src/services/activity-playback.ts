/**
 * `ActivityPlaybackService`, the transport controls of the Live lens
 * replay: enter/exit, play/pause, the scrubber cursor, and the
 * one-event-per-second stepper ("cada segundo se ejecuta un evento",
 * the user's cadence: compressed time, not proportional time).
 *
 * Entering FREEZES the tape (a snapshot of the recorder's events at
 * that moment): live frames keep recording underneath, but the
 * scrubber range never shifts under the user's hand mid-replay; a
 * fresh enter picks up the newer tape. The visible state is the pure
 * fold (`computePlaybackState`) over `(tape, cursor)`, so scrubbing is
 * instant and nothing here re-injects frames into the live services.
 *
 * A caller may hand `enter()` its own pre-filtered tape (the Sessions
 * rail replaying ONE session or one agent branch) plus a scope label
 * the transport bar shows; the default stays the whole recording. The
 * delete-recording auto-exit deliberately keeps watching the RECORDER,
 * not the frozen tape: a scoped replay narrates a slice of a recording
 * that still exists, and stands down only when THAT is erased.
 *
 * The stepper is a self-rearming timeout (armed only while playing),
 * auto-pausing on the last event; play() from the end restarts from
 * the beginning. Cursor conventions follow the fold: -1 = before the
 * first event, `total - 1` = everything applied.
 */

import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

import { computePlaybackState, type IPlaybackState } from './activity-playback-state';
import { ActivityRecorderService, type TRecordedEvent } from './activity-recorder';

/**
 * Frame provenance of one replay (see `ActivityPlaybackService.source`).
 * Both session-scoped kinds carry the session's root owner (plus the
 * agent spawn id for an agent-branch scope): `tape-session` so the
 * transport can re-filter the live tape at delete time, both so the
 * replay deep link (`graph-view/replay-url-sync.ts`) can name the
 * moment on screen.
 */
export type TReplaySource =
  | { kind: 'whole-tape' }
  | { kind: 'tape-session'; rootOwner: string; agentSpawnId?: string }
  | { kind: 'journal'; rootOwner: string; agentSpawnId?: string };

/** Fixed playback cadence: one recorded event per wall-clock second. */
export const PLAYBACK_STEP_MS = 1000;

@Injectable({ providedIn: 'root' })
export class ActivityPlaybackService {
  private readonly recorder = inject(ActivityRecorderService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _active = signal(false);
  /** Replay mode on/off. Session-only, like the lens itself. */
  readonly active = this._active.asReadonly();

  private readonly _playing = signal(false);
  readonly playing = this._playing.asReadonly();

  /** Index of the last APPLIED event; -1 = before the first. */
  private readonly _cursor = signal(-1);
  readonly cursor = this._cursor.asReadonly();

  /** Frozen tape for this replay (see module doc). */
  private readonly _tape = signal<readonly TRecordedEvent[]>([]);
  readonly tape = this._tape.asReadonly();

  private readonly _scopeLabel = signal<string | null>(null);
  /** What this replay narrates ("Session 3"); null = the whole tape. */
  readonly scopeLabel = this._scopeLabel.asReadonly();

  private readonly _source = signal<TReplaySource>({ kind: 'whole-tape' });
  /**
   * Where this replay's frames came from (2026-08-17): drives the
   * transport trash's meaning. `tape-session` (a Sessions-rail row the
   * client tape holds) erases THAT session from the tape;
   * `whole-tape` keeps the historical clear; `journal` (frames from
   * `.skill-map/sessions/`, nothing of them in this browser) has
   * nothing to erase, the trash hides.
   */
  readonly source = this._source.asReadonly();

  readonly total = computed(() => this._tape().length);

  /** The fold at the current cursor: what the map shows while replaying. */
  readonly state = computed<IPlaybackState>(() =>
    computePlaybackState(this._tape(), this._cursor()),
  );

  private stepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearStepTimer());

    // A replay narrates a recording: once the operator deletes it (the
    // Settings row, the transport's own shortcut, anything later), the
    // frozen tape describes something that no longer exists, so the
    // mode stands down. The invariant lives HERE so no call site has to
    // remember to pair `clear()` with `exit()`. TRANSITION-based (a
    // delete empties a previously non-empty recorder), NOT state-based:
    // a journal-sourced replay (the Sessions tab hydrating from
    // `.skill-map/sessions/`, 2026-08-16) legitimately enters while the
    // client tape is ALREADY empty and must survive; the purge gesture
    // still stands every replay down because it transitions the
    // recorder to empty.
    let prevRecorderSize = this.recorder.events().length;
    effect(() => {
      const size = this.recorder.events().length;
      const emptied = prevRecorderSize > 0 && size === 0;
      prevRecorderSize = size;
      if (emptied && this._active()) this.exit();
    });
  }

  /**
   * Snapshot the tape, rewind, and start playing from the top.
   * `events` scopes the replay to a pre-filtered slice (default: the
   * whole recording); `scopeLabel` names that slice for the transport.
   */
  enter(
    events?: readonly TRecordedEvent[],
    scopeLabel?: string,
    source?: TReplaySource,
  ): void {
    if (this._active()) return;
    this._tape.set(events ?? this.recorder.events());
    this._scopeLabel.set(scopeLabel ?? null);
    this._source.set(source ?? { kind: 'whole-tape' });
    this._cursor.set(-1);
    this._active.set(true);
    this.play();
  }

  exit(): void {
    if (!this._active()) return;
    this.pause();
    this._active.set(false);
    this._tape.set([]);
    this._scopeLabel.set(null);
    this._source.set({ kind: 'whole-tape' });
    this._cursor.set(-1);
  }

  play(): void {
    if (!this._active() || this._playing()) return;
    if (this.total() === 0) return;
    // Play from the end means "watch it again".
    if (this._cursor() >= this.total() - 1) this._cursor.set(-1);
    this._playing.set(true);
    this.armStepTimer();
  }

  pause(): void {
    this._playing.set(false);
    this.clearStepTimer();
  }

  /** Scrub to an absolute cursor (clamped); keeps the playing state. */
  seek(cursor: number): void {
    if (!this._active()) return;
    const clamped = Math.max(-1, Math.min(cursor, this.total() - 1));
    this._cursor.set(clamped);
    if (this._playing() && clamped >= this.total() - 1) this.pause();
  }

  stepForward(): void {
    this.seek(this._cursor() + 1);
  }

  stepBack(): void {
    this.seek(this._cursor() - 1);
  }

  private armStepTimer(): void {
    this.clearStepTimer();
    this.stepTimer = setTimeout(() => {
      this.stepTimer = null;
      if (!this._active() || !this._playing()) return;
      const next = this._cursor() + 1;
      this._cursor.set(Math.min(next, this.total() - 1));
      if (next >= this.total() - 1) {
        this.pause();
        return;
      }
      this.armStepTimer();
    }, PLAYBACK_STEP_MS);
  }

  private clearStepTimer(): void {
    if (this.stepTimer !== null) {
      clearTimeout(this.stepTimer);
      this.stepTimer = null;
    }
  }
}
