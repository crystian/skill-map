/**
 * User-facing strings emitted by the `superseded` built-in rule
 * (`built-in-plugins/rules/superseded/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SUPERSEDED_TEXTS = {
  /** `<path> is superseded by <supersededBy>` */
  message: '{{path}} is superseded by {{supersededBy}}',
} as const;
