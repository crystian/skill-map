/**
 * UI strings for the EventLog drawer.
 *
 * Step 14.4.b: the drawer subscribes to `dataSource.events()` and renders
 * the last N=50 events FIFO. In live mode, frames flow from the BFF's
 * `/ws` channel; in demo mode the events stream is `EMPTY` and the
 * drawer shows a mode-specific empty state.
 *
 * Function-style entries take parameters so the catalog stays
 * Transloco-ready when a real i18n framework lands.
 */
export const EVENT_LOG_TEXTS = {
  title: 'Events',
  emptyStateLive: 'No events yet — try editing a `.md` file in the watched scope.',
  emptyStateDemo: 'No live events in demo mode — run `npx @skill-map/cli serve` for the live feed.',
  /** Inline error notice when the WS connection has been lost permanently. */
  streamError: (message: string) => `Live feed lost: ${message}`,
  /** Generic per-row payload digest fallback (unknown event type). */
  noPayloadDetails: 'no payload details',
  /**
   * Per-event-type compact digests rendered in the row's "msg" column.
   * Each helper takes the per-event narrowed payload (see
   * `models/ws-event.ts`) and formats it for display. The functions
   * tolerate undefined fields because both the spec example shapes and
   * the kernel's current emissions are accepted (the two diverge today).
   */
  digests: {
    /**
     * Spec shape: `{ mode, target, rootsCount }`. Kernel-current shape:
     * `{ roots: string[] }`. We render whichever the payload carries.
     */
    scanStarted: (mode: string | undefined, target: string | null | undefined, roots: string[] | undefined) => {
      if (mode) return target ? `${mode} target=${target}` : mode;
      if (roots && roots.length > 0) return `roots=${roots.join(',')}`;
      return 'started';
    },
    /**
     * Spec shape: `{ filesSeen, filesProcessed, filesSkipped }`. Kernel-current
     * shape: per-node `{ index, path, kind, cached }`.
     */
    scanProgress: (
      processed: number | undefined,
      seen: number | undefined,
      index: number | undefined,
      path: string | undefined,
    ) => {
      if (processed !== undefined || seen !== undefined) {
        return `${processed ?? '?'} / ${seen ?? '?'} files`;
      }
      if (index !== undefined && path) return `#${index} ${path}`;
      if (path) return path;
      return 'progress';
    },
    scanCompleted: (n: number | undefined, l: number | undefined, i: number | undefined, ms: number | undefined) =>
      `nodes=${n ?? 0} links=${l ?? 0} issues=${i ?? 0} (${ms ?? 0}ms)`,
    extractorCompleted: (id: string | undefined) => id ?? 'unknown',
    ruleCompleted: (id: string | undefined) => id ?? 'unknown',
    watcherStarted: (debounceMs: number | undefined, roots: string[] | undefined) =>
      `roots=${roots?.join(',') ?? '.'} debounce=${debounceMs ?? '?'}ms`,
    watcherError: (message: string | undefined) => message ?? 'unknown',
    extensionError: (extId: string | undefined, message: string | undefined) =>
      `${extId ?? 'unknown'}: ${message ?? 'unknown'}`,
  },
  a11y: {
    expand: 'Expand event log',
    collapse: 'Collapse event log',
  },
} as const;
