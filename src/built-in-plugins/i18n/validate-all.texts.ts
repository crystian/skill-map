/**
 * User-facing strings emitted by the `validate-all` built-in rule
 * (`built-in-plugins/rules/validate-all/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const VALIDATE_ALL_TEXTS = {
  /** `Node <path> failed schema validation: <errors>` */
  nodeFailure: 'Node {{path}} failed schema validation: {{errors}}',

  /** `Link <source> → <target> failed schema validation: <errors>` */
  linkFailure: 'Link {{source}} → {{target}} failed schema validation: {{errors}}',
} as const;
