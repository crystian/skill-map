/**
 * Module-level cache for `loadSchemaValidators`. The CLI
 * pays ~100 ms cold to read + AJV-compile 17 schemas (plus 8 supporting
 * `$ref` targets) on every invocation. Caching lets a second call in
 * the same process return the same instance for free, which matters as
 * future verbs validate at multiple boundaries (today: only
 * `sm history stats --json` does it once; tomorrow: `sm doctor`,
 * `sm record`, etc. will too).
 */

import { describe, it, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';

import {
  _resetSchemaValidatorsCacheForTests,
  loadSchemaValidators,
} from './schema-validators.js';

after(() => {
  // Leave the global cache in a clean state for any later test that runs
  // in the same process.
  _resetSchemaValidatorsCacheForTests();
});

describe('loadSchemaValidators (module-level cache)', () => {
  it('returns the SAME instance across calls in the same process', () => {
    _resetSchemaValidatorsCacheForTests();
    const a = loadSchemaValidators();
    const b = loadSchemaValidators();
    strictEqual(a, b, 'cached call must reuse the prior instance');
  });

  it('the cached validator stays functional (validate works on cached instance)', () => {
    _resetSchemaValidatorsCacheForTests();
    const v = loadSchemaValidators();
    // Pull the same instance again, then validate against it. If the cache
    // returned a stale or torn-down object, this would throw.
    const again = loadSchemaValidators();
    strictEqual(v, again);
    const result = again.validate('issue', {
      ruleId: 'orphan',
      severity: 'info',
      nodeIds: ['skills/foo.md'],
      message: 'Orphan',
    });
    ok(result.ok, `validate() must work on cached instance; got: ${result.ok ? '' : result.errors}`);
  });

  it('the test-only reset hook produces a fresh instance', () => {
    _resetSchemaValidatorsCacheForTests();
    const a = loadSchemaValidators();
    _resetSchemaValidatorsCacheForTests();
    const b = loadSchemaValidators();
    ok(a !== b, 'reset must force a new instance on the next call');
  });
});
