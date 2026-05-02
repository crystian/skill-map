/**
 * BFF (Hono) strings emitted by `src/server/**` to stdout / stderr.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Server messages are kept terse — the BFF is a long-running process,
 * not an interactive verb; every line is a server-side log, not user
 * dialogue.
 */

export const SERVER_TEXTS = {
  // Boot banner — printed by the server itself when it begins to listen.
  // The CLI verb `sm serve` formats its own boot banner separately
  // (SERVE_TEXTS.boot) so the two surfaces can diverge if needed.
  listening: 'skill-map server listening on http://{{host}}:{{port}}\n',

  // UI bundle missing — non-fatal when the path was auto-resolved (the
  // server keeps running with an inline placeholder at `/`). Becomes
  // ExitCode.Error when `--ui-dist <path>` was explicit.
  uiBundleMissing:
    'skill-map server: UI bundle not found at {{path}} — serving inline placeholder at "/" (run "npm run build --workspace=ui" to populate).\n',

  // Loopback-only deprecation hint — Decision #119. Logged once at boot
  // when `--host` resolves to a non-loopback address. Multi-host serve
  // re-opens post-v0.6.0.
  hostNonLoopbackHint:
    'skill-map server: --host {{host}} is non-loopback — through v0.6.0 the BFF assumes loopback-only (no auth). See Decision #119 in ROADMAP.\n',

  // Shutdown trace — printed by the close path so test runs that bring
  // the server up and down have a clear marker.
  closed: 'skill-map server: closed.\n',
} as const;
