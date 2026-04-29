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
 *
 * This file also doubles as the qualified-id contract test for built-ins
 * (spec § A.6): every built-in declares a `pluginId` (`core` or `claude`)
 * and `listBuiltIns()` surfaces it on every Registry-ready row.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { builtIns, listBuiltIns } from '../extensions/built-ins.js';
import { qualifiedExtensionId } from '../kernel/registry.js';

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

describe('built-in extensions — qualified ids (spec § A.6)', () => {
  it('every built-in declares a pluginId of either "core" or "claude"', () => {
    const set = builtIns();
    const all = [
      ...set.adapters,
      ...set.detectors,
      ...set.rules,
      ...set.renderers,
      ...set.audits,
    ];
    for (const ext of all) {
      assert.ok(
        ext.pluginId === 'core' || ext.pluginId === 'claude',
        `${ext.kind}:${ext.id} must declare pluginId 'core' or 'claude'; got ${JSON.stringify(ext.pluginId)}`,
      );
    }
  });

  it('built-in qualified id catalogue matches the spec mapping', () => {
    const set = builtIns();
    const qualifiedByKindAndShort = new Map<string, string>();
    const all = [
      ...set.adapters,
      ...set.detectors,
      ...set.rules,
      ...set.renderers,
      ...set.audits,
    ];
    for (const ext of all) {
      qualifiedByKindAndShort.set(`${ext.kind}:${ext.id}`, qualifiedExtensionId(ext.pluginId, ext.id));
    }

    // Claude bundle.
    assert.equal(qualifiedByKindAndShort.get('adapter:claude'), 'claude/claude');
    assert.equal(qualifiedByKindAndShort.get('detector:frontmatter'), 'claude/frontmatter');
    assert.equal(qualifiedByKindAndShort.get('detector:slash'), 'claude/slash');
    assert.equal(qualifiedByKindAndShort.get('detector:at-directive'), 'claude/at-directive');

    // Core kernel built-ins.
    assert.equal(qualifiedByKindAndShort.get('detector:external-url-counter'), 'core/external-url-counter');
    assert.equal(qualifiedByKindAndShort.get('rule:trigger-collision'), 'core/trigger-collision');
    assert.equal(qualifiedByKindAndShort.get('rule:broken-ref'), 'core/broken-ref');
    assert.equal(qualifiedByKindAndShort.get('rule:superseded'), 'core/superseded');
    assert.equal(qualifiedByKindAndShort.get('rule:link-conflict'), 'core/link-conflict');
    assert.equal(qualifiedByKindAndShort.get('renderer:ascii'), 'core/ascii');
    assert.equal(qualifiedByKindAndShort.get('audit:validate-all'), 'core/validate-all');
  });

  it('listBuiltIns() rows carry pluginId verbatim', () => {
    const rows = listBuiltIns();
    for (const row of rows) {
      assert.ok(
        row.pluginId === 'core' || row.pluginId === 'claude',
        `Registry row ${row.kind}:${row.id} must carry pluginId; got ${JSON.stringify(row.pluginId)}`,
      );
    }
    // Smoke check the count: 1 adapter + 4 detectors + 4 rules + 1 renderer + 1 audit = 11.
    assert.equal(rows.length, 11);
  });

  it('claude adapter declares qualified action ids in defaultRefreshAction', () => {
    const set = builtIns();
    const claude = set.adapters.find((a) => a.id === 'claude');
    assert.ok(claude, 'expected the claude adapter to be bundled');
    for (const [kind, action] of Object.entries(claude.defaultRefreshAction)) {
      assert.match(
        String(action),
        /^[a-z][a-z0-9]*(-[a-z0-9]+)*\/[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
        `defaultRefreshAction for kind ${kind} must be a qualified action id; got ${action}`,
      );
    }
  });
});
