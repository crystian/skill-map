---
'@skill-map/cli': patch
---

`sm-tutorial` SKILL: heads-up before scaffolding the scenario.

The skill used to start writing files (`demo-agent.md`, `findings.md`, `tutorial-state.yml`, then `.skill-map/` once `sm init` runs) without telling the tester. Now it emits one short, single-sentence FYI at the start of pre-flight Step 3, just signalling that files are about to land. The announcement is non-interactive — the agent does NOT wait for a confirmation, does NOT enumerate the files (details come later when they're relevant), it just gives the heads-up and proceeds straight to the writes.

Also catches a few residual `reveal` mentions in fixture descriptions that the previous vocabulary unification pass missed (the rule of thumb stays "step / sub-step", never "reveal" or "stage" in tester-facing copy or fixture frontmatter).
