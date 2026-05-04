/**
 * `sm tutorial [--force]` — materialize the interactive tester tutorial as
 * `sm-tutorial.md` in the current working directory.
 *
 * Companion to the `sm-tutorial` Claude Code skill. The flow is:
 *
 *   1. Tester drops into an empty directory.
 *   2. Tester runs `sm tutorial`. This verb writes `<cwd>/sm-tutorial.md` —
 *      the canonical SKILL.md content shipped with `@skill-map/cli`.
 *   3. Tester opens Claude Code in that same directory and types
 *      `ejecutá @sm-tutorial.md`, which loads the materialized file as a
 *      skill. The skill itself ignores `sm-tutorial.md` in its empty-dir
 *      whitelist (the file is its own onboarding payload, not a stale
 *      fixture).
 *
 * Per spec § `sm tutorial`:
 *
 *   - Always writes top-level (no subdirectory).
 *   - Refuses to clobber an existing `sm-tutorial.md` unless `--force`.
 *   - Does NOT require an initialized `.skill-map/` project — the verb
 *     is a pre-bootstrap helper.
 *   - Exit `0` on success, `2` if the file already exists without
 *     `--force` or any I/O failure.
 *
 * SKILL.md source-of-truth: `.claude/skills/sm-tutorial/SKILL.md` at the
 * repo root. The build pipeline (`tsup.config.ts → onSuccess`) copies
 * that file into `dist/cli/tutorial/sm-tutorial.md` so the published
 * package ships it. The runtime resolver below walks both layouts
 * (dev source + bundled dist) following the same multi-candidate
 * pattern used by `loadBundledIgnoreText` in `kernel/scan/ignore.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'clipanion';

import { tx } from '../../kernel/util/tx.js';
import { TUTORIAL_TEXTS } from '../i18n/tutorial.texts.js';
import { formatErrorMessage } from '../util/error-reporter.js';
import { ExitCode } from '../util/exit-codes.js';
import { pathExists } from '../util/fs.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';

const SM_TUTORIAL_FILENAME = 'sm-tutorial.md';

export class TutorialCommand extends SmCommand {
  static override paths = [['tutorial']];
  static override usage = Command.Usage({
    category: 'Setup',
    description:
      'Materialize the interactive tester tutorial (sm-tutorial.md) in the current directory.',
    details: `
      Drops the canonical SKILL.md content as ./sm-tutorial.md so a tester
      can open Claude Code in the cwd and load the file as a skill by
      typing "ejecutá @sm-tutorial.md". Top-level only — no subdirectory
      is created.

      Does NOT require an initialized .skill-map/ project. Refuses to
      overwrite an existing sm-tutorial.md unless --force is passed.
    `,
    examples: [
      ['Materialize the tutorial in the cwd', '$0 tutorial'],
      ['Overwrite an existing sm-tutorial.md', '$0 tutorial --force'],
    ],
  });

  force = Option.Boolean('--force', false, {
    description: 'Overwrite an existing sm-tutorial.md without prompting.',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const target = join(ctx.cwd, SM_TUTORIAL_FILENAME);

    if ((await pathExists(target)) && !this.force) {
      this.context.stderr.write(tx(TUTORIAL_TEXTS.alreadyExists, { cwd: ctx.cwd }));
      return ExitCode.Error;
    }

    let body: string;
    try {
      body = loadBundledTutorialText();
    } catch {
      this.context.stderr.write(TUTORIAL_TEXTS.sourceMissing);
      return ExitCode.Error;
    }

    try {
      await writeFile(target, body);
    } catch (err) {
      this.context.stderr.write(
        tx(TUTORIAL_TEXTS.writeFailed, { message: formatErrorMessage(err) }),
      );
      return ExitCode.Error;
    }

    this.context.stdout.write(tx(TUTORIAL_TEXTS.written, { cwd: ctx.cwd }));
    return ExitCode.Ok;
  }
}

// -----------------------------------------------------------------------------
// Bundled tutorial source loader
// -----------------------------------------------------------------------------

let cachedTutorial: string | null = null;

/**
 * Return the bundled SKILL.md text. Cached after first read so repeat
 * invocations in long-running processes (tests, watcher contexts)
 * don't re-hit disk. Mirrors `loadBundledIgnoreText` from
 * `kernel/scan/ignore.ts`.
 *
 * Throws if the file cannot be located in any candidate path — the
 * caller surfaces this as `sourceMissing` with exit code 2.
 */
function loadBundledTutorialText(): string {
  if (cachedTutorial !== null) return cachedTutorial;
  cachedTutorial = readTutorialFromDisk();
  return cachedTutorial;
}

/** Test-only — drop the cache so a unit test can simulate a missing file. */
export function _resetTutorialCacheForTests(): void {
  cachedTutorial = null;
}

/**
 * Resolve `SKILL.md` from disk. Walks a small list of candidate
 * locations relative to this module so the lookup works in both:
 *
 *   - the dev layout (`src/cli/commands/tutorial.ts` → repo-root
 *     `.claude/skills/sm-tutorial/SKILL.md`).
 *   - the bundled layout (single-file `dist/cli.js` → sibling
 *     `dist/cli/tutorial/sm-tutorial.md`, populated by tsup `onSuccess`).
 *
 * The bundled filename intentionally differs from the source filename
 * so the published tarball ships the file under the same name the verb
 * writes (`sm-tutorial.md`), keeping `dist/` self-explanatory for
 * forensic inspection.
 */
function readTutorialFromDisk(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dev: src/cli/commands/ → repo-root .claude/skills/sm-tutorial/SKILL.md
    resolve(here, '../../../.claude/skills/sm-tutorial/SKILL.md'),
    // bundled: dist/cli.js → dist/cli/tutorial/sm-tutorial.md (sibling)
    resolve(here, 'cli/tutorial/sm-tutorial.md'),
    // bundled fallback: any-depth → cli/tutorial/sm-tutorial.md
    resolve(here, '../cli/tutorial/sm-tutorial.md'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }
  throw new Error(`SKILL.md not found in any candidate location (last tried: ${candidates[candidates.length - 1]})`);
}
