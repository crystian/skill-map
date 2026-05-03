/**
 * CLI entry — composed by `bin/sm.js`. Registers every command and hands off
 * to Clipanion. Exit codes are defined once in `src/cli/util/exit-codes.ts`
 * (the `ExitCode` object) and follow `spec/cli-contract.md`:
 *
 *   0  ok                — `ExitCode.Ok`
 *   1  issues             — `ExitCode.Issues` (non-clean scan / check)
 *   2  error              — `ExitCode.Error` (unhandled / config / bad usage)
 *   3  duplicate          — `ExitCode.Duplicate` (record stub)
 *   4  nonce-mismatch     — `ExitCode.NonceMismatch` (record stub)
 *   5  not-found          — `ExitCode.NotFound` (DB / row / dump)
 */

import { existsSync } from 'node:fs';

import { Builtins, Cli } from 'clipanion';

import { configureLogger } from '../kernel/util/logger.js';
import { tx } from '../kernel/util/tx.js';
import { ENTRY_TEXTS } from './i18n/entry.texts.js';
import {
  Logger,
  extractLogLevelFlag,
  resolveLogLevel,
  LOGGER_ENV_VAR,
} from './util/logger.js';
import { defaultProjectDbPath } from './util/db-path.js';
import { ExitCode } from './util/exit-codes.js';
import { formatParseError, isClipanionParseError } from './util/parse-error.js';
import { defaultRuntimeContext } from './util/runtime-context.js';
import { CheckCommand } from './commands/check.js';
import { CONFIG_COMMANDS } from './commands/config.js';
import { CONFORMANCE_COMMANDS } from './commands/conformance.js';
import { DB_COMMANDS } from './commands/db.js';
import { ExportCommand } from './commands/export.js';
import { GraphCommand } from './commands/graph.js';
import { HelpCommand, RootHelpCommand, registeredVerbPaths, routeHelpArgs } from './commands/help.js';
import { InitCommand } from './commands/init.js';
import { HistoryCommand, HistoryStatsCommand } from './commands/history.js';
import { JobPruneCommand } from './commands/jobs.js';
import { ListCommand } from './commands/list.js';
import { ORPHANS_COMMANDS } from './commands/orphans.js';
import { PLUGIN_COMMANDS } from './commands/plugins.js';
import { REFRESH_COMMANDS } from './commands/refresh.js';
import { ScanCommand } from './commands/scan.js';
import { ScanCompareCommand } from './commands/scan-compare.js';
import { ServeCommand } from './commands/serve.js';
import { ShowCommand } from './commands/show.js';
import { STUB_COMMANDS } from './commands/stubs.js';
import { VersionCommand } from './commands/version.js';
import { WatchCommand } from './commands/watch.js';
import { BINARY_LABEL, BINARY_NAME, VERSION } from './version.js';

const cli = new Cli({
  binaryLabel: BINARY_LABEL,
  binaryName: BINARY_NAME,
  binaryVersion: VERSION,
  enableCapture: false,
});

cli.register(Builtins.VersionCommand);
cli.register(RootHelpCommand);
cli.register(HelpCommand);
cli.register(InitCommand);
cli.register(ScanCommand);
cli.register(ScanCompareCommand);
cli.register(ServeCommand);
cli.register(WatchCommand);
cli.register(VersionCommand);
cli.register(ListCommand);
cli.register(ShowCommand);
cli.register(CheckCommand);
cli.register(GraphCommand);
cli.register(ExportCommand);
cli.register(HistoryCommand);
cli.register(HistoryStatsCommand);
cli.register(JobPruneCommand);
for (const cmd of CONFIG_COMMANDS) cli.register(cmd);
for (const cmd of CONFORMANCE_COMMANDS) cli.register(cmd);
for (const cmd of DB_COMMANDS) cli.register(cmd);
for (const cmd of PLUGIN_COMMANDS) cli.register(cmd);
for (const cmd of ORPHANS_COMMANDS) cli.register(cmd);
for (const cmd of REFRESH_COMMANDS) cli.register(cmd);
for (const cmd of STUB_COMMANDS) cli.register(cmd);

const { value: logLevelFlag, rest: args } = extractLogLevelFlag(process.argv.slice(2));
const logLevel = resolveLogLevel({
  flag: logLevelFlag,
  env: process.env[LOGGER_ENV_VAR] ?? null,
  fallback: 'warn',
  errStream: process.stderr,
});
configureLogger(new Logger({ level: logLevel, stream: process.stderr }));

// Bare invocation: `sm` with no arguments. Per spec/cli-contract.md
// §Binary, this routes to `sm serve` when a project DB exists in the
// cwd; otherwise it prints a hint and exits with code 2 (operational —
// no project to serve). `--help` / `-h` flags fall through to
// RootHelpCommand and are NOT intercepted here.
const bareArgs = args.length === 0 ? resolveBareDefault() : null;
const routedArgs = routeHelpArgs(bareArgs ?? args, cli);

// Pre-parse so we can intercept Clipanion's UnknownSyntaxError /
// AmbiguousSyntaxError before its default handler dumps every command's
// USAGE line to stdout. Our replacement writes a concise diagnostic to
// stderr and exits with `ExitCode.Error` (2) per spec/cli-contract.md
// §Exit codes — "unknown flag" is operational error, not result issue.
try {
  cli.process(routedArgs, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
} catch (err) {
  if (isClipanionParseError(err)) {
    process.stderr.write(
      formatParseError({
        args: routedArgs,
        verbPaths: registeredVerbPaths(cli),
        error: err,
      }),
    );
    process.exit(ExitCode.Error);
  }
  throw err;
}

const exitCode = await cli.run(routedArgs, {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
process.exit(exitCode);

/**
 * Decide what bare `sm` should do. Returns `['serve']` if a project DB
 * is present in the cwd; prints the no-project hint and exits 2
 * otherwise. Never returns when no project is found.
 */
function resolveBareDefault(): string[] {
  const ctx = defaultRuntimeContext();
  if (existsSync(defaultProjectDbPath(ctx))) {
    return ['serve'];
  }
  process.stderr.write(tx(ENTRY_TEXTS.bareNoProject, { cwd: ctx.cwd }));
  process.exit(ExitCode.Error);
}
