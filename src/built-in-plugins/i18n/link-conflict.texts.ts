/**
 * User-facing strings emitted by the `link-conflict` built-in rule
 * (`built-in-plugins/rules/link-conflict/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const LINK_CONFLICT_TEXTS = {
  /** `Detectors disagree on link kind for <source> → <target> (<kindList>)` */
  message: 'Detectors disagree on link kind for {{source}} → {{target}} ({{kindList}})',
} as const;
