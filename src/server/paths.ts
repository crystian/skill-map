/**
 * UI bundle resolution for the BFF.
 *
 * Convention: the Angular SPA emits `ui/dist/ui/browser/` (Angular CLI
 * default `application` builder output, where the inner `ui/` is the
 * project name from `ui/angular.json`). Three resolution paths,
 * evaluated in order:
 *
 *   1. **Explicit** (`--ui-dist <path>`): resolved against `cwd`. The
 *      caller (`createServer`) decides what to do when the path doesn't
 *      contain `index.html` — `ServeCommand` exits `ExitCode.Error` for
 *      explicit paths and serves an inline placeholder for auto-resolution
 *      misses.
 *   2. **Package-bundled** (installed mode, `node_modules/@skill-map/cli`):
 *      check the directory shipped INSIDE the package itself at
 *      `<package>/dist/ui/`. The tsup post-build step copies the SPA
 *      build output there so the published tarball contains the UI;
 *      this branch is what end users hit when they run `sm serve` from
 *      a project that depends on `@skill-map/cli`.
 *   3. **Auto-detect** (dev mode, monorepo): walk upwards from the
 *      runtime context's `cwd` looking for `ui/dist/ui/browser/index.html`.
 *      Stops at the filesystem root. Returns the absolute directory or
 *      `null` if nothing matched. Lets `sm serve` work from anywhere
 *      inside the repo (e.g. `src/`).
 *
 * The package-bundled branch comes BEFORE the upward walk so a
 * developer running an installed `@skill-map/cli` from inside a fork of
 * this repo still gets the package's own bundle (predictable, version-
 * matched) instead of accidentally picking up a stale local UI build
 * higher up the tree.
 *
 * The explicit-path branch deliberately allows absolute paths (the test
 * suite uses them, and `--ui-dist` is the documented escape hatch). The
 * Hono `serveStatic` adapter cannot consume absolute paths, so the
 * server module reads files manually using these resolved paths.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IRuntimeContext } from '../cli/util/runtime-context.js';

const DEFAULT_UI_REL = join('ui', 'dist', 'ui', 'browser');
const PACKAGE_UI_REL = 'ui';
const INDEX_HTML = 'index.html';

/**
 * Resolve the UI bundle directory for auto mode (no `--ui-dist`).
 * Tries the package's own bundled UI first (covers the install
 * workflow), then falls back to walking upwards from `ctx.cwd`
 * (covers the dev / monorepo workflow). Returns the absolute
 * directory path or `null` when nothing was found in either branch.
 */
export function resolveDefaultUiDist(ctx: IRuntimeContext): string | null {
  const bundled = resolvePackageBundledUi();
  if (bundled !== null) return bundled;
  return walkUpForUi(ctx.cwd);
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

/**
 * Locate the UI bundle that ships INSIDE the installed package at
 * `<package>/dist/ui/`. Returns `null` when the directory is absent
 * (e.g. tsup ran without the UI workspace built, or the source-mode
 * `npm run dev:serve` is in use). The pivot is `import.meta.url` of
 * THIS file: at runtime it lives at `<package>/dist/cli.js` (tsup
 * flattens the bundle), so we walk up from the file's directory
 * looking for either `<here>/ui/` (when we're already inside `dist/`)
 * or `<here>/dist/ui/` (when we're one level above).
 */
function resolvePackageBundledUi(): string | null {
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
  return resolvePackageBundledUiFrom(here);
}

/**
 * Pure lookup: given a starting directory `here`, return the first
 * `<dir>/ui/` or `<dir>/dist/ui/` ancestor that looks like a UI
 * bundle. Capped at 8 ancestors — the bundled file lives directly
 * inside `dist/` so depth 1 is enough in practice; the cap protects
 * against a weird packaging layout. Exported for tests.
 */
export function resolvePackageBundledUiFrom(here: string): string | null {
  let current = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(current, PACKAGE_UI_REL);
    if (isUiBundleDir(candidate)) return candidate;
    const distHere = join(current, 'dist', PACKAGE_UI_REL);
    if (isUiBundleDir(distHere)) return distHere;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Walk upwards from `startDir` looking for `ui/dist/ui/browser/index.html`.
 * Stops at the filesystem root or after 64 ancestors (real layouts are
 * well under that — the cap beats `while (true)` for static analysis).
 */
function walkUpForUi(startDir: string): string | null {
  let current = resolve(startDir);
  for (let i = 0; i < 64; i++) {
    const candidate = join(current, DEFAULT_UI_REL);
    if (isUiBundleDir(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}
