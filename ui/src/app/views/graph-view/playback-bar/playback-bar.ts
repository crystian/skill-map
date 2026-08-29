/**
 * `<sm-playback-bar>`, the replay transport of the Live lens: exit,
 * play/pause, single-event stepping, the scrubber, the `k / N`
 * readout, and the ticker narrating the cursor event. Mounted by the
 * graph view only while `ActivityPlaybackService.active`; talks to
 * that service directly (the transport IS the service's surface; only
 * ENTERING replay needs orchestration, which stays in the graph view
 * because it may have to enter the lens first).
 *
 * The scrubber is a native `<input type="range">` on purpose: fully
 * keyboard-accessible out of the box, and the amber accent rides
 * `accent-color` with zero vendor styling.
 */

import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { PLAYBACK_BAR_TEXTS } from '../../../../i18n/playback-bar.texts';
import { ActivityPlaybackService } from '../../../../services/activity-playback';
import { ActivityRecorderService } from '../../../../services/activity-recorder';
import { COPIED_FEEDBACK_MS, copyToClipboard } from '../../../../services/clipboard';
import { LivePreferencesService } from '../../../../services/live-preferences';
import { pathBasenameForLink } from '../../../../services/path-basename';
import { filterTapeForSession } from '../../../../services/session-index';
import { replayLinkFromPlayback, replayLinkQueryParams } from '../replay-url-sync';

