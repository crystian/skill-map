/**
 * Concise formatting for Clipanion parse errors.
 *
 * Clipanion's default error path dumps the full USAGE block of every
 * registered command — for a CLI with ~50 verbs this floods the screen
 * for what is almost always a typo. This module catches the parse error
 * before Clipanion writes it and emits a single-line diagnosis with at
 * most three suggestions, matching the shape users expect from
 * git / npm / cargo.
 *
 * The handler runs in `entry.ts` BEFORE `cli.run()`. Workflow:
 *   1. Pre-parse argv via `cli.process(argv, ctx)` inside try/catch.
 *   2. On `UnknownSyntaxError` / `AmbiguousSyntaxError`: format here,
 *      write to stderr, exit `ExitCode.Error` (2 — operational error
 *      per spec/cli-contract.md §Exit codes; "unknown flag" is exit 2,
 *      not 1).
 *   3. On success: continue to `cli.run(argv)` as before.
 *
 * Suggestions are best-effort. For unknown verbs, edit-distance against
 * the registered verb catalog (top 3 within distance 3). For unknown
 * flags, a few hand-coded heuristics: single-dash long form
 * (`-version` → `--version`), known global flags, and verb-scoped flag
 * suggestions if the verb prefix can be identified.
 */

import { tx } from '../../kernel/util/tx.js';
import { ENTRY_TEXTS } from '../i18n/entry.texts.js';

/**
 * Shape we match against when sniffing a thrown error. We intentionally
 * duck-type instead of `instanceof UnknownSyntaxError` so a Clipanion
 * version bump that re-exports the class from a different path can't
 * silently flip the handler off.
 */
interface IClipanionParseError extends Error {
  input: string[];
  candidates?: Array<{ usage: string; reason: string | null }>;
}

export function isClipanionParseError(err: unknown): err is IClipanionParseError {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; input?: unknown };
  if (typeof e.name !== 'string') return false;
  if (!Array.isArray(e.input)) return false;
  return e.name === 'UnknownSyntaxError' || e.name === 'AmbiguousSyntaxError';
}

export interface IFormatParseErrorParams {
  /** The original argv slice (post log-level extraction, post help routing). */
  args: string[];
  /** Registered verb paths from `registeredVerbPaths(cli)`. */
  verbPaths: string[][];
  /** The thrown Clipanion error. */
  error: IClipanionParseError;
}

/**
 * Render the concise diagnostic. Always returns a trailing newline so
 * the caller can write directly to stderr without extra formatting.
 *
 * Branch selection:
 *   - Clipanion's message starts with `Unsupported option name` →
 *     flag-level error. Extract the offending flag and (optionally)
 *     suggest the long form for single-dash typos.
 *   - First positional matches a registered verb → flag/positional
 *     error scoped to that verb. Surface Clipanion's message verbatim
 *     under the `sm <verb>:` prefix; we don't have the per-verb flag
 *     catalog needed to suggest a fix.
 *   - Otherwise → unknown verb. Suggest the closest registered verbs
 *     by edit distance.
 *
 * Exception #2 (dispatcher pattern): three short branches dispatched
 * by the same input pair (args, error.message); splitting per helper
 * would obscure the dispatch. See AGENTS.md "When eslint-disable-next-line
 * is acceptable".
 */
export function formatParseError(params: IFormatParseErrorParams): string {
  const { args, verbPaths, error } = params;
  const firstToken = args[0] ?? '';

  const offendingFlag = extractOffendingFlag(error.message);
  if (offendingFlag !== null) {
    const verbPrefix = matchedVerbPrefix(args, verbPaths);
    const suggestion = suggestFlag(offendingFlag);
    const headline = verbPrefix
      ? tx(ENTRY_TEXTS.parseErrorUnknownOptionForVerb, { verb: verbPrefix, name: offendingFlag })
      : tx(ENTRY_TEXTS.parseErrorUnknownOption, { name: offendingFlag });
    return renderError(headline, suggestion);
  }

  if (firstToken === '') {
    return renderError(error.message.trim(), null);
  }

  const verbPrefix = matchedVerbPrefix(args, verbPaths);
  if (verbPrefix) {
    const headline = tx(ENTRY_TEXTS.parseErrorVerbUsage, { verb: verbPrefix, message: error.message.trim() });
    return renderError(headline, tx(ENTRY_TEXTS.parseErrorVerbHelpHint, { verb: verbPrefix }));
  }

  const subcommands = subcommandsUnder(firstToken, verbPaths);
  if (subcommands.length > 0) {
    const headline = tx(ENTRY_TEXTS.parseErrorIncompleteCommand, { name: firstToken });
    const suggestion = tx(ENTRY_TEXTS.parseErrorSubcommandList, {
      suggestions: formatSuggestionList(subcommands),
    });
    return renderError(headline, suggestion);
  }

  const candidates = closestVerbs(firstToken, verbPaths);
  const suggestion = candidates.length > 0
    ? tx(ENTRY_TEXTS.parseErrorVerbSuggestion, { suggestions: formatSuggestionList(candidates) })
    : null;
  return renderError(tx(ENTRY_TEXTS.parseErrorUnknownCommand, { name: firstToken }), suggestion);
}

