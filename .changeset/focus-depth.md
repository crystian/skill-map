---
'@skill-map/cli': patch
---

The map's selection dim is now graded like depth of field: one hop from the selected node stays lit, two hops fade lightly, three and beyond fade deep and desaturate, with edges following their farther endpoint. The same falloff engages around the EXECUTING nodes while Follow the Activity is armed on the curated map, so attention follows the action the way the camera does; the follow toggle now names both (camera and focus). Eases over 400ms, reduced-motion aware.

## User-facing

Selecting a node now fades the map gradually around it: close links stay bright, farther ones dim and lose color. With Follow the Activity on, the same focus wraps whatever your agent is running, so the action stands out while the rest of the map stays as context.
