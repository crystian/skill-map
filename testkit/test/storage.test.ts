/**
 * Step 9.3 unit tests for the in-memory KV stand-in.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { makeFakeStorage } from '../src/storage.js';

describe('makeFakeStorage', () => {
  it('round-trips set / get', async () => {
    const store = makeFakeStorage();
    await store.set('k', { v: 1 });
    deepStrictEqual(await store.get('k'), { v: 1 });
  });

  it('seed via initial', async () => {
    const store = makeFakeStorage({ initial: { 'a': 1, 'b': 2 } });
    strictEqual(await store.get<number>('a'), 1);
    strictEqual(await store.get<number>('b'), 2);
  });

  it('list filters by prefix', async () => {
    const store = makeFakeStorage({ initial: { 'p:1': true, 'p:2': true, 'q:1': true } });
    deepStrictEqual((await store.list('p:')).sort(), ['p:1', 'p:2']);
    deepStrictEqual((await store.list()).sort(), ['p:1', 'p:2', 'q:1']);
  });

  it('delete removes the key', async () => {
    const store = makeFakeStorage({ initial: { gone: 'soon' } });
    await store.delete('gone');
    strictEqual(await store.get('gone'), undefined);
  });
});
