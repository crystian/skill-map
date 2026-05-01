---
"@skill-map/cli": patch
---

Close audit item SD4 — clean ROADMAP "Step N / Phase N" references from kernel docstrings. 78 refs eliminated or reworded; 22 algorithm-internal "Step N" / "Phase N" comments preserved (they describe numbered steps inside an algorithm, not roadmap milestones — `trigger-normalize.ts`, `scan-persistence.ts:upsertEnrichmentLayer`, `plugin-loader.ts:loadOne`, `orchestrator.ts:detectRenamesAndOrphans` and friends). Updated one assertion in `hook-extension.test.ts` so the test no longer pins the literal string "Step 10" in the deferral message.
