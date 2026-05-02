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
import { join } from 'node:path';

import { Command, Option } from 'clipanion';

import { createKernel, runScanWithRenames } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../built-in-plugins/built-ins.js';
import { loadConfig } from '../../kernel/config/loader.js';
import {
  buildIgnoreFilter,
  loadBundledIgnoreText,
  readIgnoreFileText,
} from '../../kernel/scan/ignore.js';
import { emitDoneStderr, startElapsed } from '../util/elapsed.js';
import { tx } from '../../kernel/util/tx.js';
import { INIT_TEXTS } from '../i18n/init.texts.js';
import { createCliProgressEmitter } from '../util/cli-progress-emitter.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../util/error-reporter.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { withSqlite } from '../util/with-sqlite.js';

const GITIGNORE_ENTRIES: readonly string[] = [
  '.skill-map/settings.local.json',
  '.skill-map/skill-map.db',
];

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
      ['Preview what would be created', '$0 init --dry-run'],
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
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Preview the scope provisioning without touching the filesystem or the DB. Honours --force for the would-overwrite preview. Skips the first scan unconditionally — dry-run never persists.',
  });

  // CLI orchestrator: paths setup + dry-run branch (delegated to
  // `writeDryRunPlan`) + real provision (mkdir + 4 file writes +
  // gitignore management + DB provision + first scan delegation).
  // The first-scan branch already lives in `runFirstScan`.
  // eslint-disable-next-line complexity
  async execute(): Promise<number> {
    const elapsed = startElapsed();
    const ctx = defaultRuntimeContext();
    const scopeRoot = this.global ? ctx.homedir : ctx.cwd;
    const skillMapDir = join(scopeRoot, '.skill-map');
    const settingsPath = join(skillMapDir, 'settings.json');
    const localPath = join(skillMapDir, 'settings.local.json');
    const ignorePath = join(scopeRoot, '.skill-mapignore');
    const dbPath = join(skillMapDir, 'skill-map.db');

    if (existsSync(settingsPath) && !this.force) {
      this.context.stderr.write(tx(INIT_TEXTS.alreadyInitialised, { settingsPath }));
      emitDoneStderr(this.context.stderr, elapsed);
      return ExitCode.Error;
    }

    if (this.dryRun) {
      writeDryRunPlan(this.context.stdout, {
        skillMapDir, settingsPath, localPath, ignorePath, dbPath,
        scopeRoot, force: this.force, global: this.global, noScan: this.noScan,
      });
      emitDoneStderr(this.context.stderr, elapsed);
      return ExitCode.Ok;
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
        const gitignorePath = join(scopeRoot, '.gitignore');
        this.context.stdout.write(
          GITIGNORE_ENTRIES.length === 1
            ? tx(INIT_TEXTS.gitignoreUpdatedSingular, { path: gitignorePath })
            : tx(INIT_TEXTS.gitignoreUpdatedPlural, {
                path: gitignorePath,
                count: GITIGNORE_ENTRIES.length,
              }),
        );
      }
    }

    // Provision the DB. `withSqlite` opens the adapter, which auto-
    // applies migrations on init(); by the time this returns the DB is
    // at the latest kernel schema.
    await withSqlite({ databasePath: dbPath, autoBackup: false }, async () => {
      // No-op: opening (and closing) the adapter is the work here.
    });

    this.context.stdout.write(tx(INIT_TEXTS.initialised, { skillMapDir }));

    if (this.noScan) {
      emitDoneStderr(this.context.stderr, elapsed);
      return ExitCode.Ok;
    }

    // First scan. Inline (not subprocess) so the parent process owns
    // the elapsed line and the stdout/stderr streams cleanly.
    const scanCode = await runFirstScan(scopeRoot, ctx.homedir, dbPath, this.strict, this.context.stdout, this.context.stderr);
    emitDoneStderr(this.context.stderr, elapsed);
    return scanCode;
  }
}

/**
 * Render the `--dry-run` plan to stdout: which directories/files the
 * verb would create or overwrite, and whether the first scan would
 * run. Used only when `--dry-run` is set; the real provision path
 * skips this entirely.
 */
function writeDryRunPlan(
  stdout: NodeJS.WritableStream,
  opts: {
    skillMapDir: string;
    settingsPath: string;
    localPath: string;
    ignorePath: string;
    dbPath: string;
    scopeRoot: string;
    force: boolean;
    global: boolean;
    noScan: boolean;
  },
): void {
  stdout.write(INIT_TEXTS.dryRunHeader);
  if (!existsSync(opts.skillMapDir)) {
    stdout.write(tx(INIT_TEXTS.dryRunWouldCreateDir, { path: opts.skillMapDir }));
  }
  // settingsPath: always written (caller gated --force above).
  stdout.write(dryRunFileMessage(opts.settingsPath));
  // Local + ignore: written only when missing OR --force.
  if (!existsSync(opts.localPath) || opts.force) stdout.write(dryRunFileMessage(opts.localPath));
  if (!existsSync(opts.ignorePath) || opts.force) stdout.write(dryRunFileMessage(opts.ignorePath));
  if (!opts.global) writeDryRunGitignorePlan(stdout, opts.scopeRoot);
  stdout.write(tx(INIT_TEXTS.dryRunWouldProvisionDb, { path: opts.dbPath }));
  stdout.write(
    opts.noScan ? INIT_TEXTS.dryRunWouldSkipFirstScan : INIT_TEXTS.dryRunWouldRunFirstScan,
  );
}

