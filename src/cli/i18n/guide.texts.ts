/**
 * CLI strings emitted by `sm guide` — `cli/commands/guide.ts`.
 *
 * Paired with the `sm-guide` Claude Code skill. The success line
 * nudges the tester to open Claude Code in the cwd and trigger the
 * skill by referencing the materialized file with `@sm-guide.md`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const GUIDE_TEXTS = {
  // Success — written to stdout after `<cwd>/sm-guide.md` is created.
  written:
    'Done. sm-guide.md created at {{cwd}}. ' +
    'Open Claude Code here and tell it "run @sm-guide.md" to start the interactive guide.\n',

  // Refusal — `sm-guide.md` already exists and `--force` was not set.
  // Goes to stderr, exit code 2 (operational error per spec § Exit codes).
  alreadyExists:
    'sm guide: sm-guide.md already exists at {{cwd}}. Pass `--force` to overwrite.\n',

  // I/O failure on write or on reading the bundled SKILL source.
  writeFailed: 'sm guide: failed to write sm-guide.md: {{message}}\n',
  sourceMissing:
    'sm guide: could not read the bundled guide (SKILL.md) from the install. ' +
    'Reinstall @skill-map/cli or report the bug.\n',
} as const;
