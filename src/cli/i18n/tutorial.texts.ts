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
  // Multi-line layout: the two trigger phrases (English / Spanish) are
  // indented and labelled so they're the most visible part of the
  // output. The reminder above them surfaces the SKILL's language
  // policy: the first message the tester writes to Claude sets the
  // tutorial language for the rest of the session.
  written:
    'Done. sm-tutorial.md created at {{cwd}}\n' +
    '\n' +
    'Open Claude Code here. Write to it in the language you want the ' +
    'tutorial in — the first message sets the language for the rest ' +
    'of the session:\n' +
    '\n' +
    '    English:  run @sm-tutorial.md\n' +
    '    Español:  ejecutá @sm-tutorial.md\n',

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
