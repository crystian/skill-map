/**
 * Conformance scope registry — single source of truth for `sm
 * conformance run` (`cli/commands/conformance.ts`) and the in-process
 * `src/test/conformance.test.ts` reference suite.
 *
 * Phase 5 / A.13 split the conformance suite in two:
 *
 *   - **Spec-owned scope** — `spec/conformance/` ships with
 *     `@skill-map/spec` and only contains kernel-agnostic cases
 *     (`kernel-empty-boot`) plus the universal preamble fixture.
 *     Discovered via `resolveSpecRoot()`.
 *
 *   - **Provider-owned scopes** — each built-in Provider (today
 *     `claude`) carries its own `conformance/` directory next to its
 *     manifest, with cases that exercise the Provider's kind catalog
 *     (`basic-scan`, `rename-high`, `orphan-detection` for Claude).
 *     Discovered by walking the source tree for now (dev/CI only —
 *     the bundled CLI does not yet ship Provider conformance assets;
 *     when it does, the resolver below grows a `dist/extensions/...`
 *     fallback alongside the source path).
 *
 * The shape of a scope is intentionally narrow: a stable `id`, a label,
 * the absolute paths to its `cases/` and `fixtures/` directories. The
 * runner (`src/conformance/index.ts`) consumes them via
 * `RunCaseOptions.casePath` + `RunCaseOptions.fixturesRoot`.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export type TConformanceScopeKind = 'spec' | 'provider';

export interface IConformanceScope {
  /**
   * Stable identifier used by `--scope <id>` on the CLI verb.
   *
   *   - Spec scope: `'spec'`.
   *   - Provider scopes: `'provider:<plugin-id>'` (e.g. `'provider:claude'`).
   */
  id: string;
  kind: TConformanceScopeKind;
  /** Human-readable label for diagnostic output. */
  label: string;
  /** Absolute path to the `cases/` directory. */
  casesDir: string;
  /** Absolute path to the `fixtures/` directory. */
  fixturesDir: string;
  /**
   * Absolute path to the `@skill-map/spec` root the runner should pass
   * through to assertions like `file-matches-schema`. Same value across
   * every scope — the spec is global.
   */
  specRoot: string;
}

/**
 * Locate the installed `@skill-map/spec` package root. Mirrors the
 * helper in `kernel/adapters/schema-validators.ts` — kept independent
 * to avoid a kernel-on-cli import direction.
 */
function resolveSpecRoot(): string {
  const require = createRequire(import.meta.url);
  try {
    const indexPath = require.resolve('@skill-map/spec/index.json');
    return dirname(indexPath);
  } catch {
    throw new Error(
      '@skill-map/spec not resolvable — ensure the workspace is linked or the package is installed.',
    );
  }
}

/**
 * Locate this CLI workspace root (the `src/` directory in dev, the
 * package install dir at runtime). Built-in Provider conformance assets
 * live under `<workspace>/extensions/providers/<id>/conformance/`.
 *
 * Strategy:
 *
 *   1. Walk up from `import.meta.url` looking for a sibling
 *      `extensions/providers/` directory. Works in both source-tree
 *      (`src/cli/util/conformance-scopes.ts` → `src/`) and bundled-dist
 *      layouts (`dist/cli.js` → `dist/`, once tsup copies the
 *      conformance trees in `onSuccess`).
 *   2. Throw a directed error if the directory cannot be located —
 *      callers convert this to an exit-2 with a hint.
 */
function resolveCliWorkspaceRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let cursor = here;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(cursor, 'extensions', 'providers');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(
    'sm conformance: built-in Provider conformance assets not found ' +
      "(expected an 'extensions/providers/' directory above " +
      `${here}). The bundled CLI may not yet copy the assets — ` +
      'run from the source workspace, or rebuild after enabling the ' +
      'asset-copy step.',
  );
}

/**
 * Enumerate every built-in Provider that ships a `conformance/`
 * directory next to its manifest. Today the only built-in Provider is
 * `claude`; the loop is generic so a future Provider only needs to add
 * its directory under `extensions/providers/<id>/conformance/` to be
 * discovered automatically.
 */
function collectProviderScopes(specRoot: string): IConformanceScope[] {
  const out: IConformanceScope[] = [];
  let workspaceRoot: string;
  try {
    workspaceRoot = resolveCliWorkspaceRoot();
  } catch {
    return out;
  }
  const providersRoot = resolve(workspaceRoot, 'extensions', 'providers');
  if (!existsSync(providersRoot)) return out;
  for (const entry of readdirSync(providersRoot)) {
    const providerDir = resolve(providersRoot, entry);
    if (!statSync(providerDir).isDirectory()) continue;
    const conformanceDir = resolve(providerDir, 'conformance');
    if (!existsSync(conformanceDir)) continue;
    const casesDir = resolve(conformanceDir, 'cases');
    const fixturesDir = resolve(conformanceDir, 'fixtures');
    if (!existsSync(casesDir) || !existsSync(fixturesDir)) continue;
    out.push({
      id: `provider:${entry}`,
      kind: 'provider',
      label: `provider:${entry}`,
      casesDir,
      fixturesDir,
      specRoot,
    });
  }
  return out;
}

/**
 * Single source of truth for the spec-owned conformance scope.
 */
function specScope(specRoot: string): IConformanceScope {
  return {
    id: 'spec',
    kind: 'spec',
    label: 'spec',
    casesDir: resolve(specRoot, 'conformance', 'cases'),
    fixturesDir: resolve(specRoot, 'conformance', 'fixtures'),
    specRoot,
  };
}

/**
 * Discover every conformance scope visible to the running CLI: the spec
 * scope plus every built-in Provider scope. Returned in stable order
 * (spec first, then providers in directory-listing order).
 */
export function listConformanceScopes(): IConformanceScope[] {
  const specRoot = resolveSpecRoot();
  return [specScope(specRoot), ...collectProviderScopes(specRoot)];
}

/**
 * Resolve a `--scope` value to one or more concrete scopes. Accepts:
 *
 *   - `'all'` (or `undefined`): every scope.
 *   - `'spec'`: the spec scope alone.
 *   - `'provider:<id>'`: the matching Provider scope. Unknown ids
 *     throw — callers map the error to exit-2 with a hint listing the
 *     available scopes.
 */
export function selectConformanceScopes(
  scope: string | undefined,
): IConformanceScope[] {
  const scopes = listConformanceScopes();
  if (scope === undefined || scope === 'all') return scopes;
  const match = scopes.find((s) => s.id === scope);
  if (!match) {
    const available = scopes.map((s) => s.id).join(', ');
    throw new Error(
      `sm conformance: unknown --scope '${scope}'. Available: ${available}.`,
    );
  }
  return [match];
}

/**
 * List every `*.json` case file under `scope.casesDir` in
 * lexicographic order. Empty array if the directory contains no
 * cases (a Provider that ships an empty suite still surfaces — the
 * verb just runs zero cases against it and reports zero passes).
 */
export function listCaseFiles(scope: IConformanceScope): string[] {
  if (!existsSync(scope.casesDir)) return [];
  return readdirSync(scope.casesDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => resolve(scope.casesDir, entry));
}
