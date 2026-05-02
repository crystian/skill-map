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

  // ---- error envelope messages (Step 14.2) ---------------------------------

  // Persisted scan absent and the route can't degrade to an empty result.
  // Hint nudges the user toward `sm scan` so the SPA can call it via the
  // CLI side-by-side with the server.
  dbMissingHint:
    'No persisted scan available at {{path}}. Run `sm scan` to populate the DB.',

  // `?fresh=1` was requested but the server was booted with --no-built-ins
  // or --no-plugins. A fresh scan with neither pipeline yields an empty /
  // partial result that would surprise the SPA. Reject up front.
  freshScanRequiresPipeline:
    '?fresh=1 cannot run while the server was started with --no-built-ins or --no-plugins (would yield empty / partial results).',

  // Unknown formatter on /api/graph — the user asked for a `format` value
  // that no registered formatter advertises. Mirrors `sm graph`'s message.
  graphUnknownFormat:
    'Unknown graph format "{{format}}". Available: {{available}}.',

  // Pagination caps on /api/nodes.
  paginationLimitTooLarge:
    'limit={{value}} exceeds the maximum of {{max}}.',
  paginationInvalidInteger:
    '{{name}}={{value}} is not a non-negative integer.',

  // Node lookup miss on /api/nodes/:pathB64. Both the missing-node and
  // the malformed-pathB64 cases funnel here — the client experience is
  // the same (the resource isn't there).
  nodeNotFound:
    'No node with path "{{path}}".',
  pathB64Malformed:
    'Malformed pathB64 — not a valid base64url-encoded node.path.',
} as const;
