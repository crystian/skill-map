---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Rename the tester onboarding verb and its companion Claude Code skill from `sm-guide` to `sm-tutorial` across spec, CLI, bundled materialised payload, runtime state file, and report file. Breaking change to the public CLI surface (`sm guide` is gone — no compat shim); pre-1.0 so it ships as a minor bump per the project's pre-1.0 policy (no major while a workspace stays in `0.Y.Z`).

Spec: `spec/cli-contract.md` — the `sm guide` verb section is renamed to `sm tutorial`. Same shape, same exit codes, same `--force` semantics — only the identifier flips. Materialised file becomes `<cwd>/sm-tutorial.md`; integrity block in `spec/index.json` regenerated.

CLI (`@skill-map/cli`): `sm guide` → `sm tutorial`; `src/cli/commands/guide.ts` → `tutorial.ts` (`GuideCommand` → `TutorialCommand`, `SM_GUIDE_FILENAME` → `SM_TUTORIAL_FILENAME`); `src/cli/i18n/guide.texts.ts` → `tutorial.texts.ts` (`GUIDE_TEXTS` → `TUTORIAL_TEXTS`, all string templates updated to mention `sm-tutorial.md` and `@sm-tutorial.md`); `src/tsup.config.ts` build step `copyGuideSkill()` → `copyTutorialSkill()` writing the bundled payload to `dist/cli/tutorial/sm-tutorial.md` instead of `dist/cli/guide/sm-guide.md`. Test file `src/test/guide-cli.test.ts` → `tutorial-cli.test.ts` with updated regex assertions and SKILL.md byte-match anchor pointing at `.claude/skills/sm-tutorial/SKILL.md`.

Skill: `.claude/skills/sm-guide/` → `.claude/skills/sm-tutorial/`. Frontmatter `name: sm-guide` → `sm-tutorial`. Triggers list updated (`"tutorial", "sm-tutorial", "tutorial me", "start the tutorial"`). Internal whitelist updated (`sm-tutorial.md`, `tutorial-state.yml`, `sm-tutorial-report.md`). Runtime state file renamed `guide-state.yml` → `tutorial-state.yml` (top-level YAML key `guide:` → `tutorial:`). Report file renamed `sm-guide-report.md` → `sm-tutorial-report.md`. Colloquial Spanish "guía" inside tester-facing prose stays where it reads naturally — only identifiers (path names, command names, frontmatter, technical references) flip to `tutorial`.

ROADMAP: setup-and-state verb table updated to `sm tutorial [--force]`.

No backwards-compat alias is shipped: the tester base for this verb is tiny and a clean break is safer than maintaining two names.
