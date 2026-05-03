/**
 * Step 14.5.a — `node-body.ts` unit tests.
 *
 * The route layer (`/api/nodes/:pathB64?include=body`) is exercised
 * end-to-end in `server-endpoints.test.ts`. These tests cover the
 * pure helpers in isolation: `stripFrontmatter` and `readNodeBody`'s
 * path-traversal / missing-file branches.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { readNodeBody, stripFrontmatter } from '../server/node-body.js';

let scratch: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'skill-map-node-body-'));
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('stripFrontmatter()', () => {
  it('returns the input unchanged when no leading `---` is present', () => {
    const raw = '# Heading\n\nbody text.\n';
    assert.equal(stripFrontmatter(raw), raw);
  });

  it('strips a standard `---\\n…\\n---\\n` block (preserves the blank line the author placed under the closer)', () => {
    const raw = ['---', 'name: foo', 'description: bar', '---', '', 'body line 1', 'body line 2', ''].join('\n');
    // The blank line between `---` and `body line 1` is part of the
    // body — the author wrote it. The stripper removes ONLY the
    // delimiter pair plus its trailing newline.
    assert.equal(stripFrontmatter(raw), '\nbody line 1\nbody line 2\n');
  });

  it('strips a trailing-CRLF frontmatter block', () => {
    const raw = '---\r\nname: foo\r\n---\r\nhello\r\n';
    assert.equal(stripFrontmatter(raw), 'hello\r\n');
  });

  it('returns the input unchanged when the closing delimiter is missing', () => {
    // No closing `---` — treat the leading line as part of the body so
    // the user sees something rather than getting silently emptied out.
    const raw = '---\nname: foo\nbody but no closer\n';
    assert.equal(stripFrontmatter(raw), raw);
  });

  it('does NOT strip a `---` thematic break in the middle of a document', () => {
    const raw = 'intro\n\n---\n\nrest\n';
    assert.equal(stripFrontmatter(raw), raw);
  });

  it('handles an empty frontmatter block', () => {
    const raw = '---\n---\nbody.\n';
    assert.equal(stripFrontmatter(raw), 'body.\n');
  });
});

describe('readNodeBody()', () => {
  it('reads a markdown file and returns its post-frontmatter body', async () => {
    writeFileSync(
      join(scratch, 'note.md'),
      ['---', 'name: note', '---', 'hello body.', ''].join('\n'),
    );
    const body = await readNodeBody(scratch, 'note.md');
    assert.equal(body, 'hello body.\n');
  });

  it('returns null when the relative path does not exist on disk', async () => {
    const body = await readNodeBody(scratch, 'no-such-file.md');
    assert.equal(body, null);
  });

  it('returns null when the resolved path is a directory (EISDIR)', async () => {
    mkdirSync(join(scratch, 'dir-node'), { recursive: true });
    const body = await readNodeBody(scratch, 'dir-node');
    assert.equal(body, null);
  });

  it('refuses paths that escape the scope root via `..`', async () => {
    // Plant a file OUTSIDE the scratch root that an attacker would want
    // to leak. `readNodeBody` must refuse the traversal regardless of
    // whether the target exists.
    const body = await readNodeBody(scratch, '../../etc/passwd');
    assert.equal(body, null);
  });

  it('refuses an absolute path even when it points inside the root', async () => {
    // Defense in depth: even if the absolute path happens to resolve
    // inside the root, the API contract is "node.path is relative" —
    // accepting absolute paths would let a corrupted DB row leak any
    // file the server process can read.
    const abs = join(scratch, 'note.md');
    const body = await readNodeBody(scratch, abs);
    assert.equal(body, null);
  });

  it('returns the raw file content when the file has no frontmatter', async () => {
    writeFileSync(join(scratch, 'plain.md'), '# just a heading\n\nno fm here.\n');
    const body = await readNodeBody(scratch, 'plain.md');
    assert.equal(body, '# just a heading\n\nno fm here.\n');
  });
});
