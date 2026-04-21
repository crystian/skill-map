import { Command } from 'clipanion';

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
    const dbSchema = '—';

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
    return 0;
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
