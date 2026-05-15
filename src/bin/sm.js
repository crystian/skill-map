#!/usr/bin/env bun
// Runtime guard — fail fast with a human message when invoked under a
// non-Bun runtime. skill-map ships as a Bun-executed binary; it uses
// `bun:sqlite` for storage which has no equivalent under Node, so falling
// through to import('../dist/cli.js') would surface as an opaque
// "Cannot find module 'bun:sqlite'" error instead of guidance.
if (typeof Bun === 'undefined') {
  process.stderr.write(
`skill-map requires Bun >= 1.2.

The CLI uses Bun-only APIs (bun:sqlite) and ships as a Bun binary.
Install Bun from https://bun.sh and retry with: bun ${process.argv0 ?? 'sm'} ...
`,
  );
  process.exit(2);
}

import('../dist/cli.js').catch((err) => {
  process.stderr.write(`sm: failed to load CLI — ${err.message}\n`);
  process.exit(2);
});
