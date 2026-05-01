/**
 * In-memory `ProgressEmitterPort` adapter. No network, no DB — just a
 * synchronous fan-out to registered listeners. Used by the default scan
 * orchestrator; the WebSocket-backed emitter that streams to
 * the Web UI lands.
 */

import type {
  ProgressEmitterPort,
  ProgressEvent,
  ProgressListener,
} from '../ports/progress-emitter.js';

export class InMemoryProgressEmitter implements ProgressEmitterPort {
  readonly #listeners = new Set<ProgressListener>();

  emit(event: ProgressEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  subscribe(listener: ProgressListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
