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

import { Cli, Command, Option } from 'clipanion';

import { ExitCode } from '../util/exit-codes.js';
import { BINARY_LABEL, VERSION } from '../version.js';
import { tx } from '../../kernel/util/tx.js';
import { HELP_TEXTS } from '../i18n/help.texts.js';

type THelpFormat = 'human' | 'md' | 'json';

interface ICliDefinition {
  /** Just the verb path: `sm scan compare-with`. No options or positionals. */
  path: string;
  /**
   * Detailed usage line as Clipanion would render it, e.g.
   * `sm scan compare-with [--json] [--no-tokens] <dump> ...`. Used to
   * extract positional fragments since `path` strips them.
   */
  usage: string;
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
  /** Trailing positional fragment ready to splice into a USAGE line, e.g. ` <orphanPath>`. Empty when none. */
  positionals: string;
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

  verbParts = Option.Rest({ required: 0 });
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

    const verb = this.verbParts.join(' ').trim();
    if (verb) {
      const target = verbs.find((v) => v.name === verb);
      if (!target) {
        this.context.stderr.write(tx(HELP_TEXTS.unknownVerb, { verb }));
        return ExitCode.NotFound;
      }
      this.context.stdout.write(renderSingle(target, format));
      return ExitCode.Ok;
    }

    if (format === 'human') {
      this.context.stdout.write(renderCompactOverview(verbs));
      return ExitCode.Ok;
    }

