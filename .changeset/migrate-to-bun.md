---
"@skill-map/cli": minor
"@skill-map/spec": minor
"@skill-map/testkit": minor
"@skill-map/web": minor
---

Migrate the monorepo from npm + Node 24 to Bun (runtime + package manager). The published `@skill-map/cli` now ships with a `#!/usr/bin/env bun` shebang and requires Bun ≥ 1.2 on the consumer's machine; the previous Node 24 requirement is gone. The kernel storage layer swaps `node:sqlite` for `bun:sqlite` (synchronous API parity, same Kysely dialect surface). Test runner moves from `node --test` (with the `tsx` loader) to `bun test`; 108 `.test.ts` files were ported via a one-shot import rewrite that aliases `before` / `after` to `beforeAll` / `afterAll` so call sites stay unchanged. The Hono BFF replaces `@hono/node-server` + the `ws` package with native `Bun.serve()` + `Bun.ServerWebSocket` — the broadcaster's `IBroadcasterClient` interface absorbed the API delta via a thin adapter. CI workflows swap `actions/setup-node` for `oven-sh/setup-bun`, replace `npm ci` with `bun install --frozen-lockfile`, and route the changesets-action publish step through a new `scripts/release-publish.mjs` that walks workspaces and calls `bun publish` (no `npm publish` in CI).

**Breaking for CLI consumers**: globally-installed `@skill-map/cli` now expects Bun on the PATH. Existing installs continue to work until the next upgrade; new installs need `bun install -g @skill-map/cli@latest` followed by running `sm` under Bun. `npm i -g @skill-map/cli` continues to fetch the tarball but the binary will fail at startup with a clear `skill-map requires Bun >= 1.2` message instead of an opaque module-not-found.

**Notable Bun-only fixes surfaced during the migration**: (1) `os.homedir()` ignores `$HOME` overrides on POSIX under Bun — `core/runtime/runtime-context.ts` now reads `process.env.HOME` first to keep behavior consistent with Node; (2) `bun:sqlite`'s page cache caches per-path, so `db restore` now unlinks the target before the file copy to force a new inode (was an in-place overwrite that surfaced as `SQLITE_IOERR_SHORT_READ` on the next open); (3) Bun's TS transpiler rewrites literal NUL bytes inside regex literals to `U+FFFD`, breaking two regexes that used `\x00DOUBLESTAR\x00` and `[\x00-\x08...]` as sentinels — both rewritten to use escape sequences or single-pass alternations.
