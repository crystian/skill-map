/** UI strings for the GraphView. */
export const GRAPH_VIEW_TEXTS = {
  title: 'Graph',
  /** Subtitle is rendered in three pieces because the original markup wraps
   *  the three edge-kind names in `<code>` elements. Keeping them as inline
   *  templates avoids `[innerHTML]` (XSS surface) and the strings stay
   *  Transloco-friendly when we migrate later. */
  subtitlePrefix: 'Auto-laid-out (Dagre, top-bottom) · connections show how each node refers to another: ',
  subtitleSuffix: '. Click to highlight neighbors, double-click to inspect.',
  loading: 'Loading collection',
  errorTitle: 'Failed to load',
  emptyTitle: 'No nodes match',
  emptyDesc: 'Adjust or reset the filters above.',
  legend: {
    invokes: 'invokes',
    references: 'references',
    mentions: 'mentions',
    supersedes: 'supersedes',
  },
  legendTooltip: {
    invokes: 'Execution-level call (e.g. /command in body)',
    references: 'Explicit reference (e.g. @handle or [[wikilink]])',
    mentions: 'Plain-text mention of another node by name',
    supersedes: 'Lifecycle replacement (declared in metadata.supersedes)',
  },
  a11y: {
    toolbar: 'Graph controls',
    edgeLegend: 'Edge legend',
  },
  toolbar: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitToScreen: 'Fit to screen',
    resetLayoutLabel: 'Reset layout',
    resetLayoutTooltip: 'Reset layout (re-run auto layout, clear saved positions)',
  },
  resetLayoutConfirm: 'Reset all node positions to the automatic layout? This cannot be undone.',
} as const;
