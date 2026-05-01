---
"@skill-map/cli": patch
---

Split `evaluateJsonPath` (complexity 25) and `runConformanceCase` (complexity 20) in `src/conformance/index.ts`. Internal-only refactor — no public API change. Extracted helpers: `traverseJsonPath` (pure walker over a parsed segment list), `applyJsonPathComparator` (justified inline disable for the 4-comparator chain), `runPriorScansSetup` (the priorScans replay loop). Both monsters drop below or just above the threshold; no test regressions.
