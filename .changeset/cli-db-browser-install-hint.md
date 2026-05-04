---
"@skill-map/cli": patch
---

Improve the `sm db browser` error message when `sqlitebrowser` is not installed: multi-line block, aligned columns, three OS variants (Debian/Ubuntu, macOS, Windows), softer framing ("if you want a GUI…" rather than imperative). The Windows hint links to the official downloads page. The shortcut at root `npm run sqlite` is moved up to sit next to `start` so the daily-use entry points are grouped at the top of the scripts block.
