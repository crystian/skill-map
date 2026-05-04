/** UI strings for the ListView. */
export const LIST_VIEW_TEXTS = {
  title: 'Nodes',
  subtitleDefault: 'Flat view of the collection · click a row to open the inspector.',
  showingPrefix: 'Showing',
  showingSuffix: (total: number) => ` of ${total} nodes.`,
  loading: 'Loading collection…',
  columns: {
    kind: 'Kind',
    name: 'Name',
    path: 'Path',
    version: 'Version',
    stability: 'Stability',
    priority: 'Priority',
  },
  emptyFiltered: 'No nodes match the current filters.',
  emptyAll: 'No nodes loaded.',
  resetFilters: 'Reset filters',
  /** Placeholder for missing scalar values (version, stability, priority). */
  missing: '—',
} as const;
