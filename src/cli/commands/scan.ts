import { Command, Option } from 'clipanion';

import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../extensions/built-ins.js';

/**
 * `sm scan [roots...] [--json] [--no-built-ins]`
 *
 * Scans the given roots using the built-in extension set (claude adapter,
 * 3 detectors, 3 rules). The registry is populated with manifest rows so
 * introspection (`sm help`, future `sm plugins`) sees what's active; the
 * orchestrator consumes the callable instances separately.
 *
 * The kernel-empty-boot invariant still holds: passing `--no-built-ins`
 * reproduces the zero-filled ScanResult that `kernel-empty-boot`
 * validates. The conformance fixture runs `--no-built-ins` so the
 * invariant stays testable without building the built-in set into the
 * baseline.
 */
export class ScanCommand extends Command {
  static override paths = [['scan']];

  static override usage = Command.Usage({
    category: 'Scan',
    description: 'Scan roots for markdown nodes, run detectors and rules.',
    details: `
      Walks the given roots with the built-in claude adapter, runs the
      frontmatter / slash / at-directive detectors per node, then the
      trigger-collision / broken-ref / superseded rules over the full
      graph. Emits a ScanResult conforming to scan-result.schema.json.
    `,
    examples: [
      ['Scan the current directory', '$0 scan'],
      ['Scan multiple roots and print JSON', '$0 scan ./docs ./skills --json'],
      ['Empty-pipeline conformance', '$0 scan --no-built-ins --json'],
    ],
  });

  roots = Option.Rest({ name: 'roots' });
  json = Option.Boolean('--json', false, {
    description: 'Emit a machine-readable ScanResult document on stdout.',
  });
  noBuiltIns = Option.Boolean('--no-built-ins', false, {
    description: 'Skip the built-in extension set. Yields a zero-filled ScanResult (kernel-empty-boot parity).',
  });

  async execute(): Promise<number> {
    const kernel = createKernel();
    const roots = this.roots.length > 0 ? this.roots : ['.'];

    const extensions = this.noBuiltIns ? undefined : builtIns();
    if (!this.noBuiltIns) {
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    }

    const runOptions: Parameters<typeof runScan>[1] = { roots };
    if (extensions) runOptions.extensions = extensions;
    const result = await runScan(kernel, runOptions);

    if (this.json) {
      this.context.stdout.write(JSON.stringify(result) + '\n');
      return 0;
    }

    this.context.stdout.write(
      `Scanned ${result.roots.length} root(s) in ${result.stats.durationMs}ms — ` +
        `${result.stats.nodesCount} nodes, ${result.stats.linksCount} links, ` +
        `${result.stats.issuesCount} issues.\n`,
    );
    return result.stats.issuesCount > 0 ? 1 : 0;
  }
}