/** "would overwrite X" if the file exists, else "would write X". */
function dryRunFileMessage(path: string): string {
  return existsSync(path)
    ? tx(INIT_TEXTS.dryRunWouldOverwriteFile, { path })
    : tx(INIT_TEXTS.dryRunWouldWriteFile, { path });
}

/**
 * Subhelper of `writeDryRunPlan` — render the `.gitignore` preview
 * (unchanged / one-entry / multi-entry phrasing). Project scope only.
 */
function writeDryRunGitignorePlan(stdout: NodeJS.WritableStream, scopeRoot: string): void {
  const wouldAdd = previewGitignoreEntries(scopeRoot, GITIGNORE_ENTRIES);
  const gitignorePath = join(scopeRoot, '.gitignore');
  if (wouldAdd.length === 0) {
    stdout.write(tx(INIT_TEXTS.dryRunWouldLeaveGitignoreUnchanged, { path: gitignorePath }));
  } else if (wouldAdd.length === 1) {
    stdout.write(
      tx(INIT_TEXTS.dryRunWouldUpdateGitignoreSingular, {
        path: gitignorePath,
        entries: wouldAdd[0]!,
      }),
    );
  } else {
    stdout.write(
      tx(INIT_TEXTS.dryRunWouldUpdateGitignorePlural, {
        path: gitignorePath,
        count: wouldAdd.length,
        entries: wouldAdd.join(', '),
      }),
    );
  }
}

async function runFirstScan(
  scopeRoot: string,
  homedir: string,
  dbPath: string,
  strict: boolean,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): Promise<number> {
  stdout.write(INIT_TEXTS.runningFirstScan);

  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

  let cfg;
  try {
    cfg = loadConfig({ scope: 'project', cwd: scopeRoot, homedir, strict }).effective;
  } catch (err) {
    const message = formatErrorMessage(err);
    stderr.write(tx(INIT_TEXTS.configLoadFailure, { message }));
    return ExitCode.Error;
  }
  const ignoreFileText = readIgnoreFileText(scopeRoot);
  const ignoreFilterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
  if (cfg.ignore.length > 0) ignoreFilterOpts.configIgnore = cfg.ignore;
  if (ignoreFileText !== undefined) ignoreFilterOpts.ignoreFileText = ignoreFileText;
  const ignoreFilter = buildIgnoreFilter(ignoreFilterOpts);

  let result;
  let renameOps;
  let extractorRuns;
  let enrichments;
  try {
    const ran = await runScanWithRenames(kernel, {
      roots: [scopeRoot],
      scope: 'project',
      tokenize: true,
      extensions: builtIns(),
      ignoreFilter,
      strict,
      emitter: createCliProgressEmitter(stderr),
    });
    result = ran.result;
    renameOps = ran.renameOps;
    extractorRuns = ran.extractorRuns;
    enrichments = ran.enrichments;
  } catch (err) {
    const message = formatErrorMessage(err);
    stderr.write(tx(INIT_TEXTS.scanFailed, { message }));
    return ExitCode.Error;
  }

  await withSqlite({ databasePath: dbPath, autoBackup: false }, (adapter) =>
    adapter.scans.persist(result, { renameOps, extractorRuns, enrichments }),
  );

  stdout.write(
    tx(INIT_TEXTS.firstScanSummary, {
      nodes: result.nodes.length,
      links: result.links.length,
      issues: result.issues.length,
    }),
  );
  // Issues with severity=error gate the exit code, mirroring `sm scan`.
  const hasErrors = result.issues.some((i) => i.severity === 'error');
  return hasErrors ? ExitCode.Issues : ExitCode.Ok;
}

/**
 * Append every `entry` to `<scopeRoot>/.gitignore` that is not already
 * present (compared as trimmed line). Creates the file if absent.
 * Returns true if the file was written.
 */
/**
 * Compute which `entries` would be appended to `<scopeRoot>/.gitignore`
 * by the live `ensureGitignoreEntries` call, WITHOUT writing. Used by
 * `--dry-run` to render an honest preview of what `sm init` would
 * change. Same parsing rules as the live function so the preview tracks
 * the real outcome (skip blank lines and comment lines, dedupe by exact
 * trimmed match).
 */
function previewGitignoreEntries(scopeRoot: string, entries: readonly string[]): string[] {
  const path = join(scopeRoot, '.gitignore');
  const body = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const present = new Set(
    body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
  return entries.filter((entry) => !present.has(entry));
}

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
