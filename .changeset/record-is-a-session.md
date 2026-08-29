---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Every press of Record is now a new session in the Sessions rail. A session's identity became root owner plus recording: the browser tape stamps each captured frame with its Record gesture and partitions by it, every journal file lists as its own row, a replay is scoped to its recording, and the deep link gains `rec=<recording>`. Before, recordings of the same runtime session merged into one row and hid the separate journal files. `spec/provider-activity.md` §Session journal documents it.

## User-facing

Each time you press Record you get a new session in the Sessions list, even inside the same agent session; earlier recordings stay as their own rows and replay on their own.
