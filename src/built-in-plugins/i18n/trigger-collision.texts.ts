/**
 * User-facing strings emitted by the `trigger-collision` built-in rule
 * (`built-in-plugins/rules/trigger-collision/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const TRIGGER_COLLISION_TEXTS = {
  /** Top-level issue message wrapping all the per-cause `parts`. */
  message: 'Trigger "{{normalized}}" has {{parts}}.',

  /** `<n> nodes advertise it: <list>` part — fires on the advertiser-ambiguous branch. */
  partAdvertisers: '{{count}} nodes advertise it: {{paths}}',

  /** `<n> distinct invocation forms: <list>` part — fires on the invocation-ambiguous branch. */
  partInvocations: '{{count}} distinct invocation forms: {{forms}}',

  /** Singular cross-kind cause: `non-canonical invocation <form> against advertiser <path>`. */
  partNonCanonicalSingular: 'non-canonical invocation {{forms}} against advertiser {{advertiser}}',

  /** Plural cross-kind cause: `non-canonical invocations <forms> against advertiser <path>`. */
  partNonCanonicalPlural: 'non-canonical invocations {{forms}} against advertiser {{advertiser}}',

  /** Joiner between accumulated parts inside `message`. */
  partsJoiner: '; and ',
} as const;
