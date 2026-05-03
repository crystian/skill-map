/**
 * Strings emitted from the CLI entry point — outside any single verb.
 * Covers the bare-invocation hint when the cwd has no `.skill-map/`
 * project, and the concise diagnostic for argv parse errors that
 * replaces Clipanion's full-catalog dump.
 */

export const ENTRY_TEXTS = {
  bareNoProject:
    'No skill-map project found in {{cwd}}.\n' +
    'Run "sm init" to bootstrap one, or "sm --help" to see all commands.\n',

  parseErrorHeadline: 'sm: {{message}}',
  parseErrorUnknownOption: 'unknown option \'{{name}}\'',
  parseErrorUnknownOptionForVerb: '{{verb}}: unknown option \'{{name}}\'',
  parseErrorUnknownCommand: 'unknown command \'{{name}}\'',
  parseErrorIncompleteCommand: 'incomplete command \'{{name}}\'',
  parseErrorSubcommandList: 'Available subcommands: {{suggestions}}.',
  parseErrorVerbUsage: '{{verb}}: {{message}}',
  parseErrorMissingPositional: '{{verb}}: missing required positional argument(s) {{positionals}}',
  parseErrorFlagSuggestion: 'Did you mean \'{{suggestion}}\'?',
  parseErrorVerbSuggestion: 'Did you mean {{suggestions}}?',
  parseErrorVerbHelpHint: 'Run \'sm help {{verb}}\' for usage.',
  parseErrorFooter: 'Run \'sm help\' to see the full command list.',
} as const;
