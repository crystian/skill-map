# Map views

Named, shareable projections of the workspace map. A map view captures an
operator's curated topology (which subtrees are visible, where the pinned
nodes sit, later which visual groups exist) as one committed JSON file, so
the curation travels to every collaborator through the shared repository
instead of dying in one browser's localStorage.

Schema: [`schemas/map-view.schema.json`](./schemas/map-view.schema.json).
HTTP surface: the `/api/map-views` rows in
[`cli-contract.md` §BFF endpoints](./cli-contract.md). Storage decision:
[`architecture.md` §Storage rule](./architecture.md), fourth home.

## What a view is (and is not)

Skill-map has four mechanisms that decide what the operator sees, and they
must not be confused:

| Mechanism | Scope | Persistence | Effect |
|---|---|---|---|
| `.skillmapignore` (§Scope ignore + `/api/project-ignore`) | Global, all collaborators once committed | Project-root file | Destructive: the path is never scanned, DB rows drop on the next scan |
| **Map view** (this doc) | Per view, shared via git | `.skill-map/views/<slug>.json` | Presentational: hides and arranges without touching the scan or the DB |
| Live map state (overrides, pins, viewport) | Per browser | localStorage | The working canvas; a view is saved FROM it and applied INTO it |
| Isolate / tag selection | Per session | In-memory only | Ephemeral lenses, deliberately not persisted |
| Live lens node drags | Per lens session | In-memory only | A card dragged while the Live lens (or a replay) is on keeps its position through the lens's force relayouts, and the pin dies with the lens exit; it never reaches the curated pins, `localStorage` or a map view |

A view carries HUMAN curation only. No machine process may author or
rewrite a view file; implementations MAY at most propose changes (the
future `view-ref-broken` analyzer described below) that the operator
applies through ordinary consent-gated surfaces.

## File location and identity

One file per view: `<scopeRoot>/.skill-map/views/<slug>.json`.

- The **filename is the identity**. The slug MUST match the `Slug` rule of
  the schema (`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`): 1-64 lowercase
  alphanumerics and hyphens, no leading or trailing hyphen. The rule
  structurally forbids `/`, `\` and `.`, so a conforming slug cannot
  traverse outside the views directory; implementations MUST reject a
  non-conforming slug at every write surface.
- The slug is derived from the display `name` once, at creation; renaming
  the display name never re-derives the slug (the filename is a stable
  handle for git history and deep links).
- `views/` is deliberately ABSENT from the scope ignore file
  (§Scope ignore file in `cli-contract.md`): like `settings.json` and
  `plugins/`, view files are trackable by default and committed by intent.
- The directory is created lazily on the first write; an absent directory
  reads as zero views.

## Canonical serialization

A writer MUST emit exactly this form, so identical curation yields
byte-identical files and diffs stay reviewable:

- UTF-8, LF line endings, 2-space indent, single trailing newline.
- Top-level key order: `schemaVersion`, `kind`, `name`, `description`,
  `order`, `overrides`, `pins`, `groups`.
- `pins` keys byte-sorted ascending.
- `overrides` array order preserved VERBATIM: it is the include seniority
  of §Map scope overrides (`cli-contract.md`), not a sortable list.
- `description`, `order`, and `groups` omitted when empty or absent; no
  `null` values.
- No timestamps. A view file is a pure function of curated state; history
  and authorship belong to git.

## Apply semantics

Applying a view replaces the live curation:

- `overrides` replace the live override map verbatim (same evaluation rule
  as §Map scope overrides; the branch projection stays stateless, the
  client compiles the view onto the existing wire form).
- `pins` replace the live manual pin set: prior manual pins are demoted to
  auto-layout, view pins become manual. Unpinned nodes are re-laid-out by
  the consumer's auto-layout.
- The viewport (camera) never travels; filters (attribute-based hiding)
  never travel; which view is active is per-developer local state and
  never travels.

**Dead references are legal.** A view whose override keys, pin keys, or
group members no longer resolve to scanned nodes MUST still apply: the
dead references are ignored (an override key that matches nothing simply
matches nothing) and their count is surfaced to the operator. The server
never rewrites a view file to prune them; pruning is a human act. A future
built-in `view-ref-broken` analyzer MAY lint committed view files and a
companion fixer MAY propose the pruned file through the ordinary findings
pipeline; both are reserved surface, not part of this contract yet.

## Ordering and shortcuts

The view list has a SHARED order, part of the curation that travels
(user decision 2026-08-10): every collaborator sees the same sequence,
so "press 2" means the same view for the whole team.

- Each document MAY carry an optional `order` (integer, minimum 1).
  Lists sort by `order` ascending; documents WITHOUT `order` sort after
  every ordered one; the slug (byte order) breaks ties in both groups.
  The `GET /api/map-views` envelope returns entries already in this
  canonical sequence.
- The first nine positions of the sorted list map to the digit
  shortcuts `1`-`9` in consuming UIs; a UI SHOULD surface the position
  number on those entries. Positions beyond nine have NO shortcut and
  no number, by design; the list itself is unbounded.
- Reordering is a client concern: a writer renumbers the affected
  documents compactly (`1..N`) and persists each changed one through
  the ordinary upsert. Implementations MUST tolerate duplicate and
  sparse `order` values in committed files (a merge can produce both);
  the sort's slug tiebreak keeps the sequence deterministic either way.

## Groups (reserved)

The `groups` array ships in the schema from day one so that grouping UI
(wave 2) needs no file migration. Wave-1 implementations MUST round-trip
the array verbatim on save. A group is spatial presentation inside one
view (a titled, optionally colored container of member nodes); semantic
classification stays with tags.

## Concurrency

Writes are last-write-wins. Two operators editing the same view
concurrently resolve through git like any other committed file; the merge
and review layer is the repository, not the implementation. Implementations
SHOULD write atomically (temp file plus rename) so a crashed write never
leaves a half-serialized view.

## Stability

- The document shape (`schemaVersion` 1, the five required top-level
  keys plus optional `description`, `order`, and `groups`) is stable as
  of spec v1.10 (`order` added in the same release cycle). Adding a new
  OPTIONAL top-level key is a minor bump; making one required,
  renaming, or removing one is a major bump.
- The ordering contract (§Ordering and shortcuts: sort key, absent-last,
  slug tiebreak, nine shortcut positions) is stable; changing the sort
  key or the shortcut count is a major bump.
- The Slug rule, the canonical serialization, and the dead-reference
  tolerance are stable; tightening any of them is a major bump.
- The `groups` entry shape (`id`, `label`, required `members`, optional
  `color`, `position`, `size`) is reserved but stable; wave-2 grouping
  must build on it additively.
- The `/api/map-views` endpoint family follows the endpoint table in
  `cli-contract.md`; adding endpoints or optional body fields is a minor
  bump.
