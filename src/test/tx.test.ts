/**
 * `kernel/util/tx` — string interpolation helper for the project's
 * text tables (`*.texts.ts` files). Templates use `{{name}}` placeholders;
 * missing or null/undefined values throw — silent fallback would hide
 * a forgotten arg in production.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { tx } from '../kernel/util/tx.js';

describe('tx (template interpolation)', () => {
  it('replaces a single token', () => {
    assert.equal(tx('hello {{name}}', { name: 'world' }), 'hello world');
  });

  it('replaces multiple tokens', () => {
    assert.equal(
      tx('{{a}} + {{b}} = {{c}}', { a: 1, b: 2, c: 3 }),
      '1 + 2 = 3',
    );
  });

  it('coerces numeric values to string', () => {
    assert.equal(tx('count: {{n}}', { n: 42 }), 'count: 42');
  });

  it('replaces the same token in multiple positions', () => {
    assert.equal(
      tx('would copy {{path}} → {{path}}.bak', { path: '/tmp/db' }),
      'would copy /tmp/db → /tmp/db.bak',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    assert.equal(tx('hello {{ name }}', { name: 'arq' }), 'hello arq');
  });

  it('returns the template untouched when there are no placeholders', () => {
    assert.equal(tx('plain string', { extraneous: 'ignored' }), 'plain string');
  });

  it('throws on a missing variable', () => {
    assert.throws(
      () => tx('hello {{name}}', {} as Record<string, string>),
      /tx: missing variable "name"/,
    );
  });

  it('throws when a variable is undefined', () => {
    assert.throws(
      () => tx('x: {{x}}', { x: undefined as unknown as string }),
      /tx: variable "x" is null\/undefined/,
    );
  });

  it('throws when a variable is null', () => {
    assert.throws(
      () => tx('x: {{x}}', { x: null as unknown as string }),
      /tx: variable "x" is null\/undefined/,
    );
  });

  it('does NOT match single braces', () => {
    assert.equal(tx('{not a token}', {}), '{not a token}');
  });

  it('matches identifiers with underscores and digits', () => {
    assert.equal(
      tx('{{snake_case}} / {{withDigits9}}', { snake_case: 'a', withDigits9: 'b' }),
      'a / b',
    );
  });

  it('rejects identifiers that start with a digit (left literal)', () => {
    // The regex only matches identifiers starting with a letter — so
    // `{{1n}}` is left as a literal in the output.
    assert.equal(tx('{{1n}}', {}), '{{1n}}');
  });

  it('truncates very long templates in the error preview', () => {
    const longTemplate = 'x'.repeat(120) + '{{name}}';
    assert.throws(
      () => tx(longTemplate, {}),
      /tx: missing variable "name" for template ".+…"/,
    );
  });
});
