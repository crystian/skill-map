---
'@skill-map/cli': patch
---

`sm tutorial` success message now surfaces the bilingual trigger phrase as the most visible part of the output, and reminds the tester that the first message they write to Claude sets the tutorial language for the rest of the session.

Before:

```
Done. sm-tutorial.md created at /path. Open Claude Code here and tell it "run @sm-tutorial.md" to start the interactive tutorial.
```

After:

```
Done. sm-tutorial.md created at /path

Open Claude Code here. Write to it in the language you want the tutorial in — the first message sets the language for the rest of the session:

    English:  run @sm-tutorial.md
    Español:  ejecutá @sm-tutorial.md
```
