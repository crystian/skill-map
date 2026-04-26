#!/usr/bin/env node
/**
 * `npm run sqlite` — open the project's SQLite DB in DB Browser for SQLite
 * (sqlitebrowser).
 *
 * Defaults to read-only because the typical use case is exploring while
 * `sm scan` may be writing in another terminal. Pass `--rw` to override.
 *
 * Resolution order for the DB path:
 *   1. positional arg (e.g. `npm run sqlite -- path/to/other.db`)
 *   2. `--db <path>`
 *   3. `-g` / `--global` → `~/.skill-map/skill-map.db`
 *   4. default → `<cwd>/.skill-map/skill-map.db`
 *
 * Why a script vs. a raw `sqlitebrowser .skill-map/skill-map.db` alias:
 *   - Friendly errors when sqlitebrowser is missing or the DB doesn't exist.
 *   - Read-only by default, scoped to this project's convention.
 *   - Detached spawn so the terminal stays usable after launch.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

const flags = new Set();
const positionals = [];
let dbOverride = null;

for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '-g' || a === '--global') flags.add('global');
  else if (a === '--rw') flags.add('rw');
  else if (a === '--db') {
    dbOverride = args[++i];
  } else if (a === '-h' || a === '--help') {
    flags.add('help');
  } else if (a.startsWith('-')) {
    process.stderr.write(`Unknown flag: ${a}\nRun with --help to see usage.\n`);
    process.exit(2);
  } else {
    positionals.push(a);
  }
}

if (flags.has('help')) {
  process.stdout.write(
    `Usage: npm run sqlite [-- [path] [--db <path>] [-g|--global] [--rw]]\n\n` +
      `Opens the SQLite DB in DB Browser for SQLite (sqlitebrowser).\n` +
      `Read-only by default; pass --rw to enable writes.\n\n` +
      `Examples:\n` +
      `  npm run sqlite                     # opens .skill-map/skill-map.db read-only\n` +
      `  npm run sqlite -- --rw             # read-write\n` +
      `  npm run sqlite -- -g               # ~/.skill-map/skill-map.db\n` +
      `  npm run sqlite -- path/to/x.db     # arbitrary path\n`,
  );
  process.exit(0);
}

const dbPath = positionals[0]
  ? resolve(positionals[0])
  : dbOverride
    ? resolve(dbOverride)
    : flags.has('global')
      ? resolve(homedir(), '.skill-map/skill-map.db')
      : resolve(process.cwd(), '.skill-map/skill-map.db');

if (!existsSync(dbPath)) {
  process.stderr.write(
    `DB not found: ${dbPath}\n` +
      `Run \`sm scan\` first (or \`node src/bin/sm.mjs scan\` from the repo root).\n`,
  );
  process.exit(5);
}

// Sniff the binary before spawning to give a clean install hint instead of
// a vague ENOENT trace.
const which = spawn('which', ['sqlitebrowser'], { stdio: 'ignore' });
which.on('exit', (code) => {
  if (code !== 0) {
    process.stderr.write(
      `sqlitebrowser not found on PATH.\n` +
        `Install it (Debian/Ubuntu): sudo apt install -y sqlitebrowser\n`,
    );
    process.exit(2);
  }
  launch();
});

function launch() {
  const readOnly = !flags.has('rw');
  const sbArgs = readOnly ? ['-R', dbPath] : [dbPath];

  process.stdout.write(
    `Opening ${dbPath}${readOnly ? ' (read-only)' : ' (read-write)'}\n`,
  );

  const child = spawn('sqlitebrowser', sbArgs, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
