import type { TNodeKind } from '../models/node';

/**
 * User-facing labels for `TNodeKind`. Plural form because the labels are
 * used as group identifiers (filter-bar dropdown options, kind-palette
 * toggle tooltips) — "Skills", "Agents", … reads as "the {plural} filter
 * is active". Shared across components that surface kind names.
 */
export const KIND_LABELS: Readonly<Record<TNodeKind, string>> = {
  skill: 'Skills',
  agent: 'Agents',
  command: 'Commands',
  hook: 'Hooks',
  note: 'Notes',
};
