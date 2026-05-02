/**
 * Sanitisers for strings that flow from disk-resident user content
 * (markdown frontmatter, plugin output, persisted enrichment values)
 * into terminal output. Without sanitisation a hostile file can inject
 * ANSI control sequences that move the cursor, repaint the screen, hide
 * text, or — on certain legacy terminals — trigger command execution.
 *
 * Two layered helpers:
 *
 *   - `stripAnsi(text)` — removes the CSI / OSC / ESC sequences proper.
 *   - `sanitizeForTerminal(text)` — ANSI strip plus the C0 control
 *     subset that has no place in user content (NUL, BEL, BS, VT, FF,
 *     SO, SI, DLE..US except `\t` `\n` `\r`). Use this everywhere a
 *     disk-sourced string is about to be `write()`-en to stdout/stderr.
 *
 * Surface area kept deliberately small. If a renderer needs richer
 * escaping (HTML, shell, JSON), it should reach for the matching
 * dedicated helper rather than extending this one.
 */

// CSI / OSC / single-char ESC sequences. Pattern adapted from
// `strip-ansi` v7 (MIT, Sindre Sorhus). The kernel deliberately stays
// dependency-free for security-critical helpers, so the regex is
// vendored verbatim (with the `` / `` lead-byte anchors
// preserved) instead of pulling in the package. Compared to the
// pre-audit (M6) version, the OSC tail accepts the full
// `-a-zA-Z\d/#&.:=?%@~_` charset that real OSC 8 hyperlinks use, so
// `\x1B]8;;https://...\x07label\x1B]8;;\x07` strips cleanly instead
// of leaving the URL fragment behind. The CSI tail is unchanged.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /[][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

// C0 control characters except TAB (\x09), LF (\x0A), CR (\x0D). DEL
// (\x7F) is included — terminals interpret it as backspace.
// eslint-disable-next-line no-control-regex
const C0_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

export function sanitizeForTerminal(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '').replace(C0_CONTROL_RE, '');
}
