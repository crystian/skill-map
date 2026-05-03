/**
 * `sm serve` startup banner — TTY-aware, color-aware.
 *
 * Renders the figlet-style banner shown after the listener binds. The verb
 * also keeps a non-TTY fallback that matches the pre-banner two-line
 * shape byte-for-byte so pipes / redirects (`sm serve | tee log.txt`,
 * CI capture) stay grep-friendly.
 *
 * Mode matrix (drives `renderBanner`):
 *
 * | isTTY | colorEnabled | Output                                          |
 * |-------|--------------|-------------------------------------------------|
 * | true  | true         | Figlet block + ANSI styling (violet / green / dim / underline). |
 * | true  | false        | Figlet block, no ANSI escapes.                  |
 * | false | any          | No banner, no ANSI — two legacy flat lines.     |
 *
 * `colorEnabled` is decided in the verb from `process.env.NO_COLOR`,
 * `process.env.FORCE_COLOR`, the `--no-color` flag, and `isTTY`. The
 * helper itself stays pure: it takes booleans, strings, and writes the
 * formatted string back. No env reads, no ANSI shortcuts beyond raw
 * `\x1b[...m` escapes — repo policy is no new color deps.
 *
 * The figlet block is hardcoded as a literal — no runtime figlet
 * generation, no extra dependency. Trailing whitespace on each line is
 * load-bearing for alignment; do not trim it.
 */

import { homedir } from 'node:os';
import { relative, isAbsolute } from 'node:path';

import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';

/** ANSI escape sequences. Raw to avoid pulling in a color dep. */
const ESC = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  /** 256-color violet (xterm 141). */
  violet: '\x1b[38;5;141m',
  /** 256-color green (xterm 42). */
  green: '\x1b[38;5;42m',
} as const;

/**
 * Hardcoded figlet "Standard" rendering of "Skill Map". Trailing spaces
 * on each line are intentional — they pad the block to a uniform 40-col
 * width so the version line and any future right-aligned content line
 * up cleanly. Do not trim.
 */
const LOGO_LINES: readonly string[] = [
  '  ____  _    _ _ _   __  __             ',
  ' / ___|| | _(_) | | |  \\/  | __ _ _ __  ',
  ' \\___ \\| |/ / | | | | |\\/| |/ _` | \'_ \\ ',
  '  ___) |   <| | | | | |  | | (_| | |_) |',
  ' |____/|_|\\_\\_|_|_| |_|  |_|\\__,_| .__/ ',
  '                                 |_|    ',
];

/** Visible width of every figlet line (they are all padded to this). */
const LOGO_WIDTH = 40;

export interface IBannerInput {
  /** CLI version string (already resolved from `package.json`). */
  version: string;
  /** Bound host as reported by `handle.address.host`. */
  host: string;
  /** Bound port as reported by `handle.address.port`. */
  port: number;
  /** `'project' | 'global'`. */
  scope: string;
  /** Absolute resolved DB path (may not exist on disk yet). */
  dbPath: string;
  /** Process cwd, used to derive relative DB paths for display. */
  cwd: string;
  /** True when `--open` is in effect (default). */
  openBrowser: boolean;
  /** True when stderr is a TTY (drives banner vs flat fallback). */
  isTTY: boolean;
  /** True when ANSI escapes should be emitted. */
  colorEnabled: boolean;
}

/**
 * Render the banner string the verb writes to stderr.
 *
 * Returns a single string that already ends with `\n` so the caller
 * can `stderr.write(...)` once.
 */
export function renderBanner(input: IBannerInput): string {
  const url = `http://${input.host}:${input.port}`;
  const dbDisplay = formatDbPath(input.dbPath, input.cwd);
  const browserLine = input.openBrowser
    ? 'Opening browser…  Press Ctrl+C to stop.'
    : `Visit ${url}/ in your browser.  Press Ctrl+C to stop.`;

  if (!input.isTTY) {
    return renderFlat({
      host: input.host,
      port: input.port,
      scope: input.scope,
      dbPath: input.dbPath,
      openBrowser: input.openBrowser,
    });
  }

  return renderFiglet({
    version: input.version,
    url,
    scope: input.scope,
    dbDisplay,
    pathDisplay: formatCwdPath(input.cwd),
    browserLine,
    colorEnabled: input.colorEnabled,
  });
}

/**
 * Decide whether to emit ANSI escapes for the banner.
 *
 * Precedence (highest first):
 *   1. `--no-color` flag → disable.
 *   2. `NO_COLOR` env (any non-empty value) → disable.
 *   3. `FORCE_COLOR` env (any non-empty value) → enable, even when not TTY.
 *   4. Otherwise: enable iff stderr `isTTY`.
 */
export function resolveColorEnabled(opts: {
  isTTY: boolean;
  noColorFlag: boolean;
  env: NodeJS.ProcessEnv;
}): boolean {
  if (opts.noColorFlag) return false;
  const noColor = opts.env['NO_COLOR'];
  if (noColor !== undefined && noColor !== '') return false;
  const forceColor = opts.env['FORCE_COLOR'];
  if (forceColor !== undefined && forceColor !== '') return true;
  return opts.isTTY;
}

