#!/usr/bin/env node
// Alias / placeholder package. NOT functional. Only prints a warning that
// directs users to the real CLI. See ../../README.md.
process.stderr.write(`
WARNING: 'sm-cli' is a placeholder, not the real CLI.

'sm' is the binary name (short alias of 'skill-map'), not a package name.
The official command-line tool is published as @skill-map/cli.

Install it with:
  npm install --global @skill-map/cli

That gives you the 'sm' binary in your $PATH.

Documentation: https://skill-map.dev
`);
process.exit(1);
