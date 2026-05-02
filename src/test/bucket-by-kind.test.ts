/**
 * Audit M4 — `kernel/util/bucket-by-kind.ts`. The helper is the shared
 * dispatcher behind `built-in-plugins/built-ins.ts:bucketBuiltIn` and
 * `cli/util/plugin-runtime.ts:bucketLoaded`. It must:
 *
 *   - push the `instance` into the destination array for each of the
 *     six `ExtensionKind` values (`provider`, `extractor`, `rule`,
 *     `action`, `formatter`, `hook`);
 *   - silently drop the instance when the bag has no destination for
 *     that kind (the property is `undefined` / absent — caller's intent
 *     is "I don't care about this kind");
 *   - throw on an unknown kind so a future widening of `ExtensionKind`
 *     surfaces every caller through the runtime guard.
 *
 * Tests use plain object literals as the `instance` — the helper is
 * agnostic to its concrete shape (typed `unknown`) and constructing
 * real extension instances would only obscure the dispatch table.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { ExtensionKind } from '../kernel/registry.js';
import { bucketByKind, type IBucketByKindBag } from '../kernel/util/bucket-by-kind.js';

describe('bucketByKind', () => {
  it('pushes a provider instance into bag.provider', () => {
    const provider: unknown[] = [];
    const bag: IBucketByKindBag = { provider };
    const inst = { id: 'p' };
    bucketByKind('provider', inst, bag);
    assert.deepEqual(provider, [inst]);
  });

  it('pushes an extractor instance into bag.extractor', () => {
    const extractor: unknown[] = [];
    const bag: IBucketByKindBag = { extractor };
    const inst = { id: 'e' };
    bucketByKind('extractor', inst, bag);
    assert.deepEqual(extractor, [inst]);
  });

  it('pushes a rule instance into bag.rule', () => {
    const rule: unknown[] = [];
    const bag: IBucketByKindBag = { rule };
    const inst = { id: 'r' };
    bucketByKind('rule', inst, bag);
    assert.deepEqual(rule, [inst]);
  });

  it('pushes an action instance into bag.action', () => {
    const action: unknown[] = [];
    const bag: IBucketByKindBag = { action };
    const inst = { id: 'a' };
    bucketByKind('action', inst, bag);
    assert.deepEqual(action, [inst]);
  });

  it('pushes a formatter instance into bag.formatter', () => {
    const formatter: unknown[] = [];
    const bag: IBucketByKindBag = { formatter };
    const inst = { id: 'f' };
    bucketByKind('formatter', inst, bag);
    assert.deepEqual(formatter, [inst]);
  });

  it('pushes a hook instance into bag.hook', () => {
    const hook: unknown[] = [];
    const bag: IBucketByKindBag = { hook };
    const inst = { id: 'h' };
    bucketByKind('hook', inst, bag);
    assert.deepEqual(hook, [inst]);
  });

  it('drops the instance when the bag has no destination for that kind', () => {
    // `bucketLoaded` (cli/util/plugin-runtime.ts) deliberately omits
    // `action` from its bag; the helper must silently skip without
    // throwing or mutating any other bucket.
    const provider: unknown[] = [];
    const extractor: unknown[] = [];
    const bag: IBucketByKindBag = { provider, extractor };
    bucketByKind('action', { id: 'dropped' }, bag);
    assert.deepEqual(provider, []);
    assert.deepEqual(extractor, []);
  });

  it('throws on an unknown ExtensionKind value', () => {
    // Cast `'bogus' as ExtensionKind` to bypass TS — exercising the
    // runtime defensive throw that catches a future widening of the
    // discriminator that slipped past the exhaustive `never` guard at
    // compile time.
    const bag: IBucketByKindBag = {};
    assert.throws(
      () => bucketByKind('bogus' as ExtensionKind, { id: 'x' }, bag),
      /Unhandled extension kind/,
    );
  });
});
