import { describe, expect, it } from 'vitest';

import { parseEmbedConfig, readEmbedConfigFromLocation } from '../embed-mode';

describe('parseEmbedConfig', () => {
  it('is off without the flag', () => {
    expect(parseEmbedConfig('')).toBeNull();
    expect(parseEmbedConfig('?replay=main:x&theme=neon-blue')).toBeNull();
  });

  it('only the literal embed=1 enables it', () => {
    expect(parseEmbedConfig('?embed')).toBeNull();
    expect(parseEmbedConfig('?embed=true')).toBeNull();
    expect(parseEmbedConfig('?embed=0')).toBeNull();
    expect(parseEmbedConfig('?embed=1')).toEqual({ theme: null });
  });

  it('carries the requested theme, empty collapses to null', () => {
    expect(parseEmbedConfig('?embed=1&theme=neon-blue')).toEqual({ theme: 'neon-blue' });
    expect(parseEmbedConfig('?theme=dark&embed=1&replay=main:x')).toEqual({ theme: 'dark' });
    expect(parseEmbedConfig('?embed=1&theme=')).toEqual({ theme: null });
  });

  it('reads the document location (jsdom boots without the flag)', () => {
    expect(readEmbedConfigFromLocation()).toBeNull();
  });
});
