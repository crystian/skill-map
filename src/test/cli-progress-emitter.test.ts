/**
 * `createCliProgressEmitter` — bridges orchestrator `extension.error`
 * events to the CLI's stderr while keeping every other event in-memory
 * (so scan.progress noise stays out of the user-facing log).
 */

import { describe, it } from 'node:test';
import { strictEqual, match, ok } from 'node:assert';

import { createCliProgressEmitter } from '../cli/util/cli-progress-emitter.js';

class CaptureStream {
  chunks: string[] = [];
  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }
  get text(): string {
    return this.chunks.join('');
  }
}

describe('createCliProgressEmitter', () => {
  it('writes an extension.error event to stderr with its message', () => {
    const stderr = new CaptureStream();
    const emitter = createCliProgressEmitter(stderr as unknown as NodeJS.WritableStream);
    emitter.emit({
      type: 'extension.error',
      timestamp: new Date().toISOString(),
      data: {
        kind: 'link-kind-not-declared',
        extensionId: 'broken-extractor',
        message: 'Extractor "broken-extractor" emitted off-contract link.',
      },
    });
    match(stderr.text, /^extension\.error: Extractor "broken-extractor" emitted off-contract link\.\n$/);
  });

  it('falls back to a placeholder when extension.error has no message', () => {
    const stderr = new CaptureStream();
    const emitter = createCliProgressEmitter(stderr as unknown as NodeJS.WritableStream);
    emitter.emit({
      type: 'extension.error',
      timestamp: new Date().toISOString(),
      // No data — exercise the defensive fallback.
    });
    match(stderr.text, /extension\.error: extension reported an error \(no detail\)\.\n/);
  });

  it('does NOT write scan progress events to stderr', () => {
    const stderr = new CaptureStream();
    const emitter = createCliProgressEmitter(stderr as unknown as NodeJS.WritableStream);
    emitter.emit({
      type: 'scan.started',
      timestamp: new Date().toISOString(),
      data: { roots: ['.'] },
    });
    emitter.emit({
      type: 'scan.progress',
      timestamp: new Date().toISOString(),
      data: { index: 1, path: 'a.md', kind: 'note', cached: false },
    });
    emitter.emit({
      type: 'scan.completed',
      timestamp: new Date().toISOString(),
      data: { stats: {} },
    });
    strictEqual(stderr.text, '', 'progress events stay in-memory');
  });

  it('subscribers still receive every event (including non-error)', () => {
    const stderr = new CaptureStream();
    const emitter = createCliProgressEmitter(stderr as unknown as NodeJS.WritableStream);
    const seen: string[] = [];
    const unsubscribe = emitter.subscribe((event) => {
      seen.push(event.type);
    });
    emitter.emit({ type: 'scan.started', timestamp: '' });
    emitter.emit({ type: 'extension.error', timestamp: '', data: { message: 'x' } });
    emitter.emit({ type: 'scan.completed', timestamp: '' });
    unsubscribe();
    emitter.emit({ type: 'scan.completed', timestamp: '' });
    // Three events while subscribed, none after unsubscribe.
    strictEqual(seen.length, 3);
    ok(seen.includes('extension.error'));
    ok(seen.includes('scan.started'));
  });
});
