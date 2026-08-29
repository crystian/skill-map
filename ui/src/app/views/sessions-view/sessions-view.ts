/**
 * `<sm-sessions-view>`, the workspace rail's Sessions panel: the list of
 * runtime sessions the activity recorder has on tape, each expandable
 * into its agent tree (who spawned whom) plus the INTERNAL STEPS each
 * context ran (narrow sub-rows under the main agent and under every
 * subagent: skill runs, MCP calls, reads; user request 2026-08-16),
 * with a Play control that asks the host (via `SESSION_REPLAY_INTENT`)
 * to replay that session, or one agent branch, inside the Live lens.
 *
 * Self-contained like `<sm-files-view>`: no `@Input`s; it reads the
 * recorder directly and derives everything through the pure
 * `computeSessionIndex` fold, so the list follows the tape live while
 * the tab is mounted (the tab-gated mount is what bounds the recompute
 * cost). Unlike the Queue tab, this panel stays available while the
 * lens is on: it is the lens's own front door.
 *
 * Play is HIDDEN on agent nodes whose subtree carries no owner id
 * (nothing could be attributed to them, so the scoped tape would hold
 * only their spawn frames), and DISABLED everywhere while the lens is
 * unavailable (demo mode / Real Time off), with the tooltip saying why.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';
import { TooltipModule } from 'primeng/tooltip';

import { SESSIONS_VIEW_TEXTS } from '../../../i18n/sessions-view.texts';
import type { ISessionRecordingApi } from '../../../models/api';
import { ActivityRecorderService, type TRecordedEvent } from '../../../services/activity-recorder';
import { DATA_SOURCE, type IDataSourcePort } from '../../../services/data-source/data-source.port';
import { LiveLensService } from '../../../services/live-lens';
import { pathBasenameForLink } from '../../../services/path-basename';
import {
  computeSessionIndex,
  type ISessionAgentNode,
  type ISessionEntry,
  type ISessionReplaySelection,
  type ISessionStep,
} from '../../../services/session-index';
import { CaptureLevelService } from '../../../services/capture-level';
import { DismissedNotesService } from '../../../services/dismissed-notes';
import { foldJournalRecordings, sessionTitle } from '../../../services/session-catalog';
import { SessionPurgeService } from '../../../services/session-purge';
import { CaptureLevelSelector } from '../../components/capture-level-selector/capture-level-selector';
import { SessionRecordControl } from '../../components/session-record-control/session-record-control';
import { SESSION_REPLAY_INTENT } from '../../slots/session-replay-intent';

/** Pinned locale, same posture as `format-count.ts`: English-only UI. */
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

