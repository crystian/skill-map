---
"@skill-map/cli": patch
---

Split `renderMarkdown` (complexity 19) in `src/cli/commands/export.ts`. Extracted `countIssuesPerNode` (issue index helper) and `renderNodesByKindSection` (the per-kind nodes block with grouping + sorting + rendering). `renderMarkdown` itself drops below the threshold; the extracted section helper sits at 11 (parallel branches over `KIND_ORDER`, manageable). Pure refactor, no public API change.
