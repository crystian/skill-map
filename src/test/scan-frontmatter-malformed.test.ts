/**
 * Step 9.4 follow-up — `frontmatter-malformed` issue. The orchestrator
 * emits this when a file's body opens with an indented `---` line
 * followed by what looks like a YAML key-value pair. Without this
 * check, the most common terminal-paste accident (indentation
 * inserted in front of every line of a heredoc) parses silently as
 * "no frontmatter" and the metadata block is lost without warning.
 *
 * Asserted properties:
 *
 *   1. Indented `---` + YAML body → emits `frontmatter-malformed` warn.
 *   2. False-positive guard: a bare indented `---` (no YAML key after)
 *      is left alone — could be a horizontal rule.
 *   3. False-positive guard: a column-0 `---` that fails to YAML-parse
 *      goes through the existing `frontmatter-invalid` path, NOT this
 *      one (frontmatterRaw is non-empty in that case).
 *   4. `--strict` (or `runScan({ strict: true })`) promotes severity
 *      to `error`, mirroring the strict-fence rule.
 *   5. Incremental scans reuse the prior `frontmatter-malformed` issue
 *      for cached nodes (so the warning doesn't disappear on a clean
 *      re-scan).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../kernel/index.js';
import type { ScanResult } from '../kernel/index.js';
import { builtIns } from '../extensions/built-ins.js';

let root: string;
let counter = 0;

function freshFixture(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeNode(fixture: string, rel: string, body: string): void {
  const full = join(fixture, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-fm-malformed-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

async function scan(fixture: string, strict = false): Promise<ScanResult> {
  const kernel = createKernel();
  return runScan(kernel, { roots: [fixture], extensions: builtIns(), strict });
}

describe('frontmatter-malformed', () => {
  it('indented `---` + YAML body → emits warn issue', async () => {
    const fixture = freshFixture('indented');
    // Two leading spaces on every line — what the heredoc-paste bug produces.
    writeNode(
      fixture,
      '.claude/agents/indented.md',
      '  ---\n  name: indented\n  description: paste accident\n  ---\n  body line\n',
    );
    const result = await scan(fixture);
    const issue = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.ok(issue, `expected frontmatter-malformed issue; got: ${JSON.stringify(result.issues)}`);
    assert.equal(issue.severity, 'warn');
    assert.deepEqual(issue.nodeIds, ['.claude/agents/indented.md']);
    assert.match(issue.message, /column 0/);
  });

  it('--strict promotes the issue to error', async () => {
    const fixture = freshFixture('strict');
    writeNode(
      fixture,
      '.claude/agents/indented.md',
      '  ---\n  name: indented\n  ---\n',
    );
    const result = await scan(fixture, true);
    const issue = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.ok(issue);
    assert.equal(issue.severity, 'error');
  });

  it('false-positive guard: indented `---` with no YAML key after is left alone', async () => {
    const fixture = freshFixture('hr-only');
    writeNode(
      fixture,
      '.claude/agents/hr.md',
      // Indented `---` followed by prose — could be a list-continuation
      // horizontal rule. No `key: value` after, so the heuristic skips.
      '  ---\nThis is not frontmatter, just prose.\n',
    );
    const result = await scan(fixture);
    const malformed = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.equal(malformed, undefined);
  });

  it('false-positive guard: column-0 `---` with malformed YAML routes to frontmatter-invalid, not malformed', async () => {
    const fixture = freshFixture('col0-bad-yaml');
    writeNode(
      fixture,
      '.claude/agents/badyaml.md',
      // Column-0 fence parses as frontmatter, YAML loads as null/invalid
      // for our schema. Emits `frontmatter-invalid` (Step 6.7), NOT
      // `frontmatter-malformed`.
      '---\n: not valid yaml\n---\nbody\n',
    );
    const result = await scan(fixture);
    const malformed = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.equal(malformed, undefined, 'must not double-flag column-0 cases');
  });

  it('files with no `---` at all produce no malformed issue', async () => {
    const fixture = freshFixture('plain');
    writeNode(
      fixture,
      '.claude/agents/plain.md',
      'plain body, no frontmatter, no horizontal rule\n',
    );
    const result = await scan(fixture);
    const malformed = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.equal(malformed, undefined);
  });

  it('incremental scan caches the malformed issue for unchanged files', async () => {
    const fixture = freshFixture('cache');
    writeNode(
      fixture,
      '.claude/agents/indented.md',
      '  ---\n  name: indented\n  ---\n',
    );
    const first = await scan(fixture);
    assert.ok(
      first.issues.some((i) => i.ruleId === 'frontmatter-malformed'),
      'first pass must emit',
    );

    // Second pass with priorSnapshot + enableCache simulates `--changed`.
    const kernel = createKernel();
    const second = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
      priorSnapshot: first,
      enableCache: true,
    });
    const cached = second.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.ok(cached, `cached pass must reuse the issue; got: ${JSON.stringify(second.issues)}`);
    assert.equal(cached.severity, 'warn');
  });

  // --- additional edge cases -----------------------------------------------

  it('tab-indented `---` triggers the same heuristic as space-indented', async () => {
    const fixture = freshFixture('tab-indent');
    writeNode(
      fixture,
      '.claude/agents/tabbed.md',
      '\t---\n\tname: tabbed\n\tdescription: tab-indented\n\t---\n',
    );
    const result = await scan(fixture);
    const malformed = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.ok(malformed, `tab indent must trip the heuristic; got: ${JSON.stringify(result.issues)}`);
  });

  it('CRLF line endings are tolerated', async () => {
    const fixture = freshFixture('crlf');
    writeNode(
      fixture,
      '.claude/agents/win.md',
      '  ---\r\n  name: win\r\n  ---\r\n',
    );
    const result = await scan(fixture);
    assert.ok(result.issues.some((i) => i.ruleId === 'frontmatter-malformed'));
  });

  it('issue carries data.hint = "paste-with-indent" for downstream tooling', async () => {
    const fixture = freshFixture('hint');
    writeNode(
      fixture,
      '.claude/agents/h.md',
      '  ---\n  name: h\n  ---\n',
    );
    const result = await scan(fixture);
    const issue = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.ok(issue);
    assert.deepEqual(issue.data, { hint: 'paste-with-indent' });
  });

  it('mixed batch: one indented + one clean → only the indented file is flagged', async () => {
    const fixture = freshFixture('mixed-batch');
    writeNode(
      fixture,
      '.claude/agents/clean.md',
      '---\nname: clean\ndescription: ok\n---\nbody\n',
    );
    writeNode(
      fixture,
      '.claude/agents/dirty.md',
      '  ---\n  name: dirty\n  ---\n',
    );
    const result = await scan(fixture);
    const malformed = result.issues.filter((i) => i.ruleId === 'frontmatter-malformed');
    assert.equal(malformed.length, 1, 'exactly one node should be flagged');
    assert.deepEqual(malformed[0]?.nodeIds, ['.claude/agents/dirty.md']);
  });

  it('false-positive guard: indented `---` later in the body is ignored', async () => {
    const fixture = freshFixture('mid-body');
    writeNode(
      fixture,
      '.claude/agents/mid.md',
      // Body starts with prose, then has an indented `---: key:` deeper
      // inside a nested code block. The heuristic anchors at body start
      // (^), so this never trips.
      'plain prose\n\n  ```\n  ---\n  key: value\n  ```\n',
    );
    const result = await scan(fixture);
    const malformed = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.equal(malformed, undefined);
  });

  it('false-positive guard: column-0 horizontal rule (---) followed by prose is not flagged', async () => {
    const fixture = freshFixture('hr-col0');
    writeNode(
      fixture,
      '.claude/agents/hr.md',
      // A column-0 `---` followed by prose looks like a malformed
      // frontmatter (open fence, no close). The current adapter regex
      // requires both fences, so frontmatterRaw is empty and the
      // heuristic checks for INDENTED `---`. Column-0 with no second
      // fence is left alone — markdown horizontal rule.
      '---\nThis is a horizontal rule, not frontmatter.\n',
    );
    const result = await scan(fixture);
    const malformed = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.equal(malformed, undefined);
  });

  it('indented opening fence followed by colon-leading prose is flagged (key: value pattern)', async () => {
    const fixture = freshFixture('indent-yaml');
    writeNode(
      fixture,
      '.claude/agents/yaml.md',
      // Hyphenated key is allowed by the heuristic ([A-Za-z0-9_-]+:).
      '  ---\n  full-name: spec\n  ---\nbody\n',
    );
    const result = await scan(fixture);
    assert.ok(result.issues.some((i) => i.ruleId === 'frontmatter-malformed'));
  });

  it('the issue message is actionable — names the file and the column-0 rule', async () => {
    const fixture = freshFixture('msg');
    writeNode(
      fixture,
      '.claude/agents/m.md',
      '  ---\n  name: m\n  ---\n',
    );
    const result = await scan(fixture);
    const issue = result.issues.find((i) => i.ruleId === 'frontmatter-malformed');
    assert.ok(issue);
    assert.match(issue.message, /\.claude\/agents\/m\.md/);
    assert.match(issue.message, /column 0/);
    assert.match(issue.message, /Move the `---` lines/);
  });
});
