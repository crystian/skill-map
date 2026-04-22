import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { normalizeTrigger } from './trigger-normalize.js';

describe('normalizeTrigger', () => {
  const cases: Array<[string, string]> = [
    ['Hacer Review', 'hacer review'],
    ['hacer-review', 'hacer review'],
    ['hacer_review', 'hacer review'],
    ['  hacer   review  ', 'hacer review'],
    ['Clúster', 'cluster'],
    ['/MyCommand', '/mycommand'],
    ['@FooDetector', '@foodetector'],
    ['skill-map:explore', 'skill map:explore'],
    ['', ''],
    ['foo bar', 'foo bar'], // NBSP collapses through step 4
    ['foo\tbar\nbaz', 'foo bar baz'], // tabs + newlines treated as whitespace
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      strictEqual(normalizeTrigger(input), expected);
    });
  }
});