/**
 * Subcommands registered under a parent namespace. `db` →
 * `['db backup', 'db migrate', ...]`. Returns up to three for the
 * incomplete-command hint; alphabetical so the order is stable.
 */
function subcommandsUnder(namespace: string, verbPaths: string[][]): string[] {
  const matches = verbPaths
    .filter((path) => path.length >= 2 && path[0] === namespace)
    .map((path) => path.join(' '))
    .sort();
  return matches.slice(0, 3);
}

/**
 * Longest registered verb path that is a prefix of the leading
 * positionals in `args`. Returns the joined verb (`db migrate`) or `''`
 * when nothing matches.
 */
function matchedVerbPrefix(args: string[], verbPaths: string[][]): string {
  const leading: string[] = [];
  for (const tok of args) {
    if (tok.startsWith('-')) break;
    leading.push(tok);
  }
  if (leading.length === 0) return '';
  let best: string[] = [];
  for (const path of verbPaths) {
    if (path.length > leading.length) continue;
    const matches = path.every((tok, i) => leading[i] === tok);
    if (matches && path.length > best.length) best = path;
  }
  return best.join(' ');
}

/** Compose the final two-or-three-line message with the trailing help footer. */
function renderError(headline: string, suggestion: string | null): string {
  const lines = [tx(ENTRY_TEXTS.parseErrorHeadline, { message: headline })];
  if (suggestion) lines.push(suggestion);
  lines.push(ENTRY_TEXTS.parseErrorFooter);
  return lines.join('\n') + '\n';
}

/**
 * Pull the offending option name out of Clipanion's English message
 * (`Unsupported option name ("-version")`). Returns null on miss so the
 * caller can fall back to the raw first token.
 */
function extractOffendingFlag(message: string): string | null {
  const match = /Unsupported option name \("([^"]+)"\)/.exec(message);
  return match ? match[1]! : null;
}

/**
 * Single-dash long option detector. `-version` → `--version`,
 * `-help` → `--help`. Any single-dash token longer than two chars
 * (i.e. not `-v` / `-h` etc) is treated as an attempted long form.
 * Returns null when the input is already a valid short form or starts
 * with `--`.
 */
function suggestFlag(token: string): string | null {
  if (!token.startsWith('-')) return null;
  if (token.startsWith('--')) return null;
  if (token.length <= 2) return null;
  const longForm = '-' + token;
  return tx(ENTRY_TEXTS.parseErrorFlagSuggestion, { suggestion: longForm });
}

/**
 * Levenshtein distance bounded at `max` for early exit. We don't need
 * exact distances — only "is this within N edits". Capping makes the
 * cost O(n*m) for short strings (verbs are short) and effectively free.
 */
function editDistance(a: string, b: string, max: number): number {
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
 * Extracted to keep `editDistance` under the project's complexity cap.
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

interface IVerbCandidate {
  verb: string;
  distance: number;
}

/**
 * Top-3 closest registered verbs by edit distance, capped at 3 edits.
 * The distance threshold is intentionally tight — wider matches start
 * surfacing nonsense (`fooooo` matched against `db backup` etc.).
 *
 * For multi-word verb paths (`db migrate`) we score against the joined
 * form so a typo on either word can match: `dbmigrate` → `db migrate`.
 */
function closestVerbs(typed: string, verbPaths: string[][]): string[] {
  const target = typed.toLowerCase();
  const distanceCap = target.length <= 4 ? 2 : 3;
  const ranked: IVerbCandidate[] = [];
  for (const path of verbPaths) {
    const verb = path.join(' ');
    const head = path[0]!;
    const distHead = editDistance(target, head.toLowerCase(), distanceCap);
    const distFull = editDistance(target, verb.replace(/\s+/g, '').toLowerCase(), distanceCap);
    const distance = Math.min(distHead, distFull);
    if (distance <= distanceCap) ranked.push({ verb, distance });
  }
  ranked.sort((a, b) => a.distance - b.distance || a.verb.localeCompare(b.verb));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { verb } of ranked) {
    const head = verb.split(' ')[0]!;
    if (seen.has(head)) continue;
    seen.add(head);
    out.push(verb);
    if (out.length === 3) break;
  }
  return out;
}

/** Render `'a', 'b', or 'c'` for the suggestion clause. */
function formatSuggestionList(items: string[]): string {
  const quoted = items.map((s) => `'${s}'`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  if (quoted.length === 2) return `${quoted[0]} or ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(', ')}, or ${quoted[quoted.length - 1]}`;
}
