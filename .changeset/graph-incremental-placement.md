---
'@skill-map/cli': patch
---

Graph view: place newly-detected nodes around the existing layout instead of on top of it.

Follow-up to the previous "persist all node positions" change. The reconcile effect was reading the new node's coordinate out of a fresh full d3-force simulation, but that simulation didn't see the actual on-screen positions of the existing pinned nodes — they were taken from storage. Result: the new node landed wherever the fresh sim happened to put it, which often overlapped existing cards.

New behaviour:

- **Cold start** (no stored positions yet) — reuses the cached full simulation as before. Single batch.
- **Incremental** (some nodes already pinned, one or more new) — runs a smaller d3-force pass with every existing entry held fixed via `fx` / `fy`, and only the missing nodes free to move. The new ones settle into a non-overlapping spot that respects the existing cards.

The new helper lives in `graph-layout.ts` (`computeIncrementalPositions`); 200 ticks is enough because the bulk of the system is already at equilibrium.
