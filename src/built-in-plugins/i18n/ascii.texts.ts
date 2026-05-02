/**
 * User-facing strings emitted by the `ascii` built-in formatter
 * (`built-in-plugins/formatters/ascii/index.ts`). Produces the
 * `sm graph --format ascii` output.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ASCII_FORMATTER_TEXTS = {
  /** Header line: `skill-map graph — N nodes, M links, K issues`. */
  header: 'skill-map graph — {{nodes}} nodes, {{links}} links, {{issues}} issues',

  /** Per-node-kind section header: `## <kind> (<count>)`. */
  kindSectionHeader: '## {{kind}} ({{count}})',

  /** Plain node bullet: `- <path>`. */
  nodeBullet: '- {{path}}',

  /** Node bullet with title suffix: `- <path> — "<title>"`. */
  nodeBulletWithTitle: '- {{path}} — "{{title}}"',

  /** `## links (<count>)` section header. */
  linksSectionHeader: '## links ({{count}})',

  /** Link bullet: `- <source> --<kind>--> <target>  [<confidence>]`. */
  linkBullet: '- {{source}} --{{kind}}--> {{target}}  [{{confidence}}]',

  /** `## issues (<count>)` section header. */
  issuesSectionHeader: '## issues ({{count}})',

  /** Issue bullet: `- [<severity>] <ruleId>: <message>`. */
  issueBullet: '- [{{severity}}] {{ruleId}}: {{message}}',
} as const;
