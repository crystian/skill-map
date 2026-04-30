/**
 * Spec § A.11 — Hook extension kind.
 *
 * Six tests covering the curated trigger set, load-time validation,
 * runtime dispatch (deterministic + probabilistic), filter narrowing,
 * and graceful error handling.
 *
 * Coverage map:
 *   (a) Hook with valid trigger loads with status 'enabled'.
 *   (b) Hook with trigger outside curated set → invalid-manifest at load.
 *   (c) Deterministic hook subscribed to scan.completed → invoked once
 *       per scan with the event payload threaded through ctx.
 *   (d) Hook with filter — only invoked when event.data matches.
 *   (e) Hook that throws → extension.error meta-event, scan continues OK.
 *   (f) Probabilistic hook → skipped with stderr advisory until job
 *       subsystem ships at Step 10.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns } from '../extensions/built-ins.js';
import {
  PluginLoader,
  installedSpecVersion,
} from '../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../kernel/adapters/schema-validators.js';
import type {
  ProgressEmitterPort,
  ProgressEvent,
  ProgressListener,
} from '../kernel/ports/progress-emitter.js';
import type { IHook, IHookContext } from '../kernel/extensions/index.js';

class CapturingEmitter implements ProgressEmitterPort {
  events: ProgressEvent[] = [];
  emit(event: ProgressEvent): void {
    this.events.push(event);
  }
  subscribe(_listener: ProgressListener): () => void {
    return () => {};
  }
}

let fixtureRoot: string;
let pluginsRoot: string;

before(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'skill-map-hook-fix-'));
  pluginsRoot = mkdtempSync(join(tmpdir(), 'skill-map-hook-plugins-'));
  // Minimal claude fixture so the orchestrator has something to walk.
  const write = (rel: string, content: string): void => {
    const abs = join(fixtureRoot, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  write(
    '.claude/agents/architect.md',
    ['---', 'name: architect', 'description: A', '---', 'Body.'].join('\n'),
  );
});

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(pluginsRoot, { recursive: true, force: true });
});

function writeHookPlugin(
  id: string,
  hookSource: string,
): string {
  const dir = join(pluginsRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '0.1.0',
      specCompat: '>=0.0.0',
      extensions: ['hook.mjs'],
    }),
  );
  writeFileSync(join(dir, 'hook.mjs'), hookSource);
  return dir;
}

function loaderFor(): PluginLoader {
  return new PluginLoader({
    searchPaths: [pluginsRoot],
    validators: loadSchemaValidators(),
    specVersion: installedSpecVersion(),
  });
}

describe('Hook extension kind (spec § A.11)', () => {
  it('(a) hook with a valid trigger loads with status "enabled"', async () => {
    writeHookPlugin(
      'hook-ok',
      `export default {
        id: 'completed-listener',
        kind: 'hook',
        version: '1.0.0',
        triggers: ['scan.completed'],
        on() {},
      };`,
    );
    const result = await loaderFor().discoverAndLoadAll();
    const ok_plugin = result.find((p) => p.id === 'hook-ok')!;
    strictEqual(ok_plugin.status, 'enabled');
    strictEqual(ok_plugin.extensions?.length, 1);
    strictEqual(ok_plugin.extensions?.[0]?.kind, 'hook');
    rmSync(join(pluginsRoot, 'hook-ok'), { recursive: true, force: true });
  });

  it('(b) hook with an unknown trigger fails with invalid-manifest at load', async () => {
    writeHookPlugin(
      'hook-bad-trigger',
      `export default {
        id: 'bad',
        kind: 'hook',
        version: '1.0.0',
        // 'scan.progress' is intentionally NOT in the curated hookable
        // set — too verbose for a reactive surface.
        triggers: ['scan.progress'],
        on() {},
      };`,
    );
    const result = await loaderFor().discoverAndLoadAll();
    const plugin = result.find((p) => p.id === 'hook-bad-trigger')!;
    // Loader runs the trigger-set check BEFORE AJV so the directed
    // `invalid-manifest` reason wins over AJV's generic enum error.
    strictEqual(plugin.status, 'invalid-manifest');
    ok(
      typeof plugin.reason === 'string' && plugin.reason.includes('scan.progress'),
      `reason must name the offending trigger; got: ${plugin.reason}`,
    );
    ok(
      (plugin.reason ?? '').includes('Hookable triggers:'),
      `reason must list the curated hookable set; got: ${plugin.reason}`,
    );
    rmSync(join(pluginsRoot, 'hook-bad-trigger'), { recursive: true, force: true });
  });

  it('(c) deterministic hook on scan.completed is invoked once per scan with the payload', async () => {
    const captured: IHookContext[] = [];
    const hook: IHook = {
      kind: 'hook',
      id: 'capture-completed',
      pluginId: 'test',
      version: '1.0.0',
      triggers: ['scan.completed'],
      on(ctx) {
        captured.push(ctx);
      },
    };

    const emitter = new CapturingEmitter();
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixtureRoot],
      emitter,
      extensions: {
        providers: baseline.providers,
        extractors: baseline.extractors,
        rules: baseline.rules,
        hooks: [hook],
      },
    });

    strictEqual(captured.length, 1, 'hook must fire exactly once on scan.completed');
    const ctx = captured[0]!;
    strictEqual(ctx.event.type, 'scan.completed');
    ok(
      ctx.event.data && typeof ctx.event.data === 'object',
      'event.data must be an object',
    );
    const data = ctx.event.data as Record<string, unknown>;
    ok(data['stats'] && typeof data['stats'] === 'object', 'stats payload threaded through');
    // The lifecycle event itself was emitted to the progress emitter
    // alongside the dispatch — observability and reactive surface live
    // in lock-step.
    const completedEvents = emitter.events.filter((e) => e.type === 'scan.completed');
    strictEqual(completedEvents.length, 1);
  });

  it('(d) filter narrows fan-out — hook only fires on matching event payloads', async () => {
    let firedCount = 0;
    const hook: IHook = {
      kind: 'hook',
      id: 'filtered',
      pluginId: 'test',
      version: '1.0.0',
      triggers: ['extractor.completed'],
      // Fire only when the external-url-counter finishes — every other
      // built-in extractor must NOT trigger this hook.
      filter: { extractorId: 'core/external-url-counter' },
      on() {
        firedCount += 1;
      },
    };

    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixtureRoot],
      extensions: {
        providers: baseline.providers,
        extractors: baseline.extractors,
        rules: baseline.rules,
        hooks: [hook],
      },
    });

    strictEqual(
      firedCount,
      1,
      'filter must let exactly one extractor.completed event through',
    );
  });

  it('(e) hook that throws → extension.error meta-event, scan continues', async () => {
    const hook: IHook = {
      kind: 'hook',
      id: 'thrower',
      pluginId: 'test',
      version: '1.0.0',
      triggers: ['scan.completed'],
      on() {
        throw new Error('synthetic hook failure');
      },
    };

    const emitter = new CapturingEmitter();
    const kernel = createKernel();
    const baseline = builtIns();
    const result = await runScan(kernel, {
      roots: [fixtureRoot],
      emitter,
      extensions: {
        providers: baseline.providers,
        extractors: baseline.extractors,
        rules: baseline.rules,
        hooks: [hook],
      },
    });

    // Scan still produced a result (the throwing hook didn't block).
    ok(result.stats.nodesCount >= 1, 'scan must complete despite the hook error');

    // extension.error event surfaced with kind: 'hook-error' and the
    // qualified extension id.
    const hookErrors = emitter.events.filter(
      (e) =>
        e.type === 'extension.error' &&
        (e.data as Record<string, unknown>)['kind'] === 'hook-error',
    );
    strictEqual(hookErrors.length, 1, 'one extension.error per failed hook invocation');
    const data = hookErrors[0]!.data as Record<string, unknown>;
    strictEqual(data['extensionId'], 'test/thrower');
    strictEqual(data['trigger'], 'scan.completed');
    ok(
      typeof data['message'] === 'string' && (data['message'] as string).length > 0,
      'error message threaded through',
    );
  });

  it('(f) probabilistic hook is skipped with a stderr advisory', async () => {
    let fired = false;
    const hook: IHook = {
      kind: 'hook',
      id: 'prob',
      pluginId: 'test',
      version: '1.0.0',
      mode: 'probabilistic',
      triggers: ['scan.completed'],
      on() {
        fired = true;
      },
    };

    // Capture stderr — the hook dispatcher logs a one-shot advisory
    // when it indexes the probabilistic hook.
    const stderrChunks: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      stderrChunks.push(args.map(String).join(' '));
    };

    try {
      const kernel = createKernel();
      const baseline = builtIns();
      await runScan(kernel, {
        roots: [fixtureRoot],
        extensions: {
          providers: baseline.providers,
          extractors: baseline.extractors,
          rules: baseline.rules,
          hooks: [hook],
        },
      });
    } finally {
      console.error = originalError;
    }

    strictEqual(fired, false, 'probabilistic hook must not dispatch in-scan');
    const advisory = stderrChunks.find((s) => s.includes('test/prob'));
    ok(
      advisory && advisory.includes('Step 10'),
      'stderr advisory mentions the probabilistic deferral and Step 10',
    );
  });
});
