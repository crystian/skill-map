---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

A session replay is now a URL: `?replay=<rootOwner>[&agent=<spawnId>][&at=<frame>]` opens the replay at boot (tape first, then the journal) and lands paused on the frame; while a session-scoped replay is on screen the address bar mirrors it (`at` only while paused) and the transport bar's new Copy link hands the URL out. `spec/provider-activity.md` §Session journal documents the addressable replay.

## User-facing

You can now share a replay: press the link button in the replay bar to copy a URL that opens the same session on this project, paused on the exact moment you were looking at (or from the top if it was playing).
