---
"@skill-map/cli": patch
---

Graph edges no longer draw a dot marker at their source end. The schema-designer look projected a fixed-size circle at the origin of every static edge alongside the arrowhead at the target, and the dot read as a second endpoint glyph that made the edge direction ambiguous. Static edges now carry only the target arrowhead, matching the spawn edges that never had a source marker.

## User-facing

Map edges lost the small dot at their starting end; the arrowhead alone now shows which node a link points at.
