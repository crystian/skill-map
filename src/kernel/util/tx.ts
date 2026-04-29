/**
 * `tx(template, vars)` — string interpolation for the project's text
 * tables (`*.texts.ts` files under `kernel/i18n/` and `cli/i18n/`).
 *
 * Templates use the `{{name}}` placeholder shape (Mustache / Handlebars
 * / Transloco compatible) so the same string tables drop into a real
 * i18n library on the day this project migrates.
 *
 * Contract:
 *   - Every `{{name}}` token in `template` MUST have a matching key in
 *     `vars`. A missing key throws — silent fallback would hide a
 *     forgotten arg in a production build, which is the worst kind of
 *     bug to chase down.
 *   - Values can be `string | number`. `null` / `undefined` keys are
 *     rejected; the caller is expected to coerce upstream (e.g. format
 *     a missing path as `'(unknown)'` before passing).
 *   - Whitespace inside the braces is tolerated (`{{ name }}`); the
 *     parser strips it. This keeps long templates readable when wrapped
 *     across multiple TS lines via `+`.
 *   - Literal `{{` is not currently supported — no real text needs it.
 *     Add escaping the day a template needs to render Handlebars-style
 *     content.
 *
 * Plural / conditional logic does NOT live in the template. The caller
 * picks the correct template (e.g. `entries_singular` vs
 * `entries_plural`) or composes the variable value upstream and passes
 * the finished string. Keeping templates flat is the price for staying
 * Transloco-ready.
 */

const TOKEN_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

export function tx(
  template: string,
  vars: Record<string, string | number> = {},
): string {
  return template.replace(TOKEN_RE, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new Error(
        `tx: missing variable "${name}" for template "${template.slice(0, 80)}${template.length > 80 ? '…' : ''}"`,
      );
    }
    const value = vars[name];
    if (value === null || value === undefined) {
      throw new Error(
        `tx: variable "${name}" is null/undefined for template "${template.slice(0, 80)}${template.length > 80 ? '…' : ''}"`,
      );
    }
    return String(value);
  });
}
