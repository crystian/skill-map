---
'@skill-map/cli': patch
---

Tutorial polish + UI fix:

- `expandedNodeIds` GC: brand-new nodes no longer render with the chevron pre-expanded when their path was previously persisted in localStorage. The graph-view now filters the persisted set against the current `loader.nodes()` on every change, dropping orphan ids before they can affect a freshly created node.
- Tutorial Reveal 3 inserted: the tester takes the keyboard for the first time before the connector reveal, edits the `description:` frontmatter of `demo-agent.md` and watches the card refresh live. Closes the "passive observer" gap in the demo and gives the tester muscle memory for the `.skillmapignore` flow that lands in Reveal 5.
- Tutorial copy passes: dropped the bilingual `Spanish / English` pairs from the blockquotes (the `Tone` rule already says the agent translates whole-cloth; the pairs were inducing mid-paragraph spanglish), dropped the obsolete "zoom out if a node lands off-screen" hint (auto-fit on add/remove makes it irrelevant), removed the broken-ref aside from the demo (planted in Stage L4 instead so the lesson is active), config files (`.skillmapignore`, `.skill-map/settings.json`, `.gitignore`) are now off-limits to the agent's `Edit` tool — the tester always edits those, fixture content follows the tester's language while identifiers / paths / code stay English, side-by-side viewing instruction before Reveal 1 so the tester sees browser + chat together.
