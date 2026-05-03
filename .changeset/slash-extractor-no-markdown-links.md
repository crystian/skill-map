---
'@skill-map/cli': patch
---

Fix the slash extractor's regex so markdown relative links `[label](./foo.md)` no longer trigger false-positive `broken-ref` issues. URLs (`https://...`), Windows drive letters (`c:/...`), and dotted paths (`domain.com/api`) were also affected — same root cause in the previous-char guard. Switched from a character-class guard to a negative lookbehind that explicitly excludes `.`, `:`, `?`, `#` in addition to the original word / `/` exclusions.
