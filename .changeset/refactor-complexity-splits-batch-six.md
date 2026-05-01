---
"@skill-map/cli": patch
---

Continue the complexity-reduction sweep — six more high-complexity
functions split into focused helpers in a single batch. **Patch bump**:
zero public API changes (no exported signatures touched, no new
exports), pure internal restructuring; 602 / 602 tests still green
after each split individually and after the batch.

## Why

Follows the chain `91fea6a` → `efa8972` → `66ea293` → `6d031d8` →
`4fbb23c` → `11c4382`, per the standing request to push every
function below the lint complexity threshold of 8. This batch picks
off the next six offenders across kernel, CLI commands, an extension
rule, and the plugin-runtime helper layer. The chain is deliberately
small per commit so each split is reviewable in isolation and the
"behavior identical" claim is easy to verify.

## What

### `src/kernel/orchestrator.ts` — finish the `walkAndExtract` split (audit V4 follow-up)

Refactored `reusePriorNode` to share its body via a new
`cloneNodeAndReshapeLinks` helper. Both the full-cache-hit branch
(still inside `reusePriorNode`) and the partial-cache-hit branch (now
delegates to `cloneNodeAndReshapeLinks` directly) share one code path
for the clone + link reshape + frontmatter issue re-emit.
`reusePriorNode` adds the `extractorRuns` records on top.

Effect: `walkAndExtract` 33 → 28; `cloneNodeAndReshapeLinks` and the
trimmed `reusePriorNode` both sit below threshold.

### `src/cli/commands/refresh.ts` — split `execute` (30 → <8)

Two private methods on `RefreshCommand`:

- `#resolveTargetNodes` — handles the `--stale` vs `<nodePath>`
  decision, returns `{ ok: true, nodes } | { ok: false, exitCode }`.
- `#runDetExtractorsAcrossNodes` — reads node bodies off disk, runs
  every applicable deterministic extractor per node, counts
  probabilistic skips.

Added `ScanResult` to the kernel imports for the typed parameter.

### `src/cli/commands/init.ts` — split `execute` (25 → <8)

The `--dry-run` branch was 60+ lines with many `existsSync()`
conditionals plus a 3-way `.gitignore` plural / singular / unchanged
switch. Two free helpers now: `writeDryRunPlan` writes the full plan
to stdout; `writeDryRunGitignorePlan` is a sub-helper for the
`.gitignore` preview phrasing. New `writeDryRunPlan` sits at 11 — the
conditional density is intrinsic to the dry-run preview, further
splitting would dilute clarity.

### `src/cli/commands/help.ts` — extract `renderVerbBlock` (19 → <8)

The per-verb body of the markdown renderer (heading, description,
details, flags table, examples block) was inlined inside two nested
`for` loops. Pulled out as `renderVerbBlock(verb): string[]`. New
helper at 9.

### `src/extensions/rules/trigger-collision/index.ts` — extract `analyzeTriggerBucket` (19 → <8)

The per-bucket ambiguity analysis (advertisers / invocations /
canonical comparison plus the issue construction) was an 80-line `for`
body. Pulled into a free function returning `Issue | null`. New helper
at 9.

### `src/cli/util/plugin-runtime.ts` — extract `accumulateBuiltInScanExtensions` (16 → 9)

The bucketing of built-in extensions by kind (`switch` over
`provider` / `extractor` / `rule` / `hook` inside nested `for`s) moved
into a private helper. Caller passes the buckets object as a
parameter; the helper mutates them in place. The remaining 9 in
`composeScanExtensions` is the env-flag layer that follows, which
still adds branches.

## Net effect on lint

- Previous baseline (after `11c4382`): 81 warnings.
- After this commit: **81 warnings** (no net change — each removed
  monster is replaced by 1 marginal helper at 9-11).
- However, **6 functions dropped below threshold**: `refresh.ts:execute`,
  `init.ts:execute`, `help.ts:renderMarkdown`,
  `trigger-collision:evaluate`; plus `walkAndExtract` and
  `composeScanExtensions` reduced significantly.
- Tests: 602 / 602 green; `npm run build -w src` green;
  `npm run lint -w src` green (0 errors).

## Out of scope

The remaining ~24 warnings are mostly small (10-14 cyclomatic) and
will be tackled in subsequent commits, same one-batch-per-session
cadence.
