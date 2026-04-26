---
"@skill-map/cli": patch
---

Three fixes surfaced by the Step 4 end-to-end validation:

- `sm scan` exit code now matches `sm check`: returns `1` only when issues
  at `error` severity exist (was: `1` on any issue, including warn / info).
  Honors `spec/cli-contract.md` §Exit codes. The exit code is now
  consistent across `--json` and the human format — previously the
  `--json` branch always returned `0`, which made an agent loop scripting
  `sm scan --json | jq` blind to error-severity issues.
- `sm show` human output now reports `External refs: <N>` after the
  Weight section. The `--json` output already exposed
  `node.externalRefsCount`; the human format had a parity gap. Rendered
  unconditionally (including `External refs: 0`) for honest reporting.
- `sm scan --changed` no longer drops `supersedes`-inversion links from
  cached nodes. The frontmatter detector emits `supersededBy` edges with
  `source = newer-node` and `target = older-node`; the prior cached-reuse
  filter incorrectly required `link.source === node.path`, which dropped
  these inverted edges (the source path is often not even a real node).
  Repro on the skill-map repo: `sm scan` then `sm scan --changed`
  previously yielded 470 → 468 links; both now yield 470 with the link
  sets set-equal. The fix introduces an `originatingNodeOf(link,
  priorNodePaths)` helper in the orchestrator: for `kind === 'supersedes'`
  it falls back to `link.target` only when `link.source` is not a known
  prior node path, which handles BOTH the inverted case (originating =
  target) and the forward `metadata.supersedes[]` case (originating =
  source). Frontmatter is currently the only detector that emits
  cross-source links — a future detector adding another inversion case
  would escalate to a persisted `Link.detectedFromPath` field with a
  schema bump rather than extending this heuristic.
