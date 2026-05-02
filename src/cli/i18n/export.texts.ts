/**
 * Strings emitted by `cli/commands/export.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const EXPORT_TEXTS = {
  errorPrefix: 'sm export: {{message}}\n',

  formatNotImplemented: 'format={{format}} not yet implemented ({{reason}}).\n',
  formatUnsupported:
    'Unsupported format: {{format}}. Supported: {{supported}}. Deferred: {{deferred}}.\n',

  /**
   * Reason emitted by `formatNotImplemented` when the user asks for
   * `--format mermaid`. Pre-1.0 placeholder until the formatter lands as
   * a built-in.
   */
  formatDeferredReasonMermaid: 'lands at Step 12 with the mermaid formatter',

  // --- markdown body ---------------------------------------------------------
  /** Top-level heading for the markdown export. */
  mdTitle: '# skill-map export',
  /** Echo of the user's query string (or the empty placeholder). */
  mdQueryLine: 'Query: `{{query}}`',
  /** Placeholder used when the user's query is empty. */
  mdQueryEmpty: '(empty — all nodes)',
  /** Counts summary line under the query. */
  mdCounts:
    'Counts: {{nodes}} nodes, {{links}} links, {{issues}} issues.',

  /** Section header for a single node-kind group. */
  mdKindSectionHeader: '## {{kind}} ({{count}})',

  /** Bullet template for a node row. `{{title}}` and `{{issues}}` are pre-rendered (empty when absent). */
  mdNodeBullet: '- `{{path}}`{{title}}{{issues}}',
  /** ` — "<title>"` segment when the node has a title. */
  mdNodeTitleSuffix: ' — "{{title}}"',
  /** ` — N issue(s)` segment when the node has any associated issues. */
  mdNodeIssueSuffix: ' — {{count}} {{label}}',
  mdNodeIssueLabelSingular: 'issue',
  mdNodeIssueLabelPlural: 'issues',

  /** Section header for the links block. */
  mdLinksSectionHeader: '## links ({{count}})',
  /** Bullet template for one link row. */
  mdLinkBullet:
    '- `{{source}}` --{{kind}}--> `{{target}}` _[{{confidence}}]_',

  /** Section header for the issues block. */
  mdIssuesSectionHeader: '## issues ({{count}})',
  /** Bullet template for one issue row. */
  mdIssueBullet:
    '- **[{{severity}}]** `{{ruleId}}`: {{message}}',
} as const;