@Component({
  selector: 'sm-playback-bar',
  imports: [ButtonModule, TooltipModule],
  templateUrl: './playback-bar.html',
  styleUrl: './playback-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaybackBar {
  protected readonly playback = inject(ActivityPlaybackService);
  protected readonly recorder = inject(ActivityRecorderService);
  protected readonly livePrefs = inject(LivePreferencesService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  protected readonly texts = PLAYBACK_BAR_TEXTS;

  /** 1-based progress for humans (`0 / N` while before the first event). */
  protected readonly counter = computed(() =>
    this.texts.counter(this.playback.cursor() + 1, this.playback.total()),
  );

  protected readonly trimmed = computed(() => this.recorder.droppedCount() > 0);

  /**
   * The replay deep link for THIS moment (`replay-url-sync.ts`): the
   * session (and agent branch) on screen, plus the frame while paused.
   * `null` for the whole-tape replay, which has no session identity,
   * so the Copy link hides there.
   */
  protected readonly link = computed(() =>
    replayLinkFromPlayback(this.playback.source(), this.playback.playing(), this.playback.cursor()),
  );

  /** True for `COPIED_FEEDBACK_MS` after a successful copy (icon + tooltip flip). */
  protected readonly linkCopied = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Copy an absolute link to this moment. Built from the router (the
   * current tree merged with the link params, then the app's base
   * href), never from `location.href`: the URL write-back is a pending
   * navigation right after a step, so the address bar can lag the
   * transport by a frame.
   */
  protected async copyLink(): Promise<void> {
    const link = this.link();
    if (link === null) return;
    const tree = this.router.createUrlTree([], {
      queryParams: replayLinkQueryParams(link),
      queryParamsHandling: 'merge',
    });
    const url = `${window.location.origin}${this.location.prepareExternalUrl(this.router.serializeUrl(tree))}`;
    if (!(await copyToClipboard(url))) return;
    this.linkCopied.set(true);
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      this.copiedTimer = null;
      this.linkCopied.set(false);
    }, COPIED_FEEDBACK_MS);
  }

  /**
   * Director camera toggle: the lens follow reads the preference and
   * switches between close-ups on each step and the whole route
   * (`director.ts`). Persisted browser-local like follow.
   */
  protected toggleDirector(): void {
    this.livePrefs.setDirectorEnabled(!this.livePrefs.directorEnabled());
  }

  /**
   * Wall-clock `HH:MM:SS` (local) of the cursor event, rendered at the
   * caption's left so the operator knows WHEN the narrated step
   * executed (user request 2026-08-16). Empty before step 0, so the
   * chip only shows while a frame is under the cursor; tabular-nums in
   * CSS keeps its width stable across frames.
   */
  protected readonly captionTime = computed(() => {
    const event = this.playback.tape()[this.playback.cursor()];
    if (event === undefined) return '';
    const at = new Date(event.tMs);
    return this.texts.captionTime(pad2(at.getHours()), pad2(at.getMinutes()), pad2(at.getSeconds()));
  });

  /**
   * Elapsed `(mm:ss)` (hours prepended past one) from the tape's FIRST
   * event to the cursor event (user request 2026-08-16): how deep into
   * the session the narrated step happened. On a session-scoped replay
   * the tape starts at that session's first frame, so the offset reads
   * as time since the session began; unscoped, since recording began.
   */
  protected readonly captionElapsed = computed(() => {
    const tape = this.playback.tape();
    const event = tape[this.playback.cursor()];
    const first = tape[0];
    if (event === undefined || first === undefined) return '';
    const totalSeconds = Math.max(0, Math.floor((event.tMs - first.tMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const rest = `${pad2(Math.floor((totalSeconds % 3600) / 60))}:${pad2(totalSeconds % 60)}`;
    return this.texts.captionElapsed(hours > 0 ? `${hours}:${rest}` : rest);
  });

  /** The ticker line for the cursor event (empty before step 0). */
  protected readonly caption = computed(() => {
    const caption = this.playback.state().caption;
    if (caption === null) return '';
    switch (caption.kind) {
      case 'start':
        return this.texts.caption.start(pathBasenameForLink(caption.path), caption.detail);
      case 'end':
        return this.texts.caption.end(pathBasenameForLink(caption.path));
      case 'owner-end':
        return this.texts.caption.ownerEnd;
      case 'session-end':
        return this.texts.caption.sessionEnd;
      case 'spawn':
        return this.texts.caption.spawn(
          caption.parent === undefined ? '' : pathBasenameForLink(caption.parent),
          caption.childName ?? (caption.child === undefined ? '' : pathBasenameForLink(caption.child)),
          caption.phase,
        );
      case 'turn-end':
        return this.texts.caption.turnEnd;
      default:
        return this.texts.caption.other;
    }
  });

  protected togglePlay(): void {
    if (this.playback.playing()) this.playback.pause();
    else this.playback.play();
  }

  /**
   * The trash acts on the BROWSER TAPE ONLY, scoped to what the replay
   * narrates (decisions 2026-08-17: the project journal is the
   * accumulated EVIDENCE the design-vs-reality volume gates count on,
   * and while WATCHING a session the trash means "drop THIS session").
   * Per source: a `tape-session` replay removes that session's frames
   * from the tape and exits (the tape may stay non-empty, so the
   * empty-tape auto-exit cannot be relied on; the row re-lists from the
   * journal, still replayable); a `whole-tape` replay keeps the
   * historical full-tape clear (auto-exit handles it); a `journal`
   * replay never shows the button (nothing of it lives in this
   * browser). No confirm anywhere: tape frames are regenerable and the
   * journal survives; the full both-memories wipe lives in Settings.
   */
  protected readonly trashVisible = computed(() => this.playback.source().kind !== 'journal');

  protected readonly trashTooltip = computed(() =>
    this.playback.source().kind === 'tape-session'
      ? this.texts.deleteSession
      : this.texts.deleteRecording,
  );

  protected deleteRecording(): void {
    const source = this.playback.source();
    if (source.kind === 'tape-session') {
      this.recorder.removeAll(
        filterTapeForSession(this.recorder.events(), { rootOwner: source.rootOwner }),
      );
      this.playback.exit();
      return;
    }
    this.recorder.clear();
  }

  protected onSeek(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.playback.seek(value);
  }
}

/** Two-digit zero pad for the time stamps above. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
