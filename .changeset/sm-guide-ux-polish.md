---
'@skill-map/cli': patch
---

`sm guide` UX polish: clearer trigger phrase + richer bundled walkthrough.

The verb message and docstring now tell the tester to type `ejecutá @sm-guide.md` (the natural way to load a loose `SKILL.md` in the cwd as a Claude Code skill) instead of the previous "guíame". The bundled `.claude/skills/sm-guide/SKILL.md` got eight pedagogical fixes that ship together: the empty-directory whitelist is now an internal step (the agent reports "Listo, el directorio está limpio" without enumerating ignored items); the invented "4. Event log" UI view is removed (only Grafo / Lista / Inspector exist); a "si no lo ves, hacé zoom" hint was added at the live-edit step; "arista" is replaced by "conector" throughout; the fixture is diversified into a skill (`.claude/skills/demo-skill/SKILL.md`), an agent (`.claude/agents/demo-agent.md`), a hook (`.claude/hooks/demo-hook.md`) and a note (`notes/todo.md`), each with realistic frontmatter so the graph shows the four kinds; a `.skill-map-ignore` is dropped so the scanner ignores the guide's own scratch files; the closing flow offers to write a `sm-guide-report.md` for the tester to send to Pusher (renamed from Crystian); and the live-edit step is rewritten against the new fixture.
