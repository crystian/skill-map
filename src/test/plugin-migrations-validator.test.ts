/**
 * Step 9.2 unit tests for the plugin-migration SQL validator. Pure
 * functions, no DB, no FS; covers id normalization, comment stripping,
 * statement splitting, and the prefix-rule whitelist.
 *
 * The integration tests for the migration runner + the `sm db migrate`
 * flag combinations live in `plugin-migrations.test.ts`.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';

import {
  assertNoNormalizationCollisions,
  detectCatalogIntrusion,
  normalizePluginId,
  objectName,
  splitStatements,
  stripComments,
  validatePluginMigrationSql,
} from '../kernel/adapters/sqlite/plugin-migrations-validator.js';

describe('normalizePluginId', () => {
  it('lowercases and replaces non-alphanumeric runs with single _', () => {
    strictEqual(normalizePluginId('My-Plugin'), 'my_plugin');
    strictEqual(normalizePluginId('foo.bar.baz'), 'foo_bar_baz');
    strictEqual(normalizePluginId('A B  C'), 'a_b_c');
  });

  it('strips leading and trailing underscores', () => {
    strictEqual(normalizePluginId('--ugly--'), 'ugly');
    strictEqual(normalizePluginId('@scope/name'), 'scope_name');
  });

  it('collapses runs of underscores in the result', () => {
    strictEqual(normalizePluginId('a___b'), 'a_b');
  });
});

describe('assertNoNormalizationCollisions', () => {
  it('passes when ids are distinct after normalization', () => {
    assertNoNormalizationCollisions(['plugin-a', 'plugin-b', 'plugin-c']);
  });

  it('throws when two ids collide on normalization', () => {
    throws(
      () => assertNoNormalizationCollisions(['plugin.a', 'plugin-a']),
      /normalization collision/,
    );
  });
});

describe('stripComments', () => {
  it('strips line comments to end-of-line', () => {
    strictEqual(stripComments('SELECT 1; -- explanation\nSELECT 2'), 'SELECT 1;  \nSELECT 2');
  });

  it('strips block comments (multiline)', () => {
    strictEqual(
      stripComments('CREATE /* nope\nstill nope */ TABLE plugin_x_t (a)'),
      'CREATE   TABLE plugin_x_t (a)',
    );
  });

  it('handles nested-looking blocks (SQLite forbids real nesting)', () => {
    // SQLite block comments do not nest; the first */ closes them.
    strictEqual(
      stripComments('/* outer /* inner */ trailing'),
      '  trailing',
    );
  });
});

describe('objectName', () => {
  it('strips wrapping quotes / brackets', () => {
    deepStrictEqual(objectName('"plugin_foo_bar"'), { name: 'plugin_foo_bar', schema: null });
    deepStrictEqual(objectName('`plugin_foo_bar`'), { name: 'plugin_foo_bar', schema: null });
    deepStrictEqual(objectName('[plugin_foo_bar]'), { name: 'plugin_foo_bar', schema: null });
  });

  it('parses schema qualifier', () => {
    deepStrictEqual(objectName('main.plugin_x_y'), { name: 'plugin_x_y', schema: 'main' });
    deepStrictEqual(objectName('temp.evil'), { name: 'evil', schema: 'temp' });
  });

  it('strips trailing punctuation', () => {
    deepStrictEqual(objectName('plugin_x_y;'), { name: 'plugin_x_y', schema: null });
    deepStrictEqual(objectName('plugin_x_y(a,b)'), { name: 'plugin_x_y', schema: null });
  });
});

describe('splitStatements', () => {
  it('splits on top-level semicolons and trims', () => {
    deepStrictEqual(
      splitStatements('SELECT 1; SELECT 2;'),
      ['SELECT 1', 'SELECT 2'],
    );
  });

  it('respects single-quoted strings', () => {
    deepStrictEqual(
      splitStatements(`INSERT INTO t VALUES ('a;b'); SELECT 1`),
      [`INSERT INTO t VALUES ('a;b')`, 'SELECT 1'],
    );
  });

  it('respects double-quoted identifiers', () => {
    deepStrictEqual(
      splitStatements('CREATE TABLE "weird;name" (a); SELECT 1'),
      ['CREATE TABLE "weird;name" (a)', 'SELECT 1'],
    );
  });

  it('drops trailing empty statements', () => {
    deepStrictEqual(splitStatements('SELECT 1;;;'), ['SELECT 1']);
  });
});

