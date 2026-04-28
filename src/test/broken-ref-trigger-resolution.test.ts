/**
 * Regression test — the `broken-ref` rule MUST resolve invocation-style
 * triggers (`/foo`, `@bar`) against advertised `frontmatter.name` of any
 * scanned node. Fired during Step 9 manual QA when `/deploy` falsely
 * tripped broken-ref despite a `deploy.md` with `name: deploy` in the
 * scan: the original incident was the heredoc-paste auto-indent bug
 * (now caught by `frontmatter-malformed` in Step 9 follow-up), but the
 * resolution semantic itself was never asserted in isolation. This file
 * locks the contract:
 *
 *   - `/deploy` link resolves to a node where `frontmatter.name === 'deploy'`
 *   - `@architect` link resolves to a node where `frontmatter.name === 'architect'`
 *   - Trigger normalisation applies on both sides (case, hyphens, accents)
 *   - Path-style targets (`.claude/commands/foo.md`) still resolve via
 *     verbatim path lookup (frontmatter detector path)
 *   - When neither path lookup nor name index matches, broken-ref fires.
 *
 * The rule has unit-level coverage via the orchestrator-level scan test
 * (scan-readers.test.ts builds a fixture that exercises broken-ref +2
 * times by design). Those tests prove the rule fires on intentionally
 * unresolvable refs; this file proves the inverse — that genuinely
 * resolvable refs DON'T fire.
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns } from '../extensions/built-ins.js';

let tmpRoot: string;
let counter = 0;

function freshFixture(label: string): string {
  counter += 1;
  const dir = join(tmpRoot, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeNode(fixture: string, rel: string, content: string): void {
  const full = join(fixture, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-broken-ref-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function scan(fixture: string) {
  const kernel = createKernel();
  return runScan(kernel, { roots: [fixture], extensions: builtIns() });
}

describe('broken-ref — trigger resolution against frontmatter.name', () => {
  it('/deploy resolves to a command whose frontmatter.name is "deploy"', async () => {
    const fixture = freshFixture('slash-resolved');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: Architect.',
        '---',
        '',
        'Use /deploy when the build is green.',
      ].join('\n'),
    );
    writeNode(
      fixture,
      '.claude/commands/deploy.md',
      [
        '---',
        'name: deploy',
        'description: Deploy command.',
        '---',
        '',
        'Deploy body.',
      ].join('\n'),
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.ruleId === 'broken-ref');
    const slashIssue = brokenRefs.find(
      (i) => typeof i.data?.['trigger'] === 'string' && (i.data['trigger'] as string).includes('deploy'),
    );
    assert.equal(
      slashIssue,
      undefined,
      `/deploy must NOT trigger broken-ref when a node advertises name: deploy.\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('@architect resolves to an agent whose frontmatter.name is "architect"', async () => {
    const fixture = freshFixture('at-resolved');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      '---\nname: architect\ndescription: A.\n---\nbody\n',
    );
    writeNode(
      fixture,
      '.claude/skills/explorer.md',
      '---\nname: explorer\ndescription: E.\n---\nConsult @architect for review.\n',
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.ruleId === 'broken-ref');
    assert.equal(
      brokenRefs.length,
      0,
      `@architect must resolve when an agent advertises name: architect.\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('genuinely unresolvable trigger DOES fire broken-ref', async () => {
    const fixture = freshFixture('unresolved');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      '---\nname: architect\ndescription: A.\n---\nUse /missing-command somewhere.\n',
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.ruleId === 'broken-ref');
    assert.equal(brokenRefs.length, 1, 'expected exactly 1 broken-ref');
    assert.match(brokenRefs[0]!.message, /\/missing-command/);
  });

  it('case-insensitive name matching (Architect ↔ /architect)', async () => {
    const fixture = freshFixture('case');
    writeNode(
      fixture,
      '.claude/agents/Architect.md',
      '---\nname: Architect\ndescription: A.\n---\nbody\n',
    );
    writeNode(
      fixture,
      '.claude/skills/explorer.md',
      '---\nname: explorer\ndescription: E.\n---\nMention @architect (lowercase).\n',
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.ruleId === 'broken-ref');
    assert.equal(
      brokenRefs.length,
      0,
      `Case-insensitive normalisation should resolve @architect to name=Architect.\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('hyphen-vs-space normalisation (name: "build deploy" ↔ /build-deploy)', async () => {
    const fixture = freshFixture('hyphen');
    writeNode(
      fixture,
      '.claude/commands/build-deploy.md',
      '---\nname: build deploy\ndescription: B.\n---\nbody\n',
    );
    writeNode(
      fixture,
      '.claude/skills/explorer.md',
      '---\nname: explorer\ndescription: E.\n---\nRun /build-deploy when ready.\n',
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.ruleId === 'broken-ref');
    assert.equal(
      brokenRefs.length,
      0,
      `normalizeTrigger must equate "build deploy" with "build-deploy".\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('path-style target (frontmatter detector) still uses verbatim path lookup', async () => {
    const fixture = freshFixture('path');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: A.',
        'metadata:',
        '  related:',
        '    - .claude/commands/deploy.md',
        '---',
        'body',
      ].join('\n'),
    );
    writeNode(
      fixture,
      '.claude/commands/deploy.md',
      '---\nname: deploy\ndescription: D.\n---\nbody\n',
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.ruleId === 'broken-ref');
    assert.equal(
      brokenRefs.length,
      0,
      `frontmatter.metadata.related path resolves verbatim to .claude/commands/deploy.md.\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('path-style target that does NOT exist fires broken-ref', async () => {
    const fixture = freshFixture('path-missing');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: A.',
        'metadata:',
        '  related:',
        '    - .claude/commands/does-not-exist.md',
        '---',
        'body',
      ].join('\n'),
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.ruleId === 'broken-ref');
    assert.equal(brokenRefs.length, 1);
    assert.match(brokenRefs[0]!.message, /does-not-exist\.md/);
  });
});
