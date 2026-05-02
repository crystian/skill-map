/**
 * Strings emitted by cross-cutting CLI utilities under `cli/util/*`
 * (db-path, elapsed, confirm). Same convention as the per-verb catalogs:
 * flat string templates with `{{name}}` placeholders for `tx(...)`.
 */

export const UTIL_TEXTS = {
  // db-path.ts
  dbNotFound: 'DB not found at {{path}}; run `sm scan` first.\n',

  // elapsed.ts
  doneIn: 'done in {{elapsed}}\n',

  // confirm.ts (default-no prompt suffix)
  confirmPromptSuffix: ' [y/N] ',
  /**
   * Regex source matching affirmative answers in `confirm()`. Compiled
   * with the `i` flag in the helper. Pre-i18n today the pattern is
   * English-only; when a non-English locale lands the catalog grows
   * alternations (e.g. `^(y(es)?|s(í|i)?)$`).
   */
  confirmYesPatternSource: '^y(es)?$',
} as const;
