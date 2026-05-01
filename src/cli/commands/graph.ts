/**
 * `sm graph [--format <name>]`
 *
 * Renders the persisted graph through a registered formatter and writes
 * the result to stdout. Default `--format ascii` (the only built-in
 * formatter at v0.5.0; mermaid / dot land at Step 12 as drop-in additions).
 *
 * Read-only: opens the DB, calls `loadScanResult`, picks the formatter
 * whose `formatId` matches `--format`, and prints. Never persists.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok
 *   2  bad flag / no formatter registered / unhandled error
 *   5  DB missing
 *
 * Formatter registry: built-in formatters plus drop-in plugin formatters
 * discovered under `.skill-map/plugins/` and `~/.skill-map/plugins/`
 * (Step 9.1). Failed plugins emit one stderr warning each; the verb
 * keeps running on whatever loaded successfully. Pass `--no-plugins`
 * to skip plugin discovery entirely.
 */

import { Command, Option } from 'clipanion';

import { loadScanResult } from '../../kernel/adapters/sqlite/scan-load.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import {
  composeFormatters,
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';
import { withSqlite } from '../util/with-sqlite.js';

const DEFAULT_FORMAT = 'ascii';

export class GraphCommand extends Command {
  static override paths = [['graph']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Render the full graph via the named formatter.',
    details: `
      Reads the persisted scan and prints a textual rendering. The
      built-in \`ascii\` formatter is the only format available at
      v0.5.0; \`mermaid\` and \`dot\` are deferred to Step 12 and will
      surface here automatically once they ship as built-ins.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['Render the graph as ASCII (default)', '$0 graph'],
      ['Render with an explicit format', '$0 graph --format ascii'],
      ['Use a non-default DB file', '$0 graph --db /path/to/skill-map.db'],
    ],
  });

  format = Option.String('--format', DEFAULT_FORMAT, {
    description: `Formatter format. Must match the \`formatId\` field of a registered formatter. Default: ${DEFAULT_FORMAT}.`,
  });
  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery. Only built-in formatters participate.',
  });

  async execute(): Promise<number> {
    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    const pluginRuntime = this.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ scope: this.global ? 'global' : 'project' });
    for (const warn of pluginRuntime.warnings) this.context.stderr.write(`${warn}\n`);

    const formatters = composeFormatters({ pluginRuntime });
    const formatter = formatters.find((f) => f.formatId === this.format);
    if (!formatter) {
      const available = formatters
        .map((f) => f.formatId)
        .sort()
        .join(', ');
      this.context.stderr.write(
        `No formatter registered for format=${this.format}. Available: ${available || '(none)'}.\n`,
      );
      return ExitCode.Error;
    }

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const scan = await loadScanResult(adapter.db);
      const text = formatter.format({
        nodes: scan.nodes,
        links: scan.links,
        issues: scan.issues,
      });
      // Formatter output is text; trailing newline normalisation makes the
      // verb safe to pipe into anything that splits on lines without
      // double-newlining when the formatter already terminates its output.
      this.context.stdout.write(text.endsWith('\n') ? text : text + '\n');
      return ExitCode.Ok;
    });
  }
}

