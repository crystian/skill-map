---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Step 14.2 — REST read-side endpoints + DataSource contract

Fills the `### Server` subsection's endpoint catalogue from the v14.1 stub
(`/api/health` real, `/api/*` 404) to the eight read-side endpoints the
Angular SPA at 14.3 will consume. New `spec/schemas/api/rest-envelope.schema.json`
formalises the list-envelope shape. Test totals 764 → 832 (+68).

**Files added (server)**

- `src/server/path-codec.ts` — `encodeNodePath` / `decodeNodePath`. Base64url (RFC 4648 §5, no padding). Mirrored at `ui/src/services/data-source/path-codec.ts` in 14.3.
- `src/server/envelope.ts` — list / single / value envelope builders. `REST_ENVELOPE_SCHEMA_VERSION = '1'`. Hardcoded to track `spec/schemas/api/rest-envelope.schema.json#/properties/schemaVersion/const`.
- `src/server/query-adapter.ts` — `urlParamsToExportQuery(params)` lifts URL search params into the kernel's `IExportQuery` via `parseExportQuery` (one grammar, two transports). `filterNodesWithoutIssues` post-filter handles `hasIssues=false` (the one filter the kernel grammar can't express).
- `src/server/routes/deps.ts` — shared `IRouteDeps` bag (`options`, `runtimeContext`).
- `src/server/routes/health.ts` — extracted from `app.ts` for symmetry with the other routes (no behavior change).
- `src/server/routes/scan.ts` — `/api/scan` + `/api/scan?fresh=1`. DB absent → returns the empty `ScanResult` shape (matches the `loadScanResult` synthetic fallback). `?fresh=1` rejects when the server was started with `--no-built-ins` or `--no-plugins`.
- `src/server/routes/nodes.ts` — `/api/nodes/:pathB64` (single) registered BEFORE `/api/nodes` (list) so the param doesn't shadow the literal prefix. Pagination defaults `offset=0`, `limit=100`; max `limit=1000`.
- `src/server/routes/links.ts` — `/api/links?kind=&from=&to=`.
- `src/server/routes/issues.ts` — `/api/issues?severity=&ruleId=&node=`. `ruleId` filter mirrors `sm check`'s qualified-or-suffix match.
- `src/server/routes/graph.ts` — `/api/graph?format=ascii|json|md`. Per-format content-type. Unknown format → `bad-query` 400.
- `src/server/routes/config.ts` — `/api/config`. Wraps `loadConfig` from the kernel. Layered-loader warnings forwarded to `process.stderr`.
- `src/server/routes/plugins.ts` — `/api/plugins`. Built-ins (gated by `noBuiltIns`) + drop-ins (gated by `noPlugins`). `source: 'built-in' | 'project' | 'global'` derived from the plugin's filesystem path against `defaultProjectPluginsDir`.

**Files edited (server)**

- `src/server/app.ts` — `IAppDeps` gains `runtimeContext` (mandatory). Routes registered via the new `routes/*` registrars BEFORE the `/api/*` 404 catch-all. `app.onError` extended to map `ExportQueryError` → 400 `bad-query` (alongside the existing HTTPException + uncaught-Error branches).
- `src/server/index.ts` — `createServer(options, extra?)` accepts an optional `extra.runtimeContext` so tests can drive against a tempdir scope; production callers (the `sm serve` verb) leave it undefined and the composition root falls back to `defaultRuntimeContext()`.
- `src/server/i18n/server.texts.ts` — adds error message templates: `dbMissingHint`, `freshScanRequiresPipeline`, `graphUnknownFormat`, `paginationLimitTooLarge`, `paginationInvalidInteger`, `nodeNotFound`, `pathB64Malformed`.

**Tests added (68)**

- `src/test/server-endpoints.test.ts` (24) — happy + error path per endpoint. Uses real `runScan` + `persistScanResult` against a `mkdtempSync` fixture (no `:memory:` per `feedback_sqlite_in_memory_workaround.md`).
- `src/test/server-pagination.test.ts` (10) — default page caps at 100, `?limit=1000` accepted, `?limit=1001` rejected, offset/limit boundaries, `?offset=-1` and `?offset=foo` rejected, offset past total returns empty + preserves total.
- `src/test/server-errors.test.ts` (8) — every `code` value maps to the documented HTTP status; canonical envelope shape on every error response.
- `src/test/server-query-adapter.test.ts` (16) — URL-param → IExportQuery matrix; `filterNodesWithoutIssues` post-filter behaviour.
- `src/test/server-path-codec.test.ts` (10) — round-trip on POSIX / unicode / spaces / very long paths; rejection of empty, non-alphabet, single-char inputs; uniqueness for distinct inputs.

**Spec**

- `spec/schemas/api/rest-envelope.schema.json` — new schema. `$id: https://skill-map.dev/spec/v0/api/rest-envelope.schema.json`. `oneOf` enforces that an envelope carries exactly one of `items` / `item` / `value` per kind (with sentinel kinds `health` / `scan` / `graph` reserved for routes that don't use the envelope).
- `spec/cli-contract.md` `### Server` — endpoint table expanded from 4 rows (v14.1 surface) to 12 rows (v14.2 surface) with full filters / status / shape per row. Error code source enumeration added (`not-found` / `bad-query` / `internal` / reserved `db-missing`). Stability stays `experimental — locks at v0.6.0`.
- `spec/CHANGELOG.md` `[Unreleased]` `### Minor` — entry for BFF endpoints + envelope schema.
- `spec/conformance/coverage.md` — row 25 added for `api/rest-envelope.schema.json` (status: 🔴 missing — implementation-side coverage exists in `src/test/server-endpoints.test.ts`; a kernel-agnostic conformance case is still required before v1.0.0 ships).
- `spec/index.json` — regenerated (40 → 41 files hashed).

**Decisions during implementation (flag for orchestrator)**

- The `db-missing` error code is kept in the documented enum but no v14.2 route currently emits it — `/api/scan` returns the empty `ScanResult` when the DB is absent, list routes return zero items, and `/api/health` already advertises `db: 'missing'`. Documented in the spec as "reserved for future endpoints (post-v0.6.0 mutations) where degradation is not safe". Removing the code would be a breaking change to the envelope contract; keeping it costs nothing.
- `ExportQueryError` from `parseExportQuery` is funneled to `bad-query` 400 via a new branch in `app.onError`. The brief listed it as a route-level concern; centralising in the global handler means future routes that go through the kernel grammar (e.g. a future `/api/export?q=...`) inherit the same envelope mapping for free.
- `urlParamsToExportQuery` builds a canonical raw query string and re-parses it through `parseExportQuery` instead of constructing `IExportQuery` directly. The extra parse is microseconds and guarantees the BFF and `sm export` can never drift on what counts as a valid filter token. When the grammar grows (e.g. `has=findings` post-Step 11), only `parseExportQuery` changes.
- `/api/scan?fresh=1` rejection on `--no-built-ins` / `--no-plugins` matches Decision §14.1's intent: the BFF surface should not silently produce empty results that look indistinguishable from "your project has no nodes". The `bad-query` envelope tells the operator they're holding a knife by the blade.
- Tests use `noPlugins: true` by default to keep them deterministic against `process.cwd()` — `loadPluginRuntime` walks the live cwd's plugins dir, which would surface ambient plugins from the test runner's host (none in CI today, but a developer running tests locally with their own plugins installed would see flake).
- The route registration order in `app.ts` is documented in the file's header comment. `/api/nodes/:pathB64` MUST register before `/api/nodes` (Hono matches in declaration order; the literal prefix wins otherwise).
