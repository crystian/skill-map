/**
 * Strings emitted by the shared CLI option validators
 * (`cli/util/option-validators.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const OPTION_VALIDATORS_TEXTS = {
  /**
   * Generic "expected a positive integer" line. `{{label}}` is the
   * flag identifier the verb uses (e.g. `--limit`, `--top`). Replaces
   * the three near-duplicates that lived in
   * `LIST_TEXTS.invalidLimit`, `HISTORY_TEXTS.limitNotPositiveInt`,
   * and `HISTORY_TEXTS.topNotPositiveInt`.
   */
  notPositiveInt: '{{label}}: expected a positive integer, got "{{value}}".\n',
} as const;
