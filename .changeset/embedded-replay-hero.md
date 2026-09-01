---
"@skill-map/spec": patch
"@skill-map/cli": patch
"@skill-map/web": patch
---

The SPA gains a boot-only `?embed=1` flag (spec §Session journal, "Embedded replay") that renders the map canvas alone: no shell chrome, rail, inspector, toolbar or transport, a `?replay=` session loops instead of pausing, the plain wheel is left to the hosting page, a card click opens the full app, `theme=` is honoured without persisting. The public site's hero now frames `/demo/` this way, replacing the SVG simulator and the screen-capture section with the real map.
