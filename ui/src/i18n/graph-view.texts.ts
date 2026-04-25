/** UI strings for the GraphView. */
export const GRAPH_VIEW_TEXTS = {
  title: 'Graph',
  /** Subtitle is rendered in three pieces because the original markup wraps
   *  the three edge-kind names in `<code>` elements. Keeping them as inline
   *  templates avoids `[innerHTML]` (XSS surface) and the strings stay
   *  Transloco-friendly when we migrate later. */
  subtitlePrefix: 'Auto-laid-out (Dagre, top-bottom) · edges from ',
  subtitleSuffix: '. Click to highlight neighbors, double-click to inspect.',
  loading: 'Loading collection',
  errorTitle: 'Failed to load',
  emptyTitle: 'No nodes match',
  emptyDesc: 'Adjust or reset the filters above.',
  legend: {
    supersedes: 'supersedes',
    requires: 'requires',
    related: 'related',
  },
  a11y: {
    toolbar: 'Graph controls',
    edgeLegend: 'Edge legend',
  },
  toolbar: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitToScreen: 'Fit to screen',
    resetZoomLabel: 'Reset zoom to 1:1',
    resetZoomTooltip: 'Reset zoom (1:1)',
    resetLayoutLabel: 'Reset layout',
    resetLayoutTooltip: 'Reset layout (re-run auto layout, clear saved positions)',
  },
  resetLayoutConfirm: 'Reset all node positions to the automatic layout? This cannot be undone.',
} as const;
