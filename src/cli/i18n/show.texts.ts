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
