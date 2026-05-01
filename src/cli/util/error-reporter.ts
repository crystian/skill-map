/**
 * Tiny helpers for the recurring `catch (err) { const message = ... }`
 * dance. Every CLI command writes the same shape:
 *
 *   try { ... }
 *   catch (err) {
 *     const message = err instanceof Error ? err.message : String(err);
 *     this.context.stderr.write(tx(<VERB>_TEXTS.failed, { message }));
 *     return ExitCode.Error;
 *   }
 *
 * Twenty-plus duplicates of the same `instanceof Error ? ... : String(...)`
 * line drift over time (one site adds a stack-trace branch, another
 * doesn't) — the kind of inconsistency the L3 review flagged. Routing
 * through `formatErrorMessage` collapses the variance without forcing
 * every handler through a heavier reporter API.
 *
 * The surface is intentionally small — adding a `--verbose` stack
 * mode, a JSON envelope, or a sentinel-based exit code is the right
 * job for this module if those needs surface; today they don't.
 */

/**
 * Compact error → string conversion.
 *
 * - `Error` → `err.message` verbatim. The caller is responsible for
 *   wrapping with a verb-specific context line via `tx(*_TEXTS.x,
 *   { message })`; we don't add one here so error catalogues stay
 *   greppable.
 * - Anything else → `String(value)`. Catches the rare throw-a-string
 *   / throw-an-object path without exploding on `null` (`String(null)`
 *   = `'null'`).
 */
export function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
