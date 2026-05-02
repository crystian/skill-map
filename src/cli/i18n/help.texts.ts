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
  /** Description copy for the `--help` global flag in the JSON / md output. */
  globalFlagHelpDescription: 'Print usage and exit.',

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
  /** Header line for `sm help <verb>` and `sm <verb> --help`. */
  humanVerbHeader: 'sm {{name}}  —  {{description}}',
  humanDescriptionHeading: 'DESCRIPTION',
  humanUsageHeading: 'USAGE',
  /**
   * Single-line USAGE row. `{{positionals}}` is the trailing portion of
   * the Clipanion path (e.g. `<orphanPath>` or `[roots...]`); empty when
   * the command takes no positionals.
   */
  humanUsageRow: '  sm {{name}} [options]{{positionals}}',
  humanFlagsHeading: 'FLAGS',
  /** Aligned flag row inside the FLAGS block; `{{padding}}` keeps the description column flush. */
  humanFlagRow: '  {{names}}{{padding}}  {{description}}{{required}}',
  /** Trailing fragment for `humanFlagRow`'s `{{required}}` slot. */
  humanFlagRowRequiredFragment: ' (required)',
  humanFooter: 'Run `sm help {{name}} --format md` for the full reference.',

  // --- human compact overview (sm / sm --help / sm help, no verb) ---------
  /**
   * Compact-overview header. Replaces the Clipanion default ANSI banner.
   * Tagline mirrors README.md "In a sentence" — keep them in sync.
   */
  compactHeader: '{{binary}} {{version}}  —  graph explorer for Markdown-based AI-agent ecosystems',
  compactUsageHeading: 'USAGE',
  compactUsageLine: '  sm <command> [options]',
  compactExamplesHeading: 'EXAMPLES',
  compactExampleInit: 'Bootstrap a project scope',
  compactExampleScanCheck: 'Scan and review issues',
  compactExampleOrphans: 'Pipe orphans to jq',
  /**
   * Marker prepended to the description column for not-yet-implemented
   * verbs (those whose registered description carries `(planned)`).
   * Trailing space is intentional — the marker is concatenated before
   * the rest of the description.
   */
  compactStubMarker: '[stub] ',
  /** Per-category section heading (uppercased from the registered category). */
  compactCategoryHeading: '{{category}}',
  /**
   * Single command row. The renderer pads `{{name}}` to the category's
   * widest verb so descriptions align in a column.
   */
  compactVerbRow: '  {{name}}{{padding}}  {{description}}',
  /** Same row shape for example rows; padding aligned across the EXAMPLES block. */
  compactExampleRow: '  {{command}}{{padding}}  {{description}}',
  compactFooter: 'Run `sm <command> --help` for flags and arguments.',
} as const;
