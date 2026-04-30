/**
 * M6 — extension.error event coverage.
 *
 * The orchestrator drops links whose kind is not in the extractor's
 * declared `emitsLinkKinds`, and issues whose severity is not one of
 * `error` / `warn` / `info`. Until M6 those drops were silent — a
 * plugin author saw their link / issue vanish from the result with no
 * pointer at the cause. The orchestrator now emits a
 * `type: 'extension.error'` event for every drop so a CLI listener (or
 * a Web UI subscriber) can surface the diagnostic.
 *
 * These tests:
 *   1. Run a tiny scan over an in-memory fixture.
 *   2. Inject a misbehaving extractor / rule.
 *   3. Capture every `ProgressEvent` via a custom emitter.
 *   4. Assert (a) the offending link / issue is absent from the result,
 *      and (b) the corresponding `extension.error` event was emitted
 *      with the expected `data.kind`.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns } from '../extensions/built-ins.js';
import type {
  ProgressEmitterPort,
  ProgressEvent,
  ProgressListener,
} from '../kernel/ports/progress-emitter.js';
import type { IExtractor } from '../kernel/extensions/index.js';
import type { IRule } from '../kernel/extensions/index.js';
import type { Issue, Link } from '../kernel/types.js';

class CapturingEmitter implements ProgressEmitterPort {
  events: ProgressEvent[] = [];
  emit(event: ProgressEvent): void {
    this.events.push(event);
  }
  subscribe(_listener: ProgressListener): () => void {
    return () => {};
  }
}

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-extension-error-'));
  // One agent + one command, both with valid frontmatter. The body /
  // frontmatter content is irrelevant — the misbehaving extractor emits
  // its broken links unconditionally.
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  write(
    '.claude/agents/architect.md',
    ['---', 'name: architect', 'description: A', '---', 'Body.'].join('\n'),
  );
  write(
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', 'description: D', '---', 'Body.'].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('orchestrator — extension.error events', () => {
  it('extractor emitting a kind outside emitsLinkKinds → link dropped + extension.error', async () => {
    // Extractor declares `emitsLinkKinds: ['references']` but emits a
    // `mentions` link. The orchestrator MUST drop the link and surface
    // the drop via an `extension.error` event.
    const buggyExtractor: IExtractor = {
      kind: 'extractor',
      id: 'bad-kind-extractor',
      pluginId: 'test',
      version: '1.0.0',
      emitsLinkKinds: ['references'],
      defaultConfidence: 'low',
      scope: 'body',
      extract: (ctx): void => {
        ctx.emitLink({
          // Off-contract: 'mentions' is NOT in emitsLinkKinds above.
          kind: 'mentions',
          source: '.claude/agents/architect.md',
          target: '.claude/commands/deploy.md',
          confidence: 'low',
          sources: [],
        } satisfies Link);
      },
    };

    const emitter = new CapturingEmitter();
    const kernel = createKernel();
    const baseline = builtIns();
    const result = await runScan(kernel, {
      roots: [fixture],
      emitter,
      extensions: {
        providers: baseline.providers,
        extractors: [buggyExtractor],
        rules: [],
      },
    });

    // Result links have no entry from the buggy extractor.
    const fromBuggy = result.links.filter((l) => l.kind === 'mentions');
    strictEqual(fromBuggy.length, 0, 'off-contract link must be dropped');

    // The extractor runs once PER node walked (2 nodes in the fixture);
    // each invocation emits one off-contract link → one
    // `extension.error` event per dropped link.
    const extErrors = emitter.events.filter((e) => e.type === 'extension.error');
    strictEqual(extErrors.length, 2, 'one extension.error per dropped link');
    const data = extErrors[0]!.data as Record<string, unknown>;
    strictEqual(data['kind'], 'link-kind-not-declared');
    // Spec § A.6 — `extensionId` is the qualified id `<pluginId>/<id>`.
    strictEqual(data['extensionId'], 'test/bad-kind-extractor');
    strictEqual(data['linkKind'], 'mentions');
    deepStrictEqual(data['declaredKinds'], ['references']);
    ok(typeof data['message'] === 'string');
    ok(
      (data['message'] as string).includes('test/bad-kind-extractor'),
      'message names the extractor with its qualified id',
    );
  });

  it('rule emitting an issue with invalid severity → issue dropped + extension.error', async () => {
    // Rule emits an issue with severity 'fatal' which is NOT one of
    // 'error' | 'warn' | 'info'. Must be dropped + diagnosed.
    const buggyRule: IRule = {
      kind: 'rule',
      id: 'bad-severity-rule',
      pluginId: 'test',
      version: '1.0.0',
      evaluate: () =>
        [
          {
            ruleId: 'bad-severity-rule',
            // @ts-expect-error — exercising the runtime guard with a
            // value that the static type forbids.
            severity: 'fatal',
            nodeIds: ['.claude/agents/architect.md'],
            message: 'should not appear',
          } satisfies Issue,
        ],
    };

    const emitter = new CapturingEmitter();
    const kernel = createKernel();
    const baseline = builtIns();
    const result = await runScan(kernel, {
      roots: [fixture],
      emitter,
      extensions: {
        providers: baseline.providers,
        extractors: [],
        rules: [buggyRule],
      },
    });

    const fromBuggy = result.issues.filter((i) => i.ruleId === 'bad-severity-rule');
    strictEqual(fromBuggy.length, 0, 'off-contract issue must be dropped');

    const extErrors = emitter.events.filter((e) => e.type === 'extension.error');
    strictEqual(extErrors.length, 1, 'one extension.error per dropped issue');
    const data = extErrors[0]!.data as Record<string, unknown>;
    strictEqual(data['kind'], 'issue-invalid-severity');
    // Spec § A.6 — `extensionId` is the qualified id `<pluginId>/<id>`.
    strictEqual(data['extensionId'], 'test/bad-severity-rule');
    strictEqual(data['severity'], 'fatal');
    ok(
      (data['message'] as string).includes('test/bad-severity-rule'),
      'message names the rule with its qualified id',
    );
  });

  it('well-behaved extensions emit no extension.error', async () => {
    // Sanity check: a clean run with no off-contract emissions must
    // produce zero extension.error events. Catches a future regression
    // where the orchestrator starts complaining about valid emissions.
    const emitter = new CapturingEmitter();
    const kernel = createKernel();
    await runScan(kernel, {
      roots: [fixture],
      emitter,
      extensions: builtIns(),
    });
    const extErrors = emitter.events.filter((e) => e.type === 'extension.error');
    strictEqual(extErrors.length, 0);
  });
});
