/**
 * `.skill-mapignore` parser + filter facade. Wraps `ignore` (kaelzhang)
 * with the project-local layering: bundled defaults → `config.ignore`
 * (from `.skill-map/settings.json`) → `.skill-mapignore` file content.
 *
 * Why a wrapper instead of exposing `ignore` directly:
 *
 * 1. Single-source defaults — `src/config/defaults/skill-mapignore` is
 *    the canonical default list, loaded once at module init (or at
 *    explicit build time, depending on bundling). The runtime never
 *    re-reads it per scan.
 * 2. Stable interface — adapters and the orchestrator depend on a
 *    minimal `IIgnoreFilter` shape, so the underlying library can be
 *    swapped without touching every consumer.
 * 3. Path normalization — every consumer passes the path RELATIVE to
 *    the scan root (POSIX separators); the wrapper guarantees that
 *    contract before delegating to `ignore`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ignoreFactory from 'ignore';

export interface IIgnoreFilter {
  /**
   * Returns `true` when `relativePath` should be skipped. The caller
   * MUST pass paths relative to the scan root, with POSIX separators
   * (forward slashes), no leading `/`. Directories MAY be passed with
   * or without trailing `/`; the wrapper does not require it.
   */
  ignores(relativePath: string): boolean;
}

export interface IBuildIgnoreFilterOptions {
  /** Patterns from `config.ignore` in `.skill-map/settings.json`. */
  configIgnore?: string[];
  /**
   * Raw text of the project's `.skill-mapignore` file. Comments and
   * blank lines are tolerated by `ignore` itself; the caller does not
   * need to pre-process.
   */
  ignoreFileText?: string;
  /**
   * When `false`, the bundled defaults are NOT pre-loaded. Default is
   * `true`. Tests use `false` to assert the precise effect of a single
   * pattern.
   */
  includeDefaults?: boolean;
}

/**
 * Build a filter from any combination of layers. Layer order is fixed:
 *
 *   1. bundled defaults (`src/config/defaults/skill-mapignore`)
 *   2. `configIgnore`
 *   3. `ignoreFileText`
 *
 * Later layers override earlier ones via gitignore negation rules
 * (`!pattern` re-includes a path the prior layer excluded).
 */
export function buildIgnoreFilter(opts: IBuildIgnoreFilterOptions = {}): IIgnoreFilter {
  const ig = ignoreFactory();
  if (opts.includeDefaults !== false) {
    ig.add(loadDefaultsText());
  }
  if (opts.configIgnore && opts.configIgnore.length > 0) {
    ig.add(opts.configIgnore);
  }
  if (opts.ignoreFileText && opts.ignoreFileText.length > 0) {
    ig.add(opts.ignoreFileText);
  }
  return {
    ignores(relativePath: string): boolean {
      // `ignore` requires a non-empty relative path; the empty string
      // (the root itself) MUST never be ignored.
      if (relativePath === '' || relativePath === '.' || relativePath === './') {
        return false;
      }
      const normalised = relativePath.replace(/^\.\//, '').replace(/\\/g, '/').replace(/^\//, '');
      if (normalised === '') return false;
      return ig.ignores(normalised);
    },
  };
}

/**
 * Read `.skill-mapignore` from `<root>/.skill-mapignore` if it exists,
 * else return `undefined`. Caller passes the result as `ignoreFileText`
 * to `buildIgnoreFilter`.
 */
export function readIgnoreFileText(scopeRoot: string): string | undefined {
  const path = resolve(scopeRoot, '.skill-mapignore');
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// Bundled defaults loader
// -----------------------------------------------------------------------------

let cachedDefaults: string | null = null;

function loadDefaultsText(): string {
  if (cachedDefaults !== null) return cachedDefaults;
  cachedDefaults = readDefaultsFromDisk();
  return cachedDefaults;
}

/** Test-only — drop the cache so a unit test can simulate a missing file. */
export function _resetDefaultsCacheForTests(): void {
  cachedDefaults = null;
}

/**
 * Resolve `src/config/defaults/skill-mapignore` from disk. Walks a small
 * list of candidate locations relative to this module so the lookup
 * works in both the dev layout (`src/kernel/scan/ignore.ts` →
 * `src/config/defaults/`) and the bundled layout (single-file
 * `dist/...js` → `dist/config/defaults/`, populated by tsup `onSuccess`).
 */
function readDefaultsFromDisk(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../config/defaults/skill-mapignore'),  // src/kernel/scan/ → src/config/defaults/
    resolve(here, '../config/defaults/skill-mapignore'),     // dist/cli.js → dist/config/defaults/ (siblings)
    resolve(here, 'config/defaults/skill-mapignore'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, 'utf8');
      } catch {
        /* try next candidate */
      }
    }
  }
  // Fail soft: the scan still works without bundled defaults. The user's
  // own `.skill-mapignore` + config.ignore still apply.
  return '';
}
