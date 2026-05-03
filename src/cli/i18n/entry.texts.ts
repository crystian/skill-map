/**
 * Strings emitted from the CLI entry point — outside any single verb.
 * Today this covers the bare-invocation hint when the cwd has no
 * `.skill-map/` project initialized.
 */

export const ENTRY_TEXTS = {
  bareNoProject:
    'No skill-map project found in {{cwd}}.\n' +
    'Run "sm init" to bootstrap one, or "sm --help" to see all commands.\n',
} as const;
