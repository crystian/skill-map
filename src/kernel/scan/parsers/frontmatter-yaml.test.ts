import { describe, it } from 'bun:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { frontmatterYamlParser } from './frontmatter-yaml.js';

describe('parsers/frontmatter-yaml', () => {
  it('parses well-formed frontmatter and preserves the body verbatim', () => {
    const raw = '---\nname: foo\ndescription: bar\n---\nbody text';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, { name: 'foo', description: 'bar' });
    strictEqual(out.frontmatterRaw, 'name: foo\ndescription: bar');
    strictEqual(out.body, 'body text');
  });

  it('returns empty frontmatter when there is no fence', () => {
    const raw = 'just body, no frontmatter';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.frontmatterRaw, '');
    strictEqual(out.body, raw);
  });

  it('returns empty frontmatter when YAML is malformed', () => {
    // Tab indentation inside a mapping is a YAML error.
    const raw = '---\nname: foo\n\tbad: tab\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.body, 'body');
  });

  it('strips prototype-pollution keys (`__proto__`, `constructor`, `prototype`)', () => {
    const raw = [
      '---',
      'name: ok',
      '__proto__:',
      '  evil: true',
      'constructor:',
      '  bad: true',
      'prototype:',
      '  also: bad',
      '---',
      'body',
    ].join('\n');
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(Object.keys(out.frontmatter).sort(), ['name']);
    strictEqual(out.frontmatter['name'], 'ok');
    // Sanity: no global prototype mutation leaked.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strictEqual((Object.prototype as any).evil, undefined);
  });

  it('handles CRLF line endings in the fence', () => {
    const raw = '---\r\nname: foo\r\n---\r\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, { name: 'foo' });
    strictEqual(out.body, 'body');
  });

  it('returns frontmatterRaw when frontmatter parses to a non-object (e.g. a list)', () => {
    // A YAML sequence at the top level — not an object. Parser should
    // not populate frontmatter (we only accept mapping shapes), but
    // frontmatterRaw still reflects what was between the fences.
    const raw = '---\n- one\n- two\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.frontmatterRaw, '- one\n- two');
    strictEqual(out.body, 'body');
  });

  it('uses path argument only for diagnostics — does not affect output', () => {
    const raw = '---\nname: x\n---\nbody';
    const a = frontmatterYamlParser.parse(raw, 'one/path.md');
    const b = frontmatterYamlParser.parse(raw, 'totally/different.md');
    deepStrictEqual(a, b);
  });
});
