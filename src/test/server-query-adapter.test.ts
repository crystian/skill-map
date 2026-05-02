/**
 * `src/server/query-adapter.ts` — URL params → kernel `IExportQuery` matrix.
 *
 * Asserts the BFF and `sm export` share one filter grammar (parity with
 * `src/test/export-query.test.ts` on the kernel side).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExportQueryError } from '../kernel/index.js';
import type { Issue, Node } from '../kernel/index.js';
import {
  filterNodesWithoutIssues,
  urlParamsToExportQuery,
} from '../server/query-adapter.js';

function p(qs: string): URLSearchParams {
  return new URL(`http://x/?${qs}`).searchParams;
}

describe('server query-adapter — URL params → IExportQuery', () => {
  it('empty params → empty query (matches everything)', () => {
    const { query, filters } = urlParamsToExportQuery(p(''));
    assert.equal(query.raw, '');
    assert.equal(query.kinds, undefined);
    assert.equal(query.hasIssues, undefined);
    assert.equal(query.pathGlobs, undefined);
    assert.deepEqual(filters, {});
  });

  it('?kind=skill → kinds: ["skill"]', () => {
    const { query, filters } = urlParamsToExportQuery(p('kind=skill'));
    assert.deepEqual(query.kinds, ['skill']);
    assert.deepEqual(filters.kinds, ['skill']);
    assert.equal(query.raw, 'kind=skill');
  });

  it('?kind=skill,agent → multi-value AND-within-OR semantics', () => {
    const { query } = urlParamsToExportQuery(p('kind=skill,agent'));
    assert.deepEqual(query.kinds, ['skill', 'agent']);
  });

  it('?kind=skill,,agent → drops empty entries', () => {
    const { query } = urlParamsToExportQuery(p('kind=skill,,agent'));
    assert.deepEqual(query.kinds, ['skill', 'agent']);
  });

  it('?hasIssues=true → query.hasIssues === true', () => {
    const { query, filters } = urlParamsToExportQuery(p('hasIssues=true'));
    assert.equal(query.hasIssues, true);
    assert.equal(filters.hasIssues, true);
  });

  it('?hasIssues=TRUE → case-insensitive', () => {
    const { query } = urlParamsToExportQuery(p('hasIssues=TRUE'));
    assert.equal(query.hasIssues, true);
  });

  it('?hasIssues=false → no kernel grammar token; filters.hasIssues = false', () => {
    const { query, filters } = urlParamsToExportQuery(p('hasIssues=false'));
    // The kernel grammar can't express "no issues" — query.hasIssues stays undefined.
    assert.equal(query.hasIssues, undefined);
    assert.equal(filters.hasIssues, false);
    // Raw query string MUST omit the `has=` token to avoid a parser error.
    assert.equal(query.raw, '');
  });

  it('?hasIssues=nonsense → ExportQueryError', () => {
    assert.throws(
      () => urlParamsToExportQuery(p('hasIssues=nonsense')),
      ExportQueryError,
    );
  });

  it('?path=foo/* → pathGlobs', () => {
    const { query } = urlParamsToExportQuery(p('path=foo/*'));
    assert.deepEqual(query.pathGlobs, ['foo/*']);
  });

  it('?path=foo/*,bar/** → multi-value globs', () => {
    const { query } = urlParamsToExportQuery(p('path=foo/*,bar/**'));
    assert.deepEqual(query.pathGlobs, ['foo/*', 'bar/**']);
  });

  it('combines kind + hasIssues + path into a canonical raw query', () => {
    const { query } = urlParamsToExportQuery(p('kind=skill&hasIssues=true&path=foo/*'));
    assert.equal(query.raw, 'kind=skill has=issues path=foo/*');
    assert.deepEqual(query.kinds, ['skill']);
    assert.equal(query.hasIssues, true);
    assert.deepEqual(query.pathGlobs, ['foo/*']);
  });

  it('?kind= (empty value) → ExportQueryError', () => {
    assert.throws(
      () => urlParamsToExportQuery(p('kind=')),
      ExportQueryError,
    );
  });

  it('?path=, (only whitespace / empty values) → ExportQueryError', () => {
    assert.throws(
      () => urlParamsToExportQuery(p('path=,,,')),
      ExportQueryError,
    );
  });
});

describe('server query-adapter — filterNodesWithoutIssues', () => {
  function node(path: string): Node {
    return {
      path,
      kind: 'skill',
      provider: 'claude',
      bodyHash: 'h',
      frontmatterHash: 'f',
      bytes: { frontmatter: 0, body: 0, total: 0 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
      title: null,
      description: null,
      stability: null,
      version: null,
      author: null,
      frontmatter: {},
    };
  }
  function issue(nodeIds: string[]): Issue {
    return {
      ruleId: 'core/test',
      severity: 'warn',
      nodeIds,
      message: 'm',
    };
  }

  it('returns every node when issues array is empty', () => {
    const nodes = [node('a'), node('b')];
    assert.deepEqual(
      filterNodesWithoutIssues(nodes, []).map((n) => n.path),
      ['a', 'b'],
    );
  });

  it('drops nodes that appear in any issue.nodeIds', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const issues = [issue(['b']), issue(['c'])];
    assert.deepEqual(
      filterNodesWithoutIssues(nodes, issues).map((n) => n.path),
      ['a'],
    );
  });

  it('drops a node only once even if listed in multiple issues', () => {
    const nodes = [node('a'), node('b')];
    const issues = [issue(['b']), issue(['b']), issue(['b'])];
    assert.deepEqual(
      filterNodesWithoutIssues(nodes, issues).map((n) => n.path),
      ['a'],
    );
  });
});
