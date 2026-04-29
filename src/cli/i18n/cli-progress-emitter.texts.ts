/**
 * CLI strings emitted by `cli/util/cli-progress-emitter.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * The progress emitter relays orchestrator `extension.error` events to
 * stderr so plugin authors see why a link / issue is silently dropped.
 */

export const CLI_PROGRESS_EMITTER_TEXTS = {
  extensionError: 'extension.error: {{message}}\n',

  extensionErrorNoDetail: 'extension reported an error (no detail).',
} as const;
