/**
 * Interactive yes/no prompt helper used by destructive verbs
 * (`sm db restore`, `sm db reset --state`, `sm db reset --hard`,
 * `sm orphans undo-rename`).
 *
 * Writes the question + `[y/N] ` suffix to the supplied `stderr`.
 * Returns true only for inputs that match `/^y(es)?$/i` (trim,
 * case-insensitive). Any other answer (including empty) returns false.
 *
 * Streams are supplied by the caller (typically `this.context.stdin` /
 * `this.context.stderr` from Clipanion) so commands can be tested with
 * captured streams instead of monkey-patching `process.*`.
 */

import { createInterface } from 'node:readline';

import type { Readable, Writable } from 'node:stream';

import { UTIL_TEXTS } from '../i18n/util.texts.js';

export interface IConfirmStreams {
  stdin: Readable;
  stderr: Writable;
}

export async function confirm(question: string, streams: IConfirmStreams): Promise<boolean> {
  const rl = createInterface({ input: streams.stdin, output: streams.stderr });
  try {
    const answer = await new Promise<string>((resolveP) =>
      rl.question(`${question}${UTIL_TEXTS.confirmPromptSuffix}`, resolveP),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
