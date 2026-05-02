/**
 * `sm help [<verb>] [--format human|md|json]`
 *
 * Self-describing introspection over the registered command surface. The
 * shape of the JSON output is normative (see spec/cli-contract.md §Help)
 * so third-party tooling — docs generator, shell completion, Web UI form
 * generation, IDE extensions, test harness, sm-cli skill — can rely on it.
 *
 * `human` delegates to Clipanion's own Cli.usage() for overview and
 * Cli.usage(command) for a specific verb so we match the built-in
 * formatting exactly. `md` emits canonical markdown grouped by category;
 * `context/cli-reference.md` is regenerated from this and diffed in CI.
 * `json` emits the structured surface dump.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { ExitCode } from '../util/exit-codes.js';
import { VERSION } from '../version.js';
import { tx } from '../../kernel/util/tx.js';
import { HELP_TEXTS } from '../i18n/help.texts.js';

type THelpFormat = 'human' | 'md' | 'json';

interface ICliDefinition {
  path: string;
  category?: string;
  description?: string;
  details?: string;
  examples?: Array<[string, string]>;
  options?: Array<{
    preferredName: string;
    nameSet: string[];
    definition: string;
    description?: string;
    required?: boolean;
  }>;
}

interface IHelpVerb {
  name: string;
  category: string;
  description: string;
  details: string;
  examples: Array<{ title: string; command: string }>;
  flags: Array<{
    name: string;
    aliases: string[];
    type: 'boolean' | 'string';
    description: string;
    required: boolean;
  }>;
}

interface IHelpDocument {
  cliVersion: string;
  specVersion: string;
  globalFlags: Array<{ name: string; type: 'boolean'; description: string }>;
  verbs: IHelpVerb[];
}

export class HelpCommand extends Command {
  static override paths = [['help']];
  static override usage = Command.Usage({
    category: 'Introspection',
    description: 'Self-describing introspection. --format human|md|json.',
    details: `
      Without a verb: overview of every registered command grouped by category.
      With a verb: the detail view for that single command.

      Formats:
        human (default) — pretty terminal output.
        md              — canonical markdown. context/cli-reference.md is
                          regenerated from this and CI fails on drift.
        json            — structured surface dump per spec/cli-contract.md.
    `,
  });

  verb = Option.String({ required: false });
  format = Option.String('--format', 'human');

  async execute(): Promise<number> {
    const format = normalizeFormat(this.format);
    if (!format) {
      this.context.stderr.write(tx(HELP_TEXTS.invalidFormat, { format: this.format }));
      return ExitCode.Error;
    }

    // Pull definitions from Clipanion and normalise them into our shape.
    const rawDefs = this.cli.definitions() as ICliDefinition[];
    const verbs = rawDefs
      .filter((d) => !isBuiltin(d))
      .map(normalizeDefinition)
      .sort(byPath);

    if (this.verb) {
      const target = verbs.find((v) => v.name === this.verb);
      if (!target) {
        this.context.stderr.write(tx(HELP_TEXTS.unknownVerb, { verb: this.verb }));
        return ExitCode.NotFound;
      }
      this.context.stdout.write(renderSingle(target, format));
      return ExitCode.Ok;
    }

    if (format === 'human') {
      this.context.stdout.write(this.cli.usage() + '\n');
      return ExitCode.Ok;
    }

    const doc: IHelpDocument = {
      cliVersion: VERSION,
      specVersion: resolveSpecVersion(),
      globalFlags: [
        { name: '--help', type: 'boolean', description: 'Print usage and exit.' },
      ],
      verbs,
    };

    if (format === 'json') {
      this.context.stdout.write(JSON.stringify(doc, null, 2) + '\n');
      return ExitCode.Ok;
    }

    this.context.stdout.write(renderMarkdown(doc));
    return ExitCode.Ok;
  }
}

// --- normalisation --------------------------------------------------------

function normalizeFormat(raw: string): THelpFormat | null {
  if (raw === 'human' || raw === 'md' || raw === 'json') return raw;
  return null;
}

function isBuiltin(def: ICliDefinition): boolean {
  // Clipanion's built-ins register as `help` / `-h` / `--help` / `--version`.
  // Our own HelpCommand registers as `help` too; we want to keep that entry
  // but drop the raw flag paths that come from Builtins.
  const path = (def.path ?? '').trim();
  return path === 'sm -h' || path === 'sm --help' || path === 'sm --version';
}

function normalizeDefinition(def: ICliDefinition): IHelpVerb {
  const path = (def.path ?? '').replace(/^sm\s+/, '').replace(/\s*\.\.\.$/, '').trim();
  const options = def.options ?? [];
  const flags = options.map((opt) => ({
    name: opt.preferredName,
    aliases: opt.nameSet.filter((n) => n !== opt.preferredName),
    type: inferOptionType(opt.definition),
    description: (opt.description ?? '').trim(),
    required: opt.required === true,
  }));
  const examples = (def.examples ?? []).map(([title, command]) => ({
    title: title.trim(),
    command: command.trim(),
  }));
  return {
    name: path,
    category: (def.category ?? 'Other').trim(),
    description: (def.description ?? '').trim(),
    details: (def.details ?? '').trim(),
    examples,
    flags,
  };
}

function inferOptionType(definition: string): 'boolean' | 'string' {
  // Clipanion emits "--json" for booleans and "--json #0" (with a
  // placeholder) for strings / arrays.
  return /#\d/.test(definition) ? 'string' : 'boolean';
}

function byPath(a: IHelpVerb, b: IHelpVerb): number {
  return a.name.localeCompare(b.name);
}

function resolveSpecVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    const indexPath = req.resolve('@skill-map/spec/index.json');
    const pkgPath = resolve(indexPath, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// --- renderers ------------------------------------------------------------

function renderMarkdown(doc: IHelpDocument): string {
  const out: string[] = [];
  out.push(HELP_TEXTS.mdReferenceTitle, '');
  out.push(HELP_TEXTS.mdGeneratedNotice, '');
  out.push(tx(HELP_TEXTS.mdCliVersionLine, { version: doc.cliVersion }));
  out.push(tx(HELP_TEXTS.mdSpecVersionLine, { version: doc.specVersion }));
  out.push('');

  if (doc.globalFlags.length > 0) {
    out.push(HELP_TEXTS.mdHeaderGlobalFlags, '');
    for (const flag of doc.globalFlags) {
      out.push(tx(HELP_TEXTS.mdGlobalFlagBullet, { name: flag.name, description: flag.description }));
    }
    out.push('');
  }

  const byCategory = new Map<string, IHelpVerb[]>();
  for (const verb of doc.verbs) {
    if (!byCategory.has(verb.category)) byCategory.set(verb.category, []);
    byCategory.get(verb.category)!.push(verb);
  }
  const sortedCategories = [...byCategory.keys()].sort();

  for (const category of sortedCategories) {
    out.push(tx(HELP_TEXTS.mdCategoryHeading, { category }), '');
    const verbs = byCategory.get(category)!;
    for (const verb of verbs) out.push(...renderVerbBlock(verb));
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/**
 * Render the markdown block for a single verb: heading, description,
 * details, flags table, examples. Used per verb under each category in
 * `renderMarkdown`. Returns the lines as an array; caller concatenates.
 */
