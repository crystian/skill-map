import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { ToggleButtonModule } from 'primeng/togglebutton';

import { EVENT_LOG_TEXTS } from '../../../i18n/event-log.texts';
import { DATA_SOURCE, type IDataSourcePort } from '../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../services/data-source/runtime-mode';
import {
  readScanCompletedSummary,
  wsEventTimestampMs,
  type IWsEvent,
  type IWsExtractorCompletedData,
  type IWsRuleCompletedData,
  type IWsScanCompletedData,
  type IWsScanProgressData,
  type IWsScanStartedData,
  type IWsWatcherErrorData,
  type IWsWatcherStartedData,
} from '../../../models/ws-event';

/**
 * Maximum events retained in the FIFO ring. Older events drop when the
 * 51st arrives. The drawer is a "this thing is alive" telemetry surface,
 * not a full debug console — bounded memory is intentional.
 */
const MAX_EVENTS = 50;

/**
 * Severity bucket per event type — drives the row's CSS modifier so the
 * eye can spot warnings / errors without parsing every line.
 */
type TEventSeverity = 'info' | 'success' | 'warn' | 'error';

interface IEventLogRow {
  /** Stable key for `@for` track-by. */
  key: number;
  type: string;
  severity: TEventSeverity;
  /** Pre-formatted `HH:MM:SS` for the time column. */
  time: string;
  /** Pre-computed compact payload digest. Empty string when no details to show. */
  digest: string;
}

/**
 * EventLog drawer.
 *
 * Step 14.4.b: subscribes to `dataSource.events()` and renders the last
 * 50 frames FIFO. New frames push onto the end of a signal-backed ring;
 * when the ring exceeds `MAX_EVENTS` the oldest entry drops.
 *
 *   - Live mode: events flow from `WsEventStreamService.events$`.
 *   - Demo mode: events() returns `EMPTY`, the subscription completes
 *     immediately, and the empty state shows a demo-specific message.
 *
 * Forward-compat: unknown event types render with type + empty digest.
 * The component never narrows by `event.type` for unknown types — only
 * for the well-known set documented in `spec/job-events.md`.
 */
@Component({
  selector: 'app-event-log',
  imports: [FormsModule, ButtonModule, BadgeModule, ToggleButtonModule],
  templateUrl: './event-log.html',
  styleUrl: './event-log.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventLog {
  protected readonly texts = EVENT_LOG_TEXTS;

  private readonly dataSource = inject(DATA_SOURCE);
  private readonly mode = inject(SKILL_MAP_MODE);
  private readonly destroyRef = inject(DestroyRef);

  readonly expanded = signal(false);

  /** FIFO ring backing the rendered list. */
  private readonly _events = signal<IEventLogRow[]>([]);
  readonly events = this._events.asReadonly();

  /** Live count for the badge in the handle. */
  readonly count = computed(() => this._events().length);

  /** Surface a stream-error notice when the WS gives up reconnecting. */
  private readonly _streamError = signal<string | null>(null);
  readonly streamError = this._streamError.asReadonly();

  /** Demo-vs-live tells the empty-state which copy to render. */
  readonly isDemo = this.mode === 'demo';

  /** Monotonic counter for stable `@for` keys (survives identical-content frames). */
  private nextKey = 1;

  constructor() {
    this.subscribeToStream(this.dataSource);
  }

  setExpanded(value: boolean): void {
    this.expanded.set(value);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private subscribeToStream(ds: IDataSourcePort): void {
    ds.events()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => this.appendEvent(event),
        error: (err) => {
          const message = err instanceof Error ? err.message : String(err);
          this._streamError.set(message);
        },
        // complete() in demo mode is a no-op — the empty state already
        // covers the "no live events" case.
      });
  }

  private appendEvent(event: IWsEvent): void {
    const row: IEventLogRow = {
      key: this.nextKey++,
      type: event.type,
      severity: severityForType(event.type),
      time: formatTime(wsEventTimestampMs(event)),
      digest: digestForEvent(event, this.texts),
    };
    const next = [...this._events(), row];
    if (next.length > MAX_EVENTS) {
      next.splice(0, next.length - MAX_EVENTS);
    }
    this._events.set(next);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests).
// ---------------------------------------------------------------------------

function severityForType(type: string): TEventSeverity {
  if (type === 'watcher.error' || type === 'extension.error') return 'error';
  if (type === 'scan.completed') return 'success';
  if (type === 'scan.started' || type === 'scan.progress') return 'info';
  if (type === 'watcher.started') return 'success';
  return 'info';
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function digestForEvent(event: IWsEvent, texts: typeof EVENT_LOG_TEXTS): string {
  // Narrow by `type`. Unknown types collapse to the empty-digest path so
  // forward-compat events still render their type + time.
  switch (event.type) {
    case 'scan.started': {
      const d = (event.data ?? {}) as IWsScanStartedData;
      return texts.digests.scanStarted(d.mode, d.target ?? null, d.roots);
    }
    case 'scan.progress': {
      const d = (event.data ?? {}) as IWsScanProgressData;
      return texts.digests.scanProgress(d.filesProcessed, d.filesSeen, d.index, d.path);
    }
    case 'scan.completed': {
      const d = (event.data ?? {}) as IWsScanCompletedData;
      const s = readScanCompletedSummary(d);
      return texts.digests.scanCompleted(s.nodes, s.links, s.issues, s.durationMs);
    }
    case 'extractor.completed': {
      const d = (event.data ?? {}) as IWsExtractorCompletedData;
      return texts.digests.extractorCompleted(d.extractorId);
    }
    case 'rule.completed': {
      const d = (event.data ?? {}) as IWsRuleCompletedData;
      return texts.digests.ruleCompleted(d.ruleId);
    }
    case 'watcher.started': {
      const d = (event.data ?? {}) as IWsWatcherStartedData;
      return texts.digests.watcherStarted(d.debounceMs, d.roots);
    }
    case 'watcher.error': {
      const d = (event.data ?? {}) as IWsWatcherErrorData;
      return texts.digests.watcherError(d.message);
    }
    case 'extension.error': {
      const d = (event.data ?? {}) as { extensionId?: string; message?: string };
      return texts.digests.extensionError(d.extensionId, d.message);
    }
    default:
      // Unknown event type — render the type only, no digest.
      return '';
  }
}

/** Re-exported for unit tests so the spec doesn't reach into module internals through hand-rolled paths. */
export const __testHooks = { severityForType, formatTime, digestForEvent };
