import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, merge } from 'rxjs';

import { INSPECTOR_VIEW_TEXTS } from '../../../../i18n/inspector-view.texts';
import type {
  IActivityNodeDetailApi,
  IActivityRunApi,
  IActivitySpawnRecordApi,
} from '../../../../models/api';
import { activityPairKeyTouches } from '../../../../models/api';
import { shortenOwner } from '../../../../models/activity-owner';
import type { INodeView } from '../../../../models/node';
import { LivePreferencesService } from '../../../../services/live-preferences';
import { NodeActivityStatsService } from '../../../../services/node-activity-stats';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { activityNodeLabel, pathBasenameForLink } from '../../../../services/path-basename';
import { CollapsibleSection } from '../../../components/collapsible-section/collapsible-section';
import { ConversationDialog } from '../../../components/conversation-dialog/conversation-dialog';
import { setupConversationDialog } from '../../../components/conversation-dialog/conversation-dialog.controller';
import {
  groupSpawnThreads,
  type ISpawnThread,
} from '../../../components/conversation-dialog/spawn-thread';
import {
  setupActivityFilter,
  type IActivityFilterHandle,
  type TActivityProvenanceFilter,
} from './inspector-activity-filter.controller';
import {
  mergeActivityTimeline,
  type TActivityTimelineEntry,
} from './inspector-activity-timeline';

/**
 * Debounce for the Activity section's live re-fetch. Live `node.activity`
 * and `agent.spawn` frames can arrive in rapid bursts (an agent lighting
 * a chain, an MCP tool called in a loop); coalescing them into one GET
 * shortly after the burst settles keeps the panel fresh without a request
 * per frame. The server is the source of truth, so a single trailing
 * re-fetch always reflects the final state.
 */
const ACTIVITY_LIVE_REFRESH_DEBOUNCE_MS = 400;

/** Per-node cap on the conversation threads the Activity section renders. */
const SPAWN_THREADS_LIMIT = 10;

/**
 * Activity section of the inspector (spec/provider-activity.md): per-node
 * execution stats, the recent ring, the spawn records touching the node,
 * and the conversation dialog its thread rows open. Extracted from the
 * inspector god component following the `linked-nodes-panel` precedent:
 * the section owns its own fetch machinery (lazy first-expand load,
 * silent scan / live refreshes), the provenance filter, and the merged
 * timeline; the host only threads the node and the persisted collapse
 * state, and routes the `openPath` clicks.
 */
