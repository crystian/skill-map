#!/usr/bin/env node
// Alias / placeholder package. NOT functional. Only prints a warning that
// directs users to the real CLI. See ../../README.md.
process.stderr.write(`
WARNING: 'skillmap' is a placeholder, not the real CLI.

The project name is spelled with a hyphen: skill-map.
The official command-line tool lives at @skill-map/cli.

Install it with:
  npm install --global @skill-map/cli

Or run one-shot:
  npx @skill-map/cli --version

Documentation: https://skill-map.dev
`);
process.exit(1);
