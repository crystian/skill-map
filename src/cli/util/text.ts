/**
 * Small text helpers shared by table renderers in `cli/commands/*`.
 *
 * The kernel-side string sanitisers (`stripAnsi`, `sanitizeForTerminal`)
 * live in `kernel/util/safe-text.ts`; this module hosts the
 * presentation-only helpers that the CLI uses on top of them.
 */

/**
 * Truncate `s` to at most `max` user-perceived characters, appending an
 * ellipsis (`…`) when the input was longer. UTF-8 safe: splits on the
 * code-point boundary (via `Array.from`), so a multi-byte rune cannot
 * be cut in half — protects table renderers from emitting half-bytes
 * that a terminal then renders as `?` / mojibake.
 *
 * The single-character `…` is intentional: it visually announces the
 * truncation while keeping the column width predictable. Callers that
 * need a different ellipsis style should compose their own helper.
 */
export function truncateHead(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join('') + '…';
}

/**
 * Same as `truncateHead` but preserves the END of the string instead
 * of the start. Used by `sm list` to keep the file basename visible
 * when the directory prefix is long (e.g. `…ents/very/long/foo.md`).
 */
export function truncateTail(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return '…' + chars.slice(chars.length - max + 1).join('');
}
