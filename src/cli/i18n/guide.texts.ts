/**
 * CLI strings emitted by `sm guide` — `cli/commands/guide.ts`.
 *
 * Spanish-leaning copy: this verb is paired with the `sm-guide` Claude
 * Code skill, which is itself authored in Spanish for the tester
 * audience. The success line nudges the tester to open Claude Code in
 * the cwd and trigger the skill ("guíame"). Other verbs in this CLI
 * remain English; the localization here is intentional and verb-scoped.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const GUIDE_TEXTS = {
  // Success — written to stdout after `<cwd>/sm-guide.md` is created.
  written:
    'Listo. sm-guide.md creado en {{cwd}}. ' +
    'Abrí Claude Code acá y decile "guíame" para arrancar la guía interactiva.\n',

  // Refusal — `sm-guide.md` already exists and `--force` was not set.
  // Goes to stderr, exit code 2 (operational error per spec § Exit codes).
  alreadyExists:
    'sm guide: sm-guide.md ya existe en {{cwd}}. Usá `--force` para sobrescribir.\n',

  // I/O failure on write or on reading the bundled SKILL source.
  writeFailed: 'sm guide: no se pudo escribir sm-guide.md: {{message}}\n',
  sourceMissing:
    'sm guide: no se pudo leer la guía empaquetada (SKILL.md) desde la instalación. ' +
    'Reinstalá @skill-map/cli o reportá el bug.\n',
} as const;
