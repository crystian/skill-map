/**
 * Containment guards for filesystem paths the CLI dereferences from
 * persisted state (typically `node.path` rows from a SQLite snapshot).
 *
 * The threat model: a manually-tampered `.skill-map/skill-map.db` (or a
 * future plugin migration that writes raw rows) could land an absolute
 * path or a `../../`-laden relative path into `scan_nodes.path`. Verbs
 * that resolve the path against `cwd` and read the result (`sm refresh`,
 * future enrichment / export verbs) would then read files anywhere on
 * the disk.
 *
 * `assertContained` rejects both shapes before the read happens. It is
 * deliberately strict: relative paths only, no segment may escape the
 * supplied root after `resolve` collapses `..` segments. Internal
 * messages are English crude — they bubble up as `throw new Error(...)`,
 * not `tx(...)`, because they signal a tampered DB rather than a user
 * input problem.
 */

import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Throw when `rel` does not stay inside `cwd` after path resolution.
 * The caller is expected to wrap the throw into a verb-specific error
 * surface; the helper deliberately does not return a discriminated
 * union because the failure mode (tampered DB) is exceptional, not
 * routine.
 */
export function assertContained(cwd: string, rel: string): void {
  if (isAbsolute(rel)) {
    throw new Error(`node path is absolute, refusing to read: ${rel}`);
  }
  const abs = resolve(cwd, rel);
  if (abs !== cwd && !abs.startsWith(cwd + sep)) {
    throw new Error(`node path escapes repo root: ${rel}`);
  }
}
