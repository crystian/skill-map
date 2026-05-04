---
'@skill-map/cli': patch
---

Graph view: persist every node's position, not just the manually-dragged ones.

Until now `localStorage` only tracked the override map (nodes the user had dragged); auto-layout positions were re-derived on every load. That meant a freshly created node (via WS scan refresh) could land in a different spot the next time the user opened the UI, even with no drags involved.

A new reconcile effect on `GraphView` keeps `nodePositions` in lockstep with `loader.nodes()`:

- New node detected → seed its position from the auto-layout and persist immediately.
- Node removed (file deleted upstream) → drop its entry from storage.
- Reset layout → clears the map; the same effect repopulates from the current auto-layout on the next tick and writes the whole batch back, giving the "delete → re-arrange → save" loop the button label has always promised.

Single localStorage write per reconcile cycle (gated by a `dirty` check, mirrors the existing `expandedNodeIds` GC pattern). The early-return in `resetLayout()` ("if nothing's overridden, just fit") is gone — under the new model the map is never empty after the first seed, so the early return was dead code.

Also: tutorial deep-dive duration claim trimmed from `~30-40 min` to `~20-30 min` across the SKILL and the three READMEs (root EN/ES + the package's `src/README.md`).
