/**
 * Strings emitted by `cli/commands/show.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SHOW_TEXTS = {
  nodeNotFound: 'Node not found: {{nodePath}}\n',

  // --- renderHuman labels ------------------------------------------------
  sectionFrontmatter: 'Frontmatter:',
  sectionLinksOut: 'Links out',
  sectionLinksIn: 'Links in',
  sectionIssues: 'Issues',
  placeholderNone: '  (none)',
  sectionHeader: '{{label}} ({{count}}, {{unique}} unique):',
  issuesHeader: 'Issues ({{count}}):',
  issueRow: '  - [{{severity}}] {{ruleId}}: {{message}}',

  // --- formatGroupedLink ------------------------------------------------
  /**
   * Bullet line for one grouped link in the in/out lists. `{{kind}}` and
   * `{{endpoint}}` are pre-sanitized by the caller; `{{dup}}` is the
   * `(×N)` count when the row collapses multiple identical edges, empty
   * otherwise; `{{sources}}` is the trailing `  sources: a, b` segment
   * (empty when the link has no sources).
   */
  groupedLinkHead:
    '  - [{{kind}}/{{confidence}}] {{arrow}} {{endpoint}}{{dup}}{{sources}}',
  groupedLinkDup: ' (×{{count}})',
  groupedLinkSources: '  sources: {{values}}',

  // --- renderNodeHeader labels ------------------------------------------
  nodeIdentity: '{{path}} [{{kind}}] (provider: {{provider}})',
  nodeFieldTitle: 'title:        {{value}}',
  nodeFieldDescription: 'description:  {{value}}',
  nodeFieldStability: 'stability:    {{value}}',
  nodeFieldVersion: 'version:      {{value}}',
  nodeFieldAuthor: 'author:       {{value}}',
  nodeWeight: 'Weight: bytes {{total}} total / {{frontmatter}} frontmatter / {{body}} body',
  nodeTokens: '        tokens {{total}} total / {{frontmatter}} frontmatter / {{body}} body',
  nodeExternalRefs: 'External refs: {{count}}',
} as const;
