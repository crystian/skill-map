/**
 * Shared per-kind dispatcher for extension bucketing.
 *
 * Two call sites — `built-in-plugins/built-ins.ts:bucketBuiltIn` and
 * `cli/util/plugin-runtime.ts:bucketLoaded` — used to open-code an
 * identical six-way `switch (ext.kind) {...}` block, each with the
 * same exhaustive-`never` guard. They diverged only in (a) whether
 * actions / hooks land in arrays of their own and (b) whether a
 * manifest row is recorded alongside the runtime instance.
 *
 * `bucketByKind` is the centralized dispatch. It receives:
 *
 *   - the extension kind (the discriminator),
 *   - the runtime instance, typed broadly as `unknown` so the helper
 *     doesn't take a hard dependency on each kind's concrete TS type
 *     (avoids a circular import between `kernel/util/` and
 *     `kernel/extensions/`),
 *   - a `bag` mapping each kind to its destination array. Each entry
 *     is optional — a caller that doesn't care about a given kind
 *     (`bucketLoaded` skips actions, for instance) leaves it `undefined`
 *     and the helper drops that branch on the floor.
 *
 * The helper still owns the exhaustive switch (so adding a new kind to
 * `ExtensionKind` flags every caller through the `never` guard) and
 * gets one `eslint-disable-next-line complexity` comment, justified by
 * AGENTS.md category 6 (discriminated-union dispatcher) — splitting
 * per case would scatter the central dispatch table without making
 * the algorithm clearer.
 */

import type { ExtensionKind } from '../registry.js';

/**
 * Per-kind destination arrays. Each property is optional — a caller
 * that ignores a kind passes `undefined` (or simply omits the key).
 * The instance itself is typed `unknown`; callers cast to the kind's
 * concrete type at the destination.
 */
export interface IBucketByKindBag {
  provider?: unknown[];
  extractor?: unknown[];
  rule?: unknown[];
  action?: unknown[];
  formatter?: unknown[];
  hook?: unknown[];
}

/**
 * Push `instance` into `bag[kind]` if the caller declared a
 * destination array for that kind; otherwise drop it. Throws on an
 * unknown kind so a future widening of `ExtensionKind` cannot silently
 * land an instance in nowhere.
 */
// AGENTS.md category 6 (discriminated-union dispatcher): one branch per
// `ExtensionKind` plus a per-kind optional-chain guard for absent
// destination arrays. Splitting per kind would scatter the central
// dispatch table without making the algorithm clearer.
// eslint-disable-next-line complexity
export function bucketByKind(
  kind: ExtensionKind,
  instance: unknown,
  bag: IBucketByKindBag,
): void {
  switch (kind) {
    case 'provider':
      bag.provider?.push(instance);
      return;
    case 'extractor':
      bag.extractor?.push(instance);
      return;
    case 'rule':
      bag.rule?.push(instance);
      return;
    case 'action':
      bag.action?.push(instance);
      return;
    case 'formatter':
      bag.formatter?.push(instance);
      return;
    case 'hook':
      bag.hook?.push(instance);
      return;
    default: {
      // Exhaustive guard: a new `ExtensionKind` variant must extend
      // this switch. The `_exhaustive: never` binding triggers a
      // compile error if the discriminant is not exhausted; the
      // runtime throw is defensive in case TS is silenced via
      // `as never` at the call site.
      const _exhaustive: never = kind;
      throw new Error(`Unhandled extension kind: ${String(_exhaustive)}`);
    }
  }
}
