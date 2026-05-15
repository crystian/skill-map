import { describe, it } from 'bun:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { buildKindRegistry } from './kind-registry.js';
import type { IProvider } from '../kernel/extensions/index.js';

/** Minimal IProvider shaped for the kindRegistry tests. */
function fakeProvider(id: string, kinds: IProvider['kinds']): IProvider {
  return {
    id,
    pluginId: id,
    kind: 'provider',
    version: '1.0.0',
    explorationDir: `~/.${id}`,
    kinds,
    classify: () => 'unknown',
  };
}

describe('buildKindRegistry', () => {
  it('builds an entry per kind a single provider declares', () => {
    const claude = fakeProvider('claude', {
      agent: {
        schema: './a.json',
        schemaJson: {},
        defaultRefreshAction: 'claude/a',
        ui: { label: 'Agents', color: '#3b82f6', colorDark: '#60a5fa' },
      },
      skill: {
        schema: './s.json',
        schemaJson: {},
        defaultRefreshAction: 'claude/s',
        ui: { label: 'Skills', color: '#10b981' },
      },
    });
    const registry = buildKindRegistry([claude]);
    deepStrictEqual(Object.keys(registry).sort(), ['agent', 'skill']);
    strictEqual(registry['agent']!.primaryProviderId, 'claude');
    deepStrictEqual(Object.keys(registry['agent']!.providers), ['claude']);
    strictEqual(registry['agent']!.providers['claude']!.label, 'Agents');
    strictEqual(registry['agent']!.providers['claude']!.color, '#3b82f6');
    strictEqual(registry['agent']!.providers['claude']!.colorDark, '#60a5fa');
    strictEqual(registry['skill']!.providers['claude']!.colorDark, undefined);
  });

  it('cross-provider sharing — both contributions kept under `providers`, primary stays first', () => {
    const claude = fakeProvider('claude', {
      agent: {
        schema: './a.json',
        schemaJson: {},
        defaultRefreshAction: 'claude/a',
        ui: { label: 'Agents', color: '#3b82f6' },
      },
    });
    const gemini = fakeProvider('gemini', {
      agent: {
        schema: './ga.json',
        schemaJson: {},
        defaultRefreshAction: 'gemini/a',
        ui: { label: 'Gemini Agents', color: '#9b72cb' },
      },
    });
    const registry = buildKindRegistry([claude, gemini]);
    strictEqual(registry['agent']!.primaryProviderId, 'claude');
    deepStrictEqual(Object.keys(registry['agent']!.providers).sort(), ['claude', 'gemini']);
    strictEqual(registry['agent']!.providers['claude']!.color, '#3b82f6');
    strictEqual(registry['agent']!.providers['gemini']!.color, '#9b72cb');
  });

  it('order matters — first provider in the input array wins primaryProviderId', () => {
    const claude = fakeProvider('claude', {
      agent: {
        schema: './a.json',
        schemaJson: {},
        defaultRefreshAction: 'claude/a',
        ui: { label: 'Agents', color: '#3b82f6' },
      },
    });
    const gemini = fakeProvider('gemini', {
      agent: {
        schema: './ga.json',
        schemaJson: {},
        defaultRefreshAction: 'gemini/a',
        ui: { label: 'Gemini Agents', color: '#9b72cb' },
      },
    });
    const registryGeminiFirst = buildKindRegistry([gemini, claude]);
    strictEqual(registryGeminiFirst['agent']!.primaryProviderId, 'gemini');
    deepStrictEqual(
      Object.keys(registryGeminiFirst['agent']!.providers).sort(),
      ['claude', 'gemini'],
    );
  });

  it('empty providers array yields an empty registry', () => {
    deepStrictEqual(buildKindRegistry([]), {});
  });
});
