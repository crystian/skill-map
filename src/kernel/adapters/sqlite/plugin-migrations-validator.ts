/**
 * Plugin migration SQL validator — triple protection layer.
 *
 * Plugins MAY ship their own SQL migrations (`<plugin-dir>/migrations/`).
 * To keep a malicious or buggy plugin from clobbering kernel state, every
 * DDL object a plugin creates MUST live in the namespace
 * `plugin_<normalizedId>_*`. This module enforces the rule on three
 * layers:
 *
 *   Layer 1 — discovery: every migration file is parsed and validated
 *             before any of them run. A bad file aborts the whole
 *             plugin's migration batch with no side effects.
 *   Layer 2 — apply: the same SQL is re-validated immediately before
 *             `db.exec(sql)`, in case the file changed between discovery
 *             and apply (long-running session, on-disk edit).
 *   Layer 3 — post-apply catalog assertion: after each plugin's batch
 *             commits, we sweep `sqlite_master` and verify no objects
 *             live outside the prefix were created. This catches edge
 *             cases the regex layers might miss (e.g. a SQL feature we
 *             didn't anticipate that creates an object).
 *
 * Pragmatic regex implementation: per the Arquitecto's pick, this is a
 * whitelist of allowed DDL forms (CREATE / DROP / ALTER over TABLE,
 * INDEX, TRIGGER, VIEW, plus DML INSERT / UPDATE / DELETE for seed data),
 * with explicit denylist coverage for transaction control and pragmas.
 * Anything not on the whitelist is rejected. The grammar is intentionally
 * narrow because plugins are small and migrations should be auditable.
 *
 * Comment handling: SQL line comments (`-- ...`) and block comments
 * (`/* ... *​/`) are stripped before any other processing. The ZWSP
 * (U+200B) inside the close fence above is intentional — without it
 * the docstring's own block-comment delimiter would close prematurely.
 * A clever
 * attacker who hides DDL inside a comment is defeated by stripping
 * first; once stripped, the hidden DDL becomes visible to the regex.
 *
 * No external dependency. No SQL parser. No tokenizer. Heuristics only,
 * but defended by Layer 3 for everything the heuristics miss.
 */

import type { DatabaseSync } from 'node:sqlite';

/**
 * Normalize a plugin id into the form used as a table-prefix segment.
 *
 * Rule (from `spec/db-schema.md`): lowercase, replace any character
 * outside `[a-z0-9]` with `_`, collapse runs of `_`, strip leading and
 * trailing `_`.
 *
 * Example: `My-Plugin@v2` → `my_plugin_v2`.
 *
 * Two distinct plugin ids that normalise to the same string are a
 * load-time error — see `assertNoNormalizationCollisions`.
 */
export function normalizePluginId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Detects collisions when two distinct plugin ids share a normalized form. */
export function assertNoNormalizationCollisions(ids: string[]): void {
  const seen = new Map<string, string>();
  for (const id of ids) {
    const normalized = normalizePluginId(id);
    const prior = seen.get(normalized);
    if (prior !== undefined && prior !== id) {
      throw new Error(
        `Plugin id normalization collision: "${prior}" and "${id}" both normalize to "${normalized}"`,
      );
    }
    seen.set(normalized, id);
  }
}

export interface IValidationResult {
  ok: boolean;
  /** Human-readable issues; empty when ok=true. */
  violations: string[];
}

/**
 * Strip SQL comments. Block comments first (greedy across lines), then
 * line comments to end-of-line.
 *
 * Note: this does not respect comments inside string literals, so an
 * unusual identifier like `"foo--bar"` (double-quoted with embedded
 * dashes) could lose characters. Plugin authors who need that level
 * of escaping are expected to file an issue; for the v0.5.0 surface,
 * we tolerate the limitation. The catalog assertion (Layer 3) catches
 * any object that slips through.
 */
export function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ');
}

/** Tokens that abort validation immediately — too dangerous in plugin space. */
const FORBIDDEN_KEYWORDS = [
  /\bBEGIN\b/i,
  /\bCOMMIT\b/i,
  /\bROLLBACK\b/i,
  /\bSAVEPOINT\b/i,
  /\bATTACH\b/i,
  /\bDETACH\b/i,
  /\bPRAGMA\b/i,
  /\bVACUUM\b/i,
  /\bREINDEX\b/i,
  /\bANALYZE\b/i,
];

