---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The Sessions rail now follows a replay: the step row under the cursor is marked current and scrolled into view, and the session (or agent chain) holding it auto-expands. Cards are draggable while the Live lens or a replay is on: the drag pins the card for the lens session only (force relayouts respect it, nothing is persisted, the pin dies with the lens exit), documented in `spec/map-views.md`.

## User-facing

During a replay the Sessions list highlights the current step and keeps it in view. You can now drag cards around while the live view or a replay is on; the arrangement lasts until you leave it and is never saved.
