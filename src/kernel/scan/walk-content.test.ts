import { describe, it,beforeAll as before,afterAll as after} from 'bun:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { walkContent, UnknownParserError } from './walk-content.js';
import { buildIgnoreFilter } from './ignore.js';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'walk-content-'));

  const write = (rel: string, content: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  // Markdown files — primary content.
  write(
    'docs/a.md',
    ['---', 'name: a', 'description: alpha', '---', 'body of a'].join('\n'),
  );
  write('docs/b.md', 'no frontmatter here, just body');
  write('nested/inner/c.md', '---\nname: c\n---\nbody');

  // Non-matching extensions.
  write('docs/a.txt', 'should not be yielded under extensions: [".md"]');
  write('docs/a.toml', 'name = "toml"\ndescription = "stays"');

  // Files inside ignored directories.
  write('.git/HEAD', 'ref: refs/heads/main');
  write('node_modules/foo/thing.md', 'should be ignored');

  // Symlink at the root that points outside — must be skipped (M7).
  // We point at /etc/hostname which always exists on Linux; the test
  // asserts the walker did not yield it (ignored as a symlink, not
  // because of the ignore filter).
  try {
    symlinkSync('/etc/hostname', join(root, 'symlinked.md'));
  } catch {
    // Some sandboxes block symlink creation — the test still passes
    // because the file simply does not exist.
  }
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('walkContent', () => {
  it('yields one IRawNode per matching markdown file, sorted-stable per directory', async () => {
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      collected.push(n.path);
    }
    collected.sort();
    deepStrictEqual(collected, ['docs/a.md', 'docs/b.md', 'nested/inner/c.md']);
  });

  it('parses frontmatter via the configured parser', async () => {
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      if (n.path !== 'docs/a.md') continue;
      strictEqual((n.frontmatter as { name?: string }).name, 'a');
      strictEqual((n.frontmatter as { description?: string }).description, 'alpha');
      strictEqual(n.body.trim(), 'body of a');
      return;
    }
    ok(false, 'docs/a.md not yielded');
  });

  it('yields empty frontmatter when no fence is present (frontmatter-yaml)', async () => {
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      if (n.path !== 'docs/b.md') continue;
      deepStrictEqual(n.frontmatter, {});
      strictEqual(n.body, 'no frontmatter here, just body');
      return;
    }
    ok(false, 'docs/b.md not yielded');
  });

  it('respects the configured extensions list (filters by suffix)', async () => {
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.toml'],
      parser: 'plain',
    })) {
      collected.push(n.path);
    }
    deepStrictEqual(collected, ['docs/a.toml']);
  });

  it('uses the `plain` parser to pass content through unparsed', async () => {
    for await (const n of walkContent([root], {
      extensions: ['.toml'],
      parser: 'plain',
    })) {
      if (n.path !== 'docs/a.toml') continue;
      deepStrictEqual(n.frontmatter, {});
      strictEqual(n.body.includes('name = "toml"'), true);
      return;
    }
    ok(false, 'docs/a.toml not yielded by plain parser');
  });

  it('skips ignored directories (.git, node_modules) via the bundled defaults filter', async () => {
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      collected.push(n.path);
    }
    ok(!collected.some((p) => p.startsWith('.git/')), '.git/ should be skipped');
    ok(!collected.some((p) => p.startsWith('node_modules/')), 'node_modules/ should be skipped');
  });

  it('skips symlinks (audit M7)', async () => {
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      collected.push(n.path);
    }
    ok(!collected.includes('symlinked.md'), 'symlinks must not be yielded');
  });

  it('accepts an explicit ignoreFilter and uses it instead of bundled defaults', async () => {
    // Filter that ignores everything → empty walk.
    const filter = buildIgnoreFilter({ includeDefaults: false, configIgnore: ['**/*.md'] });
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
      ignoreFilter: filter,
    })) {
      collected.push(n.path);
    }
    deepStrictEqual(collected, []);
  });

  it('throws `UnknownParserError` for an unknown parser id', async () => {
    await rejects(async () => {
      for await (const _ of walkContent([root], {
        extensions: ['.md'],
        parser: 'does-not-exist',
      })) {
        // unreachable
      }
    }, UnknownParserError);
  });

  it('rejects the unknown parser id on the first iteration (resolves once at top of walk)', async () => {
    const it = walkContent([root], { extensions: ['.md'], parser: 'nope' })[Symbol.asyncIterator]();
    await rejects(it.next(), UnknownParserError);
  });
});