/**
 * Allowed DDL / DML statement shapes. Each entry captures the object
 * name(s) the statement touches; the validator then checks each name
 * against the plugin's prefix.
 *
 * Object names tolerate the three SQLite identifier forms: bare,
 * double-quoted, backticked, square-bracketed. The capture group strips
 * the wrapping in `objectName()` below.
 *
 * Schema qualifiers (`main.`, `temp.`) are matched but rejected during
 * name normalization — a plugin migration MUST live in the default
 * `main` schema, qualified or not. `temp.*` and attached schemas are
 * rejected because they bypass the per-DB lifecycle.
 */
const STATEMENT_PATTERNS: Array<{ kind: string; re: RegExp; targets: ('first' | 'on')[] }> = [
  // CREATE [TEMP|TEMPORARY] [VIRTUAL] TABLE [IF NOT EXISTS] <name>
  // CREATE [TEMP|TEMPORARY] [UNIQUE] INDEX [IF NOT EXISTS] <name> ON <table>
  // CREATE [TEMP|TEMPORARY] TRIGGER [IF NOT EXISTS] <name>
  // CREATE [TEMP|TEMPORARY] VIEW [IF NOT EXISTS] <name>
  {
    kind: 'CREATE TABLE',
    re: /^\s*CREATE(?:\s+(?:TEMP|TEMPORARY))?(?:\s+VIRTUAL)?\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'CREATE INDEX',
    re: /^\s*CREATE(?:\s+(?:TEMP|TEMPORARY))?(?:\s+UNIQUE)?\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+(\S+)\s+ON\s+(\S+)/i,
    targets: ['first', 'on'],
  },
  {
    kind: 'CREATE TRIGGER',
    re: /^\s*CREATE(?:\s+(?:TEMP|TEMPORARY))?\s+TRIGGER(?:\s+IF\s+NOT\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'CREATE VIEW',
    re: /^\s*CREATE(?:\s+(?:TEMP|TEMPORARY))?\s+VIEW(?:\s+IF\s+NOT\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  // ALTER TABLE <name> RENAME / ADD / DROP ...
  {
    kind: 'ALTER TABLE',
    re: /^\s*ALTER\s+TABLE\s+(\S+)/i,
    targets: ['first'],
  },
  // DROP TABLE / INDEX / TRIGGER / VIEW [IF EXISTS] <name>
  {
    kind: 'DROP TABLE',
    re: /^\s*DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'DROP INDEX',
    re: /^\s*DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'DROP TRIGGER',
    re: /^\s*DROP\s+TRIGGER(?:\s+IF\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'DROP VIEW',
    re: /^\s*DROP\s+VIEW(?:\s+IF\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  // DML over plugin tables: seed inserts, defensive cleanups.
  // INSERT INTO <name> ... / UPDATE <name> ... / DELETE FROM <name>
  {
    kind: 'INSERT',
    re: /^\s*INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'UPDATE',
    re: /^\s*UPDATE\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'DELETE',
    re: /^\s*DELETE\s+FROM\s+(\S+)/i,
    targets: ['first'],
  },
];

/**
 * Strip identifier wrapping (double-quote / backtick / square bracket)
 * and any schema qualifier (`main.`, `temp.`, etc.). Returns the
 * normalized identifier or `null` if the schema qualifier is anything
 * other than the default `main`.
 */
// eslint-disable-next-line complexity
export function objectName(token: string): { name: string; schema: string | null } | null {
  // Strip everything from the first opening paren onward — handles
  // `CREATE TABLE name(col INTEGER)` where the captured token has no
  // whitespace between the name and the column list.
  let raw = token;
  const parenIdx = raw.indexOf('(');
  if (parenIdx !== -1) raw = raw.slice(0, parenIdx);
  // Strip trailing punctuation that follows the identifier in some
  // grammars (e.g. `name,`, `name;`).
  raw = raw.replace(/[(),;]+$/g, '');
  let schema: string | null = null;

  // Look for a schema qualifier: `<schema>.<name>`.
  const dotIdx = raw.indexOf('.');
  if (dotIdx !== -1) {
    schema = raw.slice(0, dotIdx).toLowerCase();
    raw = raw.slice(dotIdx + 1);
  }

  // Strip wrappers.
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  else if (raw.startsWith('`') && raw.endsWith('`')) raw = raw.slice(1, -1);
  else if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1);

  if (raw.length === 0) return null;
  return { name: raw, schema };
}

/**
 * Split a SQL string into statements on top-level semicolons.
 *
 * Respects single-quote strings (with `''` escape), double-quote
 * identifiers, backtick identifiers, and square-bracket identifiers.
 * Block comments and line comments must be stripped before calling
 * this function — `stripComments` does that.
 *
 * Trailing empty / whitespace-only statements are dropped so the caller
 * can iterate without filtering.
 */
// Char-by-char state machine (5 quoting modes + ';' splitting). Each
// branch is a single state transition; splitting per mode would make
// the state machine harder to read, not easier.
// eslint-disable-next-line complexity
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBracket = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;

    if (inSingle) {
      current += ch;
      if (ch === "'" && sql[i + 1] === "'") {
        current += "'";
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      current += ch;
      if (ch === '`') inBacktick = false;
      continue;
    }
    if (inBracket) {
      current += ch;
      if (ch === ']') inBracket = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === '`') {
      inBacktick = true;
      current += ch;
      continue;
    }
    if (ch === '[') {
      inBracket = true;
      current += ch;
      continue;
    }

    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) out.push(trimmed);
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/**
 * Validate one plugin migration's SQL against the prefix rule. Returns
 * a list of violation strings (empty when valid).
 *
 * Each statement must (a) match a whitelisted shape, (b) target only
 * objects whose name starts with `plugin_<normalizedId>_`, (c) live in
 * the default schema (no `temp.*`, no attached-DB references), and (d)
 * not contain a forbidden keyword (transaction control, pragma, etc.).
 */
// 4 validation layers (forbidden keywords + per-statement shape + name
// prefix + cross-schema references); each is its own branch.
// eslint-disable-next-line complexity
export function validatePluginMigrationSql(sql: string, normalizedId: string): IValidationResult {
  const violations: string[] = [];
  const prefix = `plugin_${normalizedId}_`;
  const stripped = stripComments(sql);

  for (const re of FORBIDDEN_KEYWORDS) {
    if (re.test(stripped)) {
      violations.push(
        `forbidden keyword: matches /${re.source}/. Plugin migrations cannot manage transactions, pragmas, or attached databases.`,
      );
    }
  }

  for (const stmt of splitStatements(stripped)) {
    let matched: { kind: string; tokens: string[] } | null = null;
    for (const pattern of STATEMENT_PATTERNS) {
      const m = pattern.re.exec(stmt);
      if (!m) continue;
      const tokens: string[] = [];
      for (let j = 1; j < m.length; j++) tokens.push(m[j]!);
      matched = { kind: pattern.kind, tokens };
      break;
    }

    if (!matched) {
      violations.push(`unsupported statement: ${truncate(stmt, 80)}`);
      continue;
    }

    for (const tok of matched.tokens) {
      const parsed = objectName(tok);
      if (!parsed) {
        violations.push(`${matched.kind}: could not parse object name from "${tok}"`);
        continue;
      }
      if (parsed.schema !== null && parsed.schema !== 'main') {
        violations.push(
          `${matched.kind}: schema qualifier "${parsed.schema}." not allowed (must be unqualified or "main.")`,
        );
        continue;
      }
      if (!parsed.name.startsWith(prefix)) {
        violations.push(
          `${matched.kind}: object "${parsed.name}" is outside the plugin's namespace ("${prefix}*")`,
        );
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Layer 3 — post-apply catalog assertion. After a plugin's migration
 * batch commits, sweep `sqlite_master` for any object NOT in the
 * `plugin_<normalizedId>_*` prefix that wasn't there before. We compare
 * against a snapshot taken before the batch ran.
 *
 * Returns an empty array when clean; otherwise a list of object names
 * that should not exist. The caller decides what to do (we recommend
 * raising an error and refusing to advance the ledger).
 */
export function detectCatalogIntrusion(
  before: Set<string>,
  after: Set<string>,
  normalizedId: string,
): string[] {
  const prefix = `plugin_${normalizedId}_`;
  const intrusions: string[] = [];
  for (const name of after) {
    if (before.has(name)) continue; // pre-existing
    if (name.startsWith(prefix)) continue; // legitimate plugin object
    if (name.startsWith('sqlite_')) continue; // SQLite internal
    intrusions.push(name);
  }
  return intrusions;
}

/**
 * Read every user-visible object name from `sqlite_master`. Filters
 * out auto-generated indexes (those start with `sqlite_autoindex_`)
 * because they shadow whatever table they belong to and don't have an
 * independent author. Plugins that want their own indexes must `CREATE
 * INDEX` them explicitly.
 */
export function snapshotCatalog(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type IN ('table', 'index', 'trigger', 'view')
         AND name NOT LIKE 'sqlite_autoindex_%'`,
    )
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s.replace(/\s+/g, ' ');
  return s.slice(0, max).replace(/\s+/g, ' ') + '…';
}
