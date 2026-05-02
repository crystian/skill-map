/**
 * Shared option-value validators for CLI verbs.
 *
 * Two near-duplicate "must be a positive integer" checks lived inline
 * in `sm list` (`--limit`) and `sm history` (`--limit`, `--top`), each
 * with its own i18n catalog entry. Consolidating here keeps the
 * acceptance rules in lock-step (a permissive `Number.parseInt` parse
 * accepts `'12abc'` as `12` — every call site needs the same defensive
 * checks against trim + signed input + non-integer).
 *
 * The helpers stay close to the call site (a CLI-style "validate +
 * write to stderr + return null" pattern) rather than throwing because
 * Clipanion's `Option.String({ validator: ... })` cascades reject
 * before the verb's `execute` runs, which collides with the existing
 * shape of these flags (they are read inside `execute()` and only
 * validated when the user passed them).
 */

import { tx } from '../../kernel/util/tx.js';
import { OPTION_VALIDATORS_TEXTS } from '../i18n/option-validators.texts.js';

/**
 * Parse `raw` as a strict positive integer (`>= 1`). Writes a
 * scoped-by-`label` error line to `stderr` on rejection and returns
 * `null` so the caller can short-circuit to the appropriate exit
 * code (typically `ExitCode.Error`).
 *
 * Accepts: `'1'`, `'42'`, `'  100  '` (leading/trailing whitespace
 * trimmed for symmetry with the pre-consolidation behaviour).
 *
 * Rejects: `''`, `'0'`, `'-3'`, `'1.5'`, `'12abc'`, `'NaN'`, `'inf'`.
 */
export function parsePositiveIntegerOption(
  raw: string,
  label: string,
  stderr: NodeJS.WritableStream,
): number | null {
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  // Every leg below is one of the failure modes the inline validators
  // were already catching:
  //   - `Number.isInteger`     rejects NaN / Infinity / floats.
  //   - `parsed <= 0`          rejects zero and negatives.
  //   - `String(parsed) !== trimmed`  rejects `'12abc'`-style trailing
  //                            garbage that `parseInt` happily eats.
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
    stderr.write(
      tx(OPTION_VALIDATORS_TEXTS.notPositiveInt, { label, value: raw }),
    );
    return null;
  }
  return parsed;
}
