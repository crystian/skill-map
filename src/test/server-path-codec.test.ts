/**
 * `src/server/path-codec.ts` — base64url encode/decode round-trip + edge cases.
 *
 * The codec is the wire format for `/api/nodes/:pathB64`. The mirror at
 * `ui/src/services/data-source/path-codec.ts` (Step 14.3) MUST produce
 * identical output — these tests pin the contract.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  decodeNodePath,
  encodeNodePath,
  PathCodecError,
} from '../server/path-codec.js';

describe('server path-codec — base64url for node.path', () => {
  it('round-trips a typical POSIX path with slashes', () => {
    const path = '.claude/agents/architect.md';
    const encoded = encodeNodePath(path);
    assert.equal(decodeNodePath(encoded), path);
    // Base64url alphabet only — no `/`, no `+`, no `=`.
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  });

  it('round-trips a path with unicode characters', () => {
    const path = '.claude/notas/teoria-de-grafos.md';
    const encoded = encodeNodePath(path);
    assert.equal(decodeNodePath(encoded), path);
  });

  it('round-trips a path with spaces and shell metacharacters', () => {
    const path = '.claude/skills/Hello World!/intro.md';
    const encoded = encodeNodePath(path);
    assert.equal(decodeNodePath(encoded), path);
  });

  it('round-trips a very long path (depth + length stress)', () => {
    const segments = Array.from({ length: 32 }, (_, i) => `seg-${i}`);
    const path = segments.join('/') + '/file.md';
    const encoded = encodeNodePath(path);
    assert.equal(decodeNodePath(encoded), path);
  });

  it('round-trips a single-character path', () => {
    const path = 'a';
    const encoded = encodeNodePath(path);
    assert.equal(decodeNodePath(encoded), path);
  });

  it('produces base64url output (no `+`, `/`, or `=` padding)', () => {
    // 'subjects?' encodes to bytes that include `+` / `/` in standard
    // base64; base64url replaces them with `-` / `_`.
    const path = 'subjects?';
    const encoded = encodeNodePath(path);
    assert.doesNotMatch(encoded, /[+/=]/);
  });

  it('rejects empty input with PathCodecError', () => {
    assert.throws(() => decodeNodePath(''), PathCodecError);
  });

  it('rejects characters outside the base64url alphabet', () => {
    assert.throws(() => decodeNodePath('AAA=='), PathCodecError);   // `=` is padding
    assert.throws(() => decodeNodePath('AAA/BBB'), PathCodecError); // `/` is std base64
    assert.throws(() => decodeNodePath('AAA+BBB'), PathCodecError); // `+` is std base64
    assert.throws(() => decodeNodePath('AAA BBB'), PathCodecError); // whitespace
  });

  it('rejects single-character pathB64 (decodes to empty bytes — non-canonical)', () => {
    // 1 char in base64url decodes to zero usable bytes — Node returns
    // `''` for `Buffer.from('A', 'base64url').toString('utf8')` and the
    // re-encode of `''` is `''`, which fails the round-trip check.
    assert.throws(() => decodeNodePath('A'), PathCodecError);
  });

  it('produces a unique encoding for distinct inputs (collision check on common paths)', () => {
    const a = encodeNodePath('a/b.md');
    const b = encodeNodePath('a/c.md');
    const c = encodeNodePath('A/B.md');
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.notEqual(b, c);
  });
});
