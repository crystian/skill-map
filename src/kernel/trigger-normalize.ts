/**
 * Normative trigger normalisation pipeline. Shared utility used by every
 * extractor that emits invocation-style links (slash, at-directive,
 * command-name) and by the `trigger-collision` rule that keys on the
 * result.
 *
 * Defined by `spec/architecture.md` §Extractor · trigger normalization:
 *
 *   1. Unicode NFD (canonical decomposition).
 *   2. Strip diacritics (every code point in category Mn / Nonspacing_Mark).
 *   3. Locale-independent lowercase.
 *   4. Separator unification: hyphen, underscore, and any whitespace → ASCII space.
 *   5. Collapse runs of whitespace to a single space.
 *   6. Trim.
 *
 * Non-separator, non-alphanumeric characters (e.g. /, @, :, .) are
 * PRESERVED — stripping them is the extractor's concern, not the
 * normalizer's. This keeps `/ns:verb` and `@scope/foo` comparable in
 * their intended form.
 */

export function normalizeTrigger(source: string): string {
  // Step 1: NFD.
  let out = source.normalize('NFD');
  // Step 2: strip Mn (diacritics). \p{Mn} with the `u` flag matches
  // Nonspacing_Mark across the full Unicode range.
  out = out.replace(/\p{Mn}+/gu, '');
  // Step 3: locale-independent lowercase. String#toLowerCase in JS is
  // already locale-independent by default (unlike toLocaleLowerCase).
  out = out.toLowerCase();
  // Step 4: separator unification. Hyphen, underscore, or any whitespace
  // character becomes a single ASCII space. We use \s (any whitespace),
  // which covers tab, newline, NBSP, and other Unicode spaces.
  out = out.replace(/[-_\s]+/g, ' ');
  // Step 5: runs of ≥ 2 spaces collapse to one. Step 4 already collapsed
  // runs of whitespace-equivalents; this handles stray multi-space input
  // that somehow survived (e.g. a unicode space followed by an ASCII one
  // that would each map independently).
  out = out.replace(/  +/g, ' ');
  // Step 6: trim.
  return out.trim();
}