function renderVerbBlock(verb: IHelpVerb): string[] {
  const out: string[] = [];
  out.push(tx(HELP_TEXTS.mdVerbHeading, { name: verb.name }), '');
  if (verb.description) out.push(verb.description, '');
  if (verb.details) out.push(verb.details, '');
  if (verb.flags.length > 0) out.push(...renderVerbFlags(verb.flags));
  if (verb.examples.length > 0) out.push(...renderVerbExamples(verb.examples));
  return out;
}

/** Markdown flags table for one verb. */
function renderVerbFlags(flags: IHelpVerb['flags']): string[] {
  const lines: string[] = [HELP_TEXTS.mdLabelFlags, ''];
  for (const flag of flags) {
    const names = [flag.name, ...flag.aliases].map((n) => `\`${n}\``).join(', ');
    const required = flag.required ? HELP_TEXTS.mdFlagBulletRequiredFragment : '';
    const description = flag.description
      ? tx(HELP_TEXTS.mdFlagBulletDescriptionFragment, { description: flag.description })
      : '';
    lines.push(tx(HELP_TEXTS.mdFlagBullet, { names, type: flag.type, required, description }));
  }
  lines.push('');
  return lines;
}

/** Markdown examples block for one verb. */
function renderVerbExamples(examples: IHelpVerb['examples']): string[] {
  const lines: string[] = [HELP_TEXTS.mdLabelExamples, ''];
  for (const ex of examples) {
    lines.push(tx(HELP_TEXTS.mdExampleBullet, { title: ex.title }));
    lines.push('  ```');
    lines.push(`  ${ex.command}`);
    lines.push('  ```');
  }
  lines.push('');
  return lines;
}

function renderSingle(verb: IHelpVerb, format: THelpFormat): string {
  if (format === 'json') {
    return JSON.stringify(verb, null, 2) + '\n';
  }
  if (format === 'md') {
    const doc: IHelpDocument = {
      cliVersion: VERSION,
      specVersion: resolveSpecVersion(),
      globalFlags: [],
      verbs: [verb],
    };
    return renderMarkdown(doc);
  }
  // human single-verb
  const out: string[] = [];
  out.push(tx(HELP_TEXTS.humanVerbHeader, { name: verb.name, description: verb.description }));
  if (verb.details) out.push('', verb.details);
  if (verb.flags.length > 0) {
    out.push('', HELP_TEXTS.humanLabelFlags);
    for (const flag of verb.flags) {
      const names = [flag.name, ...flag.aliases].join(', ');
      const required = flag.required ? HELP_TEXTS.humanFlagRowRequiredFragment : '';
      out.push(tx(HELP_TEXTS.humanFlagRow, { names, required, description: flag.description }));
    }
  }
  return out.join('\n') + '\n';
}
