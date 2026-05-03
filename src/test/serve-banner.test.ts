/**
 * Tests for the `sm serve` startup banner (`cli/util/serve-banner.ts`).
 *
 * Three behaviour modes are validated:
 *   1. TTY + color enabled → ASCII-art figlet block AND ANSI escape sequences
 *      (violet upper half, green lower half, dim labels, green-underlined URL).
 *   2. TTY + color disabled → ASCII-art figlet block AND zero ANSI escapes.
 *   3. Non-TTY (pipes / redirects) → legacy two-line format, byte-equivalent
 *      to what `sm serve` emitted before the banner landed. This is the
 *      regression guard for piped consumers (`sm serve | tee log.txt`,
 *      CI capture).
 *
 * Structural assertions only — full ANSI byte snapshots are too brittle
 * (one shade tweak invalidates every test).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { renderBanner, resolveColorEnabled } from '../cli/util/serve-banner.js';

describe('serve banner — TTY + color enabled', () => {
  const out = renderBanner({
    version: '0.13.0',
    host: '127.0.0.1',
    port: 4242,
    scope: 'project',
    dbPath: '/projects/skill-map/.skill-map/skill-map.db',
    cwd: '/projects/skill-map',
    openBrowser: true,
    isTTY: true,
    colorEnabled: true,
  });

  it('renders the ASCII-art figlet block', () => {
    // Match the top-left of the figlet rendering — distinct enough that
    // ANSI styling around it cannot accidentally produce the substring.
    assert.match(out, / ____ {2}_ {4}_ _ _/, 'expected figlet "Skill" line');
    assert.ok(out.includes('|____/|_|\\_\\_|_|_|'), 'expected figlet "Skill" bottom row');
    assert.ok(out.includes('|_|'), 'expected the trailing "p" descender of the figlet');
  });

  it('emits ANSI escape sequences for color and styling', () => {
    assert.ok(out.includes('\x1b['), 'expected at least one ANSI CSI introducer');
    assert.ok(
      out.includes('\x1b[38;5;141m'),
      'expected violet 256-color (\\x1b[38;5;141m) for the upper half of the logo',
    );
    assert.ok(
      out.includes('\x1b[38;5;42m'),
      'expected green 256-color (\\x1b[38;5;42m) for the lower half of the logo and the URL',
    );
    assert.ok(out.includes('\x1b[2m'), 'expected dim (\\x1b[2m) for labels and version');
    assert.ok(out.includes('\x1b[4m'), 'expected underline (\\x1b[4m) for the URL');
  });

  it('does NOT emit the legacy cyan escape', () => {
    assert.ok(
      !out.includes('\x1b[36m'),
      'cyan (\\x1b[36m) was the old palette and must be gone',
    );
  });

  it('includes the URL, scope, and a relative DB path', () => {
    assert.ok(out.includes('http://127.0.0.1:4242'), 'URL must be present');
    assert.ok(out.includes('project'), 'scope must be present');
    assert.ok(out.includes('.skill-map/skill-map.db'), 'DB path must be relative to cwd');
    assert.ok(
      !out.includes('/projects/skill-map/.skill-map/skill-map.db'),
      'absolute DB path must NOT appear when relative is in cwd',
    );
  });

  it('shows the cwd Path field', () => {
    // cwd lives outside the user's home, so it must show as-is (no `~` prefix).
    assert.ok(out.includes('Path'), 'expected Path label in the data block');
    assert.ok(out.includes('/projects/skill-map'), 'expected absolute cwd to render verbatim');
  });

  it('includes the version line', () => {
    assert.ok(out.includes('v0.13.0'), 'version line must include the version string');
  });

  it('shows the "Opening browser…" message when openBrowser is true', () => {
    assert.ok(out.includes('Opening browser'), 'expected opening-browser message');
    assert.ok(out.includes('Press Ctrl+C to stop'), 'expected Ctrl+C hint');
  });

  it('does NOT contain the legacy "sm serve: listening on" prefix in TTY mode', () => {
    // The flat-mode line is what pipes consumers grep for; in TTY mode
    // the banner replaces it entirely.
    assert.ok(!out.includes('sm serve: listening on'), 'TTY mode must not emit the flat prefix');
  });
});

describe('serve banner — TTY + NO_COLOR', () => {
  const out = renderBanner({
    version: '0.13.0',
    host: '127.0.0.1',
    port: 4242,
    scope: 'project',
    dbPath: '/projects/skill-map/.skill-map/skill-map.db',
    cwd: '/projects/skill-map',
    openBrowser: true,
    isTTY: true,
    colorEnabled: false,
  });

  it('still renders the ASCII-art figlet block', () => {
    assert.match(out, / ____ {2}_ {4}_ _ _/, 'expected figlet "Skill" line');
    assert.ok(out.includes('|____/|_|\\_\\_|_|_|'), 'expected figlet "Skill" bottom row');
  });

  it('emits zero ANSI escape sequences', () => {
    assert.ok(!out.includes('\x1b['), `unexpected ANSI escape in NO_COLOR output: ${out}`);
  });

  it('still surfaces the URL, scope, DB path, and version', () => {
    assert.ok(out.includes('http://127.0.0.1:4242'));
    assert.ok(out.includes('project'));
    assert.ok(out.includes('.skill-map/skill-map.db'));
    assert.ok(out.includes('v0.13.0'));
  });
});

describe('serve banner — non-TTY (piped / redirected)', () => {
  it('falls back to the two-line legacy format under --open', () => {
    const out = renderBanner({
      version: '0.13.0',
      host: '127.0.0.1',
      port: 4242,
      scope: 'project',
      dbPath: '/projects/skill-map/.skill-map/skill-map.db',
      cwd: '/projects/skill-map',
      openBrowser: true,
      isTTY: false,
      // colorEnabled value is irrelevant when isTTY=false; helper
      // emits the flat lines without ANSI either way.
      colorEnabled: false,
    });
    assert.ok(
      out.includes('sm serve: listening on http://127.0.0.1:4242 (scope=project, db=/projects/skill-map/.skill-map/skill-map.db)'),
      `legacy "listening on" line missing: ${out}`,
    );
    assert.ok(
      out.includes('sm serve: opening http://127.0.0.1:4242/ in your browser. Press Ctrl+C to stop.'),
      `legacy "opening" line missing: ${out}`,
    );
  });

  it('falls back to the legacy "visit" line under --no-open', () => {
    const out = renderBanner({
      version: '0.13.0',
      host: '127.0.0.1',
      port: 4242,
      scope: 'project',
      dbPath: '/projects/skill-map/.skill-map/skill-map.db',
      cwd: '/projects/skill-map',
      openBrowser: false,
      isTTY: false,
      colorEnabled: false,
    });
    assert.ok(
      out.includes('sm serve: visit http://127.0.0.1:4242/ in your browser. Press Ctrl+C to stop.'),
      `legacy "visit" line missing: ${out}`,
    );
  });

  it('emits no figlet block and no ANSI escapes', () => {
    const out = renderBanner({
      version: '0.13.0',
      host: '127.0.0.1',
      port: 4242,
      scope: 'project',
      dbPath: '/projects/skill-map/.skill-map/skill-map.db',
      cwd: '/projects/skill-map',
      openBrowser: true,
      isTTY: false,
      colorEnabled: true, // even if asked, non-TTY path drops it.
    });
    assert.ok(!/ ____ {2}_ {4}_ _ _/.test(out), 'unexpected figlet line in non-TTY output');
    assert.ok(!out.includes('|____/'), 'unexpected figlet line in non-TTY output');
    assert.ok(!out.includes('\x1b['), `unexpected ANSI escape in non-TTY output: ${out}`);
  });

  it('shows the absolute DB path (legacy contract — non-TTY does not relativise)', () => {
    const out = renderBanner({
      version: '0.13.0',
      host: '127.0.0.1',
      port: 4242,
      scope: 'project',
      dbPath: '/projects/skill-map/.skill-map/skill-map.db',
      cwd: '/projects/skill-map',
      openBrowser: true,
      isTTY: false,
      colorEnabled: false,
    });
    assert.ok(
      out.includes('db=/projects/skill-map/.skill-map/skill-map.db'),
      'non-TTY fallback must keep the absolute db= path',
    );
  });
});

describe('serve banner — DB path display in TTY mode', () => {
  it('keeps the absolute path when the DB sits outside cwd', () => {
    const out = renderBanner({
      version: '0.13.0',
      host: '127.0.0.1',
      port: 4242,
      scope: 'global',
      dbPath: '/home/alice/.skill-map/skill-map.db',
      cwd: '/projects/skill-map',
      openBrowser: true,
      isTTY: true,
      colorEnabled: false,
    });
    assert.ok(
      out.includes('/home/alice/.skill-map/skill-map.db'),
      'global / out-of-cwd DB path must stay absolute in TTY mode',
    );
  });
});

describe('resolveColorEnabled — precedence', () => {
  it('disables color when --no-color is set, regardless of TTY / env', () => {
    assert.equal(
      resolveColorEnabled({ isTTY: true, noColorFlag: true, env: { FORCE_COLOR: '1' } }),
      false,
    );
  });

  it('disables color when NO_COLOR is set (any non-empty value)', () => {
    assert.equal(
      resolveColorEnabled({ isTTY: true, noColorFlag: false, env: { NO_COLOR: '1' } }),
      false,
    );
  });

  it('treats NO_COLOR="" as "not set" per no-color.org convention', () => {
    assert.equal(
      resolveColorEnabled({ isTTY: true, noColorFlag: false, env: { NO_COLOR: '' } }),
      true,
    );
  });

  it('enables color when FORCE_COLOR is set even without a TTY', () => {
    assert.equal(
      resolveColorEnabled({ isTTY: false, noColorFlag: false, env: { FORCE_COLOR: '1' } }),
      true,
    );
  });

  it('enables color iff TTY when no env override is present', () => {
    assert.equal(resolveColorEnabled({ isTTY: true, noColorFlag: false, env: {} }), true);
    assert.equal(resolveColorEnabled({ isTTY: false, noColorFlag: false, env: {} }), false);
  });
});
