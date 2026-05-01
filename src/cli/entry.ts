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

import { Builtins, Cli } from 'clipanion';

import { configureLogger } from '../kernel/util/logger.js';
import {
  Logger,
  extractLogLevelFlag,
  resolveLogLevel,
  LOGGER_ENV_VAR,
} from './util/logger.js';
import { CheckCommand } from './commands/check.js';
import { CONFIG_COMMANDS } from './commands/config.js';
import { CONFORMANCE_COMMANDS } from './commands/conformance.js';
import { DB_COMMANDS } from './commands/db.js';
import { ExportCommand } from './commands/export.js';
import { GraphCommand } from './commands/graph.js';
import { HelpCommand } from './commands/help.js';
import { InitCommand } from './commands/init.js';
import { HistoryCommand, HistoryStatsCommand } from './commands/history.js';
import { JobPruneCommand } from './commands/jobs.js';
import { ListCommand } from './commands/list.js';
import { ORPHANS_COMMANDS } from './commands/orphans.js';
import { PLUGIN_COMMANDS } from './commands/plugins.js';
import { REFRESH_COMMANDS } from './commands/refresh.js';
import { ScanCommand } from './commands/scan.js';
import { ScanCompareCommand } from './commands/scan-compare.js';
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

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.register(HelpCommand);
cli.register(InitCommand);
cli.register(ScanCommand);
cli.register(ScanCompareCommand);
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

const exitCode = await cli.run(args, {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
process.exit(exitCode);
