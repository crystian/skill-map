/**
 * `kernel/util/safe-text` — sanitisers used before printing
 * disk-sourced content (frontmatter titles, plugin output, persisted
 * issue messages) to a TTY. The risk: a hostile markdown file can ship
 * ANSI/CSI escapes that move the cursor, repaint the screen, hide
 * text, or — on certain legacy terminals — trigger command execution.
 *
 * `stripAnsi` removes the escape sequences proper. `sanitizeForTerminal`
 * also drops C0 control characters except the three we keep (`\t`, `\n`,
 * `\r`). The two are kept separate so a future renderer can pick the
 * lighter strip when it has its own line-discipline rules.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sanitizeForTerminal, stripAnsi } from '../kernel/util/safe-text.js';

describe('stripAnsi', () => {
  it('passes through plain text unchanged', () => {
    assert.equal(stripAnsi('hello world'), 'hello world');
  });

  it('removes a CSI SGR sequence (color reset)', () => {
    assert.equal(stripAnsi('[31mred[0m'), 'red');
  });

  it('removes a screen-clearing CSI sequence', () => {
    assert.equal(stripAnsi('before[2J[Hafter'), 'beforeafter');
  });

  it('removes a cursor-move CSI sequence', () => {
    assert.equal(stripAnsi('row1[10;20Hpwn'), 'row1pwn');
  });

  it('preserves newlines and tabs', () => {
    assert.equal(stripAnsi('a\n\tb'), 'a\n\tb');
  });

  it('removes an OSC 8 hyperlink sequence (URL chars in the param)', () => {
    // OSC 8 emits `ESC ] 8 ; ; <url> BEL <label> ESC ] 8 ; ; BEL`.
    // The expanded charset (`-/#&.:=?%@~_`) lets the regex match the
    // `https://example.com` URL. Pre-audit (M6) the regex stopped at the
    // `:` and left the URL fragment behind.
    const link = '\x1B]8;;https://example.com\x07label\x1B]8;;\x07';
    assert.equal(stripAnsi(link), 'label');
  });
});

describe('sanitizeForTerminal', () => {
  it('passes through plain text unchanged', () => {
    assert.equal(sanitizeForTerminal('Hello, Arquitecto!'), 'Hello, Arquitecto!');
  });

  it('strips ANSI escapes (delegates to stripAnsi)', () => {
    assert.equal(sanitizeForTerminal('[31mred[0m'), 'red');
  });

  it('drops NUL, BEL, BS', () => {
    assert.equal(sanitizeForTerminal('a\x00b\x07c\x08d'), 'abcd');
  });

  it('drops VT, FF and the SO..US block', () => {
    assert.equal(sanitizeForTerminal('a\x0bb\x0cc\x0ed\x1fe'), 'abcde');
  });

  it('drops DEL (0x7F)', () => {
    assert.equal(sanitizeForTerminal('a\x7fb'), 'ab');
  });

  it('preserves TAB, LF, CR (renderer line discipline relies on them)', () => {
    assert.equal(sanitizeForTerminal('a\tb\nc\rd'), 'a\tb\nc\rd');
  });

  it('strips a screen-repaint + colour-reset attack from a hostile title', () => {
    const hostile = 'My Agent[2J[H[31mPWN[0m';
    assert.equal(sanitizeForTerminal(hostile), 'My AgentPWN');
  });

  it('preserves printable Unicode (CJK, emoji, accented)', () => {
    assert.equal(sanitizeForTerminal('café — 日本 — 🚀'), 'café — 日本 — 🚀');
  });
});