@Component({
  selector: 'sm-inspector-activity-section',
  imports: [
    ButtonModule,
    SelectButtonModule,
    TooltipModule,
    FormsModule,
    CollapsibleSection,
    ConversationDialog,
  ],
  templateUrl: './inspector-activity-section.html',
  styleUrl: './inspector-activity-section.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorActivitySection {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly wsEvents = inject(WsEventStreamService);
  private readonly activityStats = inject(NodeActivityStatsService);
  private readonly livePrefs = inject(LivePreferencesService);

  protected readonly texts = INSPECTOR_VIEW_TEXTS;

  /** The inspected node (its path keys every fetch + the visibility gate). */
  readonly node = input.required<INodeView>();

  /** Expanded state; owned + persisted by the host's collapse map. */
  readonly expanded = input.required<boolean>();

  /** Emitted when the user clicks the section's toggle row. */
  readonly toggle = output<void>();

  /**
   * Emitted when the user clicks a counterpart node in an invocation
   * row. The host routes it through the shared node-open intent; the
   * section stays unaware of routing (same contract as
   * `<sm-linked-nodes-panel>`).
   */
  readonly openPath = output<string>();

  /**
   * Whether the "Activity" section renders at all, matching how the
   * other inspector sections (`hasConnections`, `hasAnnotations`, ...)
   * hide when empty: a quiet node shows no Activity section instead of
   * the "no recorded runs" placeholder. Visibility derives from the
   * same per-node mirror the node-card pill and the edge labels read
   * (`NodeActivityStatsService`, summary snapshot + WS overwrites): a
   * stats entry for the node, a spawn pair touching it as parent or
   * child, or PERSISTENT AI-run history (the summary's `runNodes`; the
   * boot-scoped counters reset on server restart, the DB history does
   * not, so recorded runs must keep the section visible after a
   * reboot). With real-time activity OFF the mirror may be un-hydrated
   * (the boot fetch is skipped), so emptiness is unknowable and the
   * section stays available like it always was.
   */
  protected readonly hasActivity = computed<boolean>(() => {
    const path = this.node().path;
    if (!this.livePrefs.activityEnabled()) return true;
    if (this.activityStats.stats().has(path)) return true;
    if (this.activityStats.runNodes().has(path)) return true;
    for (const key of this.activityStats.pairCounts().keys()) {
      if (activityPairKeyTouches(key, path)) return true;
    }
    return false;
  });

  /**
   * Activity section state (spec/provider-activity.md §Execution stats
   * / §Conversation capture). Fetched LAZILY on first expand per node
   * (the collapse state is persisted, so a user who keeps the section
   * open gets a fetch per navigation), then silently re-fetched on
   * every `scan.completed` while loaded, mirroring the body state
   * machine's loud-load / silent-refresh split. `null` = not fetched
   * yet (renders the loading line while expanded).
   */
  protected readonly activityDetail = signal<IActivityNodeDetailApi | null>(null);
  /** Path the current `activityDetail` belongs to (navigation guard). */
  private activityPath: string | undefined = undefined;
  /** Dedupe guard: the expand effect fetches once per (path, expand). */
  private activityFetchedFor: string | null = null;
  private readonly activityLoaderEffect = effect(() => {
    const path = this.node().path;
    const open = this.expanded();
    if (path !== this.activityPath) {
      // Navigation: a previous node's activity must not linger.
      this.activityDetail.set(null);
      this.activityFetchedFor = null;
      this.activityPath = path;
    }
    // The visibility gate also cuts the fetch: a hidden section (quiet
    // node) with a persisted-open collapse state must not spend a GET.
    // Reading the computed here makes the effect re-run when activity
    // first arrives for the node, so the section loads as it appears.
    if (!open || !this.hasActivity()) return;
    // The host's collapse-state signal covers EVERY section, so the
    // `expanded` input can re-fire without a real change here; the
    // fetched-for guard keeps those re-runs free.
    if (this.activityFetchedFor === path) return;
    this.activityFetchedFor = path;
    void this.fetchActivity(path);
  });

  /**
   * Silent same-path refresh on watcher re-scans, so counters and
   * spawn lists stay live while the section sits open. Skipped until
   * the section has fetched at least once for the current node.
   */
  private readonly activityScanRefresh = this.wsEvents.scanCompleted$
    .pipe(takeUntilDestroyed())
    .subscribe(() => {
      const path = this.activityPath;
      if (!path || this.activityFetchedFor !== path) return;
      void this.fetchActivity(path);
    });

  /**
   * Live same-path refresh on execution frames, so the recent-history
   * rows and counters update the moment the assistant runs, not only on
   * the next watcher re-scan. Merges the live streams the Activity section
   * reflects: `node.activity` (a unit executing, an MCP tool invoked),
   * `agent.spawn` (a new spawn thread), and `job.*` events. The job stream
   * is what makes skill-map's OWN AI runs appear live: `sm record` writes
   * the `state_executions` row (the AI-run history the timeline shows) then
   * pushes `job.completed`, and that push carries NO `node.activity` frame,
   * so without subscribing here an AI run only surfaced when something ELSE
   * happened to refresh the section (a fixer's edit triggered a re-scan, a
   * runtime frame fired), which is why finder / summarizer runs, which touch
   * no file, sometimes never appeared until the next navigation. Any frame
   * can touch this node's detail, directly (it lit up) or as the correlated
   * caller of an invocation elsewhere, so rather than duplicate the server's
   * owner-to-caller correlation client-side, we re-fetch the authoritative
   * detail (debounced) whenever activity flows while the section sits open.
   * Gated by the same fetched-for guard as the scan refresh, so a closed or
   * never-loaded section spends nothing.
   */
  private readonly activityLiveRefresh = merge(
    this.wsEvents.nodeActivity$,
    this.wsEvents.agentSpawn$,
    this.wsEvents.jobEvents$,
  )
    .pipe(debounceTime(ACTIVITY_LIVE_REFRESH_DEBOUNCE_MS), takeUntilDestroyed())
    .subscribe(() => {
      const path = this.activityPath;
      if (!path || this.activityFetchedFor !== path) return;
      void this.fetchActivity(path);
    });

  private async fetchActivity(path: string): Promise<void> {
    try {
      const detail = await this.dataSource.getNodeActivity(path);
      if (this.activityPath === path) this.activityDetail.set(detail);
    } catch {
      // Transport failure: keep whatever is shown (or the loading
      // line); activity is a progressive enhancement, never an error
      // banner.
    }
  }

  /** In-flight guard for the clear-all button (disables it while deleting). */
  protected readonly clearingActivity = signal(false);

  /**
   * Clear-all (`DELETE /api/activity/node`,
   * `spec/provider-activity.md` §DELETE): drops the node's run history,
   * runtime counters and spawn conversations in one call. Machine data,
   * regenerable, so no confirm dialog (same posture as the summary
   * delete). On success the authoritative re-fetch empties the panel and
   * the stats-mirror re-hydration is what lets `hasActivity()` retire
   * the whole section (the mirror drives the gate, the node-card pill
   * and the edge labels, and no WS frame echoes a clear).
   */
  protected async onClearAll(): Promise<void> {
    if (this.clearingActivity()) return;
    const path = this.node().path;
    this.clearingActivity.set(true);
    try {
      await this.dataSource.clearNodeActivity(path);
      if (this.activityPath === path) await this.fetchActivity(path);
      await this.activityStats.refresh();
    } catch {
      // Progressive enhancement: a failed clear (transport, demo mode)
      // keeps the panel as it was, same posture as fetchActivity.
    } finally {
      this.clearingActivity.set(false);
    }
  }

  /** True when the fetched detail has nothing to show (quiet node). */
  protected readonly activityEmpty = computed<boolean>(() => {
    const detail = this.activityDetail();
    // A node with a log but no counted start (a row checkpointed before
    // shell sightings counted, spec/provider-activity.md §Execution
    // stats) is NOT quiet: the log is what the section exists to show.
    return (
      detail !== null &&
      detail.stats.count === 0 &&
      detail.recent.length === 0 &&
      detail.spawns.length === 0 &&
      (detail.runs ?? []).length === 0
    );
  });

  /**
   * The "capture on" chip shows only where capture is ON *and* this node
   * actually has retained spawn conversations, not merely because the gate
   * is enabled: a chip on a node with zero captured conversations is noise
   * (the gate's global state already lives in Settings).
   */
  protected readonly showCaptureChip = computed<boolean>(() => {
    const detail = this.activityDetail();
    return detail !== null && detail.captureEnabled && detail.spawns.length > 0;
  });

  /**
   * Provenance filter over the merged timeline (all / runtime / AI
   * runs), persisted at INSPECTOR level like the section-collapse map,
   * so it survives navigation between nodes and reloads.
   */
  private readonly activityFilterState: IActivityFilterHandle = setupActivityFilter();

  protected activityFilter(): TActivityProvenanceFilter {
    return this.activityFilterState.filter();
  }

  protected onActivityFilterChange(value: TActivityProvenanceFilter): void {
    this.activityFilterState.set(value);
  }

  /** Filter control options; labels from the catalog, values are the filter ids. */
  protected readonly activityFilterOptions: {
    label: string;
    value: TActivityProvenanceFilter;
  }[] = [
    { label: INSPECTOR_VIEW_TEXTS.activity.filter.all, value: 'all' },
    { label: INSPECTOR_VIEW_TEXTS.activity.filter.runtime, value: 'runtime' },
    { label: INSPECTOR_VIEW_TEXTS.activity.filter.ai, value: 'ai' },
  ];

  /**
   * Merged timeline (user decision 2026-07-17): the runtime recent ring
   * interleaved with the persistent AI-run history, newest first,
   * timestampless entries sunk to the end. `runs` is normalized through
   * `?? []` so a BFF that predates the field degrades to runtime-only.
   */
  protected readonly activityTimeline = computed<TActivityTimelineEntry[]>(() => {
    const detail = this.activityDetail();
    if (detail === null) return [];
    return mergeActivityTimeline(detail.recent, detail.runs ?? []);
  });

  /** The merged timeline narrowed by the active provenance filter. */
  protected readonly filteredActivityTimeline = computed<TActivityTimelineEntry[]>(() => {
    const filter = this.activityFilterState.filter();
    const entries = this.activityTimeline();
    if (filter === 'all') return entries;
    return entries.filter((e) => e.provenance === filter);
  });

  /**
   * AI-run row text: `<extension> · <status?> · <duration>`, nullable
   * segments omitted. The built-in `core/` plugin prefix is stripped (it
   * is the overwhelming default and reads as noise; external plugins keep
   * their qualifier), the recording model is not shown (user call
   * 2026-07-20, matching the findings rows; `sm findings` in the terminal
   * still has it), and the status is surfaced ONLY when it deviates from
   * the happy-path `completed`: a failed / cancelled run shows its state,
   * a completed one does not repeat the obvious.
   */
  protected runRowLabel(run: IActivityRunApi): string {
    const parts = [run.extensionId.replace(/^core\//, '')];
    if (run.status !== 'completed') parts.push(run.status);
    if (run.durationMs !== null) parts.push(this.texts.activity.runDuration(run.durationMs));
    return parts.join(' · ');
  }

  /** Human time for activity rows (session-scoped, date is noise). */
  protected formatActivityTime(ms: number): string {
    return new Date(ms).toLocaleTimeString();
  }

  /**
   * Compact owner label for activity rows: the full sessionized id
   * (`main:6cfe5636-...`) is too long and squishes the tool detail, so
   * the row shows the short form (`main:6cfe5636`) with the full value
   * in the title tooltip. See `shortenOwner`.
   */
  protected shortOwner(owner: string): string {
    return shortenOwner(owner);
  }

  /**
   * Compact node label for a directional invocation row's caller /
   * target path (`mcp://<server>` -> `<server>`, else the basename).
   */
  protected nodeLabel(path: string): string {
    return activityNodeLabel(path);
  }

  /**
   * Spawn records grouped into per-pair conversation threads: one row
   * per parent-child pair, N Task calls fused into N turns of the same
   * thread (most recent thread first), capped per node at
   * `SPAWN_THREADS_LIMIT` conversations.
   */
  protected readonly spawnThreads = computed<ISpawnThread[]>(() =>
    groupSpawnThreads(this.activityDetail()?.spawns ?? []).slice(0, SPAWN_THREADS_LIMIT),
  );

  /** Thread-row labels: `<parent> -> <child>`, session parents named plainly. */
  protected threadPairLabel(thread: ISpawnThread): string {
    const t = this.texts.activity;
    const parent =
      thread.parentNodePath !== undefined
        ? pathBasenameForLink(thread.parentNodePath)
        : t.spawnParentSession;
    return t.spawnPair(parent, this.threadChildLabel(thread));
  }

  protected threadChildLabel(thread: ISpawnThread): string {
    if (thread.childName !== undefined) return thread.childName;
    if (thread.childNodePath !== undefined) return pathBasenameForLink(thread.childNodePath);
    return this.threadLastRecord(thread).childKind ?? '';
  }

  /** Records are ASC by startedAt, so the latest turn is the last one. */
  protected threadLastRecord(thread: ISpawnThread): IActivitySpawnRecordApi {
    return thread.records[thread.records.length - 1]!;
  }

  /**
   * Conversation dialog, state machine shared with the graph view via
   * `conversation-dialog.controller.ts`. The inspector already holds
   * the full spawn records (content included while capture is on), so
   * it uses the no-fetch `openThread` path, the clicked thread is
   * handed to the dialog directly; the graph view's edge-click path is
   * the one that fetches by id. The capture-gate binding stays on this
   * component's own `activityDetail` (already fetched for the section).
   */
  private readonly conversation = setupConversationDialog({ dataSource: this.dataSource });
  protected readonly conversationOpen = this.conversation.open;
  protected readonly conversationThread = this.conversation.thread;

  protected openSpawnConversation(thread: ISpawnThread): void {
    this.conversation.openThread(thread);
  }

  protected onConversationClosed(): void {
    this.conversation.close();
  }
}
