/**
 * Strings emitted by `cli/commands/help.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const HELP_TEXTS = {
  invalidFormat: '--format expects one of: human | md | json. Got: {{format}}\n',
  unknownVerb: 'Unknown verb: {{verb}}\n',
} as const;
