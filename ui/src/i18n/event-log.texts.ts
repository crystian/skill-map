/**
 * UI strings for the EventLog drawer.
 *
 * Step 14.3.a trim: scan-simulator was removed, the EventBus stub is
 * gone, and the live `EventStreamPort` lands at 14.4. The drawer now
 * always renders an empty state until that wiring arrives.
 */
export const EVENT_LOG_TEXTS = {
  title: 'Events',
  emptyState: 'No events yet — the event stream wires up in v0.7.0.',
  a11y: {
    expand: 'Expand event log',
    collapse: 'Collapse event log',
  },
} as const;
