/**
 * Invariant: every built-in extractor and rule declares its execution mode
 * explicitly as `deterministic`. The schema makes the field optional with
 * a deterministic default, so omitting it would still be valid — but the
 * project policy is to thread it explicitly so a future probabilistic
 * extension is the visible deviation, not a silent flip of the default.
 *
 * Providers and formatters are deterministic-only and MUST NOT carry the
 * field.
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
  it('every built-in extractor declares mode: deterministic', () => {
    const set = builtIns();
    assert.ok(set.extractors.length > 0, 'expected at least one built-in extractor');
    for (const d of set.extractors) {
      assert.equal(
        d.mode,
        'deterministic',
        `extractor ${d.id} should declare mode: 'deterministic'`,
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

  it('provider manifest does NOT declare mode (deterministic-only kind)', () => {
    const set = builtIns();
    for (const a of set.providers) {
      assert.equal(
        (a as unknown as Record<string, unknown>)['mode'],
        undefined,
        `provider ${a.id} must not declare mode — providers are deterministic-only`,
      );
    }
  });

  it('provider manifest declares an explorationDir (Provider §)', () => {
    const set = builtIns();
    assert.ok(set.providers.length > 0, 'expected at least one built-in provider');
    for (const p of set.providers) {
      assert.equal(
        typeof p.explorationDir,
        'string',
        `provider ${p.id} must declare explorationDir as a string`,
      );
      assert.ok(
        p.explorationDir.length > 0,
        `provider ${p.id} explorationDir must be non-empty`,
      );
    }
  });

  it('formatter manifest does NOT declare mode (deterministic-only kind)', () => {
    const set = builtIns();
    for (const f of set.formatters) {
      assert.equal(
        (f as unknown as Record<string, unknown>)['mode'],
        undefined,
        `formatter ${f.id} must not declare mode — formatters are deterministic-only`,
      );
    }
  });
});

describe('built-in extensions — qualified ids (spec § A.6)', () => {
  it('every built-in declares a pluginId of either "core" or "claude"', () => {
    const set = builtIns();
    const all = [
      ...set.providers,
      ...set.extractors,
      ...set.rules,
      ...set.formatters,
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
      ...set.providers,
      ...set.extractors,
      ...set.rules,
      ...set.formatters,
    ];
    for (const ext of all) {
      qualifiedByKindAndShort.set(`${ext.kind}:${ext.id}`, qualifiedExtensionId(ext.pluginId, ext.id));
    }

    // Claude bundle.
    assert.equal(qualifiedByKindAndShort.get('provider:claude'), 'claude/claude');
    assert.equal(qualifiedByKindAndShort.get('extractor:frontmatter'), 'claude/frontmatter');
    assert.equal(qualifiedByKindAndShort.get('extractor:slash'), 'claude/slash');
    assert.equal(qualifiedByKindAndShort.get('extractor:at-directive'), 'claude/at-directive');

    // Core kernel built-ins.
    assert.equal(qualifiedByKindAndShort.get('extractor:external-url-counter'), 'core/external-url-counter');
    assert.equal(qualifiedByKindAndShort.get('rule:trigger-collision'), 'core/trigger-collision');
    assert.equal(qualifiedByKindAndShort.get('rule:broken-ref'), 'core/broken-ref');
    assert.equal(qualifiedByKindAndShort.get('rule:superseded'), 'core/superseded');
    assert.equal(qualifiedByKindAndShort.get('rule:link-conflict'), 'core/link-conflict');
    assert.equal(qualifiedByKindAndShort.get('formatter:ascii'), 'core/ascii');
    assert.equal(qualifiedByKindAndShort.get('rule:validate-all'), 'core/validate-all');
  });

  it('listBuiltIns() rows carry pluginId verbatim', () => {
    const rows = listBuiltIns();
    for (const row of rows) {
      assert.ok(
        row.pluginId === 'core' || row.pluginId === 'claude',
        `Registry row ${row.kind}:${row.id} must carry pluginId; got ${JSON.stringify(row.pluginId)}`,
      );
    }
    // Smoke check the count: 1 provider + 4 extractors + 5 rules + 1 formatter = 11.
    assert.equal(rows.length, 11);
  });

  it('claude provider declares qualified action ids in kinds[<kind>].defaultRefreshAction', () => {
    const set = builtIns();
    const claude = set.providers.find((a) => a.id === 'claude');
    assert.ok(claude, 'expected the claude provider to be bundled');
    for (const [kind, entry] of Object.entries(claude.kinds)) {
      assert.match(
        entry.defaultRefreshAction,
        /^[a-z][a-z0-9]*(-[a-z0-9]+)*\/[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
        `defaultRefreshAction for kind ${kind} must be a qualified action id; got ${entry.defaultRefreshAction}`,
      );
    }
  });

  it('claude provider declares schema + schemaJson per kind (Phase 3 catalog)', () => {
    const set = builtIns();
    const claude = set.providers.find((a) => a.id === 'claude');
    if (!claude) throw new Error('expected the claude provider to be bundled');
    const expectedKinds = new Set(['skill', 'agent', 'command', 'hook', 'note']);
    const seen = new Set<string>();
    for (const [k, entry] of Object.entries(claude.kinds)) {
      seen.add(k);
      assert.equal(typeof entry.schema, 'string', `kinds.${k}.schema must be a string path`);
      assert.ok(entry.schema.endsWith('.schema.json'), `kinds.${k}.schema should point at a JSON Schema file`);
      assert.ok(entry.schemaJson !== null && typeof entry.schemaJson === 'object', `kinds.${k}.schemaJson must be a loaded JSON object`);
      const json = entry.schemaJson as { $id?: string };
      assert.equal(typeof json.$id, 'string', `kinds.${k}.schemaJson must declare an $id`);
    }
    for (const expected of expectedKinds) {
      assert.ok(seen.has(expected), `kind ${expected} must have a catalog entry`);
    }
  });
});
