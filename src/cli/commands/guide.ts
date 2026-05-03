/**
 * `sm guide [--force]` — materialize the interactive tester guide as
 * `sm-guide.md` in the current working directory.
 *
 * Companion to the `sm-guide` Claude Code skill. The flow is:
 *
 *   1. Tester drops into an empty directory.
 *   2. Tester runs `sm guide`. This verb writes `<cwd>/sm-guide.md` —
 *      the canonical SKILL.md content shipped with `@skill-map/cli`.
 *   3. Tester opens Claude Code in that same directory and types
 *      `ejecutá @sm-guide.md`, which loads the materialized file as a
 *      skill. The skill itself ignores `sm-guide.md` in its empty-dir
 *      whitelist (the file is its own onboarding payload, not a stale
 *      fixture).
 *
 * Per spec § `sm guide`:
 *
 *   - Always writes top-level (no subdirectory).
 *   - Refuses to clobber an existing `sm-guide.md` unless `--force`.
 *   - Does NOT require an initialized `.skill-map/` project — the verb
 *     is a pre-bootstrap helper.
 *   - Exit `0` on success, `2` if the file already exists without
 *     `--force` or any I/O failure.
 *
 * SKILL.md source-of-truth: `.claude/skills/sm-guide/SKILL.md` at the
 * repo root. The build pipeline (`tsup.config.ts → onSuccess`) copies
 * that file into `dist/cli/guide/sm-guide.md` so the published
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
import { GUIDE_TEXTS } from '../i18n/guide.texts.js';
import { formatErrorMessage } from '../util/error-reporter.js';
import { ExitCode } from '../util/exit-codes.js';
import { pathExists } from '../util/fs.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';

const SM_GUIDE_FILENAME = 'sm-guide.md';

export class GuideCommand extends SmCommand {
  static override paths = [['guide']];
  static override usage = Command.Usage({
    category: 'Setup',
    description:
      'Materialize the interactive tester guide (sm-guide.md) in the current directory.',
    details: `
      Drops the canonical SKILL.md content as ./sm-guide.md so a tester
      can open Claude Code in the cwd and load the file as a skill by
      typing "ejecutá @sm-guide.md". Top-level only — no subdirectory
      is created.

      Does NOT require an initialized .skill-map/ project. Refuses to
      overwrite an existing sm-guide.md unless --force is passed.
    `,
    examples: [
      ['Materialize the guide in the cwd', '$0 guide'],
      ['Overwrite an existing sm-guide.md', '$0 guide --force'],
    ],
  });

  force = Option.Boolean('--force', false, {
    description: 'Overwrite an existing sm-guide.md without prompting.',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const target = join(ctx.cwd, SM_GUIDE_FILENAME);

    if ((await pathExists(target)) && !this.force) {
      this.context.stderr.write(tx(GUIDE_TEXTS.alreadyExists, { cwd: ctx.cwd }));
      return ExitCode.Error;
    }

    let body: string;
    try {
      body = loadBundledGuideText();
    } catch {
      this.context.stderr.write(GUIDE_TEXTS.sourceMissing);
      return ExitCode.Error;
    }

    try {
      await writeFile(target, body);
    } catch (err) {
      this.context.stderr.write(
        tx(GUIDE_TEXTS.writeFailed, { message: formatErrorMessage(err) }),
      );
      return ExitCode.Error;
    }

    this.context.stdout.write(tx(GUIDE_TEXTS.written, { cwd: ctx.cwd }));
    return ExitCode.Ok;
  }
}

// -----------------------------------------------------------------------------
// Bundled guide source loader
// -----------------------------------------------------------------------------

let cachedGuide: string | null = null;

/**
 * Return the bundled SKILL.md text. Cached after first read so repeat
 * invocations in long-running processes (tests, watcher contexts)
 * don't re-hit disk. Mirrors `loadBundledIgnoreText` from
 * `kernel/scan/ignore.ts`.
 *
 * Throws if the file cannot be located in any candidate path — the
 * caller surfaces this as `sourceMissing` with exit code 2.
 */
function loadBundledGuideText(): string {
  if (cachedGuide !== null) return cachedGuide;
  cachedGuide = readGuideFromDisk();
  return cachedGuide;
}

/** Test-only — drop the cache so a unit test can simulate a missing file. */
export function _resetGuideCacheForTests(): void {
  cachedGuide = null;
}

/**
 * Resolve `SKILL.md` from disk. Walks a small list of candidate
 * locations relative to this module so the lookup works in both:
 *
 *   - the dev layout (`src/cli/commands/guide.ts` → repo-root
 *     `.claude/skills/sm-guide/SKILL.md`).
 *   - the bundled layout (single-file `dist/cli.js` → sibling
 *     `dist/cli/guide/sm-guide.md`, populated by tsup `onSuccess`).
 *
 * The bundled filename intentionally differs from the source filename
 * so the published tarball ships the file under the same name the verb
 * writes (`sm-guide.md`), keeping `dist/` self-explanatory for
 * forensic inspection.
 */
function readGuideFromDisk(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dev: src/cli/commands/ → repo-root .claude/skills/sm-guide/SKILL.md
    resolve(here, '../../../.claude/skills/sm-guide/SKILL.md'),
    // bundled: dist/cli.js → dist/cli/guide/sm-guide.md (sibling)
    resolve(here, 'cli/guide/sm-guide.md'),
    // bundled fallback: any-depth → cli/guide/sm-guide.md
    resolve(here, '../cli/guide/sm-guide.md'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }
  throw new Error(`SKILL.md not found in any candidate location (last tried: ${candidates[candidates.length - 1]})`);
}
