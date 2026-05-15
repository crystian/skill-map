import { describe, it } from 'bun:test';
import { strictEqual, throws } from 'node:assert';

import { _unregisterParserForTests, getParser, registerParser } from './index.js';
import type { IFileParser } from './types.js';

describe('parsers/registry', () => {
  it('resolves the built-in `frontmatter-yaml` parser', () => {
    const p = getParser('frontmatter-yaml');
    strictEqual(p?.id, 'frontmatter-yaml');
  });

  it('resolves the built-in `plain` parser', () => {
    const p = getParser('plain');
    strictEqual(p?.id, 'plain');
  });

  it('returns undefined for an unknown id', () => {
    strictEqual(getParser('does-not-exist'), undefined);
  });

  it('rejects re-registration of a built-in id (frozen)', () => {
    const dup: IFileParser = {
      id: 'frontmatter-yaml',
      parse: () => ({ frontmatter: {}, frontmatterRaw: '', body: '' }),
    };
    throws(() => registerParser(dup), /built-in id/);
  });

  it('rejects re-registration of `plain` (frozen)', () => {
    const dup: IFileParser = {
      id: 'plain',
      parse: () => ({ frontmatter: {}, frontmatterRaw: '', body: '' }),
    };
    throws(() => registerParser(dup), /built-in id/);
  });

  it('allows registering a non-built-in id and resolving it', () => {
    const custom: IFileParser = {
      id: 'unit-test-only-parser',
      parse: (raw) => ({ frontmatter: { custom: true }, frontmatterRaw: '', body: raw }),
    };
    registerParser(custom);
    try {
      const got = getParser('unit-test-only-parser');
      strictEqual(got?.id, 'unit-test-only-parser');
    } finally {
      _unregisterParserForTests('unit-test-only-parser');
    }
  });

  it('refuses to unregister a built-in parser', () => {
    throws(() => _unregisterParserForTests('frontmatter-yaml'), /built-in/);
    throws(() => _unregisterParserForTests('plain'), /built-in/);
  });
});
