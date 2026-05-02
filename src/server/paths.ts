/**
 * UI bundle resolution for the BFF.
 *
 * Convention: the Angular SPA emits `ui/dist/browser/` (default Angular
 * builder output). Two resolution paths:
 *
 *   1. **Auto-detect** (no `--ui-dist` flag): walk upwards from the
 *      runtime context's `cwd` looking for a `ui/dist/browser/index.html`.
 *      Stops at the filesystem root. Returns the absolute directory or
 *      `null` if nothing matched.
 *   2. **Explicit** (`--ui-dist <path>`): resolved against `cwd`. The
 *      caller (`createServer`) decides what to do when the path doesn't
 *      contain `index.html` — at 14.1 the CLI exits `ExitCode.Error` for
 *      explicit paths and serves an inline placeholder for auto-resolution
 *      misses.
 *
 * Why walking upwards: the dev workflow runs `sm serve` from anywhere
 * inside the repo (e.g. `src/`); the install workflow runs from a
 * consumer project that has `node_modules/@skill-map/cli/dist/ui/`
 * shipped alongside the CLI. The traversal handles both without baking
 * a layout assumption.
 *
 * The explicit-path branch deliberately allows absolute paths (the test
 * suite uses them, and `--ui-dist` is the documented escape hatch). The
 * Hono `serveStatic` adapter cannot consume absolute paths, so the
 * server module reads files manually using these resolved paths.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { IRuntimeContext } from '../cli/util/runtime-context.js';

const DEFAULT_UI_REL = join('ui', 'dist', 'browser');
const INDEX_HTML = 'index.html';

/**
 * Auto-detect the UI bundle by walking upwards from `ctx.cwd`. Returns
 * the absolute directory path or `null` if no candidate contained
 * `index.html`.
 */
export function resolveDefaultUiDist(ctx: IRuntimeContext): string | null {
  let current = resolve(ctx.cwd);
  // Cap the upward walk at a generous depth — real layouts are well
  // under 32 ancestors. Beats `while (true)` for static analysis.
  for (let i = 0; i < 64; i++) {
    const candidate = join(current, DEFAULT_UI_REL);
    if (isUiBundleDir(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Resolve an explicit `--ui-dist <path>` flag value against the runtime
 * cwd. Returns the absolute path verbatim — existence check is the
 * caller's job (so the server can distinguish missing-explicit from
 * missing-auto and pick the right exit code).
 */
export function resolveExplicitUiDist(ctx: IRuntimeContext, raw: string): string {
  return isAbsolute(raw) ? raw : resolve(ctx.cwd, raw);
}

/**
 * True when `path` is a directory containing `index.html`. The bundle
 * SHOULD also contain hashed JS / CSS chunks but those names are
 * Angular-version-specific; `index.html` is the stable marker.
 */
export function isUiBundleDir(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    if (!statSync(path).isDirectory()) return false;
    return existsSync(join(path, INDEX_HTML));
  } catch {
    // Permission errors / vanishing directories — treat as miss rather
    // than crash the server boot.
    return false;
  }
}
