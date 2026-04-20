#!/usr/bin/env node
import('../dist/cli.js').catch((err) => {
  process.stderr.write(`sm: failed to load CLI — ${err.message}\n`);
  process.exit(2);
});