@Component({
  selector: 'sm-sessions-view',
  imports: [
    NgTemplateOutlet,
    ButtonModule,
    PaginatorModule,
    TooltipModule,
    CaptureLevelSelector,
    SessionRecordControl,
  ],
  templateUrl: './sessions-view.html',
  styleUrl: './sessions-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsView {
  protected readonly recorder = inject(ActivityRecorderService);
  private readonly liveLens = inject(LiveLensService);
  private readonly replayIntent = inject(SESSION_REPLAY_INTENT);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly purge = inject(SessionPurgeService);
  private readonly captureLevelSvc = inject(CaptureLevelService);
  private readonly notes = inject(DismissedNotesService);

  /** The recording intro note (see the texts entry for the intent). */
  protected readonly introVisible = this.notes.visible(SESSIONS_VIEW_TEXTS.introNoteId);

  protected dismissIntro(): void {
    this.notes.dismiss(SESSIONS_VIEW_TEXTS.introNoteId);
  }
  private readonly destroyRef = inject(DestroyRef);
  protected readonly texts = SESSIONS_VIEW_TEXTS;

  protected readonly index = computed(() => computeSessionIndex(this.recorder.events()));

  /**
   * The server journal's recordings (`GET /api/activity/sessions`,
   * 2026-08-16): the DURABLE memory, so sessions recorded before this
   * page opened still list and replay. Fetched at mount, re-fetched
   * when a recording stops (the GET flushes pending buffers, so the
   * fresh session is immediately visible) and when the tape empties
   * (the purge wiped the journal too). Best-effort: demo mode / a dead
   * server leave the tab living off the client tape alone.
   */
  private readonly journalRecordings = signal<readonly ISessionRecordingApi[]>([]);

  /**
   * Journal-ONLY sessions: each recording folds through the same
   * `computeSessionIndex` as the tape, so rows / agents / steps reuse
   * every template unchanged; roots the client tape already carries
   * are skipped (the live version wins, it is still updating). The
   * frames map feeds the replay selection (`sourceFrames`), the client
   * recorder never saw these frames.
   */
  private readonly journalIndex = computed(() =>
    foldJournalRecordings(this.index().sessions, this.journalRecordings()),
  );

  /**
   * Newest first, tape + journal merged (the session you just watched
   * is the one you replay). Ordinals re-stamp over the merged order so
   * the positional testids stay unique.
   */
  protected readonly sessions = computed(() =>
    [...this.index().sessions, ...this.journalIndex().entries]
      .sort((a, b) => b.firstTMs - a.firstTMs)
      .map((entry, i) => ({ ...entry, ordinal: i + 1 })),
  );

  constructor() {
    void this.refreshJournal();
    // Falling edge of recording -> refetch (the finalize/flush is
    // server-side; the GET flushes buffers itself, no debounce wait).
    // Tape emptied -> refetch after a small delay: the Settings purge
    // wipes the journal too (the DELETE should land first), while the
    // replay trash clears the tape only, so the journal rows re-list.
    let prevRecording: boolean | null = null;
    let prevSize: number | null = null;
    effect(() => {
      const recording = this.recorder.recording();
      if (prevRecording === true && !recording) this.scheduleJournalRefresh(300);
      prevRecording = recording;
    });
    effect(() => {
      const size = this.recorder.size();
      if (prevSize !== null && prevSize > 0 && size === 0) this.scheduleJournalRefresh(400);
      prevSize = size;
    });
    // A settled purge (Settings row) refetches DIRECTLY: with an
    // already-empty tape there is no size transition to piggyback on,
    // which is how stale journal rows survived until an F5.
    let prevPurgedAt: number | null = null;
    effect(() => {
      const purgedAt = this.purge.purgedAt();
      if (prevPurgedAt !== null && purgedAt !== prevPurgedAt) this.scheduleJournalRefresh(0);
      prevPurgedAt = purgedAt;
    });
    this.destroyRef.onDestroy(() => {
      if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    });
  }

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleJournalRefresh(delayMs: number): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshJournal();
    }, delayMs);
  }

  private async refreshJournal(): Promise<void> {
    try {
      const { sessions, captureLevel, shellCapture } = await this.dataSource.getSessionJournal();
      this.journalRecordings.set(sessions);
      // The envelope carries the live ladder position + the shell
      // opt-in: hydrate the shared service so the selector needs no
      // extra request.
      this.captureLevelSvc.hydrate(captureLevel);
      this.captureLevelSvc.hydrateShellCapture(shellCapture);
    } catch {
      // Best-effort (demo mode, server down): the tape still lists.
    }
  }

  protected readonly playAvailable = this.liveLens.replayAvailable;

  /**
   * Capture-level tag for a session row (user request 2026-08-17): the
   * stamp of the journal recording holding this session's root. Covers
   * tape-native rows too, the journal records in parallel while the
   * tape does; sessions with no journal recording (demo mode, journal
   * off, pre-ladder files) show no tag.
   */
  protected captureLevelTag(session: ISessionEntry): string | null {
    const recording = this.journalRecordings().find((r) => r.rootOwner === session.rootOwner);
    const level = recording?.captureLevel;
    if (level === undefined) return null;
    return this.texts.levelTag[level] ?? level;
  }

  /**
   * The IN-FLIGHT session while recording: frames still landing after
   * the record watermark (user call 2026-08-17). Watching the present
   * and replaying it collide on the same canvas, so its Play (and step
   * deep-links) disable until the recording stops; every finished
   * session stays replayable mid-recording.
   */
  protected replayBlocked(session: ISessionEntry): boolean {
    const since = this.recorder.recordingSince();
    return since !== null && session.lastTMs >= since;
  }

  /** Tooltip for a Play control, honest about WHY it is disabled. */
  protected playTooltip(session: ISessionEntry, agentTooltip: string): string {
    if (!this.playAvailable()) return this.texts.playUnavailableTooltip;
    if (this.replayBlocked(session)) return this.texts.playRecordingTooltip;
    return agentTooltip;
  }

  /**
   * Session-row pagination, the Queue tab's exact dialect (user request
   * 2026-08-16): 100 rows per page, prev / next + the compact report.
   * `first` self-clamps when the list shrinks under the cursor (a
   * deleted recording, the ring trimming old sessions away).
   */
  protected readonly pageSize = 100;
  private readonly pageFirst = signal(0);
  protected readonly first = computed(() => {
    const total = this.sessions().length;
    const first = this.pageFirst();
    if (first < total) return first;
    return total === 0 ? 0 : Math.floor((total - 1) / this.pageSize) * this.pageSize;
  });

  protected readonly pagedSessions = computed(() => {
    const first = this.first();
    return this.sessions().slice(first, first + this.pageSize);
  });

  protected onPage(event: PaginatorState): void {
    this.pageFirst.set(event.first ?? 0);
  }

  /** Expanded rows; session rows key by rootOwner, agents by spawnId. */
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  protected toggle(key: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected startTime(tMs: number): string {
    return TIME_FORMAT.format(new Date(tMs));
  }

  /**
   * The session's user-visible name everywhere (replay scope chip, aria
   * labels): the runtime session id (shortened; it matches the journal
   * filename suffix on disk), or the start time when the runtime never
   * reported one. The synthetic "Session N" ordinal survives ONLY in
   * testids, where positional stability is the point.
   */
  protected sessionName(session: ISessionEntry): string {
    const id = session.sessionId;
    return id === undefined ? this.startTime(session.firstTMs) : shortSessionId(id);
  }

  /** One internal step's label, same grammar as the replay ticker. */
  protected stepLabel(step: ISessionStep): string {
    return this.texts.step(pathBasenameForLink(step.path), step.detail);
  }

  /**
   * A session's title: the NAMES of everything it touched (user call
   * 2026-08-16, usage over identity), first-touch order, deduped by
   * display name (two paths can share a basename). A session that
   * touched nothing (only ever spawned) falls back to its counters so
   * the title line never goes blank.
   */
  protected sessionTitle(session: ISessionEntry): string {
    return sessionTitle(session);
  }

  /** The subtitle's counters half (the id half renders as its own chip). */
  protected sessionStats(session: ISessionEntry): string {
    return this.texts.stats(session.eventCount, session.touchedPaths.size, session.agentCount);
  }

  /** Template access to the shared shortener (the id chip's face). */
  protected shortId(id: string): string {
    return shortSessionId(id);
  }

  /**
   * Replay selection for one session: identity plus, for a
   * journal-hydrated row, the recording's own frames (the client tape
   * never saw them, see `ISessionReplaySelection.sourceFrames`).
   */
  private selectionFor(session: ISessionEntry, agentSpawnId?: string): ISessionReplaySelection {
    const sourceFrames = this.journalIndex().frames.get(session.rootOwner);
    return {
      rootOwner: session.rootOwner,
      ...(agentSpawnId === undefined ? {} : { agentSpawnId }),
      ...(sourceFrames === undefined ? {} : { sourceFrames }),
    };
  }

  /**
   * What the replay transport's scope chip reads: the session's TITLE
   * (the touched-node names, user call 2026-08-17), not the short id.
   * The id keeps naming the row's expand/collapse aria labels, where
   * positional identity matters more than content.
   */
  private replayLabel(session: ISessionEntry): string {
    return this.sessionTitle(session);
  }

  protected play(session: ISessionEntry): void {
    this.replayIntent.replaySession(this.selectionFor(session), this.replayLabel(session));
  }

  protected playAgent(session: ISessionEntry, agent: ISessionAgentNode): void {
    this.replayIntent.replaySession(
      this.selectionFor(session, agent.spawnId),
      this.texts.agentLabel(this.replayLabel(session), agent.name ?? this.texts.unnamedAgent),
    );
  }

  /**
   * Step deep-link (user request 2026-08-16): replay the WHOLE session
   * and land on this step's frame. Deliberately session-scoped even for
   * an agent's step, so the map narrates the full context up to that
   * moment; the intent seeks by the step's `(tMs, path)` identity.
   */
  protected playStep(session: ISessionEntry, step: ISessionStep): void {
    this.replayIntent.replaySession(this.selectionFor(session), this.replayLabel(session), step);
  }

  /** An agent is replayable only if its subtree owns attributable frames. */
  protected replayable(agent: ISessionAgentNode): boolean {
    if (agent.owner !== undefined) return true;
    return agent.children.some((child) => this.replayable(child));
  }
}

/** Row-sized session id, 5 chars (user call 2026-08-16); the full value rides the chip tooltip. */
function shortSessionId(id: string): string {
  return id.length > 5 ? `${id.slice(0, 5)}…` : id;
}
