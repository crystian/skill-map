/**
 * `node-body.ts` — on-demand body reader for `/api/nodes/:pathB64?include=body`.
 *
 * The kernel deliberately persists `body_hash` / `bytes_body` / `tokens_body`
 * (per spec/db-schema.md §scan_nodes) but NOT the body bytes themselves —
 * the body is human content, not machine state, and duplicating it in
 * SQLite would inflate the DB without serving any read-side query the
 * kernel cares about. Inspector cards that DO want to render the body
 * (markdown preview at Step 14.5) opt into a filesystem re-read by
 * passing `?include=body`.
 *
 * Two pieces:
 *
 *   1. `readNodeBody(cwd, relPath)` — resolves the node path against the
 *      scope root, refuses any resolved path that escapes the root
 *      (defense-in-depth for path-traversal — `node.path` is supposed to
 *      be relative-and-inside, but a corrupted DB row or a future
 *      Provider that doesn't sanitise its paths shouldn't be able to
 *      hand the BFF a `../../../etc/passwd`), reads UTF-8 from disk, and
 *      strips frontmatter delimiters. Returns `null` on missing file
 *      (ENOENT) or path-traversal violation; bubbles unexpected errors.
 *
 *   2. `stripFrontmatter(raw)` — removes a leading `---\n…\n---\n?` block
 *      if present, otherwise returns the input unchanged. Tolerates
 *      both LF and CRLF EOLs.
 *
 * Callers handle the `null` return as "body unavailable" — the SPA
 * inspector renders an empty-state card instead of crashing. Stale-vs-DB
 * detection (file changed since last scan) is NOT this module's job:
 * the watcher will re-emit a `scan.completed` and the loader's reactive
 * refresh will catch up.
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath, relative as relativePath, sep } from 'node:path';

/**
 * Read a node body from disk and strip its YAML frontmatter delimiters.
 *
 * Returns `null` when:
 *   - the resolved path escapes `cwd` (path-traversal defense),
 *   - the file does not exist (`ENOENT`),
 *   - the file is not readable (`EACCES` / `EISDIR` / etc).
 *
 * Other errors (truly unexpected I/O failures) bubble — the BFF's
 * `app.onError` formats them into the shared error envelope.
 */
export async function readNodeBody(cwd: string, relPath: string): Promise<string | null> {
  // Absolute paths violate the "node.path is relative to the scope root"
  // contract from `spec/schemas/node.schema.json`. Even if the absolute
  // path happens to resolve inside `cwd`, accepting it would let a
  // corrupted DB row leak any file the server process can read by
  // tunneling through the relative-resolve step. Refuse outright.
  if (isAbsolute(relPath)) return null;
  const absRoot = resolvePath(cwd);
  const absFile = resolvePath(absRoot, relPath);
  const rel = relativePath(absRoot, absFile);
  // `relative` returns a string starting with `..` (or an absolute path
  // on Windows) when the resolved file lies outside the root. Both cases
  // mean traversal — refuse.
  if (rel.startsWith('..') || rel.startsWith(sep) || rel.length === 0) {
    return null;
  }
  let raw: string;
  try {
    raw = await readFile(absFile, 'utf-8');
  } catch (err) {
    if (isExpectedFsError(err)) return null;
    throw err;
  }
  return stripFrontmatter(raw);
}

/**
 * Strip a leading YAML-style frontmatter block (`---\n…\n---\n?`) from
 * a markdown document. Returns the input unchanged when no leading
 * delimiter is present.
 *
 * Tolerates LF and CRLF line endings. Preserves the body's trailing
 * newline if present.
 */
export function stripFrontmatter(raw: string): string {
  // Leading delimiter must start at offset 0 — `--- ` mid-document is
  // a markdown thematic break, not frontmatter.
  if (!raw.startsWith('---')) return raw;
  // Match `---` opener (line 1), then any content, then a closing
  // `---` at the START of a line (multiline `^`), then optionally
  // consume the trailing newline so the body starts cleanly.
  // The multiline anchor — vs. requiring `\r?\n---` — is what lets an
  // empty frontmatter (`---\n---\nbody`) match: there's no preceding
  // newline because the closer is on line 2, immediately after the
  // opener.
  const match = raw.match(/^---\r?\n[\s\S]*?^---\r?\n?/m);
  if (!match) return raw;
  return raw.slice(match[0].length);
}

const EXPECTED_FS_ERROR_CODES = new Set(['ENOENT', 'EACCES', 'EISDIR', 'ENOTDIR']);

function isExpectedFsError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && EXPECTED_FS_ERROR_CODES.has(code);
}
