/** UI strings for the GraphView. */
export const GRAPH_VIEW_TEXTS = {
  loading: 'Loading collection',
  errorTitle: 'Failed to load',
  emptyTitle: 'No nodes match',
  emptyDesc: 'Adjust or reset the filters above.',
  a11y: {
    toolbar: 'Graph controls',
    panel: 'Selected node details',
  },
  toolbar: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitToScreen: 'Fit to screen',
    resetLayoutLabel: 'Reset layout',
    resetLayoutTooltip: 'Reset layout (re-run auto layout, clear saved positions)',
  },
  panel: {
    closeLabel: 'Close panel',
  },
  resetLayoutConfirm: 'Reset all node positions to the automatic layout? This cannot be undone.',
} as const;
