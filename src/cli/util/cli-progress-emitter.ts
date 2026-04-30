/**
 * `createCliProgressEmitter(stderr)` — `ProgressEmitterPort` for CLI
 * commands that ALSO writes a stderr line every time the orchestrator
 * emits an `extension.error` event.
 *
 * Why: the orchestrator drops links / issues that violate their
 * extension's declared contract (e.g. an extractor emitting a kind it did
 * not declare in `emitsLinkKinds`, a rule emitting an issue with an
 * out-of-spec severity). Without surfacing the drop, a plugin author
 * sees their link / issue silently disappear from the result with no
 * explanation — the worst possible plugin-author UX. This helper wires
 * those events to stderr so authors get a clear pointer at the offending
 * extension.
 *
 * Other event kinds (`scan.started` / `scan.progress` / `scan.completed`)
 * stay in-memory: the CLI already prints a structured summary and we
 * don't want to flood stderr with progress noise.
 */

import { InMemoryProgressEmitter } from '../../kernel/adapters/in-memory-progress.js';
import type { ProgressEmitterPort, ProgressEvent } from '../../kernel/ports/progress-emitter.js';
import { tx } from '../../kernel/util/tx.js';
import { CLI_PROGRESS_EMITTER_TEXTS } from '../i18n/cli-progress-emitter.texts.js';

const EXTENSION_ERROR = 'extension.error';

interface IExtensionErrorData {
  kind: string;
  extensionId: string;
  message: string;
  [key: string]: unknown;
}

export function createCliProgressEmitter(
  stderr: NodeJS.WritableStream,
): ProgressEmitterPort {
  const inner = new InMemoryProgressEmitter();
  return {
    emit(event: ProgressEvent): void {
      if (event.type === EXTENSION_ERROR) {
        const data = event.data as IExtensionErrorData | undefined;
        const message = data?.message ?? CLI_PROGRESS_EMITTER_TEXTS.extensionErrorNoDetail;
        stderr.write(tx(CLI_PROGRESS_EMITTER_TEXTS.extensionError, { message }));
      }
      inner.emit(event);
    },
    subscribe: (listener) => inner.subscribe(listener),
  };
}
