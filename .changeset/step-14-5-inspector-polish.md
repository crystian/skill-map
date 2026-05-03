---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Step 14.5 (a + b) — Inspector polish: markdown body opt-in + linked-nodes panel + dead-link verify hybrid

Two sub-steps land together as a single feature unit. The Inspector
view (UI workspace) gains a real markdown body card, a dedicated
linked-nodes panel fed by the BFF's `/api/links` endpoint, and a
hybrid dead-link checker that combines the in-memory heuristic with
on-demand BFF verification. The spec + server side ships the minimal
contract the new UI surface depends on: an opt-in `?include=body`
parameter on `GET /api/nodes/:pathB64`, plus a corrected single-node
response shape. Tests 854 → 868 (+14 server) and UI 113 → 138 (+25
inspector / linked-nodes specs).

**Why on-demand body reads instead of persisting bodies in the DB**:
the kernel persists `body_hash` only (per `db-schema.md` §scan_nodes)
— the body itself is human content, not machine state, and
duplicating it in SQLite would inflate the DB without serving any
read-side query the kernel cares about. Inspector cards that DO want
to render the body (markdown preview at Step 14.5) opt into the
filesystem re-read; the list / graph / kind-palette views never need
it.

**Files added (server)**

- `src/server/node-body.ts` — on-demand body reader. Exports
  `readNodeBody(cwd, relPath)` (returns `string | null`; `null` on
  ENOENT / EACCES / EISDIR / ENOTDIR) and `stripFrontmatter(body)`
  (drops the leading `---\n…\n---\n` block when present, leaves
  fences in mid-document untouched). Path-traversal hardened: refuses
  absolute paths and any relative path that resolves outside `cwd`.
- `src/test/server-node-body.test.ts` (11 unit cases) — covers
  `stripFrontmatter` edge cases (empty, no frontmatter, missing
  closing fence, fence in mid-document) and `readNodeBody` traversal
  rejection + the four `null`-returning errno branches.

**Files edited (server)**

- `src/server/routes/nodes.ts` — `GET /api/nodes/:pathB64` extends
  with `?include=body` opt-in (CSV-tolerant via the new
  `parseIncludes` helper, so `?include=body,future-extension` reads
  cleanly the day a second include lands). Same handler also FIXES a
  long-standing shape bug: was emitting `{ item: { node, linksOut,
  linksIn, issues } }` (raw `INodeBundle` pass-through), now emits
  the documented `{ item: Node, links: { incoming, outgoing },
  issues }` that the UI's `INodeDetailApi` and `StaticDataSource`
  already expected. No prod consumer ran against the legacy shape
  (the UI was internally branching on the legacy shape before the
  REST adapter landed at 14.3.a), so the corrected shape ships as a
  minor.
- `src/test/server-endpoints.test.ts` — assertions corrected to the
  documented shape; 2 new cases for `?include=body` (returns body
  on present file, returns `null` when the file is missing).

**Files added (UI)**

- `ui/src/app/components/linked-nodes-panel/{ts,html,css,spec.ts}`
  — standalone Angular component. Inputs: `path`. Outputs:
  `openPath`. Internally fires `dataSource.listLinks({from})` +
  `listLinks({to})` in parallel; state machine
  `idle/loading/ready/error`. Subscribes to `events()` filtered on
  `scan.completed` for reactive refresh, plus a manual refresh
  button in the card header. Token guard handles rapid path
  changes. Renders rows with kind tag + clickable path +
  confidence chip + sources. 10 spec cases.
- `ui/src/i18n/linked-nodes-panel.texts.ts` — i18n catalog.
- `ui/src/app/views/inspector-view/inspector-view.spec.ts` (15
  cases) — first inspector-view spec. Covers empty / loading /
  body-card states, stale-fetch token guard, kind-card smoke,
  dead-link verify icon flow (heuristic-dead renders icon,
  click → 404 confirms, click → 200 flips to live).

**Files edited (UI)**

- `ui/src/models/api.ts` — `INodeApi.body?: string | null` added.
- `ui/src/services/data-source/data-source.port.ts` —
  `IDataSourcePort.getNode(path, opts?: {includeBody?: boolean})`.
- `ui/src/services/data-source/rest-data-source.ts` — propagates
  `includeBody` to `?include=body`.
- `ui/src/services/data-source/static-data-source.ts` — ignores
  the flag (demo bundle ships bodies inline; see
  `scripts/build-demo-dataset.js` below).
