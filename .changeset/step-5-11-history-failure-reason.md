---
"@skill-map/cli": patch
---

Step 5.11 — `sm history` human renderer now shows `failure_reason`
inline when present, so the human path stops hiding info that's
already in `--json`.

Before:

```
h-008  ...  audit-bar  failed     200ms  50/0     1
h-006  ...  audit-foo  cancelled  50ms   20/0     1
```

After:

```
h-008  ...  audit-bar  failed (runner-error)         200ms  50/0   1
h-006  ...  audit-foo  cancelled (user-cancelled)    50ms   20/0   1
```

`completed` rows are unchanged (no parens noise). The STATUS column
widened from 12 to 30 chars to fit the longest enum
(`cancelled (user-cancelled)` = 26).

Test count: 207 → 208.
