---
'@skill-map/cli': patch
---

The map now draws itself on load: cards fade and rise in staggered along the layout's diagonal, then the edges draw themselves from source to target with the markers popping in as the lines finish. A once-per-mount intro keyed on the first reconciled layout pass (`ui/src/app/views/graph-view/intro.controller.ts`), so nothing flashes at the origin while dagre runs; fully behind the reduced-motion gate and never replayed by live refreshes, lens toggles or view switches.

## User-facing

Opening the map now plays a short intro: the cards appear in a wave across the layout and the links draw themselves between them. It runs once per page load and respects your system's reduced-motion setting.