describe('validatePluginMigrationSql — green path', () => {
  it('CREATE TABLE in plugin namespace passes', () => {
    const result = validatePluginMigrationSql(
      'CREATE TABLE plugin_foo_items (id INTEGER PRIMARY KEY, label TEXT)',
      'foo',
    );
    strictEqual(result.ok, true);
    deepStrictEqual(result.violations, []);
  });

  it('IF NOT EXISTS clause works', () => {
    const result = validatePluginMigrationSql(
      'CREATE TABLE IF NOT EXISTS plugin_foo_items (id INTEGER)',
      'foo',
    );
    strictEqual(result.ok, true);
  });

  it('CREATE INDEX checks both index name and target table', () => {
    const result = validatePluginMigrationSql(
      'CREATE INDEX plugin_foo_items_label_idx ON plugin_foo_items (label)',
      'foo',
    );
    strictEqual(result.ok, true);
  });

  it('multi-statement migration with mixed DDL passes', () => {
    const sql = `
      CREATE TABLE plugin_foo_items (id INTEGER PRIMARY KEY, label TEXT);
      CREATE INDEX plugin_foo_items_label_idx ON plugin_foo_items (label);
      INSERT INTO plugin_foo_items (id, label) VALUES (1, 'seed');
    `;
    const result = validatePluginMigrationSql(sql, 'foo');
    strictEqual(result.ok, true, JSON.stringify(result.violations));
  });

  it('comments hiding bad SQL are stripped before validation', () => {
    const sql = `
      /* CREATE TABLE evil_kernel_table (a); */
      -- DROP TABLE config_schema_versions;
      CREATE TABLE plugin_foo_real (a INTEGER);
    `;
    const result = validatePluginMigrationSql(sql, 'foo');
    strictEqual(result.ok, true, JSON.stringify(result.violations));
  });

  it('schema qualifier "main." is allowed', () => {
    const result = validatePluginMigrationSql(
      'CREATE TABLE main.plugin_foo_x (a INTEGER)',
      'foo',
    );
    strictEqual(result.ok, true);
  });
});

describe('validatePluginMigrationSql — violations', () => {
  it('CREATE TABLE outside namespace is rejected', () => {
    const result = validatePluginMigrationSql(
      'CREATE TABLE other_table (id INTEGER)',
      'foo',
    );
    strictEqual(result.ok, false);
    ok(result.violations.some((v) => v.includes('outside the plugin\'s namespace')));
  });

  it('ALTER TABLE on a kernel table is rejected', () => {
    const result = validatePluginMigrationSql(
      'ALTER TABLE config_schema_versions DROP COLUMN scope',
      'foo',
    );
    strictEqual(result.ok, false);
  });

  it('schema qualifier other than "main" is rejected', () => {
    const result = validatePluginMigrationSql(
      'CREATE TABLE temp.plugin_foo_x (a INTEGER)',
      'foo',
    );
    strictEqual(result.ok, false);
    ok(result.violations.some((v) => v.includes('schema qualifier "temp."')));
  });

  it('forbidden keyword PRAGMA is rejected', () => {
    const result = validatePluginMigrationSql(
      'PRAGMA foreign_keys = OFF; CREATE TABLE plugin_foo_x (a)',
      'foo',
    );
    strictEqual(result.ok, false);
    ok(result.violations.some((v) => v.includes('forbidden keyword')));
  });

  it('explicit BEGIN / COMMIT is rejected', () => {
    const result = validatePluginMigrationSql(
      'BEGIN; CREATE TABLE plugin_foo_x (a); COMMIT;',
      'foo',
    );
    strictEqual(result.ok, false);
    ok(result.violations.some((v) => v.includes('forbidden keyword')));
  });

  it('ATTACH DATABASE is rejected', () => {
    const result = validatePluginMigrationSql(
      "ATTACH DATABASE '/tmp/evil.db' AS evil",
      'foo',
    );
    strictEqual(result.ok, false);
  });

  it('non-DDL statement (SELECT) is rejected as unsupported', () => {
    const result = validatePluginMigrationSql(
      'SELECT * FROM plugin_foo_x',
      'foo',
    );
    strictEqual(result.ok, false);
    ok(result.violations.some((v) => v.includes('unsupported statement')));
  });

  it('CREATE INDEX with index name in plugin namespace but table outside is rejected', () => {
    const result = validatePluginMigrationSql(
      'CREATE INDEX plugin_foo_idx ON other_table (col)',
      'foo',
    );
    strictEqual(result.ok, false);
  });

  it('INSERT into a kernel table is rejected', () => {
    const result = validatePluginMigrationSql(
      "INSERT INTO config_schema_versions (scope, owner_id, version, description, applied_at) VALUES ('plugin', 'evil', 99, 'pwn', 0)",
      'foo',
    );
    strictEqual(result.ok, false);
  });
});

