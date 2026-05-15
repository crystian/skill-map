import { describe, it } from 'bun:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { plainParser } from './plain.js';

describe('parsers/plain', () => {
  it('treats the entire raw as the body; empty frontmatter', () => {
    const raw = 'just plain content\nmultiple lines\n';
    const out = plainParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.frontmatterRaw, '');
    strictEqual(out.body, raw);
  });

  it('handles empty input', () => {
    const out = plainParser.parse('', 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.frontmatterRaw, '');
    strictEqual(out.body, '');
  });

  it('does NOT recognise YAML-looking frontmatter — pass-through', () => {
    const raw = '---\nname: foo\n---\nbody';
    const out = plainParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.frontmatterRaw, '');
    strictEqual(out.body, raw);
  });

  it('preserves CRLF line endings verbatim', () => {
    const raw = 'line one\r\nline two\r\n';
    const out = plainParser.parse(raw, 'test.md');
    strictEqual(out.body, raw);
  });
});
