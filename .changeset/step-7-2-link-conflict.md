---
'@skill-map/spec': patch
'@skill-map/cli': minor
---

Step 7.2 — Detector conflict resolution

Two pieces:

1. **New built-in rule `link-conflict`** (`src/extensions/rules/link-conflict/`).
   Surfaces detector disagreement. Groups links by `(source, target)` and
   emits one `warn` Issue per pair where the set of distinct `kind` values
   has size ≥ 2. Agreement (single kind across multiple detectors) is
   silent — by design, to avoid massive noise on real graphs.
   Issue payload (`data`) carries `{ source, target, variants }` where
   each `variant` is `{ kind, sources: detectorId[], confidence }`. Variant
   sources are deduped + sorted; confidence is the highest across rows
   of the same kind (`high` > `medium` > `low`).

   This is the kernel piece of Decision #90 read-time "consumers that
   need uniqueness aggregate at read time" — the rule is one such
   consumer, on the alarming side. Storage stays untouched (one row
   per detector, no merge, no dedup). Severity is `warn`, not `error`:
   the rule cannot pick which kind is correct, so per `cli-contract.md`
   §Exit codes the verb stays exit 0.

2. **`sm show` pretty link aggregation** (`src/cli/commands/show.ts`).
   The human renderer now groups `linksOut` / `linksIn` by `(endpoint,
   kind, normalizedTrigger)` and prints one row per group with the
   union of detector ids in a `sources:` field. The section header
   reports both the raw row count and the unique-after-grouping count
   (`Links out (12, 9 unique)`). When N > 1 detector emits the same
   logical link, the row also gets a `(×N)` suffix.

   `--json` output is byte-identical to before — raw rows, no merge.
   Storage is byte-identical to before. The grouping is purely a
   read-time presentation choice for human eyes.

**Spec changes (patch)**:

- `spec/cli-contract.md` §Browse — `sm show` row clarifies that pretty
  output groups identical-shape links and that `--json` emits raw rows.
  Patch (not minor) because the JSON contract is unchanged; the human
  output format is non-normative anyway.

**Runtime changes (minor — new rule + new presentation)**:

- New rule `link-conflict` registered in `src/extensions/built-ins.ts`.
- `sm show` pretty output groups links + reports unique counts.

**UI inspector aggregation deferred to Step 13**: the current Flavor A
inspector renders the `Relations` card from `node.frontmatter.metadata.{
related, requires, supersedes, provides, conflictsWith}` directly — it
does NOT consume `linksOut` / `linksIn` rows from `scan_links`. There
is no link table to aggregate today. When Step 13's Flavor B lands (Hono
BFF + WS + full link panel from scan), the aggregation logic from
`src/cli/commands/show.ts` will need to be ported.

**Roadmap**: Step 7 — Robustness, sub-step 7.2 (detector conflict
resolution). Closes one of the three remaining frentes; 7.3 (`sm job
prune` + retention) still pending. Decision #90 unchanged: storage
keeps raw per-detector rows. The `related` vs LLM-amplification
discussion is documented in `.tmp/skill-map-related-test/` (status
quo retained — fields stay opt-in under `metadata.*`; revisit if
real-world amplification appears).

**Tests**: 327 → 335 (+8 new for the rule, no regressions).
