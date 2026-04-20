import { Command, Option } from 'clipanion';

import { createKernel, runScan } from '../../kernel/index.js';

/**
 * `sm scan [roots...] [--json]`
 *
 * Step 0b: stub. Always produces a well-formed empty ScanResult. Step 3 wires
 * the real walker + detectors + rules.
 */
export class ScanCommand extends Command {
  static override paths = [['scan']];

  static override usage = Command.Usage({
    category: 'Scan',
    description: 'Scan roots for markdown nodes, run detectors and rules.',
    details: `
      Walks the given roots, classifies files as nodes, runs all registered
      detectors and rules, and emits a scan result.

      In Step 0b this command returns an empty scan result regardless of input,
      confirming the kernel's boot invariant (zero extensions → empty graph).
    `,
    examples: [
      ['Scan the current directory', '$0 scan'],
      ['Scan multiple roots and print JSON', '$0 scan ./docs ./skills --json'],
    ],
  });

  roots = Option.Rest({ name: 'roots' });
  json = Option.Boolean('--json', false, {
    description: 'Emit a machine-readable ScanResult document on stdout.',
  });

  async execute(): Promise<number> {
    const kernel = createKernel();
    const roots = this.roots.length > 0 ? this.roots : ['.'];
    const result = await runScan(kernel, { roots });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(result) + '\n');
      return 0;
    }

    this.context.stdout.write(
      `Scanned ${result.roots.length} root(s) in ${result.stats.durationMs}ms — ` +
        `${result.stats.nodesCount} nodes, ${result.stats.linksCount} links, ` +
        `${result.stats.issuesCount} issues.\n`,
    );
    return 0;
  }
}