    const doc: IHelpDocument = {
      cliVersion: VERSION,
      specVersion: resolveSpecVersion(),
      globalFlags: [
        { name: '--help', type: 'boolean', description: HELP_TEXTS.globalFlagHelpDescription },
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
  const rawPath = (def.path ?? '').trim();
  const detailedUsage = (def.usage ?? rawPath).trim();
  const path = rawPath.replace(/^sm\s+/, '').replace(/\s*\.\.\.$/, '').trim();
  const verbName = stripPositionals(path);
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
    name: verbName,
    category: (def.category ?? 'Other').trim(),
    description: (def.description ?? '').trim(),
    details: (def.details ?? '').trim(),
    positionals: extractPositionals(detailedUsage, verbName),
    examples,
    flags,
  };
}

/**
 * Extract trailing positional tokens from a Clipanion path string, ready
 * to splice into a USAGE line. Positionals are bracket-balanced tokens
 * (`<x>` or `[x]`) whose first inner char is NOT `-` (those are flags).
 * Returns ` <pos1> [pos2]` or empty string. Variadic `...` is preserved.
 *
 * Exception #2 (char-by-char parser / state machine): each char triggers
 * a depth/buffer state transition; splitting per state mode hides the
 * dispatcher loop. See AGENTS.md "When eslint-disable-next-line is acceptable".
 */
// eslint-disable-next-line complexity
function extractPositionals(rawPath: string, verbName: string): string {
  const afterPrefix = rawPath.replace(/^sm\s+/, '').trim();
  const stripped = afterPrefix.startsWith(verbName)
    ? afterPrefix.slice(verbName.length).trim()
    : afterPrefix;
  if (!stripped) return '';

  const tokens: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of stripped) {
    if (ch === '[' || ch === '<') {
      if (depth === 0 && buf.trim()) {
        tokens.push(buf.trim());
        buf = '';
      }
      depth++;
      buf += ch;
    } else if (ch === ']' || ch === '>') {
      depth--;
      buf += ch;
      if (depth === 0) {
        tokens.push(buf.trim());
        buf = '';
      }
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) tokens.push(buf.trim());

  const positionals = tokens.filter((t) => /^[<[][^-]/.test(t) || t === '...');
  return positionals.length > 0 ? ' ' + positionals.join(' ') : '';
}

/** Drop trailing positional fragments to recover the bare verb path (`db migrate`). */
function stripPositionals(path: string): string {
  // Verb tokens are space-separated and don't start with `[`, `<`, or `--`.
  const out: string[] = [];
  for (const tok of path.split(/\s+/)) {
    if (tok.startsWith('[') || tok.startsWith('<') || tok.startsWith('-') || tok === '...') break;
    out.push(tok);
  }
  return out.join(' ');
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
  if (format === 'json') return JSON.stringify(verb, null, 2) + '\n';
  if (format === 'md') {
    const doc: IHelpDocument = {
      cliVersion: VERSION,
      specVersion: resolveSpecVersion(),
      globalFlags: [],
      verbs: [verb],
    };
    return renderMarkdown(doc);
  }
  return renderSingleHuman(verb);
}

function renderSingleHuman(verb: IHelpVerb): string {
  const out: string[] = [];
  out.push(buildHumanHeader(verb));
  out.push('');
  out.push(HELP_TEXTS.humanUsageHeading);
  out.push(tx(HELP_TEXTS.humanUsageRow, { name: verb.name, positionals: verb.positionals }));
  if (verb.details) out.push(...renderHumanDescription(verb.details));
  if (verb.flags.length > 0) out.push(...renderHumanFlags(verb.flags));
  out.push('');
  out.push(tx(HELP_TEXTS.humanFooter, { name: verb.name }));
  return out.join('\n') + '\n';
}

function buildHumanHeader(verb: IHelpVerb): string {
  const { isStub, clean } = classifyDescription(verb.description);
  const description = (isStub ? HELP_TEXTS.compactStubMarker : '') + firstSentence(clean);
  return tx(HELP_TEXTS.humanVerbHeader, { name: verb.name, description });
}

function renderHumanDescription(details: string): string[] {
  const out: string[] = ['', HELP_TEXTS.humanDescriptionHeading];
  for (const line of normaliseDetailLines(details)) {
    out.push(line === '' ? '' : '  ' + line);
  }
  return out;
}

function renderHumanFlags(flags: IHelpVerb['flags']): string[] {
  const out: string[] = ['', HELP_TEXTS.humanFlagsHeading];
  const flagNames = flags.map((f) => [f.name, ...f.aliases].join(', '));
  const flagWidth = Math.max(...flagNames.map((n) => n.length));
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!;
    const names = flagNames[i]!;
    const padding = padRight('', flagWidth - names.length);
    const required = flag.required ? HELP_TEXTS.humanFlagRowRequiredFragment : '';
    const row = tx(HELP_TEXTS.humanFlagRow, {
      names,
      padding,
      description: firstSentence(flag.description),
      required,
    });
    out.push(truncate(row, COMPACT_ROW_MAX));
  }
  return out;
}

/**
 * Reflow a Clipanion `details` block into terminal-friendly lines: trim,
 * collapse soft-wrapped paragraphs, keep blank-line paragraph breaks.
 * Clipanion's source emits details with leading whitespace per line and
 * hard-wrap from the docstring; we restore intent.
 */
function normaliseDetailLines(details: string): string[] {
  return details
    .split('\n')
    .map((l) => l.replace(/^\s+/, '').trimEnd())
    .filter((l, i, arr) => !(l === '' && (i === 0 || arr[i - 1] === '')));
}

// --- compact overview (sm / sm --help / sm help, no verb, human) ----------

interface ICompactExample {
  command: string;
  description: string;
}

/**
 * The intro examples shown at the top of the compact overview. Commands
 * are literal CLI invocations (not translated); descriptions go through
 * the `tx` catalog so they can be localised.
 */
function compactExamples(): ICompactExample[] {
  return [
    { command: 'sm init', description: HELP_TEXTS.compactExampleInit },
    { command: 'sm scan && sm check', description: HELP_TEXTS.compactExampleScanCheck },
    { command: 'sm orphans --json | jq', description: HELP_TEXTS.compactExampleOrphans },
  ];
}

/** Take the first sentence of a description for the compact one-liner column. */
function firstSentence(text: string): string {
  const idx = text.indexOf('. ');
  if (idx === -1) return text.replace(/\.$/, '').trim();
  return text.slice(0, idx).trim();
}

/** Hard cap on the rendered width of a single compact row, including indent. */
const COMPACT_ROW_MAX = 120;

/**
 * Strip the `(planned)` marker from a verb description and report whether
 * it was present. Stubs are surfaced via a leading `[stub] ` tag in the
 * compact column rather than the trailing parenthetical, so the column
 * stays alignable and the marker stays visible after `firstSentence()`
 * truncation.
 */
function classifyDescription(raw: string): { isStub: boolean; clean: string } {
  const isStub = /\(planned\)/.test(raw);
  const clean = raw.replace(/\s*\(planned\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return { isStub, clean };
}

/** Truncate `text` with a single-char ellipsis to fit `width`, no-op if it already fits. */
function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width < 1) return '';
  return text.slice(0, width - 1) + '…';
}

/** Right-pad `value` with spaces to `width` columns. */
function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/**
 * Render the compact top-level overview. Replaces Clipanion's default
 * `cli.usage()` ANSI banner. Format: header tagline, USAGE block,
 * EXAMPLES block, then per-category two-column command listing, then a
 * footer pointing to per-verb help. Per-category column width is
 * computed independently so a single long verb in one category does not
 * widen every other section.
 */
export function renderCompactOverview(verbs: IHelpVerb[]): string {
  const lines: string[] = [];
  lines.push(tx(HELP_TEXTS.compactHeader, { binary: BINARY_LABEL, version: VERSION }));
  lines.push('');
  lines.push(HELP_TEXTS.compactUsageHeading);
  lines.push(HELP_TEXTS.compactUsageLine);
  lines.push('');

  const examples = compactExamples();
  const exampleWidth = Math.max(...examples.map((e) => e.command.length));
  lines.push(HELP_TEXTS.compactExamplesHeading);
  for (const ex of examples) {
    const padding = ' '.repeat(exampleWidth - ex.command.length);
    lines.push(tx(HELP_TEXTS.compactExampleRow, {
      command: ex.command,
      padding,
      description: ex.description,
    }));
  }
  lines.push('');

  const byCategory = new Map<string, IHelpVerb[]>();
  for (const verb of verbs) {
    const list = byCategory.get(verb.category) ?? [];
    list.push(verb);
    byCategory.set(verb.category, list);
  }

  const sortedCategories = [...byCategory.keys()].sort();
  for (const category of sortedCategories) {
    const verbsInCategory = byCategory.get(category)!;
    verbsInCategory.sort((a, b) => a.name.localeCompare(b.name));
    const verbWidth = Math.max(...verbsInCategory.map((v) => v.name.length));
    lines.push(tx(HELP_TEXTS.compactCategoryHeading, { category: category.toUpperCase() }));
    for (const verb of verbsInCategory) {
      const { isStub, clean } = classifyDescription(verb.description);
      const description = (isStub ? HELP_TEXTS.compactStubMarker : '') + firstSentence(clean);
      const row = tx(HELP_TEXTS.compactVerbRow, {
        name: verb.name,
        padding: padRight('', verbWidth - verb.name.length),
        description,
      });
      lines.push(truncate(row, COMPACT_ROW_MAX));
    }
    lines.push('');
  }

  lines.push(HELP_TEXTS.compactFooter);
  return lines.join('\n') + '\n';
}

// --- root --help / -h -----------------------------------------------------

/**
 * Replaces Clipanion's `Builtins.HelpCommand` so `sm`, `sm --help`,
 * `sm -h` render the compact overview instead of the default ANSI
 * banner. Per-verb `sm <verb> --help` is still served by Clipanion's
 * built-in tokenizer and untouched.
 *
 * Bare `sm` (no arguments) is NOT routed here — it is intercepted in
 * `entry.ts` per spec/cli-contract.md §Binary: it starts the Web UI
 * server when a project is initialized, or prints a hint and exits
 * non-zero when no project is found. Help is reserved for explicit
 * `--help` / `-h`.
 */
export class RootHelpCommand extends Command {
  static override paths = [['-h'], ['--help']];

