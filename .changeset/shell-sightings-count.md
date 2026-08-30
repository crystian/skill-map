---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Shell sightings (a `.md` named in a Bash / `run_command` / `bash` command under capture rung 5) now count as evidence: they add to the node's execution stats, so the node card's execution pill agrees with the inspector's Activity section, and the session-journal fold turns them into `reads` relations for the observed-* finders; the recent-log entry stays tagged `kind: "shell"`. Spec: `provider-activity.md` §Execution stats, §Capture level rung 5, §Session journal.

## User-facing

Files mentioned in a shell command (Bash) now count on the node card's execution counter and count as reads for the observed-link finders, matching what the inspector's Activity section already listed.
