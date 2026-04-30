import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claudeProvider } from './index.js';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-provider-'));

  const write = (rel: string, content: string) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  write(
    '.claude/agents/backend.md',
    [
      '---',
      'name: backend',
      'description: Backend architect',
      'metadata:',
      '  version: 1.0.0',
      '---',
      'Body text.',
    ].join('\n'),
  );
  write(
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', '---', '/deploy body'].join('\n'),
  );
  write('.claude/hooks/pre-commit.md', '# no frontmatter');
  write(
    '.claude/skills/code-review/SKILL.md',
    ['---', 'name: code-review', '---', 'Skill body.'].join('\n'),
  );
  write('notes/readme.md', 'Plain note.');
  write('.git/HEAD', 'ref: refs/heads/main'); // should be ignored
  write('node_modules/foo/thing.md', 'should be ignored');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('claude provider', () => {
  it('walks the scope and yields one node per markdown file', async () => {
    const collected: string[] = [];
    for await (const n of claudeProvider.walk([root])) {
      collected.push(n.path);
    }
    collected.sort();
    deepStrictEqual(collected, [
      '.claude/agents/backend.md',
      '.claude/commands/deploy.md',
      '.claude/hooks/pre-commit.md',
      '.claude/skills/code-review/SKILL.md',
      'notes/readme.md',
    ]);
  });

  it('parses frontmatter via yaml and leaves body intact', async () => {
    for await (const n of claudeProvider.walk([root])) {
      if (n.path !== '.claude/agents/backend.md') continue;
      strictEqual((n.frontmatter as { name?: string }).name, 'backend');
      strictEqual((n.frontmatter as { description?: string }).description, 'Backend architect');
      strictEqual(n.body.trim(), 'Body text.');
      return;
    }
    ok(false, 'backend.md not found');
  });

  it('classifies paths by convention', () => {
    strictEqual(claudeProvider.classify('.claude/agents/x.md', {}), 'agent');
    strictEqual(claudeProvider.classify('.claude/commands/y.md', {}), 'command');
    strictEqual(claudeProvider.classify('.claude/hooks/z.md', {}), 'hook');
    strictEqual(claudeProvider.classify('.claude/skills/n/SKILL.md', {}), 'skill');
    strictEqual(claudeProvider.classify('notes/readme.md', {}), 'note');
    strictEqual(claudeProvider.classify('random.md', {}), 'note');
  });

  it('handles files with no frontmatter', async () => {
    for await (const n of claudeProvider.walk([root])) {
      if (n.path !== '.claude/hooks/pre-commit.md') continue;
      deepStrictEqual(n.frontmatter, {});
      strictEqual(n.body, '# no frontmatter');
      return;
    }
    ok(false, 'pre-commit.md not found');
  });

  it('declares an explorationDir', () => {
    strictEqual(claudeProvider.explorationDir, '~/.claude');
  });
});
