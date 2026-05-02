/**
 * Async filesystem probes shared by CLI commands. Two helpers, both
 * built on `fs.stat`:
 *
 *   - `pathExists(path)` — boolean answer; `false` only on ENOENT.
 *   - `statOrNull(path)` — full `Stats` so the caller can read `.size`,
 *     `null` only on ENOENT.
 *
 * Both swallow ENOENT only — every other error code (permission denied,
 * IO failure) propagates so the caller surfaces the real reason instead
 * of a false "not found".
 */

import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';

/**
 * Returns true if the path exists. ENOENT is the only swallowed error
 * code; anything else propagates.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Returns the `Stats` if the path exists, otherwise `null`. ENOENT is
 * the only swallowed error code; anything else propagates.
 */
export async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
