#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Shebang note: `env -S` lets us pass `--disable-warning=ExperimentalWarning`
// to node so end users don't see the `node:sqlite` experimental notice on
// every invocation. The flag scopes to ExperimentalWarning only — other
// warning classes (DeprecationWarning, etc.) still surface.
//
// Runtime guard — fail fast with a human message before importing anything
// that uses Node 24 APIs (node:sqlite stable, built-in WebSocket, modern
// ESM loader). Without this, a user on Node 20/22 gets an obscure
// SyntaxError or "module not found" instead of guidance.
const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  process.stderr.write(
`skill-map requires Node.js >= 24 (found v${process.versions.node}).

Node 24 is the active LTS since October 2025 and brings:
  - stable node:sqlite (used for the skill-map database)
  - built-in WebSocket client
  - modern ESM loader

Install the latest LTS from https://nodejs.org and retry.
`,
  );
  process.exit(2);
}

import('../dist/cli.js').catch((err) => {
  process.stderr.write(`sm: failed to load CLI — ${err.message}\n`);
  process.exit(2);
});
