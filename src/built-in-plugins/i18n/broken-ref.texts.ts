/**
 * User-facing strings emitted by the `broken-ref` built-in rule
 * (`built-in-plugins/rules/broken-ref/index.ts`). Issue messages land
 * in `scan_issues.message` and surface through `sm check` / `sm show` /
 * `sm export`, so the same i18n discipline as the CLI catalogs applies.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const BROKEN_REF_TEXTS = {
  /** `Broken <kind> reference from <source> → <target>` */
  message: 'Broken {{kind}} reference from {{source}} → {{target}}',
} as const;
