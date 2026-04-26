/**
 * Interactive yes/no prompt helper used by destructive verbs
 * (`sm db restore`, `sm db reset --state`, `sm db reset --hard`,
 * `sm orphans undo-rename`).
 *
 * Writes the question + `[y/N] ` suffix to stderr. Returns true only
 * for inputs that match `/^y(es)?$/i` (trim, case-insensitive). Any
 * other answer (including empty) returns false.
 */

import { createInterface } from 'node:readline';

export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolveP) =>
      rl.question(`${question} [y/N] `, resolveP),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
