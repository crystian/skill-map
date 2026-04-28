/**
 * Step 9.3 unit tests for the fake `RunnerPort`.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { makeFakeRunner } from '../src/runner.js';

describe('makeFakeRunner', () => {
  it('records every call in order', async () => {
    const runner = makeFakeRunner();
    await runner.run({ action: 'a', prompt: '1' });
    await runner.run({ action: 'a', prompt: '2' });
    strictEqual(runner.history.length, 2);
    strictEqual(runner.history[0]!.prompt, '1');
    strictEqual(runner.lastCall?.prompt, '2');
  });

  it('serves queued responses FIFO', async () => {
    const runner = makeFakeRunner();
    runner.queue({ text: 'first' });
    runner.queue({ text: 'second' });
    deepStrictEqual(await runner.run({ action: 'x', prompt: '' }), { text: 'first' });
    deepStrictEqual(await runner.run({ action: 'x', prompt: '' }), { text: 'second' });
  });

  it('falls back to the default when the queue empties', async () => {
    const runner = makeFakeRunner({ default: { text: 'fallback' } });
    deepStrictEqual(await runner.run({ action: 'x', prompt: '' }), { text: 'fallback' });
  });

  it('resetHistory keeps queued responses but drops history', async () => {
    const runner = makeFakeRunner();
    runner.queue({ text: 'kept' });
    await runner.run({ action: 'a', prompt: '' });
    strictEqual(runner.history.length, 1);
    runner.resetHistory();
    strictEqual(runner.history.length, 0);
    runner.queue({ text: 'still here' });
    deepStrictEqual(await runner.run({ action: 'a', prompt: '' }), { text: 'still here' });
  });
});