describe('detectCatalogIntrusion', () => {
  it('returns empty when only prefixed objects are new', () => {
    const before = new Set<string>(['existing_table']);
    const after = new Set<string>(['existing_table', 'plugin_foo_one', 'plugin_foo_two']);
    deepStrictEqual(detectCatalogIntrusion(before, after, 'foo'), []);
  });

  it('flags any new non-prefixed object', () => {
    const before = new Set<string>(['existing_table']);
    const after = new Set<string>(['existing_table', 'plugin_foo_one', 'sneaky_table']);
    deepStrictEqual(detectCatalogIntrusion(before, after, 'foo'), ['sneaky_table']);
  });

  it('ignores SQLite internal objects', () => {
    const before = new Set<string>([]);
    const after = new Set<string>(['sqlite_sequence', 'plugin_foo_t']);
    deepStrictEqual(detectCatalogIntrusion(before, after, 'foo'), []);
  });

  it('ignores objects that already existed', () => {
    const before = new Set<string>(['kernel_table_x']);
    const after = new Set<string>(['kernel_table_x', 'plugin_foo_t']);
    deepStrictEqual(detectCatalogIntrusion(before, after, 'foo'), []);
  });
});

describe('validatePluginMigrationSql — comment markers in literals (audit M5)', () => {
  it('rejects a single-quoted literal containing -- (line comment marker)', () => {
    const result = validatePluginMigrationSql(
      "INSERT INTO plugin_foo_t (note) VALUES ('-- DROP TABLE scan_nodes;')",
      'foo',
    );
    strictEqual(result.ok, false);
    ok(
      result.violations[0]!.includes('--'),
      `expected violation message about '--', got ${result.violations[0]}`,
    );
  });

  it('rejects a single-quoted literal containing /* (block comment marker)', () => {
    const result = validatePluginMigrationSql(
      "INSERT INTO plugin_foo_t (note) VALUES ('/* hidden */')",
      'foo',
    );
    strictEqual(result.ok, false);
    ok(result.violations[0]!.includes('/*'));
  });

  it('rejects a double-quoted identifier containing --', () => {
    const result = validatePluginMigrationSql(
      'CREATE TABLE plugin_foo_t ("col--name" TEXT)',
      'foo',
    );
    strictEqual(result.ok, false);
  });

  it('does not flag bare -- outside literals (real comment)', () => {
    const result = validatePluginMigrationSql(
      "-- a real header comment\nCREATE TABLE plugin_foo_t (col TEXT);",
      'foo',
    );
    strictEqual(result.ok, true, `unexpected violations: ${result.violations.join(' | ')}`);
  });

  it('does not flag plain literal content without comment markers', () => {
    const result = validatePluginMigrationSql(
      "INSERT INTO plugin_foo_t (note) VALUES ('hello world')",
      'foo',
    );
    strictEqual(result.ok, true);
  });
});