- `ui/src/services/collection-loader.ts` — minor signature touch
  for the `getNode` opts pass-through.
- `ui/src/models/node.ts` — `INodeView` loses three fields:
  `body`, `raw`, `mockSummary`. The "Summary" mock card is
  retired (description already lives in `inspector__desc`).
- `ui/src/app/views/inspector-view/inspector-view.ts` — body card
  switches from `<pre>{{ n.body }}</pre>` to a `@switch` over a
  `bodyState` signal (idle / loading / empty / unavailable /
  error / ready) with token-guarded fetch via `effect()` keyed on
  `path()`; markdown rendered via `MarkdownRenderer` and
  `[innerHTML]`. Mounts `<sm-linked-nodes-panel>` as a separate
  card between Relations and Body. Dead-link verify hybrid: the
  Relations card chips (`supersededBy` / `supersedes` / `requires`
  / `related`) keep the in-memory heuristic but now carry a verify
  icon (`pi-question-circle`) that fires `getNode(path)` against
  the BFF; three visual states `live` / `dead-confirmed` (404 → red
  dashed border + `pi-times-circle`) / `dead-heuristic` (not in
  scope, not yet verified). Per-node signals
  `verifiedAlive` / `verifiedDead` / `verifyInFlight` reset on
  `path()` change. Template refactor consolidates 4 inline
  duplicated chip blocks into a single `<ng-template #pathChip>`
  shared via `*ngTemplateOutlet`.
- `ui/src/app/views/inspector-view/inspector-view.{html,css}` —
  templates + styles for the new body / verify states.
- `ui/src/i18n/inspector-view.texts.ts` — drops `summary*`, adds
  `body.*` (loading / empty / unavailable / renderError),
  `relations.verifyHint`, `relations.deadConfirmed`. `body: 'Body'`
  (was `'Body (raw markdown)'`).

**Files edited (build pipeline)**

- `scripts/build-demo-dataset.js` — new `embedBodies(scan,
  fixtureDir)` post-processor reads each fixture's body from disk,
  strips frontmatter, attaches to the demo `data.json` so the
  demo experience matches the live BFF (~40 KB extra for 21
  fixtures; bodies-on-bundle is the explicit demo-mode tradeoff).

**Spec**

- `spec/cli-contract.md` `### Server` — `/api/nodes/:pathB64` row
  flips its shape column from the legacy bundle to the documented
  `{ item, links: { incoming, outgoing }, issues }` and gains the
  `?include=body` filter column.
- `spec/CHANGELOG.md` `[Unreleased]` `### Minor` — entry covering
  the `?include=body` opt-in, the corrected response shape, and
  the path-traversal defense.
- `spec/index.json` — regenerated (41 files hashed; no schema
  added).

**ROADMAP** — `Last updated` bumped, "YOU ARE HERE" updated,
completeness marker now lists 14.5.a + 14.5.b as complete; "Next"
points at 14.5.c.

**Decisions taken inline (flag for orchestrator)**

- The corrected single-node shape ships as a minor (additive on
  the contract surface) rather than a major. Rationale: no public
  consumer ran against the legacy shape; the UI was decoding the
  legacy shape internally before the REST adapter at 14.3.a
  introduced the documented shape; and the spec table already
  documented the new shape (the bug was in the implementation,
  not the spec). Keeping the bump minor avoids burning a major
  on a never-shipped wire format.
- `parseIncludes` is CSV-tolerant from day one (`?include=body`
  and `?include=body,foo` both parse) so the second include can
  land without a parser refactor. Unknown include values are
  silently ignored — the BFF surface mirrors the spec's
  "ignore unknown event types" rule for forward compatibility.
- Bodies are fetched per-node on inspector open, not pre-fetched
  in the list endpoint. Keeps the list `/api/nodes` response
  small (the list view never renders bodies) and matches the
  read-side hot path: most nodes are listed but few are inspected.
- The dead-link verify is opt-in per chip click, not auto-fired
  on inspector open. Heuristic-dead nodes are common in scoped
  scans (a workspace that scans `docs/` but references `src/`);
  auto-firing would burn one BFF round-trip per such reference.
- Per-node verification signals reset on `path()` change to avoid
  stale state bleeding between inspector navigations. The signals
  are scoped to the component instance; no global cache (the
  cost is one BFF call per re-verify on revisit, which the user
  triggers intentionally by clicking the icon).
