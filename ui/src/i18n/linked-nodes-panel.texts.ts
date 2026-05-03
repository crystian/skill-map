/** UI strings for the LinkedNodesPanel (Step 14.5.b). */
export const LINKED_NODES_PANEL_TEXTS = {
  cardHeader: 'Linked nodes',
  refreshLabel: 'Refresh links',
  outgoingHeader: 'Outgoing',
  incomingHeader: 'Incoming',
  loading: 'Loading links…',
  error: 'Failed to load links.',
  emptyOutgoing: 'No outgoing links from this node.',
  emptyIncoming: 'No incoming links to this node.',
  /** Per-link metadata labels — small, used inline next to chips. */
  confidence: {
    high: 'high',
    medium: 'medium',
    low: 'low',
  },
  sourcesPrefix: 'detected by ',
  sourcesSeparator: ', ',
} as const;
