import { describe, expect, it } from 'vitest';

import { PathCodecError, decodeNodePath, encodeNodePath } from './path-codec';

describe('path-codec', () => {
  describe('encodeNodePath / decodeNodePath round-trip', () => {
    const cases: { name: string; input: string }[] = [
      { name: 'simple ascii', input: 'foo' },
      { name: 'with slash', input: '.claude/agents/foo.md' },
      { name: 'with dot prefix', input: '.skill-map/db.sqlite' },
      { name: 'unicode (latin)', input: 'résumé/notas.md' },
      { name: 'unicode (japanese)', input: 'ノート/さくせい.md' },
      { name: 'unicode (emoji)', input: 'fixtures/🚀-launch.md' },
      { name: 'long path', input: 'a/'.repeat(50) + 'leaf.md' },
      // Force-encode to verify both `/` and `+` survive the URL-safe alphabet swap.
      { name: 'binary-leaning', input: '?/+=&space here.md' },
    ];

    for (const { name, input } of cases) {
      it(`round-trips: ${name}`, () => {
        const encoded = encodeNodePath(input);
        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(encoded).not.toContain('=');
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
        const decoded = decodeNodePath(encoded);
        expect(decoded).toBe(input);
      });
    }
  });

  describe('decodeNodePath rejection cases', () => {
    it('rejects empty input', () => {
      expect(() => decodeNodePath('')).toThrow(PathCodecError);
    });

    it('rejects characters outside base64url alphabet', () => {
      expect(() => decodeNodePath('foo+bar')).toThrow(PathCodecError);
      expect(() => decodeNodePath('foo/bar')).toThrow(PathCodecError);
      expect(() => decodeNodePath('foo=bar')).toThrow(PathCodecError);
      expect(() => decodeNodePath('foo bar')).toThrow(PathCodecError);
    });

    it('rejects input that does not round-trip', () => {
      // 'AAAA' decodes to three null bytes; their re-encode still 'AAAA' so this
      // round-trips. Use a payload with valid chars but an invalid byte tail.
      // Single-char base64 input is illegal — but the alphabet check passes,
      // so the round-trip / atob layer must catch it.
      expect(() => decodeNodePath('A')).toThrow(PathCodecError);
    });
  });

  describe('encodeNodePath produces URL-safe alphabet only', () => {
    it('replaces + with - and / with _', () => {
      // 'subjects?' -> base64 contains '+' and '/' — encodeNodePath must rewrite.
      const out = encodeNodePath('?>?>?>?>?>');
      expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});
