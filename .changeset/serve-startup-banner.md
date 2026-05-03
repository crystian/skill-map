---
'@skill-map/cli': patch
---

`sm serve` shows a figlet-style ASCII-art startup banner; non-TTY output is unchanged.

When stderr is a TTY, `sm serve` now emits a hardcoded figlet "Skill Map" block split into a violet upper half and a green lower half, followed by a dim version line right-aligned under the logo and the existing data block (server URL, scope, cwd-relative DB path, browser hint). The URL value is rendered green-underlined to tie back to the lower-logo palette. ANSI styling (256-color violet `\x1b[38;5;141m`, 256-color green `\x1b[38;5;42m`, dim, underline) is gated behind the standard `NO_COLOR` / `--no-color` / `FORCE_COLOR` toggles.

When stderr is a pipe / redirect (e.g. `sm serve | tee log.txt`, CI capture), the banner is suppressed entirely and the verb falls back to the two-line legacy format (`sm serve: listening on …` plus the browser hint) byte-for-byte — existing tooling that scrapes those lines keeps working.

Spec change in `spec/cli-contract.md` § Server documents the boot output, the TTY / non-TTY split, and the color env-var precedence.
