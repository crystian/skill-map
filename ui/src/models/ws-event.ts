/**
 * `IWsEvent` — typed envelope for every WebSocket frame the BFF pushes
 * over `/ws`. Mirrors `spec/job-events.md §Common envelope`:
 *
 *   ```json
 *   {
 *     "type":      "<event-type>",
 *     "timestamp": <unix-ms> | "<iso-string>",
 *     "runId":     "<run-id>",
 *     "jobId":     "<job-id> | null",
 *     "data":      { ... }
 *   }
 *   ```
 *
 * The BFF (`src/server/events.ts:IWsEventEnvelope`) and the kernel's
 * `ProgressEmitterPort` agree on this shape. The `timestamp` field is
 * intentionally typed `number | string` because the kernel emits ISO-8601
 * today (per `src/kernel/orchestrator.ts:makeEvent`) while the spec
 * example shows unix-ms — consumers normalise via `wsEventTimestampMs()`.
 *
 * The brief uses the shorter `ts` / `payload` aliases. We keep
 * `timestamp` / `data` here because:
 *
 *   1. The wire shape is fixed by the BFF (and ultimately by the spec).
 *   2. Renaming on receive would break a future consumer that round-trips
 *      events through the WS pipe (e.g. a debug-relay tool).
 *
 * `IWsEvent` is intentionally generic over `data` so a consumer can
 * narrow per `type` via the discriminated unions below
 * (`IWsScanCompletedEvent` etc.). Unknown types collapse to
 * `IWsEvent<unknown>` and consumers must skip them silently per the
 * spec's forward-compat rule.
 */

export interface IWsEvent<T = unknown> {
  /**
   * Canonical event type per `spec/job-events.md §Event catalog`. Today
   * the BFF emits a subset: `scan.started`, `scan.progress`,
   * `scan.completed`, `extractor.completed`, `rule.completed`,
   * `extension.error`, plus the BFF-internal `watcher.started` /
   * `watcher.error` advisories.
   */
  type: string;
  /**
   * Server timestamp. The BFF / kernel currently emit an ISO-8601 string
   * for emitter events and `Date.now()` (number) for watcher.* advisories;
   * consumers normalise via `wsEventTimestampMs()` below.
   */
  timestamp: number | string;
  /** Run identifier. Optional — `watcher.*` advisories don't carry one. */
  runId?: string;
  /** Job identifier. `null` for run-level / non-job events. */
  jobId?: string | null;
  /** Event-specific payload. Empty object `{}` for events with no data. */
  data: T;
}

// ---------------------------------------------------------------------------
// Per-type payload shapes — narrow only the events the SPA actually
// reads. Unknown types stay `IWsEvent<unknown>`.
// ---------------------------------------------------------------------------

/**
 * `scan.started` payload. Spec example uses `{ mode, target, rootsCount }`;
 * the kernel currently emits `{ roots: string[] }` instead. Both shapes
 * are tolerated.
 */
export interface IWsScanStartedData {
  mode?: 'full' | 'changed' | 'single';
  target?: string | null;
  rootsCount?: number;
  /** Kernel-current shape — array of root paths. */
  roots?: string[];
}

/**
 * `scan.progress` payload. Spec example uses
 * `{ filesSeen, filesProcessed, filesSkipped }`; the kernel currently
 * emits per-node `{ index, path, kind, cached }`. Both shapes tolerated.
 */
export interface IWsScanProgressData {
  filesSeen?: number;
  filesProcessed?: number;
  filesSkipped?: number;
  /** Kernel-current shape — per-node fan-out. */
  index?: number;
  path?: string;
  kind?: string;
  cached?: boolean;
}

/**
 * `scan.completed` payload. The kernel emits a `stats` block today
 * (`{ stats: { filesWalked, nodesCount, linksCount, issuesCount, durationMs } }`)
 * while the spec example shows the counts inlined at the top level. Both
 * shapes are supported here so the UI tolerates either; consumers
 * normalize via `readScanCompletedSummary()` below.
 */
export interface IWsScanCompletedData {
  /** Top-level shape per spec example (some emitters use this). */
  nodes?: number;
  links?: number;
  issues?: number;
  durationMs?: number;
  /** Nested shape per the kernel's current emission. */
  stats?: {
    filesWalked?: number;
    filesSkipped?: number;
    nodesCount?: number;
    linksCount?: number;
    issuesCount?: number;
    durationMs?: number;
  };
}

/**
 * Normalize a `scan.completed` payload to the four numbers the EventLog
 * digest needs. Picks the top-level field first (spec example shape),
 * falls back to the `stats` block (current kernel shape). Returns
 * `undefined` for any field neither shape supplies.
 */
export function readScanCompletedSummary(data: IWsScanCompletedData | undefined | null): {
  nodes: number | undefined;
  links: number | undefined;
  issues: number | undefined;
  durationMs: number | undefined;
} {
  const d = data ?? {};
  return {
    nodes: d.nodes ?? d.stats?.nodesCount,
    links: d.links ?? d.stats?.linksCount,
    issues: d.issues ?? d.stats?.issuesCount,
    durationMs: d.durationMs ?? d.stats?.durationMs,
  };
}

export interface IWsExtractorCompletedData {
  extractorId?: string;
}

export interface IWsRuleCompletedData {
  ruleId?: string;
}

export interface IWsWatcherStartedData {
  roots?: string[];
  debounceMs?: number;
}

export interface IWsWatcherErrorData {
  message?: string;
}

export type IWsScanStartedEvent = IWsEvent<IWsScanStartedData> & { type: 'scan.started' };
export type IWsScanProgressEvent = IWsEvent<IWsScanProgressData> & { type: 'scan.progress' };
export type IWsScanCompletedEvent = IWsEvent<IWsScanCompletedData> & { type: 'scan.completed' };
export type IWsExtractorCompletedEvent = IWsEvent<IWsExtractorCompletedData> & {
  type: 'extractor.completed';
};
export type IWsRuleCompletedEvent = IWsEvent<IWsRuleCompletedData> & { type: 'rule.completed' };
export type IWsWatcherStartedEvent = IWsEvent<IWsWatcherStartedData> & { type: 'watcher.started' };
export type IWsWatcherErrorEvent = IWsEvent<IWsWatcherErrorData> & { type: 'watcher.error' };

/**
 * Loose, runtime type-guard. Validates only the envelope's required keys
 * (`type` is non-empty string, `timestamp` is number-or-string, `data`
 * exists). Per-type payload validation is intentionally absent — the
 * spec mandates forward-compat tolerance, and the consumers narrow by
 * `type` themselves before reading `data`.
 *
 * Returns `false` when the value is malformed; the caller logs + drops.
 * Never throws.
 */
export function isWsEvent(value: unknown): value is IWsEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['type'] !== 'string' || v['type'].length === 0) return false;
  const ts = v['timestamp'];
  if (typeof ts !== 'number' && typeof ts !== 'string') return false;
  if (!('data' in v)) return false;
  return true;
}

/**
 * Normalize the envelope's timestamp to unix-ms regardless of which form
 * the BFF emitted (kernel emitter → ISO-8601 string, watcher advisories →
 * `Date.now()` number). Returns `Date.now()` as a defensive fallback when
 * the input is unparseable so the event log row always has a render
 * value — a malformed timestamp is not worth dropping the event over.
 */
export function wsEventTimestampMs(event: IWsEvent): number {
  const ts = event.timestamp;
  if (typeof ts === 'number') return ts;
  const parsed = Date.parse(ts);
  if (Number.isFinite(parsed)) return parsed;
  return Date.now();
}
