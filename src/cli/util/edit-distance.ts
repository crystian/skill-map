/**
 * Bounded Levenshtein distance + closest-N picker. Used by:
 *   - parse-error.ts → "Did you mean <verb>?" on unknown command typos.
 *   - commands/config.ts → "Did you mean <key>?" on unknown config key.
 *
 * Both call sites need the same shape: cap the distance for early exit
 * (we don't care about exact distances, only "is this within N edits"),
 * then pick the top-K candidates ranked by distance then alphabetically
 * for stable output.
 */

/**
 * Bounded Levenshtein. Returns the exact distance when it is `<= max`,
 * otherwise returns `max + 1` as the sentinel (caller can treat anything
 * above the cap as "too far"). Capping makes the cost O(n*m) for short
 * strings effectively free — well-suited to short identifiers like CLI
 * verbs and dot-paths.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    const rowMin = fillEditRow({ a, b, i, prev, curr });
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Compute one row of the Levenshtein matrix in-place into `curr` from
 * the preceding row `prev`. Returns the row's minimum cell so the
 * caller can early-exit when every entry already exceeds the cap.
 */
function fillEditRow(args: {
  a: string;
  b: string;
  i: number;
  prev: number[];
  curr: number[];
}): number {
  const { a, b, i, prev, curr } = args;
  curr[0] = i;
  let rowMin = curr[0]!;
  for (let j = 1; j < curr.length; j++) {
    const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
    const value = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    curr[j] = value;
    if (value < rowMin) rowMin = value;
  }
  return rowMin;
}

/**
 * Pick up to `topN` closest candidates to `target`, capped at `maxDistance`
 * edits. Ties broken alphabetically for stable output.
 */
export function closestMatches(
  target: string,
  candidates: readonly string[],
  options: { topN: number; maxDistance: number },
): string[] {
  const lcTarget = target.toLowerCase();
  const ranked: Array<{ value: string; distance: number }> = [];
  for (const c of candidates) {
    const distance = editDistance(lcTarget, c.toLowerCase(), options.maxDistance);
    if (distance <= options.maxDistance) ranked.push({ value: c, distance });
  }
  ranked.sort((a, b) => a.distance - b.distance || a.value.localeCompare(b.value));
  return ranked.slice(0, options.topN).map((r) => r.value);
}
