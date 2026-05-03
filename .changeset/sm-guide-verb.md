---
'@skill-map/cli': minor
---

Add a new `sm guide` verb that materializes the interactive tester guide as `sm-guide.md` in the current working directory. Companion to the `sm-guide` Claude Code skill: a tester drops into an empty directory, runs `sm guide` to seed the canonical SKILL.md content, then opens Claude Code there and triggers the skill ("guíame") to start the interactive walkthrough. The verb:

- Writes top-level only (`<cwd>/sm-guide.md`, no subdirectory).
- Does NOT require an initialized `.skill-map/` project — runs in any directory, including empty ones.
- Refuses to clobber an existing `sm-guide.md` unless `--force` is passed (exit 2 otherwise).
- Embeds the SKILL.md source-of-truth (`.claude/skills/sm-guide/SKILL.md` at the repo root) at build time via tsup, copying it to `dist/cli/guide/sm-guide.md` for the published tarball; the runtime resolver walks both layouts so dev iteration and the shipped binary read the same content.
