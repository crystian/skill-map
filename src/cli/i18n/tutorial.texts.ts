/**
 * CLI strings emitted by `sm tutorial` — `cli/commands/tutorial.ts`.
 *
 * Paired with the `sm-tutorial` Claude Code skill. The success line
 * nudges the tester to open Claude Code in the cwd and trigger the
 * skill by referencing the materialized file with `@sm-tutorial.md`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const TUTORIAL_TEXTS = {
  // Success — written to stdout after `<cwd>/sm-tutorial.md` is created.
  written:
    'Done. sm-tutorial.md created at {{cwd}}. ' +
    'Open Claude Code here and tell it "run @sm-tutorial.md" to start the interactive tutorial.\n',

  // Refusal — `sm-tutorial.md` already exists and `--force` was not set.
  // Goes to stderr, exit code 2 (operational error per spec § Exit codes).
  alreadyExists:
    'sm tutorial: sm-tutorial.md already exists at {{cwd}}. Pass `--force` to overwrite.\n',

  // I/O failure on write or on reading the bundled SKILL source.
  writeFailed: 'sm tutorial: failed to write sm-tutorial.md: {{message}}\n',
  sourceMissing:
    'sm tutorial: could not read the bundled tutorial (SKILL.md) from the install. ' +
    'Reinstall @skill-map/cli or report the bug.\n',
} as const;
