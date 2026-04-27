/**
 * `sm init [-g] [--no-scan] [--force]` — bootstrap a skill-map scope.
 *
 *   - Creates `<root>/.skill-map/` (project = cwd, global = ~).
 *   - Writes `settings.json` (`{ "schemaVersion": 1 }`) and
 *     `settings.local.json` (`{}`).
 *   - Copies the bundled `.skill-mapignore` template into the scope root.
 *   - Provisions `<root>/.skill-map/skill-map.db` (kernel migrations
 *     run automatically via `SqliteStorageAdapter.init()`).
 *   - Project scope only: appends `.skill-map/settings.local.json` and
 *     `.skill-map/skill-map.db` to the project's `.gitignore`
 *     (creating the file when missing). The default `history.share`
 *     is `false`, so the DB stays untracked unless the team opts in.
 *   - Runs a first scan unless `--no-scan` is passed.
 *
 * Re-running on an already-initialised scope errors with exit 2 unless
 * `--force` is passed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';

import { Command, Option } from 'clipanion';

import { createKernel, runScanWithRenames } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../extensions/built-ins.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import {
  buildIgnoreFilter,
  loadBundledIgnoreText,
  readIgnoreFileText,
} from '../../kernel/scan/ignore.js';
import { emitDoneStderr, startElapsed } from '../util/elapsed.js';

const GITIGNORE_ENTRIES = [
  '.skill-map/settings.local.json',
  '.skill-map/skill-map.db',
] as const;

export class InitCommand extends Command {
  static override paths = [['init']];
  static override usage = Command.Usage({
    category: 'Setup',
    description: 'Bootstrap the current scope: scaffold .skill-map/, provision DB, run first scan.',
    details: `
      Project scope (default): creates ./.skill-map/ with settings.json,
      settings.local.json, and skill-map.db. Drops a starter
      .skill-mapignore at the scope root and appends the DB + local
      settings to .gitignore.

      Global scope (-g): same scaffolding under ~/.skill-map/. No
      .gitignore is touched; "$HOME" isn't a repo.

      Re-running over an existing scope errors with exit 2 unless
      --force is passed. --no-scan skips the first scan; useful in CI
      where the operator wants to provision before populating roots.
    `,
    examples: [
      ['Initialise the current project', '$0 init'],
      ['Provision the global scope', '$0 init -g'],
      ['Bootstrap without running the first scan', '$0 init --no-scan'],
      ['Force-overwrite an existing scope', '$0 init --force'],
    ],
  });

  global = Option.Boolean('-g,--global', false, {
    description: 'Initialise ~/.skill-map/ instead of ./.skill-map/.',
  });
  noScan = Option.Boolean('--no-scan', false, {
    description: 'Skip the first scan after scaffolding.',
  });
  force = Option.Boolean('--force', false, {
    description: 'Overwrite an existing settings.json / settings.local.json / .skill-mapignore.',
  });
  strict = Option.Boolean('--strict', false, {
    description: 'Strict mode: fail on any layered-loader warning AND promote frontmatter warnings to errors during the first scan. Same flag as sm scan / sm config.',
  });

  async execute(): Promise<number> {
    const elapsed = startElapsed();
    const cwd = process.cwd();
    const home = osHomedir();
    const scopeRoot = this.global ? home : cwd;
    const skillMapDir = join(scopeRoot, '.skill-map');
    const settingsPath = join(skillMapDir, 'settings.json');
    const localPath = join(skillMapDir, 'settings.local.json');
    const ignorePath = join(scopeRoot, '.skill-mapignore');
    const dbPath = join(skillMapDir, 'skill-map.db');

    if (existsSync(settingsPath) && !this.force) {
      this.context.stderr.write(
        `sm init: ${settingsPath} already exists. Pass --force to overwrite.\n`,
      );
      emitDoneStderr(this.context.stderr, elapsed);
      return 2;
    }

    mkdirSync(skillMapDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ schemaVersion: 1 }, null, 2) + '\n');
    if (!existsSync(localPath) || this.force) {
      writeFileSync(localPath, '{}\n');
    }
    if (!existsSync(ignorePath) || this.force) {
      writeFileSync(ignorePath, loadBundledIgnoreText());
    }

    if (!this.global) {
      const updated = ensureGitignoreEntries(scopeRoot, GITIGNORE_ENTRIES);
      if (updated) {
        this.context.stdout.write(
          `Updated ${join(scopeRoot, '.gitignore')} (added ${GITIGNORE_ENTRIES.length} entr${GITIGNORE_ENTRIES.length === 1 ? 'y' : 'ies'})\n`,
        );
      }
    }

    // Provision the DB. SqliteStorageAdapter.init() auto-applies
    // migrations, so by the time this returns the DB is at the latest
    // kernel schema.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    try {
      await adapter.init();
    } finally {
      await adapter.close();
    }

    this.context.stdout.write(`Initialised ${skillMapDir}\n`);

    if (this.noScan) {
      emitDoneStderr(this.context.stderr, elapsed);
      return 0;
    }

    // First scan. Inline (not subprocess) so the parent process owns
    // the elapsed line and the stdout/stderr streams cleanly.
    const scanCode = await runFirstScan(scopeRoot, dbPath, this.strict, this.context.stdout, this.context.stderr);
    emitDoneStderr(this.context.stderr, elapsed);
    return scanCode;
  }
}

async function runFirstScan(
  scopeRoot: string,
  dbPath: string,
  strict: boolean,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): Promise<number> {
  stdout.write('Running first scan...\n');

  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

  let cfg;
  try {
    cfg = loadConfig({ scope: 'project', cwd: scopeRoot, strict }).effective;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`sm init: ${message}\n`);
    return 2;
  }
  const ignoreFileText = readIgnoreFileText(scopeRoot);
  const ignoreFilterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
  if (cfg.ignore.length > 0) ignoreFilterOpts.configIgnore = cfg.ignore;
  if (ignoreFileText !== undefined) ignoreFilterOpts.ignoreFileText = ignoreFileText;
  const ignoreFilter = buildIgnoreFilter(ignoreFilterOpts);

  let result;
  let renameOps;
  try {
    const ran = await runScanWithRenames(kernel, {
      roots: [scopeRoot],
      scope: 'project',
      tokenize: true,
      extensions: builtIns(),
      ignoreFilter,
      strict,
    });
    result = ran.result;
    renameOps = ran.renameOps;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`sm init: scan failed: ${message}\n`);
    return 2;
  }

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  try {
    await adapter.init();
    await persistScanResult(adapter.db, result, renameOps);
  } finally {
    await adapter.close();
  }

  stdout.write(
    `First scan: ${result.nodes.length} node(s), ${result.links.length} link(s), ${result.issues.length} issue(s).\n`,
  );
  // Issues with severity=error gate the exit code, mirroring `sm scan`.
  const hasErrors = result.issues.some((i) => i.severity === 'error');
  return hasErrors ? 1 : 0;
}

/**
 * Append every `entry` to `<scopeRoot>/.gitignore` that is not already
 * present (compared as trimmed line). Creates the file if absent.
 * Returns true if the file was written.
 */
function ensureGitignoreEntries(scopeRoot: string, entries: readonly string[]): boolean {
  const path = join(scopeRoot, '.gitignore');
  let body = '';
  if (existsSync(path)) {
    body = readFileSync(path, 'utf8');
  }
  const present = new Set(
    body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
  let changed = false;
  for (const entry of entries) {
    if (present.has(entry)) continue;
    if (body.length > 0 && !body.endsWith('\n')) body += '\n';
    body += `${entry}\n`;
    present.add(entry);
    changed = true;
  }
  if (changed) writeFileSync(path, body);
  return changed;
}
