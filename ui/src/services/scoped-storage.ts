/**
 * Project-scoped `localStorage` keys (user decision 2026-08-17, after
 * sessions recorded in one project surfaced while serving another):
 * `localStorage` is per-ORIGIN, and every locally served project shares
 * `http://127.0.0.1:<port>`, so PROJECT STATE stored under a bare key
 * (the tape, node positions, map curation) followed the browser, not
 * the folder. Keys that hold project state are namespaced with a short
 * hash of the project root; keys that hold operator PREFERENCES (rail
 * width, sort modes, filters) deliberately stay bare, a preference
 * follows the operator across projects by design.
 *
 * The root travels in the `skill-map-scope` meta the BFF injects into
 * the served `index.html` (spec `cli-contract.md` §Serve), so the
 * namespace is known SYNCHRONOUSLY at module load, before any service
 * hydrates. The `fix:*` dev harness stamps its own metas at the source
 * (`ui/scripts/stamp-dev-index.mjs` writes the fixture's root into the
 * generated dev index; the raw index carries the `dev` pseudo-version).
 * No meta at all (the static demo bundle, jsdom) falls back to the
 * `default` namespace: those hosts serve one project per origin, so
 * the collision the namespace exists to prevent cannot happen there.
 * An EMBEDDED boot (`?embed=1`, see `embed-mode.ts`) gets its own
 * `embed` namespace regardless of the meta: the framed canvas shares
 * the origin with the full SPA it is cut from, and a card dragged
 * inside a host page's hero must not move the visitor's real map.
 *
 * DEBUG AFFORDANCE, nothing reads it programmatically: the
 * `sm.scopes` registry key maps each hash to the root it was minted
 * for (`{ "a3f9c2e1": "/home/x/project" }`), so a human inspecting
 * devtools can tell which project a suffixed key belongs to.
 */

import { readEmbedConfigFromLocation } from './embed-mode';

/** Meta tag name the BFF stamps the resolved scope root into. */
export const SCOPE_META_NAME = 'skill-map-scope';

/** Meta tag name the BFF stamps the serving CLI version into. */
export const VERSION_META_NAME = 'skill-map-version';

/** Hash → root registry (debug legibility only; see module doc). */
export const SCOPE_REGISTRY_KEY = 'sm.scopes';

/**
 * Layout-breaking releases: `'all'` = the whole `sm.*` family; a list
 * = those BASE keys (every scoped `<base>.<hash>` variant included).
 * Append-only; thresholds compare by semver ORDER, so an entry only
 * needs to be `<=` the release that actually ships it.
 */
const VERSION_RESETS: Readonly<Record<string, 'all' | readonly string[]>> = {
  // The namespace migration: every bare-era key is unreadable, and the
  // orphaned blobs (megabytes of tape) would sit on the origin quota.
  '1.12.0': 'all',
};

/**
 * Holds the CLI VERSION that last wrote this origin's storage (user
 * call 2026-08-17: the CLI version is the meaningful stamp, not an
 * opaque counter). There is NO backward compatibility, but the blast
 * radius is PER LAYOUT CHANGE, not per release: upgrading applies
 * every `VERSION_RESETS` threshold crossed since the stored version, a
 * release crossing none wipes nothing, and a missing / unreadable
 * stored version (the pre-namespace era) falls back to the full wipe,
 * misreading state is worse than resetting it. Re-stamped to the
 * running version on every mismatch.
 */
export const STORAGE_VERSION_KEY = 'sm.storage-version';

/**
 * FNV-1a 32-bit over the root path, as 8 hex chars. Non-cryptographic
 * on purpose: the namespace separates a handful of local projects on
 * one machine, and it must be computable SYNCHRONOUSLY at module load
 * (`crypto.subtle` is async, so it cannot mint keys the services read
 * in their constructors).
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

let resolved: string | null = null;

/** The active namespace (memoized; see the module doc for the sources). */
export function scopeNamespace(): string {
  if (resolved !== null) return resolved;
  const root = readMeta(SCOPE_META_NAME);
  ensureStorageVersion(readMeta(VERSION_META_NAME));
  if (readEmbedConfigFromLocation() !== null) {
    resolved = 'embed';
  } else if (root === null || root.length === 0) {
    resolved = 'default';
  } else {
    resolved = fnv1a(root);
    registerScope(resolved, root);
  }
  return resolved;
}

/** `<base>.<namespace>`, the storage spelling of one project-state key. */
export function scopedKey(base: string): string {
  return `${base}.${scopeNamespace()}`;
}

/** Test seam: forget the memos so a spec can vary the meta per case. */
export function resetScopeNamespaceForTest(): void {
  resolved = null;
  versionChecked = false;
}

function registerScope(hash: string, root: string): void {
  try {
    const raw = localStorage.getItem(SCOPE_REGISTRY_KEY);
    const registry = (raw === null ? {} : JSON.parse(raw)) as Record<string, string>;
    if (registry[hash] === root) return;
    registry[hash] = root;
    localStorage.setItem(SCOPE_REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    // Storage unavailable / corrupt registry: the namespace still works,
    // only the debug directory is lost.
  }
}

function readMeta(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
  return value !== null && value.length > 0 ? value : null;
}

let versionChecked = false;

/**
 * The version gate (see `VERSION_RESETS`). Inert without a version
 * meta (the dev harness, jsdom): with no idea what is running, wiping
 * would be guesswork.
 */
function ensureStorageVersion(current: string | null): void {
  if (versionChecked) return;
  versionChecked = true;
  if (current === null) return;
  try {
    const stored = localStorage.getItem(STORAGE_VERSION_KEY);
    if (stored === current) return;
    const resets = resetPlan(stored, current, VERSION_RESETS);
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith('sm.')) continue;
      if (resets === 'all' || resets.some((base) => key === base || key.startsWith(`${base}.`))) {
        stale.push(key);
      }
    }
    for (const key of stale) localStorage.removeItem(key);
    localStorage.setItem(STORAGE_VERSION_KEY, current);
  } catch {
    // Storage unavailable: nothing to version.
  }
}

/** `major.minor.patch` prefix as a comparable triplet; null = unreadable. */
function semverTriplet(version: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function semverBefore(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}

/**
 * The combined reset for an upgrade from `stored` to `current`: the
 * union of every layout-break threshold CROSSED (stored < threshold <=
 * current, by semver order), `'all'` if any crossed threshold declares
 * it, or when the stored version is missing / unreadable / newer than
 * what is running (a downgrade is unknown territory). A release
 * crossing no threshold resets nothing. Pure and exported for tests.
 */
export function resetPlan(
  stored: string | null,
  current: string,
  resets: Readonly<Record<string, 'all' | readonly string[]>>,
): 'all' | readonly string[] {
  const from = stored === null ? null : semverTriplet(stored);
  const to = semverTriplet(current);
  if (from === null || to === null || semverBefore(to, from)) return 'all';
  const combined: string[] = [];
  for (const [threshold, declared] of Object.entries(resets)) {
    const at = semverTriplet(threshold);
    if (at === null) return 'all';
    const crossed = semverBefore(from, at) && !semverBefore(to, at);
    if (!crossed) continue;
    if (declared === 'all') return 'all';
    combined.push(...declared);
  }
  return combined;
}