interface IFlatInput {
  host: string;
  port: number;
  scope: string;
  dbPath: string;
  openBrowser: boolean;
}

/**
 * Legacy two-line output used in non-TTY mode. Sanitised so a path with
 * embedded ANSI / C0 controls can never break the consumer's terminal.
 */
function renderFlat(input: IFlatInput): string {
  const safeHost = sanitizeForTerminal(input.host);
  const safeDb = sanitizeForTerminal(input.dbPath);
  const url = `http://${safeHost}:${input.port}`;
  const linesOut: string[] = [];
  linesOut.push(`sm serve: listening on ${url} (scope=${input.scope}, db=${safeDb})`);
  if (input.openBrowser) {
    linesOut.push(`sm serve: opening ${url}/ in your browser. Press Ctrl+C to stop.`);
  } else {
    linesOut.push(`sm serve: visit ${url}/ in your browser. Press Ctrl+C to stop.`);
  }
  return linesOut.join('\n') + '\n';
}

interface IFigletInput {
  version: string;
  url: string;
  scope: string;
  dbDisplay: string;
  pathDisplay: string;
  browserLine: string;
  colorEnabled: boolean;
}

/**
 * Figlet-style banner. Top half of the logo is violet, bottom half is
 * green; the version sits dim under the right edge of the logo. The
 * URL value reuses the same green as the lower logo half so the visual
 * weight ties together.
 */
function renderFiglet(input: IFigletInput): string {
  const {
    dimOpen,
    dimClose,
    greenUnderline,
    greenUnderlineClose,
    violetOpen,
    violetClose,
    greenOpen,
    greenClose,
  } = resolveAnsi(input.colorEnabled);

  // Logo split: first 3 lines violet, last 3 lines green.
  const logoLines = LOGO_LINES.map((line, i) => {
    const open = i < 3 ? violetOpen : greenOpen;
    const close = i < 3 ? violetClose : greenClose;
    return `${open}${line}${close}`;
  });

  // Version line right-aligned under the logo width.
  const versionText = `v${input.version}`;
  const versionPad = Math.max(0, LOGO_WIDTH - versionText.length);
  const versionLine = `${' '.repeat(versionPad)}${dimOpen}${versionText}${dimClose}`;

  const lines: string[] = [];
  lines.push(...logoLines);
  lines.push('');
  lines.push(versionLine);
  lines.push('');
  lines.push(`  ${dimOpen}Server${dimClose}   ${greenUnderline}${input.url}${greenUnderlineClose}`);
  lines.push(`  ${dimOpen}Scope${dimClose}    ${input.scope}`);
  lines.push(`  ${dimOpen}Path${dimClose}     ${input.pathDisplay}`);
  lines.push(`  ${dimOpen}DB${dimClose}       ${input.dbDisplay}`);
  lines.push('');
  lines.push(`  ${dimOpen}${input.browserLine}${dimClose}`);
  lines.push('');

  return lines.join('\n') + '\n';
}

interface IAnsiSet {
  dimOpen: string;
  dimClose: string;
  greenUnderline: string;
  greenUnderlineClose: string;
  violetOpen: string;
  violetClose: string;
  greenOpen: string;
  greenClose: string;
}

const EMPTY_ANSI: IAnsiSet = {
  dimOpen: '',
  dimClose: '',
  greenUnderline: '',
  greenUnderlineClose: '',
  violetOpen: '',
  violetClose: '',
  greenOpen: '',
  greenClose: '',
};

const ENABLED_ANSI: IAnsiSet = {
  dimOpen: ESC.dim,
  dimClose: ESC.reset,
  greenUnderline: `${ESC.green}${ESC.underline}`,
  greenUnderlineClose: ESC.reset,
  violetOpen: ESC.violet,
  violetClose: ESC.reset,
  greenOpen: ESC.green,
  greenClose: ESC.reset,
};

function resolveAnsi(colorEnabled: boolean): IAnsiSet {
  return colorEnabled ? ENABLED_ANSI : EMPTY_ANSI;
}

/**
 * Show the DB path relative to cwd when it sits under cwd; absolute
 * otherwise. The relative form is the common case during local
 * development (`.skill-map/skill-map.db`); the absolute form covers
 * `--db <abs path>` and `--global`.
 */
function formatDbPath(dbPath: string, cwd: string): string {
  const safe = sanitizeForTerminal(dbPath);
  if (!isAbsolute(safe)) return safe;
  const rel = relative(cwd, safe);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return safe;
  }
  return rel;
}

/**
 * Display path the verb is running from. Replaces the user's home prefix
 * with `~` to keep long paths legible (`~/projects/foo` beats
 * `/home/<user>/projects/foo`). Sanitised so a hostile cwd can't smuggle
 * ANSI / C0 controls into the banner.
 */
function formatCwdPath(cwd: string): string {
  const safe = sanitizeForTerminal(cwd);
  const home = homedir();
  if (home && (safe === home || safe.startsWith(`${home}/`))) {
    return `~${safe.slice(home.length)}`;
  }
  return safe;
}
