/**
 * Selection-view bundles shared between the graph view, which computes
 * them (see `app/views/graph-view/selection-state.ts`), and the
 * components that render them (`<sm-node-card>` mounts in the graph,
 * the files view, and prototype harnesses). They live in `models/` so
 * shared components never import from a feature view's internals.
 */

/**
 * Per-node selection state. Four booleans rolled into one record so a
 * Map lookup in the template hands the card host its full selection
 * picture in one shot (instead of N x 4 function calls per CD pass).
 *
 * The focus is graded by hop distance from its origin (the selected
 * node, or every executing node while the activity focus applies, see
 * `selection-state.ts`): hop 1 is `highlighted` (selection only), hop
 * 2 is `dimmed` (the near ring, a light fade), hop 3 and beyond (or
 * unreachable) is `dimmed` + `far` (deep fade plus desaturation), so
 * the map falls off around the focus like depth of field instead of
 * cutting to a flat two-tone.
 */
export interface ISelectionView {
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly dimmed: boolean;
  readonly far: boolean;
}

/**
 * Per-edge selection state. Same shape rationale as `ISelectionView`:
 * one Map lookup hands the `<f-connection>` its full picture per CD
 * pass. `opacity` folds the confidence gradient and the dim override
 * into a single value, so the template binds it directly (inline styles
 * win over the `.f-conn--dimmed` class rule, this is the source of truth).
 */
export interface IEdgeSelectionView {
  readonly highlighted: boolean;
  readonly dimmed: boolean;
  /** Beyond the near ring (same grading as the node `far`). */
  readonly far: boolean;
  readonly opacity: number;
}
