import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { Command } from 'clipanion';

import { resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { VERSION } from '../version.js';

/**
 * `sm version` — multi-line version matrix.
 *
 * Shape is defined in `spec/cli-contract.md`:
 *
 *   sm           <cli version>
 *   kernel       <kernel version>
 *   spec         <spec version implemented>
 *   runtime      Node v<n>.<n>.<n>
 *   db-schema    <applied migration version | —>
 *
 * The Clipanion built-in `--version` flag remains for the single-line form.
 *
 * `db-schema` resolution (Step 6 follow-up):
 *   - When the project DB file exists, the command opens it read-only and
 *     reads `PRAGMA user_version`. The migrations runner keeps that pragma
 *     in sync with the latest applied kernel migration.
 *   - When the DB is absent, the field stays `—` (no scope provisioned
 *     yet — typically pre-`sm init`).
 *   - Any read failure is silenced into `—` rather than turned into an
 *     error: `sm version` is informational and MUST NOT crash on a bad
 *     DB file.
 */
export class VersionCommand extends Command {
  static override paths = [['version']];

  static override usage = Command.Usage({
    category: 'Setup & state',
    description: 'Print the CLI / kernel / spec / runtime / db-schema version matrix.',
  });

  json = false;

  async execute(): Promise<number> {
    const runtime = `Node ${process.version}`;
    const kernelVersion = VERSION;
    const specVersion = await resolveSpecVersion();
    const dbSchema = resolveDbSchemaVersion();

    const lines: Array<[string, string]> = [
      ['sm', VERSION],
      ['kernel', kernelVersion],
      ['spec', specVersion],
      ['runtime', runtime],
      ['db-schema', dbSchema],
    ];

    const pad = Math.max(...lines.map(([k]) => k.length)) + 2;
    for (const [k, v] of lines) {
      this.context.stdout.write(`${k.padEnd(pad)}${v}\n`);
    }
    return ExitCode.Ok;
  }
}

async function resolveSpecVersion(): Promise<string> {
  try {
    const mod = await import('@skill-map/spec', { with: { type: 'json' } });
    const version = (mod as { default?: { specPackageVersion?: string } }).default
      ?.specPackageVersion;
    return version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Read `PRAGMA user_version` from the project DB. The migrations runner
 * keeps this in sync with the latest applied kernel migration; a fresh
 * DB returns 0.
 *
 * Failure modes (return `—` for all):
 *   - DB file does not exist (no `sm init` yet).
 *   - DB file exists but cannot be opened (corrupt / permissions).
 *   - PRAGMA returns null / non-numeric (engine quirk; never observed).
 */
function resolveDbSchemaVersion(): string {
  const dbPath = resolveDbPath({ global: false, db: undefined });
  if (!existsSync(dbPath)) return '—';
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
      const v = row?.user_version;
      if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
      return String(v);
    } finally {
      db.close();
    }
  } catch {
    return '—';
  }
}
