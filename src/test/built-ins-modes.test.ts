/**
 * Invariant: every built-in detector and rule declares its execution mode
 * explicitly as `deterministic`. The schema makes the field optional with
 * a deterministic default, so omitting it would still be valid — but the
 * project policy is to thread it explicitly so a future probabilistic
 * extension is the visible deviation, not a silent flip of the default.
 *
 * The `validate-all` audit is intentionally not asserted here: its
 * effective mode is derived from `composes[]` at load time
 * (`spec/architecture.md` §Execution modes) and the manifest MUST NOT
 * carry the field. Adapters and renderers are deterministic-only and
 * also MUST NOT carry the field.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { builtIns } from '../extensions/built-ins.js';

describe('built-in extensions — execution modes', () => {
  it('every built-in detector declares mode: deterministic', () => {
    const set = builtIns();
    assert.ok(set.detectors.length > 0, 'expected at least one built-in detector');
    for (const d of set.detectors) {
      assert.equal(
        d.mode,
        'deterministic',
        `detector ${d.id} should declare mode: 'deterministic'`,
      );
    }
  });

  it('every built-in rule declares mode: deterministic', () => {
    const set = builtIns();
    assert.ok(set.rules.length > 0, 'expected at least one built-in rule');
    for (const r of set.rules) {
      assert.equal(
        r.mode,
        'deterministic',
        `rule ${r.id} should declare mode: 'deterministic'`,
      );
    }
  });

  it('audit manifest does NOT declare mode (derived from composes[])', () => {
    const set = builtIns();
    for (const a of set.audits) {
      assert.equal(
        (a as unknown as Record<string, unknown>)['mode'],
        undefined,
        `audit ${a.id} must not declare mode directly — it is derived from composes[]`,
      );
    }
  });

  it('adapter manifest does NOT declare mode (deterministic-only kind)', () => {
    const set = builtIns();
    for (const a of set.adapters) {
      assert.equal(
        (a as unknown as Record<string, unknown>)['mode'],
        undefined,
        `adapter ${a.id} must not declare mode — adapters are deterministic-only`,
      );
    }
  });

  it('renderer manifest does NOT declare mode (deterministic-only kind)', () => {
    const set = builtIns();
    for (const r of set.renderers) {
      assert.equal(
        (r as unknown as Record<string, unknown>)['mode'],
        undefined,
        `renderer ${r.id} must not declare mode — renderers are deterministic-only`,
      );
    }
  });
});
