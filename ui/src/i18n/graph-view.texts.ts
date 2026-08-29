/** UI strings for the GraphView. */
export const GRAPH_VIEW_TEXTS = {
  loading: 'Loading collection',
  errorTitle: 'Failed to load',
  emptyTitle: 'No nodes match the current filters.',
  resetFilters: 'Reset filters',
  curationEmptyTitle: 'Nothing from your map selection is visible right now.',
  showAllOnMap: 'Show all on map',
  a11y: {
    toolbar: 'Map controls',
    panel: 'Selected node details',
    /**
     * Accessible name for a graph node host (WCAG 4.1.2). The host is a
     * `role="group"` (a `button` role would hide the card's own controls,
     * see the template) that selects the node on Enter / Space; the label
     * names the node, its kind, and whether it is currently selected, so a
     * screen-reader user knows what activating it does and its current
     * state. The selected word is part of the NAME on purpose: `group`
     * takes no `aria-pressed` / `aria-selected`, so this string is the
     * only place the state can travel.
     */
    nodeHost: (name: string, kind: string, selected: boolean): string =>
      `${name}, ${kind}${selected ? ', selected' : ''}. Activate to inspect.`,
    /** Announced when a node is selected and focus moves to the inspector (WCAG 2.4.3). */
    nodeSelected: (name: string): string => `Selected ${name}. Inspector panel opened.`,
    /**
     * Announced when the inspector panel closes (WCAG 4.1.3). The panel
     * slides away silently, so without this the only feedback a
     * screen-reader user gets is focus landing back on the map.
     */
    nodeDeselected: 'Inspector panel closed. Back to the map.',
    /**
     * Accessible name for the inspector panel resize separator (WCAG 2.1.1).
     * `aria-valuenow`/min/max carry the numeric width; the label names
     * the control and hints the arrow-key operation.
     */
    resizeSeparator: 'Resize the inspector panel. Use the left and right arrow keys.',
    /** Announced on the Live lens transitions (WCAG 4.1.3): the canvas
     *  swaps wholesale, which is invisible to a screen-reader user. */
    lensEntered: 'Live lens on. The map shows only executing and recent nodes.',
    lensExited: 'Live lens off. Your map is back as it was.',
    replayEntered: 'Replay on. The lens plays back the recorded session.',
    replayExited: 'Replay off. The lens is live again.',
  },
  /**
   * Live lens empty-state overlay (the lens is on with nothing live).
   * The hook branch fires only on a confirmed not-installed probe
   * (`ActivityReadinessService.hookInstalled === false`, fails open on
   * null): without the hook no activity frame can ever arrive, so
   * "waiting" would be a lie.
   */
  lens: {
    /** Broadcast-style corner badge while the lens is on. */
    liveBadge: 'LIVE',
    /** Badge variant while the lens replays the recorded tape. */
    replayBadge: 'REPLAY',
    emptyWaiting: 'Waiting for activity',
    emptyWaitingHint: 'Nodes appear here while your AI runtime executes them.',
    emptyHookMissing: 'The activity hook is not installed',
    emptyHookMissingHint: 'Install it from Settings so executions can light up the lens.',
  },
  toolbar: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitToScreen: 'Fit to screen',
    /**
     * "Follow the Activity" camera toggle (spec/provider-activity.md
     * lighting, camera side). Only rendered while Real Time is on; a
     * manual pan / zoom switches it back off (log-viewer follow
     * semantics), hence the on/off tooltip pair.
     */
    followActivity: {
      tooltipOn: 'Stop following the activity',
      tooltipOff: 'Follow the activity (camera and focus)',
      ariaOn: 'Stop following the activity',
      ariaOff: 'Follow the activity (camera and focus)',
    },
    resetLayoutLabel: 'Re-arrange layout',
    resetLayoutTooltip: 'Re-arrange the visible nodes',
    /**
     * Inline graph-layout popovers anchored to the bottom toolbar.
     * The popovers are the only surface that exposes these knobs,
     * Settings → General used to mirror them but was retired once
     * the toolbar shipped (the user can live-tinker without opening
     * a modal). Labels here drive both the button `aria-label` /
     * tooltip and the popover items.
     */
    layoutAlgorithmLabel: 'Layout algorithm',
    layoutAlgorithmTooltip: 'Layout algorithm',
    layoutDirectionLabel: 'Layout direction',
    layoutDirectionTooltip: 'Layout direction',
    /**
     * Two layouts own their own axes and ignore the direction knob
     * (Organic has no layers at all, Folders always runs root-left to
     * depth-right), so the wording names the remaining choices rather
     * than the algorithm it is refusing.
     */
    layoutDirectionUnavailableTooltip:
      'Direction does not apply to this layout. Switch to Balanced or Stretched to set it.',
    layoutSpacingLabel: 'Layout spacing',
    layoutSpacingTooltip: 'Layout spacing',
    layoutSpacingUnavailableTooltip:
      'Spacing does not apply to the Organic layout. Switch to Balanced or Stretched to set it.',
    /**
     * Connector style popover, migrated from `Settings → General` so
     * the operator can switch connector shapes live without opening a
     * modal. Mirrors the layout-direction / layout-spacing pattern:
     * one toolbar button + an icon-row popover.
     */
    connectionTypeLabel: 'Connector style',
    connectionTypeTooltip: 'Connector style',
  },
  /**
   * Per-option labels for the three layout popovers. Same shape the
   * Settings modal used before the toolbar took over, kept verbatim
   * so the migration in `graph-view.ts` was a one-line import swap
   * (`SETTINGS_TEXTS.general.layoutAlgorithm.options` →
   * `GRAPH_VIEW_TEXTS.layout.algorithm.options`).
   */
  layout: {
    algorithm: {
      options: {
        'network-simplex': { label: 'Balanced' },
        'longest-path': { label: 'Stretched' },
        force: { label: 'Organic' },
        filesystem: { label: 'Folder (realistic)' },
        'filesystem-compact': { label: 'Folder (compact)' },
      },
    },
    direction: {
      options: {
        TOP_BOTTOM: { label: 'Top to bottom' },
        BOTTOM_TOP: { label: 'Bottom to top' },
        LEFT_RIGHT: { label: 'Left to right' },
        RIGHT_LEFT: { label: 'Right to left' },
      },
    },
    spacing: {
      options: {
        compact: { label: 'Compact' },
        normal: { label: 'Normal' },
        spacious: { label: 'Spacious' },
      },
    },
    connection: {
      options: {
        segment: { label: 'Orthogonal' },
        straight: { label: 'Straight' },
        'adaptive-curve': { label: 'Adaptive curve' },
      },
    },
  },
  panel: {
    resizeLabel: 'Resize panel',
  },
  /**
   * Ephemeral spawn edges + session anchors (live agent spawns,
   * spec/provider-activity.md). The edge is clickable: it opens the
   * conversation dialog for that spawn.
   */
  spawnEdge: {
    aria: 'Open the conversation for this agent spawn',
  },
  /**
   * Transient tool-invocation edge (spec/provider-activity.md §WS event:
   * node.activity, the `detail` field): caller -> mcp target, the
   * invoked tool as the label. Visual-only (not clickable), so the aria
   * text just names the running tool.
   */
  invocationEdge: {
    aria: (tool: string): string => `Running tool ${tool}`,
  },
  /**
   * Edge conversation-count pill (spec/provider-activity.md §Execution
   * stats, per-pair spawn counters). Shown on any edge whose pair has
   * counted spawns; clicking the edge opens the threaded conversation
   * dialog. The label doubles as tooltip and aria text.
   */
  convoCount: {
    label: (n: number): string =>
      n === 1
        ? '1 conversation passed through this edge'
        : `${n} conversations passed through this edge`,
  },
  resetLayoutConfirm: {
    header: 'Re-arrange layout?',
    // Full reset (the whole graph is visible): replaces every saved position.
    message: 'This replaces every saved node position with a fresh automatic layout.',
    // Scoped reset (a curated / filtered subset is visible): re-lays out only
    // the visible nodes and replaces their positions.
    messageVisible: 'This re-arranges the visible nodes and replaces their saved positions.',
    accept: 'Re-arrange',
    reject: 'Cancel',
  },
} as const;
