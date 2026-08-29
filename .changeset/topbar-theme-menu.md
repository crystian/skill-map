---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The topbar theme button now opens a menu instead of cycling: Auto, Light and Dark (the three it used to cycle) plus every specialty theme, with the current look checked and the button's glyph naming it (the palette while a specialty theme is on). Picking a specialty theme from there emits `ui.feature.theme-extra` stamped `source: topbar`; `spec/telemetry.md` adds `topbar` to the source set.

## User-facing

The theme button at the top right now opens a menu with Auto, Light, Dark and every specialty theme (Matrix, the Neons, Blueprint, Paper), so you can switch looks without opening Settings.
