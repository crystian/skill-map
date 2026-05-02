import { Command } from 'clipanion';

import { tx } from '../../kernel/util/tx.js';
import { VERSION_TEXTS } from '../i18n/version.texts.js';
import { resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { SmCommand } from '../util/sm-command.js';
import { VERSION } from '../version.js';
import { tryWithSqlite } from '../util/with-sqlite.js';

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
 * `runtime` is rendered in human mode but absent from `--json` —
 * `cli-contract.md` § `sm version` lists exactly four JSON fields
 * (`{ sm, kernel, spec, dbSchema }`); the runtime line is
 * informational only and stays out of the machine surface to keep the
 * spec contract literal. Promoting it would require a spec PR + a
 * changeset.
 *
 * The Clipanion built-in `--version` flag remains for the single-line form.
 *
 * `db-schema` resolution:
 *   - When the project DB file exists, the command opens it through
 *     `StoragePort.migrations.currentSchemaVersion()` (which reads
 *     `PRAGMA user_version`; the migrations runner keeps that pragma in
 *     sync with the latest applied kernel migration).
 *   - When the DB is absent, the field stays `—` (no scope provisioned
 *     yet — typically pre-`sm init`).
 *   - Any read failure is silenced into `—` rather than turned into an
 *     error: `sm version` is informational and MUST NOT crash on a bad
 *     DB file.
 */
export class VersionCommand extends SmCommand {
  static override paths = [['version']];

  static override usage = Command.Usage({
    category: 'Introspection',
    description: 'Print the CLI / kernel / spec / runtime / db-schema version matrix.',
  });

  // Informational verb — no `done in <…>` line; the version matrix is
  // the entire output.
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    const runtime = `Node ${process.version}`;
    const kernelVersion = VERSION;
    const specVersion = await resolveSpecVersion();
    const dbSchema = await resolveDbSchemaVersion();

    if (this.json) {
      // Spec § `sm version`: exactly `{ sm, kernel, spec, dbSchema }`.
      // `dbSchema` keeps the human-rendered `—` sentinel for "no DB
      // yet" so consumers branch on the literal once instead of having
      // to remember a separate JSON-only convention.
      const payload = {
        sm: VERSION,
        kernel: kernelVersion,
        spec: specVersion,
        dbSchema,
      };
      this.context.stdout.write(JSON.stringify(payload) + '\n');
      return ExitCode.Ok;
    }

    const lines: Array<[string, string]> = [
      ['sm', VERSION],
      ['kernel', kernelVersion],
      ['spec', specVersion],
      ['runtime', runtime],
      ['db-schema', dbSchema],
    ];

    const pad = Math.max(...lines.map(([k]) => k.length)) + 2;
    for (const [k, v] of lines) {
      this.context.stdout.write(tx(VERSION_TEXTS.matrixRow, { key: k.padEnd(pad), value: v }));
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
 * Resolve the project DB schema version through `StoragePort`.
 *
 * Failure modes (return `—` for all):
 *   - DB file does not exist (no `sm init` yet — `tryWithSqlite`
 *     short-circuits to `null` before opening the adapter, so no
 *     `.skill-map/` directory is provisioned for an informational
 *     read).
 *   - DB file exists but cannot be opened (corrupt / permissions).
 *   - PRAGMA returns null / non-numeric (engine quirk; never observed).
 */
async function resolveDbSchemaVersion(): Promise<string> {
  const dbPath = resolveDbPath({ global: false, db: undefined, ...defaultRuntimeContext() });
  try {
    const v = await tryWithSqlite({ databasePath: dbPath, autoBackup: false }, async (port) =>
      port.migrations.currentSchemaVersion(),
    );
    if (v === null || v === undefined) return '—';
    return String(v);
  } catch {
    return '—';
  }
}
