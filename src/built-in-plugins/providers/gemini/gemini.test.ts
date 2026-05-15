import { describe, it,beforeAll as before,afterAll as after} from 'bun:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProviderWalk } from '../../../kernel/extensions/index.js';
import { geminiProvider } from './index.js';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'gemini-provider-'));

  const write = (rel: string, content: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  write(
    '.gemini/agents/reviewer.md',
    [
      '---',
      'name: reviewer',
      'description: Gemini subagent',
      'metadata:',
      '  version: 1.0.0',
      '---',
      'Body text.',
    ].join('\n'),
  );
  write(
    '.gemini/skills/code-review/SKILL.md',
    ['---', 'name: code-review', 'description: A skill', '---', 'Skill body.'].join('\n'),
  );
  write('GEMINI.md', '# Context\nFallback markdown.');
  write('.git/HEAD', 'ref: refs/heads/main'); // ignored by bundled defaults
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('gemini provider', () => {
  it('walks the scope and yields one node per markdown file', async () => {
    const collected: string[] = [];
    for await (const n of resolveProviderWalk(geminiProvider)([root])) {
      collected.push(n.path);
    }
    collected.sort();
    deepStrictEqual(collected, [
      '.gemini/agents/reviewer.md',
      '.gemini/skills/code-review/SKILL.md',
      'GEMINI.md',
    ]);
  });

  it('classifies paths by Gemini convention', () => {
    strictEqual(geminiProvider.classify('.gemini/agents/x.md', {}), 'agent');
    strictEqual(geminiProvider.classify('.gemini/skills/n/SKILL.md', {}), 'skill');
    // spec 0.18.0: GEMINI.md is no longer gemini's territory; it is
    // disclaimed here and picked up by the built-in `core/markdown`
    // Provider via its universal fallback classify.
    strictEqual(geminiProvider.classify('GEMINI.md', {}), null);
    strictEqual(geminiProvider.classify('random.md', {}), null);
    strictEqual(geminiProvider.classify('.claude/agents/x.md', {}), null);
    strictEqual(geminiProvider.classify('.agents/skills/foo/SKILL.md', {}), null);
  });

  it('declares an explorationDir', () => {
    strictEqual(geminiProvider.explorationDir, '~/.gemini');
  });

  it('every kind it classifies into resolves a per-kind schema via provider.kinds', async () => {
    const { buildProviderFrontmatterValidator } = await import(
      '../../../kernel/adapters/schema-validators.js'
    );
    const validator = buildProviderFrontmatterValidator([geminiProvider]);
    const kinds = ['agent', 'skill'] as const;
    for (const kind of kinds) {
      const entry = geminiProvider.kinds[kind];
      ok(entry, `gemini provider must declare a catalog entry for kind ${kind}`);
      const fm = { name: 'x', description: 'y', metadata: { version: '1.0.0' } };
      const result = validator.validate(geminiProvider, kind, fm);
      ok(result.ok, `frontmatter for kind ${kind} must validate`);
    }
  });

  it('every kind declares ui presentation (label + color, optional dark + emoji + icon)', () => {
    const kinds = ['agent', 'skill'] as const;
    for (const kind of kinds) {
      const entry = geminiProvider.kinds[kind];
      ok(entry, `gemini provider must declare a catalog entry for kind ${kind}`);
      ok(entry.ui, `kind ${kind} must declare ui presentation`);
      ok(typeof entry.ui.label === 'string' && entry.ui.label.length > 0);
      ok(/^#[0-9a-fA-F]{6}$/.test(entry.ui.color));
      if (entry.ui.colorDark !== undefined) {
        ok(/^#[0-9a-fA-F]{6}$/.test(entry.ui.colorDark));
      }
      if (entry.ui.icon !== undefined) {
        ok(entry.ui.icon.kind === 'pi' || entry.ui.icon.kind === 'svg');
      }
    }
  });

  it('declares declarative `read` (kernel walker handles fs)', () => {
    deepStrictEqual(geminiProvider.read, { extensions: ['.md'], parser: 'frontmatter-yaml' });
    strictEqual(geminiProvider.walk, undefined);
  });

  it('agent schema accepts the documented Gemini fields verbatim', async () => {
    const { buildProviderFrontmatterValidator } = await import(
      '../../../kernel/adapters/schema-validators.js'
    );
    const validator = buildProviderFrontmatterValidator([geminiProvider]);
    const fm = {
      name: 'r',
      description: 'd',
      kind: 'local',
      tools: ['Read', 'mcp_*'],
      model: 'gemini-3-flash-preview',
      temperature: 0.7,
      max_turns: 5,
      timeout_mins: 10,
    };
    const result = validator.validate(geminiProvider, 'agent', fm);
    ok(result.ok, `agent frontmatter must validate, got: ${result.ok ? '' : result.errors}`);
  });
});
