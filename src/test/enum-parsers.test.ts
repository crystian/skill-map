/**
 * Coverage for `kernel/util/enum-parsers` — runtime guards + narrowing
 * parsers for the closed-enum domain types. Test the contracts that
 * matter to callers:
 *
 *   - `is<X>(s)` returns true for every valid value, false for invalid
 *     strings, non-strings, null/undefined, and objects.
 *   - `parse<X>(s, ctx)` returns the value when valid; throws an Error
 *     whose message names the offending value, the full allowed set,
 *     and the caller's context.
 *
 * The error messages are part of the contract: callers (storage
 * adapters) wrap them around a row id / column / file path, and a
 * future log surface MAY parse them — pinning the shape prevents an
 * accidental rewording from breaking that surface.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  isStability, parseStability,
  isLinkKind, parseLinkKind,
  isConfidence, parseConfidence,
  isSeverity, parseSeverity,
  isExecutionMode,
  isExecutionRunner, parseExecutionRunner,
  isExecutionStatus,
  isExecutionFailureReason, parseExecutionFailureReason,
} from '../kernel/util/enum-parsers.js';

describe('enum-parsers — type guards', () => {
  it('isStability accepts the three valid values, rejects everything else', () => {
    assert.equal(isStability('experimental'), true);
    assert.equal(isStability('stable'), true);
    assert.equal(isStability('deprecated'), true);
    assert.equal(isStability('Stable'), false);
    assert.equal(isStability('beta'), false);
    assert.equal(isStability(''), false);
    assert.equal(isStability(42), false);
    assert.equal(isStability(null), false);
    assert.equal(isStability(undefined), false);
    assert.equal(isStability({}), false);
  });

  it('isLinkKind accepts invokes / references / mentions / supersedes', () => {
    for (const v of ['invokes', 'references', 'mentions', 'supersedes']) {
      assert.equal(isLinkKind(v), true, v);
    }
    assert.equal(isLinkKind('invoke'), false);
    assert.equal(isLinkKind('related'), false);
    assert.equal(isLinkKind(null), false);
  });

  it('isConfidence accepts high / medium / low', () => {
    for (const v of ['high', 'medium', 'low']) {
      assert.equal(isConfidence(v), true, v);
    }
    assert.equal(isConfidence('HIGH'), false);
    assert.equal(isConfidence('unknown'), false);
  });

  it('isSeverity accepts error / warn / info', () => {
    for (const v of ['error', 'warn', 'info']) {
      assert.equal(isSeverity(v), true, v);
    }
    assert.equal(isSeverity('warning'), false);
    assert.equal(isSeverity('debug'), false);
  });

  it('isExecutionMode accepts deterministic / probabilistic', () => {
    assert.equal(isExecutionMode('deterministic'), true);
    assert.equal(isExecutionMode('probabilistic'), true);
    assert.equal(isExecutionMode('hybrid'), false);
    assert.equal(isExecutionMode(''), false);
  });

  it('isExecutionRunner accepts cli / skill / in-process', () => {
    for (const v of ['cli', 'skill', 'in-process']) {
      assert.equal(isExecutionRunner(v), true, v);
    }
    assert.equal(isExecutionRunner('inprocess'), false);
    assert.equal(isExecutionRunner('CLI'), false);
  });

  it('isExecutionStatus accepts completed / failed / cancelled', () => {
    for (const v of ['completed', 'failed', 'cancelled']) {
      assert.equal(isExecutionStatus(v), true, v);
    }
    assert.equal(isExecutionStatus('queued'), false);
    assert.equal(isExecutionStatus('running'), false);
  });

  it('isExecutionFailureReason accepts the six closed values', () => {
    for (const v of [
      'runner-error',
      'report-invalid',
      'timeout',
      'abandoned',
      'job-file-missing',
      'user-cancelled',
    ]) {
      assert.equal(isExecutionFailureReason(v), true, v);
    }
    assert.equal(isExecutionFailureReason('content-missing'), false);
    assert.equal(isExecutionFailureReason('unknown'), false);
  });
});

describe('enum-parsers — narrowing parsers', () => {
  it('parseStability returns the value for valid input', () => {
    assert.equal(parseStability('stable', 'row 42'), 'stable');
  });

  it('parseStability throws with offending value, allowed set, and ctx', () => {
    assert.throws(
      () => parseStability('beta', 'scan_nodes/path/foo.md'),
      (err: Error) => {
        assert.match(err.message, /Invalid Stability value/);
        assert.match(err.message, /"beta"/);
        assert.match(err.message, /scan_nodes\/path\/foo\.md/);
        assert.match(err.message, /experimental \| stable \| deprecated/);
        return true;
      },
    );
  });

  it('parseStability formats null / undefined / number / object distinctly', () => {
    assert.throws(() => parseStability(null, 'ctx-null'),       /Invalid.*value null at ctx-null/);
    assert.throws(() => parseStability(undefined, 'ctx-undef'), /Invalid.*value undefined at ctx-undef/);
    assert.throws(() => parseStability(42, 'ctx-num'),          /Invalid.*value 42 at ctx-num/);
    assert.throws(() => parseStability({}, 'ctx-obj'),          /Invalid.*value \[object Object\] at ctx-obj/);
  });

  it('parseLinkKind returns the value, throws on miss', () => {
    assert.equal(parseLinkKind('invokes', 'ctx'), 'invokes');
    assert.throws(() => parseLinkKind('related', 'scan_links/123'), (err: Error) => {
      assert.match(err.message, /Invalid LinkKind value "related" at scan_links\/123/);
      assert.match(err.message, /invokes \| references \| mentions \| supersedes/);
      return true;
    });
  });

  it('parseConfidence returns the value, throws on miss', () => {
    assert.equal(parseConfidence('high', 'ctx'), 'high');
    assert.throws(() => parseConfidence('certain', 'row 7'), /Invalid Confidence value "certain" at row 7/);
  });

  it('parseSeverity returns the value, throws on miss', () => {
    assert.equal(parseSeverity('warn', 'ctx'), 'warn');
    assert.throws(() => parseSeverity('warning', 'issue 12'), /Invalid Severity value "warning" at issue 12/);
  });

  it('parseExecutionRunner returns the value, throws on miss', () => {
    assert.equal(parseExecutionRunner('cli', 'ctx'), 'cli');
    assert.throws(() => parseExecutionRunner('inprocess', 'state_executions/e-1'), (err: Error) => {
      assert.match(err.message, /Invalid ExecutionRunner value "inprocess"/);
      assert.match(err.message, /cli \| skill \| in-process/);
      return true;
    });
  });

  it('parseExecutionFailureReason returns the value, throws on miss', () => {
    assert.equal(parseExecutionFailureReason('timeout', 'ctx'), 'timeout');
    assert.throws(() => parseExecutionFailureReason('content-missing', 'state_executions/e-2'), (err: Error) => {
      assert.match(err.message, /Invalid ExecutionFailureReason value "content-missing"/);
      assert.match(err.message, /runner-error \| report-invalid \| timeout \| abandoned \| job-file-missing \| user-cancelled/);
      return true;
    });
  });
});
