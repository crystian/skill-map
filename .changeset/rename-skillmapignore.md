---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Rename the project ignore file from `.skill-mapignore` to `.skillmapignore` (no dash).

Rationale: drop the dash for consistency with `.gitignore` / `.npmignore` / `.dockerignore` and friends — those tools use a contiguous lowercase token, and adopting the same shape removes the visual stutter when listing dotfiles. The rename also avoids confusion between the public artifact and the package id `@skill-map/*` which uses a dash by convention.

Breaking change pre-1.0:

- `sm init` now scaffolds `.skillmapignore` instead of `.skill-mapignore`. Existing projects must `mv .skill-mapignore .skillmapignore` manually — no compat reader (greenfield rule, see `feedback_greenfield_no_versioning.md`).
- The bundled defaults asset moved from `src/config/defaults/skill-mapignore` to `src/config/defaults/skillmapignore`.
- `sm serve` and `sm watch` now watch `.skillmapignore` (not `.skill-mapignore`) for live filter rebuilds.
- Spec and JSON Schema (`spec/cli-contract.md` § `sm init`, `spec/schemas/project-config.schema.json` § `ignore`) updated; `spec/index.json` regenerated.
- All in-repo fixtures, docs (ROADMAP, context/*, AGENTS.md, web/app.js), tests, and skills (sm-tutorial, foblex-flow indirectly) updated in the same commit.

Historical CHANGELOG entries that reference `.skill-mapignore` are intentionally left untouched — they document past behaviour.