  async execute(): Promise<number> {
    const rawDefs = this.cli.definitions() as ICliDefinition[];
    const verbs = rawDefs
      .filter((d) => !isBuiltin(d))
      .map(normalizeDefinition)
      .sort(byPath);
    this.context.stdout.write(renderCompactOverview(verbs));
    return ExitCode.Ok;
  }
}

// --- argv routing ---------------------------------------------------------

const HELP_FLAG_PATTERN = /^(-h|--help)(=.*)?$/;

/**
 * Reroute `sm <verb...> --help|-h` invocations to `sm help <verb...>` so
 * per-verb help goes through `renderSingle()` instead of Clipanion's
 * default `cli.usage(command)` ANSI banner. Matches the longest
 * registered verb-path prefix in the leading positionals; if no prefix
 * matches, args pass through unchanged and Clipanion handles them.
 *
 * Pure: no I/O, no side effects. Called from `entry.ts` before
 * `cli.run()`.
 */
export function routeHelpArgs(args: string[], cli: Cli): string[] {
  if (!shouldRouteHelp(args)) return args;
  const leading = leadingPositionals(args);
  if (leading.length === 0) return args;
  const verbPath = longestVerbPrefix(leading, registeredVerbPaths(cli));
  if (verbPath.length === 0) return args;
  return ['help', ...verbPath];
}

/** Pre-check: only reroute when the args contain a help flag and are not already a help invocation. */
function shouldRouteHelp(args: string[]): boolean {
  if (args.length === 0) return false;
  if (args[0] === 'help') return false;
  if (!args.some((a) => HELP_FLAG_PATTERN.test(a))) return false;
  // Top-level `sm --help` / `sm -h` — RootHelpCommand handles directly.
  if (args.every((a) => HELP_FLAG_PATTERN.test(a))) return false;
  return true;
}

/** Collect leading positional tokens up to the first flag. */
function leadingPositionals(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-')) break;
    out.push(arg);
  }
  return out;
}

/** Return the longest registered verb path that is a prefix of `positionals`, or `[]` if none match. */
function longestVerbPrefix(positionals: string[], verbPaths: string[][]): string[] {
  let best: string[] = [];
  for (const path of verbPaths) {
    if (path.length > positionals.length) continue;
    const matches = path.every((tok, i) => positionals[i] === tok);
    if (matches && path.length > best.length) best = path;
  }
  return best;
}

/**
 * Snapshot of every registered verb path as a token array, e.g.
 * `[['scan'], ['scan', 'compare-with'], ['db', 'migrate'], ...]`.
 * Excludes Clipanion built-ins. Exported so the entry-level parse-error
 * handler can suggest the closest verb when the user types an unknown
 * one.
 */
export function registeredVerbPaths(cli: Cli): string[][] {
  const rawDefs = cli.definitions() as ICliDefinition[];
  const paths: string[][] = [];
  for (const def of rawDefs) {
    if (isBuiltin(def)) continue;
    const path = (def.path ?? '').replace(/^sm\s+/, '').replace(/\s*\.\.\.$/, '').trim();
    const verb = stripPositionals(path);
    if (!verb) continue;
    paths.push(verb.split(/\s+/).filter(Boolean));
  }
  return paths;
}
