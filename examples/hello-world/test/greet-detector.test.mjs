/**
 * Reference test for the `hello-world-greet` detector.
 *
 * Drives the detector through `runDetectorOnFixture` from
 * `@skill-map/testkit`. No build step, no kernel, no DB — pure
 * function-call wiring.
 */

import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { node, runDetectorOnFixture } from '@skill-map/testkit';

import detector from '../extensions/greet-detector.mjs';

test('emits one link per distinct [[greet:<name>]] token', async () => {
  const links = await runDetectorOnFixture(detector, {
    body: 'Talk to [[greet:architect]] or [[greet:sre]] when in doubt.',
    context: { node: node({ path: 'sample.md' }) },
  });
  strictEqual(links.length, 2);
  strictEqual(links[0].source, 'sample.md');
  strictEqual(links[0].target, 'architect');
  strictEqual(links[1].target, 'sre');
});

test('deduplicates repeated tokens within a node', async () => {
  const links = await runDetectorOnFixture(detector, {
    body: '[[greet:architect]] again [[greet:architect]] and one more [[greet:ARCHITECT]]',
  });
  strictEqual(links.length, 1, `expected 1 link; got ${links.length}`);
  strictEqual(links[0].target, 'architect');
});

test('returns empty when the body has no greet tokens', async () => {
  const links = await runDetectorOnFixture(detector, { body: 'no greets here' });
  deepStrictEqual(links, []);
});

test('emits the manifest-required link kind only', async () => {
  const links = await runDetectorOnFixture(detector, {
    body: '[[greet:foo]]',
  });
  strictEqual(links[0].kind, 'references');
  strictEqual(links[0].confidence, 'medium');
  deepStrictEqual(links[0].sources, ['hello-world-greet']);
});

test('does not collide with built-in @<token> patterns', async () => {
  // @greet:foo would have collided with the built-in at-directive
  // detector before Step 9.4 polish — the wikilink form sidesteps it.
  const links = await runDetectorOnFixture(detector, {
    body: 'Mention @architect (built-in territory) and [[greet:architect]] (plugin territory).',
  });
  // The plugin only fires on its own pattern; the bare @architect is
  // ignored by this detector (the built-in at-directive picks it up).
  strictEqual(links.length, 1);
  strictEqual(links[0].target, 'architect');
  strictEqual(links[0].trigger.originalTrigger, '[[greet:architect]]');
});

// --- additional edge cases -------------------------------------------------

test('matches token at the very start of the body', async () => {
  const links = await runDetectorOnFixture(detector, { body: '[[greet:start]] is the first thing.' });
  strictEqual(links.length, 1);
  strictEqual(links[0].target, 'start');
});

test('matches token at the very end of the body', async () => {
  const links = await runDetectorOnFixture(detector, { body: 'last thing: [[greet:end]]' });
  strictEqual(links.length, 1);
  strictEqual(links[0].target, 'end');
});

test('matches multiple tokens on the same line', async () => {
  const links = await runDetectorOnFixture(detector, {
    body: '[[greet:a]] [[greet:b]] [[greet:c]]',
  });
  strictEqual(links.length, 3);
  deepStrictEqual(
    links.map((l) => l.target),
    ['a', 'b', 'c'],
  );
});

test('accepts hyphens, digits, and underscores in the name', async () => {
  const links = await runDetectorOnFixture(detector, {
    body: '[[greet:senior-architect]] [[greet:agent_42]] [[greet:v2-stable]]',
  });
  strictEqual(links.length, 3);
  deepStrictEqual(
    links.map((l) => l.target),
    ['senior-architect', 'agent_42', 'v2-stable'],
  );
});

test('rejects malformed bracket variants', async () => {
  // None of these should match — single brackets, missing close, missing
  // prefix, wrong prefix.
  const links = await runDetectorOnFixture(detector, {
    body: '[greet:single] [[greet:unclosed [[ref:wrong-prefix]] [[GREETING:wrong]] ',
  });
  deepStrictEqual(links, []);
});

test('case-insensitive on the prefix; lowercases the name', async () => {
  const links = await runDetectorOnFixture(detector, {
    body: '[[GREET:Architect]] and [[Greet:SRE]]',
  });
  strictEqual(links.length, 2);
  strictEqual(links[0].target, 'architect');
  strictEqual(links[1].target, 'sre');
});

test('preserves the original trigger string verbatim in trigger.originalTrigger', async () => {
  const links = await runDetectorOnFixture(detector, {
    body: '[[GREET:Architect]]',
  });
  strictEqual(links[0].trigger.originalTrigger, '[[GREET:Architect]]');
  strictEqual(links[0].trigger.normalizedTrigger, '[[greet:architect]]');
});

test('source field reflects the node path passed in context', async () => {
  const links = await runDetectorOnFixture(detector, {
    body: '[[greet:x]]',
    context: { node: node({ path: 'deep/nested/file.md' }) },
  });
  strictEqual(links[0].source, 'deep/nested/file.md');
});

test('empty body produces no links', async () => {
  deepStrictEqual(await runDetectorOnFixture(detector, { body: '' }), []);
});

test('many tokens scale linearly (smoke for non-pathological regex)', async () => {
  // 200 distinct tokens; every one should match. Catches accidental
  // catastrophic backtracking patterns introduced by future edits.
  const tokens = Array.from({ length: 200 }, (_, i) => `[[greet:n${i}]]`);
  const body = tokens.join(' ');
  const links = await runDetectorOnFixture(detector, { body });
  strictEqual(links.length, 200);
  strictEqual(links[0].target, 'n0');
  strictEqual(links[199].target, 'n199');
});
