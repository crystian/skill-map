import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { KindRegistryService } from './kind-registry';

describe('KindRegistryService', () => {
  let service: KindRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(KindRegistryService);
    // Each test starts with a fresh document — wipe the injected style
    // tag in case a prior suite left one behind.
    document.getElementById('sm-kind-vars')?.remove();
  });

  it('starts empty', () => {
    expect(service.kinds()).toEqual([]);
    expect(service.lookup('agent')).toBeUndefined();
  });

  it('ingests a registry payload and exposes entries in insertion order', () => {
    service.ingest({
      agent: { providerId: 'claude', label: 'Agents', color: '#3b82f6' },
      skill: { providerId: 'claude', label: 'Skills', color: '#10b981' },
    });
    const names = service.kinds().map((k) => k.name);
    expect(names).toEqual(['agent', 'skill']);
  });

  it('lookup / labelOf / colorOf / iconOf work against ingested entries', () => {
    service.ingest({
      agent: {
        providerId: 'claude',
        label: 'Agents',
        color: '#3b82f6',
        colorDark: '#60a5fa',
        icon: { kind: 'pi', id: 'pi-user' },
      },
    });
    expect(service.lookup('agent')?.label).toBe('Agents');
    expect(service.labelOf('agent')).toBe('Agents');
    expect(service.colorOf('agent', 'light')).toBe('#3b82f6');
    expect(service.colorOf('agent', 'dark')).toBe('#60a5fa');
    expect(service.iconOf('agent')).toEqual({ kind: 'pi', id: 'pi-user' });
  });

  it('colorOf falls back to color when colorDark is absent', () => {
    service.ingest({
      foo: { providerId: 'p', label: 'Foo', color: '#abcdef' },
    });
    expect(service.colorOf('foo', 'dark')).toBe('#abcdef');
  });

  it('lookups for unknown kinds return undefined / sentinel values', () => {
    expect(service.lookup('unknown')).toBeUndefined();
    expect(service.labelOf('unknown')).toBe('unknown');
    expect(service.colorOf('unknown')).toBe('#9ca3af');
    expect(service.iconOf('unknown')).toBeUndefined();
  });

  it('ingest is idempotent — re-ingesting the same payload does not flip the signal', () => {
    const payload = {
      agent: { providerId: 'claude', label: 'Agents', color: '#3b82f6' },
    };
    service.ingest(payload);
    const first = service.kinds();
    service.ingest(payload);
    expect(service.kinds()).toBe(first);
  });

  it('applyCssVars injects --sm-kind-* and --sm-kind-*-bg/-fg into a managed <style> tag', () => {
    service.ingest({
      agent: {
        providerId: 'claude',
        label: 'Agents',
        color: '#3b82f6',
        colorDark: '#60a5fa',
      },
    });
    const styleEl = document.getElementById('sm-kind-vars');
    expect(styleEl).not.toBeNull();
    const css = styleEl!.textContent ?? '';
    expect(css).toContain(':root {');
    expect(css).toContain('--sm-kind-agent: #3b82f6;');
    expect(css).toContain('--sm-kind-agent-bg:');
    expect(css).toContain('--sm-kind-agent-fg:');
    expect(css).toContain('.app-dark {');
    expect(css).toContain('--sm-kind-agent: #60a5fa;');
  });

  it('re-ingest with different payload updates the same <style> tag (no duplicates)', () => {
    service.ingest({ agent: { providerId: 'claude', label: 'Agents', color: '#3b82f6' } });
    service.ingest({ skill: { providerId: 'claude', label: 'Skills', color: '#10b981' } });
    const tags = document.querySelectorAll('#sm-kind-vars');
    expect(tags.length).toBe(1);
    const css = tags[0]!.textContent ?? '';
    expect(css).not.toContain('--sm-kind-agent:');
    expect(css).toContain('--sm-kind-skill: #10b981;');
  });

  it('ingest tolerates a null / undefined payload (no-op)', () => {
    service.ingest({ agent: { providerId: 'claude', label: 'Agents', color: '#3b82f6' } });
    const before = service.kinds();
    service.ingest(null);
    service.ingest(undefined);
    expect(service.kinds()).toBe(before);
  });
});
