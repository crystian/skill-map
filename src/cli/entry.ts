/**
 * CLI entry — composed by `bin/sm.mjs`. Registers every command and hands off
 * to Clipanion. Exit codes follow `spec/cli-contract.md`:
 *
 *   0  ok
 *   1  issues / non-clean scan
 *   2  error (unhandled / config)
 *   3  duplicate
 *   4  nonce-mismatch
 *   5  not-found
 */

import { Builtins, Cli } from 'clipanion';

import { ScanCommand } from './commands/scan.js';
import { BINARY_LABEL, BINARY_NAME, VERSION } from './version.js';

const cli = new Cli({
  binaryLabel: BINARY_LABEL,
  binaryName: BINARY_NAME,
  binaryVersion: VERSION,
  enableCapture: false,
});

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.register(ScanCommand);

const args = process.argv.slice(2);
const exitCode = await cli.run(args, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
process.exit(exitCode);
