/**
 * CLI strings emitted by `sm graph` (`cli/commands/graph.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const GRAPH_TEXTS = {
  noFormatterRegistered:
    'No formatter registered for format={{format}}. Available: {{available}}.\n',

  availableNone: '(none)',
} as const;
