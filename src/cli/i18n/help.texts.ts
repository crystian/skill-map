/**
 * Strings emitted by `cli/commands/help.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Markdown structural pieces (code-fence backticks `\`\`\``, leading
 * pipes, blockquote markers) stay inline in the renderer — they are
 * markdown syntax, not user-facing prose. Everything that a translator
 * would touch (headings, labels, the "Generated from..." notice, the
 * version-line copy) lives here.
 */

export const HELP_TEXTS = {
  // --- format / verb validation --------------------------------------------
  invalidFormat: '--format expects one of: human | md | json. Got: {{format}}\n',
  unknownVerb: 'Unknown verb: {{verb}}\n',

  // --- markdown header -----------------------------------------------------
  mdReferenceTitle: '# `sm` CLI reference',
  mdGeneratedNotice:
    'Generated from `sm help --format md`. Do not hand-edit; CI regenerates this file from the live command surface.',
  mdCliVersionLine: '- CLI version: `{{version}}`',
  mdSpecVersionLine: '- Spec version: `{{version}}`',

  // --- global flags section ------------------------------------------------
  mdHeaderGlobalFlags: '## Global flags',
  mdGlobalFlagBullet: '- `{{name}}` — {{description}}',

  // --- per-category / per-verb (md) ----------------------------------------
  mdCategoryHeading: '## {{category}}',
  mdVerbHeading: '### `sm {{name}}`',
  mdLabelFlags: '**Flags:**',
  mdLabelExamples: '**Examples:**',
  mdFlagBullet: '- {{names}} `{{type}}`{{required}}{{description}}',
  /** Trailing fragment for `mdFlagBullet`'s `{{required}}` slot. */
  mdFlagBulletRequiredFragment: ' (required)',
  /** Trailing fragment for `mdFlagBullet`'s `{{description}}` slot (with leading em-dash). */
  mdFlagBulletDescriptionFragment: ' — {{description}}',
  mdExampleBullet: '- {{title}}',

  // --- human single-verb renderer ------------------------------------------
  humanVerbHeader: 'sm {{name}} — {{description}}',
  humanLabelFlags: 'Flags:',
  humanFlagRow: '  {{names}}{{required}} — {{description}}',
  /** Trailing fragment for `humanFlagRow`'s `{{required}}` slot. */
  humanFlagRowRequiredFragment: ' (required)',
} as const;
