---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Runtime activity stats now survive `sm serve` restarts: the accumulator checkpoints into two new project-DB tables (`state_activity_stats`, `state_activity_pairs`, `spec/db-schema.md`), hydrates from them at boot, and the Activity clear-all drops the rows too. A shell sighting's frame now carries the node's unchanged stats and the inspector's empty gate honours the recent log, so a node lit by a `Bash` mention shows who named it. Existing project DBs rebuild on their next scan.

## User-facing

Execution counts and the Activity log no longer vanish when you restart `sm serve`, so replaying an older session shows what really ran. Files mentioned in a Bash command now show that mention in their Activity section. Your project database is rebuilt on the next scan.
