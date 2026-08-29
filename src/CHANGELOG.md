# skill-map

## 1.12.4

### Patch Changes

- The replay bar's transport controls (play / pause, step back / forward, copy link, the director camera while on) now paint in the active theme's primary colour instead of the secondary grey or the replay amber; exit, trash and the director while off stay muted; the amber remains the bar's replay chrome. The live execution palette (spine, comets, invocation edges, card ring and halo) now follows each extra theme's own ramp, the rainbow staying the base look.

  ## User-facing

  The replay controls and the glow on running nodes and links now take the colours of your theme (green on Matrix, cyan on Neon B, and so on) instead of a fixed violet rainbow; the default themes keep the rainbow.

- The topbar theme button now opens a menu instead of cycling: Auto, Light and Dark (the three it used to cycle) plus every specialty theme, with the current look checked and the button's glyph naming it (the palette while a specialty theme is on). Picking a specialty theme from there emits `ui.feature.theme-extra` stamped `source: topbar`; `spec/telemetry.md` adds `topbar` to the source set.

  ## User-facing

  The theme button at the top right now opens a menu with Auto, Light, Dark and every specialty theme (Matrix, the Neons, Blueprint, Paper), so you can switch looks without opening Settings.

## 1.12.3

### Patch Changes

- Runtime activity stats now survive `sm serve` restarts: the accumulator checkpoints into two new project-DB tables (`state_activity_stats`, `state_activity_pairs`, `spec/db-schema.md`), hydrates from them at boot, and the Activity clear-all drops the rows too. A shell sighting's frame now carries the node's unchanged stats and the inspector's empty gate honours the recent log, so a node lit by a `Bash` mention shows who named it. Existing project DBs rebuild on their next scan.

  ## User-facing

  Execution counts and the Activity log no longer vanish when you restart `sm serve`, so replaying an older session shows what really ran. Files mentioned in a Bash command now show that mention in their Activity section. Your project database is rebuilt on the next scan.

- The map's selection dim is now graded like depth of field: one hop from the selected node stays lit, two hops fade lightly, three and beyond fade deep and desaturate, with edges following their farther endpoint. The same falloff engages around the EXECUTING nodes while Follow the Activity is armed on the curated map, so attention follows the action the way the camera does; the follow toggle now names both (camera and focus). Eases over 400ms, reduced-motion aware.

  ## User-facing

  Selecting a node now fades the map gradually around it: close links stay bright, farther ones dim and lose color. With Follow the Activity on, the same focus wraps whatever your agent is running, so the action stands out while the rest of the map stays as context.

- The map now draws itself on load: cards fade and rise in staggered along the layout's diagonal, then the edges draw themselves from source to target with the markers popping in as the lines finish. A once-per-mount intro keyed on the first reconciled layout pass (`ui/src/app/views/graph-view/intro.controller.ts`), so nothing flashes at the origin while dagre runs; fully behind the reduced-motion gate and never replayed by live refreshes, lens toggles or view switches.

  ## User-facing

  Opening the map now plays a short intro: the cards appear in a wave across the layout and the links draw themselves between them. It runs once per page load and respects your system's reduced-motion setting.

- A session replay is now a URL: `?replay=<rootOwner>[&agent=<spawnId>][&at=<frame>]` opens the replay at boot (tape first, then the journal) and lands paused on the frame; while a session-scoped replay is on screen the address bar mirrors it (`at` only while paused) and the transport bar's new Copy link hands the URL out. `spec/provider-activity.md` §Session journal documents the addressable replay.

  ## User-facing

  You can now share a replay: press the link button in the replay bar to copy a URL that opens the same session on this project, paused on the exact moment you were looking at (or from the top if it was playing).

- The session replay gained a director camera: with the director on (transport-bar toggle, default on) the camera glides into a close-up of the node each frame is about, holds on frames about nothing on the map, and pulls back to the whole route at the end of the tape. The playback fold carries `trail` (the route in first-touch order), and `spec/provider-activity.md` §Roles and boundary names the replay chrome as UI-owned.

  ## User-facing

  Replaying a session now plays like a film: the camera follows each step up close and pulls back at the end to show the whole route. Turn the director camera off in the replay bar to keep the full route in view instead.

- The Sessions rail now follows a replay: the step row under the cursor is marked current and scrolled into view, and the session (or agent chain) holding it auto-expands. Cards are draggable while the Live lens or a replay is on: the drag pins the card for the lens session only (force relayouts respect it, nothing is persisted, the pin dies with the lens exit), documented in `spec/map-views.md`.

  ## User-facing

  During a replay the Sessions list highlights the current step and keeps it in view. You can now drag cards around while the live view or a replay is on; the arrangement lasts until you leave it and is never saved.

- The executing spine on the map now carries comets: while a static edge lights up because both endpoints execute, bright particles march along it from the caller to the callee, so the direction of the live call reads on the map. A sibling Foblex connection with the spine's own geometry (`ui/src/app/views/graph-view/comet-overlay.ts`), skipped on spawn-active pairs, painted out under reduced motion. `spec/provider-activity.md` §Roles and boundary names the flow as UI-owned spine treatment.

  ## User-facing

  When your agent runs a chain on the map, the lit link between the caller and what it invoked now carries small bright particles flowing in the direction of the call, so you can read who called whom at a glance.

- Two extra themes join the Settings picker: Blueprint (drafting-sheet blue with white ink and a technical grid, on the dark base) and Paper (warm parchment with sepia ink, the first extra theme on the LIGHT base, via a new `forcesLight` registry flag). Same self-contained shape as the neon and matrix themes: one CSS file, one registry entry, per-theme favicon and brand mark. The theme picker became a dropdown with a one-line description per option, the registry outgrew a button strip.

  ## User-facing

  Two new looks under Settings, Theme: Blueprint turns the map into an architect's drafting sheet, and Paper gives it a warm parchment-and-ink feel on a light background. The theme picker is now a dropdown.

## 1.12.2

### Patch Changes

- Live activity gains a mapper digest: the server accumulates, per provider, how many events arrived and how many resolved to nothing, plus the shape of the ones that did not (hook type, tool name, payload key names, never a value). `sm activity status --verify` reports it on each `--json` entry and warns when a provider received events and mapped none, the case the wiring self-test cannot catch because its probe is answered before the mapper runs.

  ## User-facing

  Live map dark while your agent is clearly working? `sm activity status --verify` now tells you whether events are arriving at all, and if they are, what the provider adapter failed to understand about them.

## 1.12.1

### Patch Changes

- The antigravity live-activity adapter maps markdown writes and joins the shell capture rung: `write_to_file` / `replace_file_content` emit write signals (both carry an absolute `TargetFile`, live-characterised on agy 1.1.14), and the opt-in `run_command` hook yields shell path sightings resolved against the command's own `Cwd`. The spec's antigravity row also documents the workspace-trust gate (hooks load only for trusted folders).

  ## User-facing

  On Antigravity, file edits now light the map as writes, and shell capture is available: opt in with `sm activity install antigravity --shell`, pick the Shell level, and .md files named in terminal commands show up in recordings.

- The codex live-activity adapter now maps markdown writes: upstream shipped hook events for `apply_patch`, so the PreToolUse matcher includes it and each `.md` target named by the patch headers becomes a write signal (`access: 'write'`, `detail: 'apply_patch'`). The spec's codex row also documents the 0.147 hook-trust gate (a fresh install fires nothing until the operator trusts the hooks via `/hooks`) and re-verifies the still-open `read_file` gap.

  ## User-facing

  On Codex, file edits now light the map and count as writes in recordings (Codex added hook support for its patch tool). Note: Codex 0.147 asks you to trust hooks via /hooks before any events flow.

- The shell capture rung is available on codex: codex 0.147 reports its shell tool as `Bash` with the claude payload shape, so the shared shell mapper applies and `sm activity install codex --shell` renders the same opt-in `^Bash$` hook behind the same double opt-in. The claude shell mapper moved to the shared adapter util so the two runtimes cannot drift.

  ## User-facing

  Shell capture now works on Codex too: opt in with `sm activity install codex --shell`, pick the Shell level, and .md files named in shell commands light the map, which also catches docs Codex reads via cat or sed.

- The workspace's "files follows the map selection" preference now defaults ON: selecting a node reveals its file in the files rail (highlight, ancestor expansion, scroll into view) out of the box, and the rail's directions-icon toggle persists an opt-out. A previously persisted choice is respected either way.

  ## User-facing

  Selecting a node on the map now also highlights its file in the Files panel by default; use the directions icon in the panel header to turn it off.

- The Settings shell-unlock line is lens-conditioned instead of hardcoding claude: the `GET /api/activity/install` envelope gains `shellOptIn` (whether the provider's descriptor carries the shell opt-in event), and the capture-level row renders the opt-in command for the ACTIVE lens, an "unavailable on this lens" note for providers without the rung, or nothing while the lens probe is unresolved.

  ## User-facing

  The shell capture instructions in Settings now follow your active lens: they show the command for the provider you are actually using, and tell you when that provider has no shell capture instead of suggesting a Claude command.

- The shell capture rung reaches opencode through a plugin-file opt-in dialect: the generated activity plugin carries a `{{SHELL_ON}}` wiring filter resolved at install render, so bash command lines never leave the host process until `sm activity install opencode --shell` re-renders it (closing a posture gap where bash events were forwarded and discarded server-side); once opted in, `.md` paths in bash commands land as shell sightings. All four activity providers now own the rung.

  ## User-facing

  Shell capture now works on OpenCode too: opt in with `sm activity install opencode --shell`, pick the Shell level, and .md files named in shell commands light the map. Without the opt-in, command lines now never leave the OpenCode process at all.

- Shell path sightings (capture level rung 5) no longer count as node executions: the stats accumulator routes them to the typed recent log only, and the spec names the exclusion explicitly. The shell opt-in writers (`sm activity install --shell`/`--no-shell` and the HTTP install body's `shellCapture` field) now refuse a provider whose descriptor carries no shell opt-in event, so the capture-level `shell` selector can never unlock with no capture wired behind it.

  ## User-facing

  Paths mentioned in shell commands no longer count as node executions (they still appear in the recent activity log), and the shell capture opt-in is only accepted for providers that support it (Claude today).

## 1.12.0

### Minor Changes

- New capture-level ladder: one cumulative runtime knob (`executions` < `reads` < `writes` < `mcp` < `shell`, default `mcp`) filtering resolved activity at ingest before stats, journal and broadcast, moved live via `POST /api/activity/capture-level` and persisted project-local (`activity.captureLevel`). Adapters now stamp `access: "write"` on write-shaped tools, recordings carry their minimum `captureLevel`, and the UI gains a selector beside Record plus a Settings mirror.

  ## User-facing

  A capture-level selector next to Record (and in Settings) decides how much detail the live map and recordings keep, from executions only up to reads, writes and MCP calls, chosen before each recording (it locks while one runs). Writes now show as their own access type.

- The session-journal retention ceilings are now project-config keys beside the master switch: `activity.journal.maxFiles` (default 50) and `activity.journal.maxTotalBytes` (default 20 MiB), read once at serve boot and applied oldest-first at boot and each finalization. The journal is the evidence window the observed-* volume gates count against, so keep `maxFiles` at or above the largest `min-active-sessions` in use.

  ## User-facing

  You can now decide how many recorded sessions the project keeps (`activity.journal.maxFiles` / `maxTotalBytes` in settings.json): raise them if your never-runs detector needs a longer memory than the default 50 sessions.

- Browser-local project state (recording tape, node positions, map curation) is now namespaced per project: `sm serve` stamps the scope root into the served `index.html` as a `skill-map-scope` meta and the UI suffixes those localStorage keys with a hash of it, so two projects on one port stop seeing each other's sessions. A `sm.storage-version` gate resets stale layouts per-bump (this one wipes the pre-namespace era whole); `sm.scopes` maps hash to root for debugging.

  ## User-facing

  Recorded sessions and your map layout now stay with their project: serving another folder on the same port no longer shows the other project's recordings. One-time cost on upgrade: node positions, curation and the browser tape reset (recordings on disk are kept).

- The Sessions tab gains a one-time intro note above the Record control stating what recordings are NOT (content-free: structure and timing, never prompts, file contents or results), dismissible machine-wide via the new `ui.dismissedNotes` list in the per-user settings file (`~/.skill-map/settings.json`), carried by the `GET`/`PATCH /api/preferences` envelope.

  ## User-facing

  A small note above Record now explains that session recordings are content-free (what ran and when, never your prompts, files or results). Close it once and it stays closed on every project on this machine.

- The capture ladder's `shell` rung is live, double opt-in: `sm activity install claude --shell` persists the project-local `activity.shellCapture` key and renders an extra `PreToolUse` Bash hook (`--no-shell` or `activity uninstall` retires it, demoting a stored `shell` level to `mcp`), and the capture-level POST refuses `shell` while the key is off. Bash commands naming in-scope `.md` files yield path sightings (`access: "shell"`); the command text is never captured. Claude-only for now.

  ## User-facing

  Recordings can now spot docs touched from shell commands: opt in with `sm activity install claude --shell`, then pick the Shell capture level. Only file paths are kept, never the commands themselves, and the fifth selector position stays locked until you opt in.

### Patch Changes

- AJV now loads lazily through a synchronous `createRequire` seam in the kernel's ajv-interop helper (every construction site was already function-local, so no signatures changed), stays external to the dist bundle, and the user-settings store validates `~/.skill-map/settings.json` against its own single compiled schema instead of the full spec validator catalog. The five bundled boot deps (clipanion, smol-toml, js-yaml, semver, ignore) moved to devDependencies; installs no longer download them.

- The browser-storage reset gate now keys on the serving CLI version: `sm serve` (and the demo bundle) stamps a second `skill-map-version` meta, documented in the CLI contract's serve row, and upgrades wipe only what a crossed layout-break threshold declares, so a normal release keeps saved state. The locked Shell capture option is no longer natively disabled: it renders muted, refuses the click, and its tooltip explains where to enable it.

  ## User-facing

  **The greyed-out Shell option now explains itself.** Hover it to see how to enable it (Settings > Project > Capture level). And upgrading the CLI no longer resets your saved layout and recordings unless the release actually changed how they are stored.

- Perf follow-up: the scan result fingerprint now hashes through a streaming canonical writer (no multi-MB intermediate string per warm scan), and the pure-JS boot dependencies (clipanion, smol-toml, js-yaml, semver, ignore) are bundled into the dist chunks, cutting eager module loads on startup from ~45 to 14 and `sm --version` to ~135 ms on the reference machine.

- Node perf sprint: the tokenizer moved to `gpt-tokenizer` behind a lazy handle (identical counts; a literal `<|endoftext|>` in prose no longer aborts the scan), warm rescans skip the SQLite replace-all via a whole-result fingerprint in `scan_meta` (schema fingerprint changes, so the derived DB rebuilds once after upgrading), the walk overlaps file reads with an ordered 16-deep read-ahead, and startup defers the kysely/sqlite, watcher and conformance subgraphs and enables the V8 compile cache.

  ## User-facing

  Everything got faster: `sm` starts in about half the time, scans are quicker, and rescans of an unchanged project skip most database work. A file containing the literal text `<|endoftext|>` no longer breaks the scan. The project database rebuilds itself once after updating.

- The replay transport's scope chip now shows the session title (the touched-node names) instead of the short session id across the three Sessions-tab entry points (Play session, Play agent, step deep-link). The chip gained a full-label tooltip and a working ellipsis (as a non-shrinking flex item it used to overflow the fixed-width row), and the transport bar widened from 26rem to 30rem.

  ## User-facing

  **Replay names the session.** The floating replay bar now labels a replay with the session's title, the same skill and agent names you see in the Sessions tab, instead of a short id. Long titles clip with an ellipsis and the full name shows in a tooltip.

## 1.11.0

### Minor Changes

- New `core/observed-link-dead` analyzer, the dead-design detector: one `info` issue per declared `invokes`/`references` link that recorded sessions could have observed firing (target an `mcp://` or agent node) but never did, gated on the source having executed at least 3 times (`IAnalyzerContext.observedExecutions`, the journal fold's new per-node run counts). Rows join "Observed in sessions" in the inspector; dismissible, no auto-fixer. Ships `experimental` (disabled until opted in).

  ## User-facing

  skill-map now questions your design in both directions: besides pointing out what your agents used without you mentioning it, "Observed in sessions" also flags declared references that never fired across enough recorded sessions, so you can prune or rework stale links.

- New `core/observed-node-dead` analyzer: one `info` issue per runnable node (skill, agent, command) that never executed in any recorded session, gated on 20 ACTIVE sessions of evidence. All three design-vs-reality gates are now per-extension integer settings (defaults 20/3/3) via `sm plugins config` or Settings. Because the journal files ARE the evidence, the replay trash now clears the browser tape only; the full wipe stays in Settings. The trio ships `experimental` (disabled until opted in).

  ## User-facing

  skill-map can now tell you which skills, agents, or commands never run: after enough recorded sessions, untouched units get flagged under "Observed in sessions". The replay's trash button now only clears the local tape; deleting the saved session files stays in Settings.

- The session-journal fold gains the `reads` relation class (an `access: 'read'` frame correlated to its reading unit by owner), turn-bounded (a `turnEnd` clears the owner's unit claim) and gated against noise: `observed-link-missing` flags a read pair only past 3 observations and accepts a `points` link as coverage, while `observed-link-dead` now judges `references` links toward ANY scanned target (an observed read confirms them; `invokes` links still require an mcp or agent target).

  ## User-facing

  Recorded sessions now track which files your skills and agents actually read: repeated reads of something you never reference get flagged, and a declared reference that keeps being read counts as confirmed instead of dead.

- `sm serve` can now journal runtime sessions to `.skill-map/sessions/` (one content-free JSON per session, captured only while the operator records), and `sm scan` folds the journal for the new `core/observed-link-missing` analyzer: one `info` issue per node observed invoking or spawning a target no declared link covers, under "Observed in sessions" in the inspector, dismissible via the standard suppression. Ships `experimental` (disabled until opted in).

  ## User-facing

  skill-map now remembers your AI sessions on disk and, at the next scan, points out things your agents actually used that your files never mention, under "Observed in sessions", so you can add the missing reference or dismiss the hint.

- New `DELETE /api/activity/sessions` endpoint: empties the session journal (every `.skill-map/sessions/*.json` plus the serve process's open in-memory buffers, one `activity.sessions-clear` operations line, always 204). The UI's delete-recording affordances (Settings row, replay transport trash) now call it together with clearing the browser tape, behind a single confirm that warns the observed-relations evidence for the next scan goes with it.

  ## User-facing

  Deleting the recording now asks first and erases both memories in one gesture: the browser tape and the project's session journal on disk. The warning explains that "Observed in sessions" findings lose their evidence until new sessions are recorded.

- Journal capture is now a GESTURE: `POST /api/activity/sessions/recording` toggles server-side capture (driven by the Record control, surviving reloads), so nothing lands in `.skill-map/sessions/` unless the operator records. New `GET /api/activity/sessions` read-back hydrates the Sessions tab, so sessions recorded before the page opened list and replay off their own frames. Claude wires `SessionEnd` for exact finalization, and the executing-spine dressing no longer misses trigger-style links.

  ## User-facing

  Session files are written only between Record and Stop (recording survives a page reload). The Sessions tab now remembers what was recorded on disk, replayable later or from another browser, and executed-together highlighting no longer misses @trigger links.

### Patch Changes

- The Live lens toolbar cluster is gone (lens toggle, replay toggle, linger window, canvas reset): recording is an explicit Record session / Stop control atop the Sessions tab (the tape captures ONLY between those gestures, never automatically; Real Time keeps lighting the map regardless), the same control turns into an amber Exit replay while one runs and mounts stop-only above the Files search, the lens accumulates from each recording's start, and Sessions paginates past 100 rows like Queue.

  ## User-facing

  Recording moved into the Sessions tab: press Record session to capture and watch live, Stop to finish; nothing records on its own anymore. While a replay runs the button becomes Exit replay (also shown atop Files), and long session lists paginate like the queue.

- New Sessions tab in the workspace rail: the activity recording is folded into a list of runtime sessions (one per conversation), each expandable into its agent tree (who spawned whom, with per-agent stats), with a Play button that replays that session, or a single agent branch, inside the Live lens. The replay transport shows which slice is playing, frames the tape cannot attribute land in an explicit drawer, and the tab stays available while the lens is on.

  ## User-facing

  New Sessions tab next to Files and Queue: every AI session your map observed, with the agents each one spawned. Press Play on a session (or a single agent) to rewatch exactly what it did on the map, without re-running anything.

## 1.10.1

### Patch Changes

- The Live lens incremental layout now pins the nodes it has already placed (d3-force `fx`/`fy`) instead of re-simulating them, and keeps the whole-cloud centring forces for the cold-start run only. A node joining the live set used to nudge every other node, which read as flicker; survivors now hold their exact position and only the newcomers settle.

  ## User-facing

  The Live lens map no longer jitters: when a new file starts executing, the nodes already on screen stay exactly where they were instead of drifting around it.

## 1.10.0

### Minor Changes

- The Live lens gains a session replay: a recorder tapes every activity frame the page receives (bounded ring, page-lifetime), and a new transport in the map replays the whole session one event per second under an amber REPLAY frame, with play/pause, a scrubber, single-event stepping and a ticker narrating each event. The replayed state is a pure fold in virtual time (same claim semantics as the live glow), so scrubbing is instant and nothing re-executes.

  ## User-facing

  Replay your session on the map: the Live lens now records what your AI did and can play it back, one event per second, with a scrubber to jump anywhere. Watch nodes light up and calls appear exactly as they happened, without re-running anything.

### Patch Changes

- New Live lens mode in the graph view: a toolbar toggle narrows the canvas to the nodes the AI runtime is executing plus the recently-executed ones inside a configurable linger window (5 minutes by default, no-limit option, one-click reset), with automatic layout, camera framing, dragging disabled and a red on-air frame. Links that actually fired (invocations, spawns, executing chains) persist instead of expiring with their live TTLs; exiting restores the curated map exactly.

  ## User-facing

  New in the map: the Live lens. Toggle it from the bottom toolbar to watch only what your AI is executing right now, plus what ran in the last 5 minutes (or keep everything until you reset). The calls between files stay drawn, and exiting brings your map back untouched.

- The Live lens replay tape now survives a reload: the recorder mirrors it into localStorage (`sm.live.recording`) and hydrates at boot, so a refresh or a later visit keeps the history. Nothing expires it by age; the operator owns its lifetime through a new Settings row (with an events + size readout) and a delete shortcut in the replay bar. The mirror is double-bounded by event count and characters so it can never crowd the other stored preferences out of the origin quota.

  ## User-facing

  Your session recording now survives a page refresh, and it stays until you delete it: Settings, Project shows how much is stored with a Delete button, and the replay bar carries the same shortcut.

- The Live lens now scopes the whole workspace, not just the map: the files rail lists only the files seen executing (the same membership the canvas paints, so the replay narrows it as the tape advances) and shows its own "nothing has executed yet" state instead of the filters one, while the Queue tab is disabled for the duration and an open queue panel falls back to files.

  ## User-facing

  The live lens now also narrows your file list to what the AI actually touched, so the panel and the map tell the same story. The Queue tab stays out of the way while the lens is on.

## 1.9.1

### Patch Changes

- New path-derived graph layouts, and "Folder (compact)" becomes the default a map opens with. Column is path depth, edges are ignored, and the two variants differ only in where a folder's own files go: level with the folder, or under its subfolders like the files panel lists them. Both use their own tighter gaps, since a layout that draws no edges reserves no room to route them. They answer the case dagre cannot: few references means every node lands in rank 0, one endless column.

  ## User-facing

  Two new layouts arrange the map like your file tree instead of by links, and "Folder (compact)" is now what a new map opens with. If you already picked a layout, yours is kept.

- The MCP registration rows (Quick Start and Settings > Project) hold the "paste it into <file>" instruction back until the snippet has actually been copied, so the hint line reads copy, then the clipboard confirmation, then where the document goes. The target is gated on a sticky flag, so it survives the button's two-second confirmation instead of flashing past with it.

  ## User-facing

  The MCP row no longer tells you where to paste a config you have not copied yet. Click Copy, and once the "Copied to the clipboard" confirmation fades the row names the file the snippet belongs in.

- Plugin-load warnings are emitted exactly once per `sm serve` boot. The composition root is now the single emission point (it used to gate its own line behind `--no-watcher` while two route factories printed the full warning list at registration time), so a project carrying an untrusted drop-in no longer repeats the "found but not loaded" notice at startup.

  ## User-facing

  Starting `sm` on a project with an untrusted plugin now prints the "plugin found but not loaded" warning once instead of twice.

- Fix a race in the graph view's selection/URL sync that could re-open the inspector on the node you had just closed. The writer mirrors the selection into `?path=`, and the reader could not tell that query-param change from an incoming deep link, so whenever it first observed the param after the selection had already been cleared it "restored" it. The writer now claims the value it pushes and the reader swallows its own echo; genuine deep links are unaffected.

- The two scoped single-file reads, the job-submit drift verification and the incremental scan's reread of unchanged nodes, now honour `scan.followExternalSymlinks` like the scan walk. Before, both ran on the gate's default: a node indexed through an authorised external symlink was scannable but not operable (submits refused it as "file missing") and a live re-scan could silently blank its content. The spec's §Submit step 8 now names the discovery config alongside the parser rules.

  ## User-facing

  Files reached through an allowed external symlink can now be operated: submitting jobs against them works, and live re-scans no longer risk wiping their content from the map.

- The unreadable-node submit refusal now diagnoses and names the actual cause instead of a generic "file missing or not readable as a node": a deleted file, a broken symlink, permission denied, or an external symlink blocked by settings, each with the remedy that applies to it (the old blanket "run sm scan" advice was wrong for half of them). The full sentence is authored once in the submit engine, so the CLI, the fan-out lines, the BFF envelope, and MCP `submit_job` all carry it.

  ## User-facing

  When a job submit fails because a file cannot be read, the error now tells you what actually happened (deleted, broken symlink, no permission, or a link blocked by settings) and how to fix that, instead of a generic message.

## 1.9.0

### Minor Changes

- Map views gain a shared list order: a new optional `order` field in `map-view.schema.json` (contract in `spec/map-views.md` §Ordering and shortcuts) drives the `GET /api/map-views` sequence (order ascending, absent last, slug tiebreak), the switcher list is drag-reorderable (renumbering compactly and re-writing only the changed view files), and the first nine positions surface their digit-shortcut number on the row.

  ## User-facing

  Drag views up and down in the view selector to order them; the order is saved in the view files, so your team gets the same sequence. The first nine views show their number and keys 1-9 switch straight to them.

- Named map views: human-curated map topology (visibility overrides plus pinned node positions, with a reserved groups surface) now persists as committed files under `.skill-map/views/<slug>.json` per the new `spec/map-views.md` contract and `map-view.schema.json`, written and served through the new `GET/PUT/DELETE /api/map-views` endpoints; the web UI gains a view switcher with save, save as, exit views, a dirty-switch confirmation (`ui.confirmViewSwitch`) and `?view=` deep links.

  ## User-facing

  You can now save the map you curated as a named view and commit it, so your team gets the same map: same hidden folders, same pinned nodes. Switch views from the new selector on the graph, share one with a link, and save changes explicitly when you are ready.

### Patch Changes

- UX round on the workspace map: the map-views glyph is now the eye (switcher trigger and rail view chip), the graph toolbar's Show-all button was replaced by an eraser reset in the files rail's curation strip (shown for manual curation too, routing through the guarded view exit when a view is active), exiting a view no longer rearranges the canvas (pins stay put, revealed nodes seed from auto-layout), and the bezier connector style was removed (a legacy stored value falls back to the default).

  ## User-facing

  **Workspace map polish.** The Show all button moved from the map toolbar to an eraser icon on the files rail, leaving a view keeps your layout in place instead of rearranging it, view menus now wear an eye icon, and the Bezier connector style is gone (it doubled Adaptive curve).

## 1.8.0

### Minor Changes

- Line numbers in findings and link locations are now file-absolute (the frontmatter block is counted, matching the editor), the inspector's Raw view shows the on-disk file verbatim via the new `GET /api/nodes/:pathB64?include=raw` so its gutter lines up with the reported `L<n>`, and a middle-mouse pan on the graph background no longer clears the current selection.

  ## User-facing

  Line numbers in findings (L12) now match your editor: they count the frontmatter block. The inspector's Raw view shows the whole file including the frontmatter, so its line gutter lines up. Panning the map with the middle mouse button no longer clears your selection.

### Patch Changes

- The slash and at-mention token grammars now require at least one letter in the identifier, so purely numeric prose tokens (`total /10`, `@10/20`) no longer produce false-positive reference-broken findings; digit-leading names (`/2fa-setup`) and numeric filenames (`@10.md`) keep matching. Mirrors the guard the dollar grammar already had for currency.

  ## User-facing

  Fractions and scores written in prose ("total /10", "@10/20") are no longer mistaken for command or mention references, so they stop showing up as broken-reference errors.

## 1.7.0

### Minor Changes

- `sm activity status` gains `--verify`, a wiring self-test that pushes one synthetic probe event through the installed activity bridge and asks the running server whether it arrived, so a crashing bridge, a dead server or a stale `serve.json` stops reading as a green `installed`. Backed by a new `GET /api/activity/probe` readback plus a `__skillMapProbe` short-circuit in `POST /api/activity` that keeps probes from lighting nodes or counting as executions. Failing verdicts exit 1.

  ## User-facing

  `sm activity status --verify` now proves your live-activity wiring actually works: it sends a test event through the installed bridge and reports whether the server received it, instead of showing a green check while the map stays dark.

## 1.6.7

### Patch Changes

- The inspector's AI finding rows now sort by confidence descending inside each severity tier, instead of leaving same-severity rows in the tray's arrival order. Severity remains the primary key (error, warn, info) and equal-confidence rows keep their incoming order; the deterministic issue rows above them are unchanged, they carry no confidence.

  ## User-facing

  In the Findings card, findings of the same severity are now listed with the most confident ones first.

- Dismissing a deterministic analyzer issue now sticks across scans for every analyzer, not just `core/reference-broken`. The orchestrator applies `annotations.issueSuppressions` centrally, dropping any emitted issue whose `(analyzer, data.target)` pair matches an entry on one of its anchor nodes before it reaches the accumulator; `core/reference-broken` keeps its inline check only to skip the confidence penalty.

  ## User-facing

  Dismissing an issue used to work only for broken references: for every other kind (redundant references, self-loops, reserved names, schema violations, extractor collisions) the issue came back on the next scan. Dismissals now stick for all of them.

- The active lens is now a cache input. Each scan records it in `scan_meta.active_provider` (new column, mirrored on `ScanResult.activeProvider`) and the next one rebuilds every node when it differs, since the lens decides per-node classification and gates provider-specific extractors. This catches a lens changed out of band, where the `scan_*` drop performed by `sm config set activeProvider` never runs. The walker's `tokenizerChanged` flag generalises into `cacheInvalidatedBy`.

  ## User-facing

  If the active tool changes without going through Settings (a hand-edited or pulled config), the next scan now re-reads the whole project instead of keeping files labelled under the old tool.

- An incremental scan no longer re-attributes unchanged nodes to the active lens. The mtime fast path skips `classify`, so it now reuses the prior node's provider the same way it already reused its kind, instead of binding the node to whichever provider's pass reached it first; a prior provider that stopped participating falls through to a real reread plus classify. That mis-paired `(provider, kind)` was also what made a re-extracted node emit a spurious `frontmatter-invalid: no-schema`.

  ## User-facing

  Re-scanning a project no longer relabels plain markdown files with the active tool's badge, and no longer invents a "frontmatter failed schema validation" warning on files that have no frontmatter at all.

## 1.6.6

### Patch Changes

- The UI's AI submit gate now fails closed at boot (superseding the 2026-07-26 fail-open call): an unknown skill reading disables every submitting affordance with a 'Checking your agent setup...' tooltip until the automatic probe confirms the setup, while a green check verdict or an observed answer still opens it; the inspector's AI actions also re-fetch their launcher catalog when Settings closes, so plugin and skill-action toggles apply to the open node immediately.

  ## User-facing

  **AI actions wait for your agent check.** The AI action buttons now start disabled with a 'Checking your agent setup' hint until skill-map confirms your agent is ready, and the panel refreshes as soon as you close Settings, so toggles you flip there apply right away.

- Graph multi-selection now survives its own gestures: releasing a Shift+drag rectangle no longer clears the set (the background-click deselect ignores clicks that conclude a drag), Ctrl/Cmd+click toggles nodes without collapsing to a single selection, dragging any selected node moves the whole group and keeps it selected, and Escape clears a lingering multi-selection.

  ## User-facing

  On the map you can now select several nodes at once (Shift+drag a rectangle, or Ctrl/Cmd+click) and drag them together; the selection stays after you drop them. Press Escape or click empty canvas to clear it.

- Skill actions: agent skills installed under the project's private `.skill-map/.agents/skills/` catalog (skills.sh installer) are discovered at `sm serve` boot and run as per-node probabilistic jobs. New `spec/skill-actions.md` contract plus canonical report schema; `prob-extensions` gains an optional `skills` bucket, the BFF job submit accepts `skill:<name>` targets, and the inspector's AI actions card gains a Skills group. The CLI submit grammar for `skill:` stays reserved.

  ## User-facing

  New Skills group in the AI actions panel: install agent skills into your project's .skill-map folder (npx skills add) and run them on any node; each run's report lands in the executions history. The server picks up newly installed skills on restart.

- Skill actions gain a project-local offering toggle, `skillActions.enabled` (default false, opt-in), surfaced in Settings > Project below the external-symlinks opt-in: while off, the prob-extensions `skills` bucket stays empty and `skill:` submits refuse not-found; the key is read fresh per request so flips apply without restarts. The root READMEs (EN/ES) document the catalog folder and install command.

  ## User-facing

  New Settings > Project toggle: Skill actions (off by default). Turn it on to offer installed skills in the AI actions panel; the setting text explains where skills live (.skill-map/.agents/skills/<name>/SKILL.md) and that new installs load on server restart.

## 1.6.5

### Patch Changes

- The map now flashes a node once (~1s, theme primary color) when the live watcher detects its file changed on disk, gated by the new project-local `ui.changeSpark` preference (default on) and suppressed around agent activity so the executing glow never double-flashes. `scan.started` now reports its real `{ mode, roots }` payload (`changed` on watcher file-change batches, `full` otherwise) and `scan.progress` documents the actual per-node shape with `cached` / `partialCache` semantics.

  ## User-facing

  **See file changes on the map.** When a file changes on disk (your editor saving, a git pull), its node now flashes briefly in your theme color so you notice the update. Your agent activity glow always wins. Turn it off in Settings > Project with Flash on file changes.

- Confirmation dialogs now share one global width band (512-1024px, viewport-capped): every PrimeNG confirm gate plus the sidecar-consent, crash-report, and action-prompt dialogs. The consent dialogs' former `:host ::ng-deep` sizing never reached their body-portaled dialog root, so they stretched as wide as their copy, while the follow-symlinks gate sat below the new floor.

  ## User-facing

  Confirmation dialogs (like the companion-file write consent) no longer stretch across the whole window: they now stay between 512 and 1024 pixels wide, sizing to their content within that range.

- The files rail's file and folder rows and the inspector header gain an Ignore button that appends a root-anchored pattern to the project-root `.skillmapignore` through the existing `PATCH /api/project-ignore`, fronted by a confirmation dialog whose don't-ask-again checkbox persists the new project-local `ui.confirmIgnore` key (default `true` = ask); duplicates resolve silently, demo mode hides the buttons, and the gesture rides telemetry as `ui.feature.ignore-path`, never the path.

  ## User-facing

  **Ignore files without leaving the map.** Ignore a file or folder right from the files list or the inspector header: a new button adds it to `.skillmapignore` after a confirmation, with a don't-ask-again option. Bring it back anytime from Settings > Project.

- The inspector's AI Actions section now renders the Standalone launcher group above Finders, so single-action buttons surface before the two-state Detect/Fix pairs.

- Rule 6 of `spec/telemetry.md` §Per-incident crash-report consent now excludes UI module-load failures: a dynamically imported chunk that fails to fetch (the three browser phrasings, matched on the error message) never opens the crash-report consent dialog, since the crash is environmental (serving process gone or a stale cached shell) with nothing actionable to report; the UI early-returns on that class and the error still reaches the console.

  ## User-facing

  **No crash-report prompt when the server is gone.** If a page fails to load because `sm serve` is not running (or the browser kept an old copy of the app), skill-map no longer asks to send a crash report; the server being unreachable is not a bug worth reporting.

## 1.6.4

### Patch Changes

- The global rendered-markdown prose family in `ui/src/styles.css` is renamed from `.inspector__body-rendered` to the shared `.sm-md-prose` and now also styles the conversation dialog's bubbles, whose `pre` blocks previously kept browser-default `white-space: pre` and forced horizontal scroll on the whole dialog; the prose `pre { overflow-x: auto }` confines long lines to their own scrollable block.

  ## User-facing

  **Conversation dialog readability.** Code blocks in agent prompts and responses now scroll inside their own box instead of stretching the dialog sideways, and messages render with proper markdown styling (headings, tables, code).

- The claude and opencode live-activity adapters now capture markdown WRITES (Claude `Write`/`Edit`, opencode `write`/`edit`) alongside reads: an in-scope `.md` write emits the same filter-first PATH signal, with the literal tool name riding the existing `detail` field so the UI badge tells reads apart from writes; the installed claude hook matcher widens accordingly, while codex and antigravity writes stay unmapped per the spec rows.

  ## User-facing

  **Edits light the map too.** When your agent writes or edits a markdown file, the map now lights that node the moment it happens, with a Write/Edit badge, instead of waiting for the next rescan. Re-run the activity hook install (or repair from Settings) to pick it up.

## 1.6.3

### Patch Changes

- `core/backtick-path` now stamps its signals with the code-region `context` (`inline-code` / `code-block`) like the trigger siblings do, so `core/link-self-loop`'s usage-example exemption finally applies to backticked paths: a file naming itself in a code span (a `SKILL.md` or `AGENTS.md` self-mention) no longer warns as a self-loop. The trigger resolution gate stays kind-gated, so unresolved `points` paths keep flagging `reference-broken`; the spec's Emission contract documents the stamp.

  ## User-facing

  **No more false self-loop warnings on self-mentions.** A document that names its own file inside backticks (a usage example, like a skill citing its own SKILL.md) no longer gets flagged as a self-reference loop.

## 1.6.2

### Patch Changes

- Refresh the CLI dependency graph to apply audited security fixes and restore the supported TypeScript toolchain pins.

## 1.6.1

### Patch Changes

- Repair the two test suites the executing-tool badge broke (the activity endpoint's custody frame now expects `detail: 'Agent'`; the graph-view harness stubs the new `executionDetails` signal), and gate `main` npm releases on the `ci` workflow finishing green (workflow_run trigger with an npm no-op guard) so a red build can no longer publish.

## 1.6.0

### Minor Changes

- The activity contract adds `DELETE /api/activity/node/<pathB64>`: one call clears a node's persistent AI-run history, its runtime stats and pair counters, and its retained spawn conversations, logging `activity.clear` to the operations log. The CLI ships it end to end: the storage port's targeted `history.deleteForNode`, the BFF route (no consent, regenerable machine data), and a Clear all button in the inspector's Activity section. The GET row's documented runs cap is corrected to 15.

  ## User-facing

  **Clear a node's activity in one click.** The inspector's Activity section adds a Clear all button that deletes everything recorded for that node: run history, live counters and captured agent conversations. The section empties right away and refills as new activity arrives.

- While a node glows in the live map, a small badge on the card now names the literal tool that lit it (Claude `Skill` / `Read` / `Agent`, Codex `spawn_agent`, Antigravity `view_file`, opencode `skill` / `read`, plus MCP tool names). The existing `detail` field carries it end to end; `spec/provider-activity.md` §detail blesses unit-frame detail and moves the invocation-edge gate to the `mcp://` node path.

  ## User-facing

  **See which tool lit a card.** While a node glows during a live session, a small badge on the card names the exact call that triggered it: a skill invocation, a file read, a subagent spawn, or the MCP tool. It fades with the glow.

- New finder/fixer pair `core/ai-prose-to-rules-analyzer` + `core/ai-prose-to-rules-action` (stable, enabled): the finder flags spans where two or more normative directives hide inside narrative paragraphs and its finding detail carries the extracted checklist ready to paste; the fixer applies the conversion in place. `ai-structure-analyzer` ceded the prose-should-be-a-list territory in the same change, narrowing its axis to placement, ordering and hierarchy.

  ## User-facing

  New AI action: skill-map now spots rules buried inside paragraphs (musts, nevers, step orders) and proposes them as an explicit checklist you can apply with one click, alongside the other finders in the inspector.

### Patch Changes

- Both path grammars accept a hidden first segment now: a backticked `.claude/minions.md` and an `@.claude/minions.md` token emit their links instead of silently matching nowhere (the word-character anchor rejected the leading dot, so paths under `.claude/`, `.codex/` or `.agents/` produced neither a link nor a reference-broken issue). The pinned grammar in `architecture.md` documents the widening; URLs, placeholders and double-dot typos stay rejected.

  ## User-facing

  References to files under hidden folders like `.claude/` now draw their arrows on the map, both as backticked paths and as @-mentions. Before, they were silently ignored.

- The `node.prob-extensions` entry gains an optional `findingsMaxSeverity` (highest OUTSTANDING severity for the pair, `null` when nothing is pending). The inspector renders it as a per-launcher verdict mark, the Findings card gains severity filter chips, a Dismiss-all over the visible AI findings and a Delete-all over a revealed bucket, its rows sort error before warn before info, the header shows the node's tokens and bytes, and the queue lists jobs in strict enqueue order.

  ## User-facing

  Findings filter by severity and dismiss (or permanently delete) in one click, and each AI action shows what it still has pending, turning into a green check once everything is resolved. The queue lists newest jobs first, and the inspector header shows the file's tokens and bytes.

## 1.5.1

### Patch Changes

- The inspector's Body section adds an Expand button next to the Raw / Rendered toggle: it opens the full node body in a large modal dialog (node name in the header, same toggle flipping the shared session-sticky view, same rendered / raw content with no extra fetch). Because the dialog portals to `<body>`, the rendered-markdown prose rules and the dialog chrome moved from the inspector's scoped styles to global `ui/src/styles.css`; the card-vs-dialog layout split stays scoped.

  ## User-facing

  **Read the whole document comfortably.** The inspector's Body section has a new Expand button that opens the full document in a large dialog, with the same Raw / Rendered switch in its header. The view you pick sticks for the session, in and out of the dialog.

## 1.5.0

### Minor Changes

- `sm scan` is now incremental by default: with a persisted prior snapshot, unchanged nodes are reused and only changed files re-extract (`--full` forces a complete re-extraction; `--changed` stays as an explicit alias). Startup also sheds fixed costs on every verb: the server import is deferred to `sm serve`, spec validators compile on first use, the tokenizer is built once per process, the serve watcher reuses the boot plugin runtime, and the bundle code-splits.

  ## User-facing

  Scans are now incremental by default: repeat scans reuse unchanged files and finish much faster (use --full for a complete rescan). Every sm command also starts noticeably faster.

### Patch Changes

- The walker's symlink cycle guard was a walk-global visited set, so the first directory link to reach a target claimed its realpath and every later link to the same target was silently dropped, when the contract promises in-tree links are always followed. Cycle detection is now a per-branch ancestor chain (sibling links each yield their own subtree), with a hard cap on symlinked-directory entries so a hostile diamond link graph cannot make the walk exponential. Spec wording clarified to match.

  ## User-facing

  Two folder symlinks pointing at the same target now both appear on the map; before, only the first one scanned showed up and the other vanished silently.

## 1.4.0

### Minor Changes

- The liveness probe no longer targets a project file. A probabilistic Action can now declare `probNodeless`: submits skip target resolution and drift verification and enqueue against a synthetic `sm://<extension-id>` id, through the new `POST /api/jobs` or `sm jobs submit <ext>` with no `-n`. `core/ai-ping-action` declares it, so a question about the AGENT stops failing when the file it happened to aim at was deleted since the last scan. The claim / record circle is unchanged.

  ## User-facing

  Checking whether an agent is answering no longer fails with a "cannot be read from disk" error when a file in the map has been deleted, and now works in a project you have not scanned yet.

- The agent-liveness verdict now waits for the ANSWER instead of the claim. A `job.claimed` is a receipt: an agent parked on `sm jobs claim --wait` picks a job up within one poll cycle, so the Check probe and `GET /api/agent/presence` both reported "an agent is answering" before the model had read a line of the prompt. Only `job.completed` / `job.failed` count now; a claim moves the check into a second phase with its own longer window, and a claimed-but-unanswered ping reports that distinctly.

  ## User-facing

  The "Agent waiting for jobs" check no longer turns green the instant your agent picks the ping up. It waits for the agent to actually answer, shows "picked it up, waiting" in between, and tells you when something took the job but never came back.

- Providers can now declare how an operator registers skill-map's MCP server with their runtime, through a new optional `mcpRegister` manifest block (a shell command, or a config document plus its paste target, with `{{url}}` bound to the live endpoint). It travels in the envelope `providerRegistry` and drives the Copy affordance in Quick Start and Settings, replacing a client-side catalog keyed by provider id under which every other lens, drop-in Providers included, copied the bare endpoint URL.

  ## User-facing

  The MCP Copy button now gives the right setup line for whichever agent you are using, including agents that come from a plugin of your own, instead of falling back to just the server address.

### Patch Changes

- Review pass over the answers-not-receipts liveness change, closing the receipt-based signals the first cut missed: the MCP `claim_job` attempt no longer flips `attending` (an agent announcing itself has answered nothing; the hook and its plumbing are removed), the UI submit gate heals on `job.completed` / `job.failed` instead of `job.claimed`, and the nodeless `sm jobs submit <extension>` form is now documented in the CLI contract.

  ## User-facing

  An agent connected over MCP no longer shows as "answering" the moment it asks for work; like everywhere else now, it counts once it actually answers a job.

- Two surfaces that ignored project-local reality. `sm agent` and the processing-agent gate built their scaffold catalog from the built-in Providers alone, so `sm agent install` refused with "the active lens declares no skill directory" under a lens whose plugin declared `scaffold.skillDir`; both read the composed Provider set now. And `sm scan --dry-run` persisted the auto-detected lens, leaving a settings file behind; it writes nothing.

  ## User-facing

  `sm agent install` now works under a lens that comes from one of your own plugins, instead of claiming it has nowhere to install. And `sm scan --dry-run` no longer leaves a settings file behind.

- The `sm serve` console now prints skipped-for-size files as a list, one `path (size)` row per line, the same shape `sm scan` and `sm watch` already print. It used to join them with commas into a single line, which is exactly where the UI banner's "see the full list in the console" sent the operator when more than six files were skipped.

  ## User-facing

  When files are skipped for exceeding the size limit, the server console now lists them one per line instead of cramming them into a single run-on line.

- The skipped-files banner's CTA now performs the fix instead of navigating to it: "Add to ignore" appends every skipped file to `.skillmapignore` in one click (root-anchored exact paths, merged into the existing pattern list through `PATCH /api/project-ignore`), and the watcher restart that write already triggers rescans and clears the banner on its own. The former "Open Project settings" CTA is gone; raising `scan.maxFileSizeBytes` stays available in Settings > Project.

  ## User-facing

  When files are skipped for exceeding the size limit, the banner button now adds them to the ignore file directly, and the map rescans by itself, instead of just opening Settings.

## 1.3.0

### Minor Changes

- Settings > Project gains an MCP registration row: the ready-to-paste snippet for the active lens (a command, or a config document plus its paste target) and a Copy button, reusing the catalog the Quick Start modal already uses. Both agent-facing rows now show a restart line naming that agent: the MCP one once the snippet is copied, the skill one once an install or update writes the file. Row order regrouped: skill install, MCP Server, MCP registration, symlink opt-in.

  ## User-facing

  Settings now shows the exact line your agent needs to reach skill-map over MCP, with a Copy button, right under the MCP Server switch. Installing the skill or copying that line also reminds you to restart your agent, since agents read both only at startup.

### Patch Changes

- `GET /api/mcp/status` verifies attendance instead of counting tracked sessions. A session ends only on `DELETE /mcp` or shutdown, which the reference SDK client never sends, so every agent that ever attached left one behind and the probe reported it as connected until the next `sm serve` restart. It now pings each session and counts only responders, reaping those that stay unreachable and silent past a grace window. Spec: `mcp-server.md` §Session liveness.

  ## User-facing

  Quick Start's "MCP installed on your agent" check no longer reports a connected agent when none is running. It now asks the agent to answer before saying yes, so closing or killing your agent turns the row red on the next Check instead of staying green until you restart `sm`.

- The node card's expand chevron now stops `mousedown` / `touchstart`, so the graph's pointer-down selection no longer fires when the card is expanded or collapsed; the `click`-time `stopPropagation` ran too late to prevent it.

  ## User-facing

  **Expanding a card no longer opens the inspector.** Clicking the chevron on a card in the map now just expands or collapses it, without selecting the node and popping the inspector panel open.

## 1.2.4

### Patch Changes

- The first scan (`sm init`, and the bare `sm` bootstrap that delegates to it) now prints the same summary block `sm scan` does, counts row plus database path, instead of its own one-line `First scan: 9 nodes, 9 links, 2 issues.` variant. That line also led with a red `✕` whenever any issue was at error severity, which read as "the scan failed" on a scan that succeeded. The renderer moved to `cli/util/scan-summary.ts` and both verbs call it.

  ## User-facing

  The first scan after setup now reports its results in the same format as every later `sm scan`: nodes, links and issues split by severity, then the database path. No more red mark on a scan that worked.

- New `GET /api/github-stars`: the star count, read by the SERVER (unauthenticated, cached 6h) and not the browser, since the token-free limit is 60/hour per IP and every tab spends the same budget. Shows as a Star link in the topbar and a badge on the About CTA; anything unknown collapses to `count: null` and renders NOTHING, since skill-map must work offline. Opt-out in Settings → General. Also fixes `writeUserSettings`, whose merge listed its sub-objects by hand and dropped new preferences.

  ## User-facing

  The top bar now shows how many stars skill-map has on GitHub, and clicking it opens the repository. It disappears by itself when you are offline, and you can turn it off in Settings → General.

- The topbar brand is clickable: the mark opens skill-map.ai, the wordmark opens the GitHub repository, both in a new tab with `rel="noopener noreferrer"` and each with its own accessible name (the mark's image is decorative, so its link would otherwise be unnamed). The two URLs moved to `i18n/project-links.ts`, shared with About. Also widens the node-activity TTL decay waits to 500ms behind `afterTtlDecay()`; they were a coin flip on a loaded machine.

  ## User-facing

  The logo and the skill-map title in the top bar are now links: the logo opens the website, the title opens the GitHub repository, both in a new tab.

## 1.2.3

### Patch Changes

- Materialised skill folders no longer land in commits. `sm agent install` and `sm tutorial` drop a `.gitignore` (a bare `*`, which hides the file itself too) inside the folder they create, same doctrine as `.skill-map/.gitignore`: the rule lives in the directory it describes, the project-root `.gitignore` is never touched. Creation only, never over an existing file, and out of the staleness comparison so deleting it stays an opt-out. The default scan ignore also gained `sm-tutorial/`.

  ## User-facing

  The skill folders `sm agent install` and `sm tutorial` create are generated copies, so they now ship a `.gitignore` that keeps them out of your commits, and the tutorial folder no longer shows up in your map. Delete that file if you would rather commit it.

- The plugin enable toggle no longer restates the defaults in `settings.json`. `sm plugins enable / disable` and the `PATCH /api/plugins...` routes skip a per-extension `enabled` key whose state the id already resolves to without it, drop one that turned redundant, and sweep the layer they write for keys left by the previous always-write behaviour. A `--local` re-enable over a committed `false` still persists. Spec: `architecture.md` §Locality.

  ## User-facing

  Turning a plugin off and back on used to leave a line behind in `.skill-map/settings.json` for every flip. Now the file only keeps the settings that actually differ from the defaults, and it cleans up the leftovers the next time you toggle anything.

- An outdated agent process skill now announces itself in Settings instead of waiting to be found. The chassis reads `ProcessingAgentReadinessService.skillUpdateAvailable` and marks the Project sidebar row with an attention dot; the row itself takes a stripe, an "Update available" chip and a warn-toned action. New `--sm-attention` token, orange rather than the amber severity-warn: an older skill is a pending action, not a finding.

  ## User-facing

  Settings now shows an orange dot next to Project when your agent process skill is older than the one shipping with this version, and the row explains why. The dot clears as soon as you update.

- The Settings resolution dialog had two nested scrollbars: the table sat in its own `max-height: 60vh` scroll box inside PrimeNG's already-scrollable dialog content. The wrapper is gone, so the dialog content is the single scrollport and the sticky column header sticks against it. The layer chip also renders `project-local` as `LOCAL`, which reads at chip size where the raw id did not.

  ## User-facing

  The "Settings resolution" panel now has a single scrollbar instead of two, and the config layer column shows LOCAL instead of the harder-to-read PROJECT-LOCAL.

## 1.2.2

### Patch Changes

- Correct the published README's developer-commands block: it claimed CI runs `pnpm validate` (untrue since CI split into parallel `cli` and `ui` lanes), described the root orchestrator rather than the workspace-local one a reader standing in this package would get, and announced "two extra scripts" above a list of four. Each entry now says what it does and where it runs from. Documentation-only change, no runtime behaviour affected.

## 1.2.1

### Patch Changes

- The MCP integration spec's wall-clock budget for the `notifications/resources/updated` round-trip (`src/server/__tests__/server-mcp-integration.spec.ts`) goes from 4s to 15s, in line with the 8s waits the sibling WebSocket spec already uses. The delivery path is synchronous and the test measures 40-180ms locally, so the budget is a hang backstop rather than a latency assertion, and a contended CI runner starved it past 4s anyway. Test-only change, no runtime behaviour affected.

## 1.2.0

### Minor Changes

- Adds the `match-list` input-type (twelfth in the settings catalog: literal, regex, and gitignore-style glob entries) and gives `core/reference-broken` an `ignored-references` setting: matched targets skip both the issue and the confidence penalty. Editable from the Settings plugins panel or `sm plugins config core/reference-broken`, stored in the committed project settings, covered by the new `reference-broken-ignored` conformance case.

  ## User-facing

  **Ignore known-dead references.** You can now tell the broken-reference check to skip targets you know are fine: add exact values, patterns, or wildcards under Settings, Plugins, reference-broken. Matching links stop being flagged, and the list is saved with your project.

- Plugin settings debt pass: the `secret` `envVar` override is now real (a non-empty env value wins over the stored one, the config table reports `[env]`, the UI shows the secret as set), the `github/enrichment` base-URL overrides became writable (project-local-only keys now route to `settings.local.json` from both the CLI and the UI), `sm plugins doctor` gained an `unknown-input-type` warning, and the spec stopped describing secrets as encrypted. Details in `spec/input-types.md`.

  ## User-facing

  Plugin secrets (like the GitHub token) can now come from an environment variable, handy for CI, and the GitHub Enterprise URL overrides can finally be saved from Settings or the CLI (they land in your local, uncommitted config).

- New built-in plugin `test-plugin` with one extension, `showcase`: a settings showcase declaring one setting per input-type in the closed catalog, so every control can be exercised end to end (Settings form, CLI writes, resolver validation, storage routing). Ships disabled by default (deliberate opt-in, no experimental badge); enable with `sm plugins enable test-plugin/showcase`. A companion spec pins the showcase to the full catalog, so a future input-type cannot ship without joining it.

- `sm tutorial --completed <part-id|book>` is a new silent milestone ping the bundled sm-tutorial skill runs at each part close and at the final wrap-up: no scaffolding, no empty-cwd requirement, exit 0 always, out-of-catalog ids collapse to `unknown`. The opt-in `cli.tutorial` usage event carries the milestone as `tutorial_part` (and as the URL / Screen value `tutorial:<id>`), so tutorial completion becomes observable by part name. Contract in `spec/cli-contract.md` and `spec/telemetry.md`.

### Patch Changes

- The BFF no longer reads `process.env` directly: `sm serve` snapshots it once into the required `IServerOptions.settingsEnv` knob (lint-enforced under `server/**`). Plugin-settings writes now append operations-log lines (`config.set` / `config.reset`, key only, CLI and UI channels), and `sm plugins config <id> <setting> --reset` correctly removes a project-local-only override (e.g. the github `apiBaseUrl`) instead of failing with exit 2.

- The scan benchmark's perf budget (`BUDGET_MS` in `src/__tests__/integration/scan-benchmark.spec.ts`) doubles from 10s to 20s after a 10.48s trip on WSL2 under heavy parallel suite load; the isolated baseline on the same machine is ~1.4s, so the budget still catches order-of-magnitude regressions while absorbing worst-case host contention. Test-only change, no runtime behaviour affected.

- UI review-pass fixes: string values on the generic `ui.feature` channel now collapse inside the event builder (a third-party plugin id can no longer leak through a call site), consent-gated toggles (capture, follow-symlinks) emit usage events only once the confirm dialog or write resolves, re-clicking the active Changelog / About tab no longer re-emits, and the match-list editor gains inline over-256-char and duplicate-entry errors plus collision-free DOM ids for same-label settings.

  ## User-facing

  **Stricter ignore-list editing.** When adding entries to a plugin's match list in Settings (like reference-broken's ignored references), a value over 256 characters or an entry already in the list is now flagged right at Add time instead of failing the whole Apply later.

- Security-audit hardening of the UI telemetry surface: the UI scrubber regains the CLI's project-root collapse (the /api/health cwd threads into the Sentry beforeSend and the crash-dialog preview), short deterministic analyzer ids collapse through a closed built-in set before riding usage events, the crash dialog previews an honest truncated JSON summary for non-Error rejections, plugin secret inputs stop password-manager save offers, and the match-list editor dedupes seeded duplicates.

  ## User-facing

  **More private crash reports.** The crash-report dialog now redacts your project folder's name from anything it sends, shows a real summary even for non-standard errors, and plugin secret fields in Settings no longer trigger your password manager's save prompt.

## 1.1.0

### Minor Changes

- Usage telemetry reshaped after dogfooding: a successful `sm jobs claim` emits no event (its `cli.record` carries the signal), `--help` / `--version` report as `cli.help` / `cli.version`, and the UI catalog was rebuilt: `ui.view.*` and the inspector event are gone in favor of `ui.app.start`, gesture-level `ui.feature.*`, `ui.filter`, and `plugin.apply`. UI events stamp `$screen_name` and drop the localhost URL props, so the URL / Screen column reads the gesture. Taxonomy in `spec/telemetry.md`.

- Opt-in usage telemetry now attaches the job's extension id as PostHog's `$screen_name` on the queue-lifecycle events (`cli.jobs` submit / claim, `cli.record`), so the events report names the involved finder / fixer in the URL / Screen column at a glance. Third-party ids still collapse to `external_plugin`, and the value duplicates what `extensions` already carried, so nothing new leaves the machine. Taxonomy documented in `spec/telemetry.md` §Usage event taxonomy.

### Patch Changes

- The interactive cache-rebuild prompt on DB drift (`sm scan` / `sm serve` on a version-skewed or schema-changed cache) now defaults to Yes: the suffix reads `[Y/n]`, a bare Enter rebuilds, and only an explicit `n` / `no` declines. The rebuild is safe (the cache is derived from `.sm` files) and declining dead-ends the verb, so Yes is the right default. Documented in `spec/db-schema.md` §Schema drift.

  ## User-facing

  When skill-map warns that your local cache is from an older version, just press Enter to rebuild it, the prompt now defaults to Yes. Nothing of yours is touched; the cache is rebuilt from your files.

## 1.0.1

### Patch Changes

- Republish the stable line as 1.0.1, the first installable stable pair: 1.0.0 is burned on both packages (`@skill-map/spec@1.0.0` was squatted by a premature 2026-04 publish that npm refuses to overwrite, and `@skill-map/cli@1.0.0` shipped pinning it, failing at boot with ENOENT; that version is deprecated on the registry and `latest` was rolled back to 0.99.1 during the incident). No code changes ride this bump.

  ## User-facing

  1.0.0 was dead on arrival (it paired the new CLI with an ancient spec package and failed at boot); 1.0.1 is the real first stable release. If you installed 1.0.0, reinstall with `npm i -g @skill-map/cli`.

## 1.0.0

### Major Changes

- Plugin storage Mode B is gone: the dedicated-table wrapper, the plugin migration runner and its SQL namespace validator (793 lines) are removed, along with `sm db migrate`'s plugin pass and its `--plugin` / `--kernel-only` flags. The kernel migration half of that verb is untouched. A plugin manifest declaring `storage.mode: "dedicated"` is no longer valid; `mode: "kv"` is unaffected and keeps its four-method accessor.

- First stable release of the reference implementation, published alongside spec 1.0.0. The CLI implements the full v1 contract (scan, watch, serve, jobs, findings, plugins behind the pre-import enable gate, and the conformance runner) and follows semver against the frozen v1 standard from here on, ending the pre-1.0 breaking-changes-as-minors policy.

  ## User-facing

  skill-map 1.0, the first stable release. Everything you use daily (scans, the map, jobs, plugins) now sits on a frozen contract: future updates stay backward-compatible until a 2.0.

### Minor Changes

- Hardening pass from a security audit of `src/`. Terminal sanitisation now covers the 8-bit C1 controls, the Unicode line separators and the bidi overrides, closing a clipboard write and a filename spoof that carried no ESC byte. `allowNetworkActions` moves to the project-local config layer, the chokidar watcher refuses symlinks escaping the scan roots, a malformed `.skillmapignore` line warns instead of aborting the scan, and `--plugin-dir` announces that it loads code untrusted.

  ## User-facing

  Hostile filenames can no longer repaint your terminal or disguise what a file is called. A broken line in `.skillmapignore` warns instead of killing the scan. `allowNetworkActions` is now per-machine: re-enable it with `sm config set allowNetworkActions true`.

- The conformance runner validates every case document against `conformance-case.schema.json` at load, before any scope is provisioned or child spawned; a malformed case fails with `case-invalid` naming the violation instead of surfacing as confusing downstream behaviour. A sweep test audits every bundled case in all six scopes, and the gate immediately caught three synthesized test cases missing a required field.

- `sm conformance run` gained `--case <id>`, narrowing a run to a single case searched across the selected scopes. An id matching nothing exits 2 rather than reporting a clean sweep of zero cases, so a typo in CI cannot go green forever. The summary now counts the scopes that actually ran instead of the ones selected, which keeps `totals.scopes` in agreement with the `scopes` array beside it.

  ## User-facing

  `sm conformance run --case <id>` runs a single case instead of the whole suite, so you can iterate on one without waiting for the rest.

- The conformance runner implements `parallel` and `sleepAfterMs`. Parallel children are spawned asynchronously in a plain loop with no await between them, so every process exists before any is collected, which is what makes the race real. Mixing per-result assertions with `parallel` (or a `parallel-*` assertion without it) fails at the top of the run with zero side effects, before any scope is provisioned or child spawned.

- The conformance runner implements the four new case-format fields: `schemaPointer` resolves a subschema through AJV's registered `$id` so a `$def`'s relative `$ref`s still resolve, `each` validates array elements and rejects an empty array rather than passing vacuously, `expectExit` lets a staging step declare a non-zero exit, and `capture` binds JSONPath values from a step's stdout into `{{name}}` placeholders in later arguments and flags.

- The conformance runner implements `setup.serve`, `http-matches-schema` and `ndjson-line`. The serve child is spawned with `--no-watcher` on port 0, readiness is polled on `serve.json`, and teardown is an awaited SIGTERM with a SIGKILL fallback inside the same finally that removes the scope, so the child can never outlive the case. HTTP assertions carry a 10s abort timeout, and declaring one without `setup.serve` fails the case loudly as an authoring error instead of skipping.

- Thirteen contract violations fixed and gated: five verbs missing the `elapsedMs` their contract requires, and eight writing human receipts to stdout under `--json` (human mode is byte-identical). Separately, `process.exit()` fired with bytes still queued on stdout, so over a PIPE any payload above 64 KB was silently truncated mid-document; `sm scan --json | jq` and `sm help --format json | jq` were losing data while redirecting to a file hid it.

  ## User-facing

  Piping a large `--json` output into another tool no longer truncates it at 64 KB. `sm scan --json | jq` used to cut off mid-document while writing the same output to a file worked fine.

- `sm plugins doctor` gained the `recommended-action-missing` warning the spec already promised: an action whose `precondition.analyzerIds` names an analyzer no loaded plugin declares now surfaces a non-blocking diagnostic instead of failing silently. Resolution spans the whole registry, so a cross-plugin reference is fine. The `applicable-kind-unknown` warning is renamed `precondition-kind-unknown` after the field it actually reads, and gained the tests it never had.

- The `sm refresh` verb is now `sm enrich` (command, texts catalog, report schema, envelope kind and operations-log slug all follow); the old name is removed, not aliased. Separately, `sm scan <some-file.md>` used to fail with "does not exist or is not a directory" about a file that plainly exists; a path that exists but is a file now gets its own message explaining that roots are directories and naming the two verbs that do narrow (`sm enrich`, `sm scan --changed`).

  ## User-facing

  `sm refresh` is now `sm enrich`. And pointing `sm scan` at a single file no longer claims the file does not exist: it explains that scan roots are directories and tells you which command to use for one node.

- `github/enrichment` gained `apiBaseUrl` and `rawBaseUrl` settings, honoured ONLY from the gitignored `settings.local.json`: the operator's token rides the Authorization header to whatever the API base says, so a committed override in a cloned repo would exfiltrate it on the first refresh. The conformance runner also serves `setup.staticServe` fixtures and spawns every staged child asynchronously, fixing a latent deadlock.

- Extensions get a diagnostic channel: the kernel binds `ctx.log` onto every Extractor, Analyzer, Action and Hook context. It routes to the kernel logger (stderr, so a chatty extension can never corrupt a `--json` payload the way `console.log` does), strips ANSI escapes and control bytes from extension-authored text, and prefixes every line with the qualified extension id so no extension can emit a line that reads as kernel output.

- Clipanion's built-in version command claimed `-v` as well as `--version`, so `sm -v` printed the version and `sm -v <verb>` died with "unknown command", and any global flag typed before the verb was swallowed into `sm serve`. `-v` is the verbose counter everywhere now. The UI's bump chain listened for a WS event the server no longer emits, so an inspector bump refreshed nothing; it consumes `action.applied` now. `sm history --extension` also takes a bare id again.

  ## User-facing

  `sm -v scan` and `sm --json version` now work: `-v` used to print the version instead of raising the log level, and a flag typed before the verb failed with a confusing "serve" error. Bumping a node from the inspector also refreshes the view again.

- `sm help --format json` now describes the CLI it actually is. Clipanion's `definitions()` silently drops any option that declares no `description`, folding it into the usage string, so 78 real flags were invisible to the surface the contract calls normative (`jobs submit` published none of its seven). Exit codes were missing on all 79 verbs and `globalFlags` listed one of six. Human `--help` and `--format md` were lying identically and are fixed with it.

- The `job.spawning` hook trigger is gone. It named the pre-spawn of a runner subprocess that the pull-only decision removed in July, and it outlived that removal in the runtime trigger list without ever being dispatched: a plugin could declare it, pass load-time validation, and never fire. The spec schema always listed the other nine, so this aligns the implementation with the published contract rather than changing it.

- Raising the log level opened an almost empty room: one `debug` call in the whole codebase and no `trace` at all. The four paths an operator needs when something looks wrong now speak: plugin discovery and per-plugin skip reasons at `debug`, and at `trace` the per-node Provider/kind claim, the extractor cache hit-or-rerun count, and which drop reason `core/reference-broken` applied to a broken edge. Hot loops guard on a level check so silenced lines build no strings.

- Dismissing an issue with an analyzer id that does not exist is now refused on all three faces (CLI exit 2, HTTP 400, MCP invalid-params) before anything is written. It used to succeed silently and plant a permanent, never-matching `issueSuppressions` entry in the node's committed `.sm` sidecar, so a typo became repo state. Undismiss deliberately does NOT validate: a stale suppression whose plugin was uninstalled must stay removable.

  ## User-facing

  Dismissing an issue with a misspelled analyzer name is now refused instead of silently recorded. Before, the typo was written into the node's committed `.sm` file and never matched anything.

- The plugin KV store now enforces a hard 4 MiB budget per plugin per scan, rejecting the write that would cross it with `KvBudgetExceededError` and persisting nothing. The per-value 1 MiB ceiling bounded nothing on its own, since an Extractor runs once per node and a plugin on a large tree could stay under it on every call while growing the project database without limit. A rejected write does not consume budget, so the plugin is throttled rather than bricked, and the scan continues.

- `sm graph --format mermaid` and `--format dot` now work, as does `sm export --format mermaid`. The CLI contract had documented all three since before any existed, so they failed with exit 2 and "No formatter registered". Output is deterministic and escaped against each language's real rules: Mermaid ids are synthetic because `-` and `.` are edge-token characters, and DOT escapes the backslash before the quote so a path cannot render as the node name.

  ## User-facing

  `sm graph --format mermaid` and `--format dot` render the map as a diagram you can paste into a GitHub markdown file or feed to Graphviz. `sm export --format mermaid` does the same for a filtered subset.

- Error reporting moves to per-incident consent: when a verb crashes on an interactive terminal, or an unhandled error hits the UI, skill-map now asks whether to send that one report (with a scrubbed-payload preview), defaulting to Yes; an explicit no always wins and nothing is remembered between crashes. Auto-capturing Sentry integrations are gone on both surfaces, making verb-boundary errors reportable at last; non-interactive runs auto-send only with the persisted opt-in.

  ## User-facing

  When something crashes, skill-map now asks right there whether to send that one anonymous error report, and can show exactly what would be sent. Enter (or 60s of silence) sends; saying no always wins, applies to that report only, and is never remembered against a future crash.

- The Mode A plugin KV store now exists and is wired. `ctx.store` exposes the four methods `plugin-kv-api.md` has always required (`get` / `set` / `delete` / `list`) over `state_plugin_kvs`, scoped per plugin and optionally per node, behind a new `pluginKvs` storage port. Until now only `set` existed and nothing populated `ctx.store`, so it was `undefined` on every real scan; a regression test drives an extractor through `runScan` to pin the wiring itself.

- Usage events now name the extensions involved beyond the scan: `cli.enrich` carries the ids its deterministic pass refreshed, and `cli.jobs` (submit / claim) plus `cli.record` carry the job's extension id, deduped with third-party ids collapsed to `external_plugin`. Both telemetry scrubbers (CLI/BFF and UI) also mask the values of the `path` / `search` URL query parameters as `<masked>`, so a `$current_url` like `/?kinds=skill&path=...` no longer leaks the node path.

  ## User-facing

  Usage analytics (if you turned them on) now report which extensions ran on enrich and queue operations, still names only. URLs in telemetry no longer include your node paths or search text; those query values are replaced with a mask before anything leaves the machine.

- The log level can now be set once per machine, as `logLevel` in `~/.skill-map/settings.json`, instead of retyping `--log-level` or exporting an env var. It sits at the bottom of the precedence chain (`-v` counter, then `--log-level`, then `SKILL_MAP_LOG_LEVEL`, then this, then the `warn` default), so a standing preference never fights a one-off invocation, and `sm serve` inherits it like every other verb.

  ## User-facing

  Tired of typing `--log-level debug`? Put `"logLevel": "debug"` in `~/.skill-map/settings.json` and every `sm` command on this machine picks it up. Any flag or env var on a single run still wins.

- `-v` goes back to being the `--version` alias it is in every other CLI. A `-v` / `-vv` / `-vvv` verbosity counter had claimed it, which both broke that universal expectation and left `sm -v` with no verb to run, so it fell into the bare `sm serve` fan-out and hung. Verbosity is now only the named parameter, and `--log debug` is accepted as a short form of `--log-level debug`. An argv of nothing but global flags no longer launches a server either.

  ## User-facing

  `sm -v` prints the version again, instantly, instead of quietly starting a server and hanging. To raise the log level use `--log debug` (or `--log-level debug`); the `-v` / `-vv` / `-vvv` counter is gone.

### Patch Changes

- `sm help` (json / md) now publishes the boot-level `--log` / `--log-level` global flag, closing an introspection gap; `sm check` renders unknown `--analyzers` ids as the standard error-plus-hint block; `sm scan --help` describes the active-provider-lens pipeline instead of the retired fixed extension set; stale `-v` verbosity mentions in docstrings now say `--log`; and the unused `typanion` dependency is gone.

  ## User-facing

  `sm help` now lists the `--log` / `--log-level` flag, `sm scan --help` describes the current scan pipeline, and mistyping an analyzer id on `sm check --analyzers` shows the usual error style with the valid ids right below.

- Dragging a node on the map no longer opens the inspector. Foblex selects the node under the pointer on pointerdown and reports it once the drag threshold is crossed, bypassing the click handler's drag guard. The graph now rejects selections reported while the flow host carries `f-dragging` and re-asserts its own selection when the drag settles, so moving a node leaves selection untouched and a plain click still opens the panel.

  ## User-facing

  Dragging a node around the map no longer opens the inspector panel. Moving a node just moves it; a plain click still opens it.

- Terminal sanitisation moves from the log call sites into `Logger` itself, so ANSI escapes and control bytes are stripped from every message and every context value on the way to stderr instead of wherever an author remembered to wrap the interpolation. Eleven sites had grown their own wrapper and two interpolating ones had been missed. Measured at ~136 ns per line, which is nothing against a stream write.

- The telemetry allow-list was missing `github`, a built-in that ships with the CLI, so its extension ids collapsed to `external_plugin` and its usage was misreported as third-party. Two guard tests now pin both directions: no id may be in the list unless the CLI actually ships it (the direction that would leak), and every shipped built-in must be in it (the direction that only costs signal).

- An architecture review pass over the bundled UI: the graph camera's deferred fits now key on a reconciled-layout tick instead of sibling-effect creation order, the topbar update chip surfaces the literal install command when a clipboard write is blocked instead of failing silently, branch-scoped live refreshes queued behind an in-flight fetch no longer escalate to a full reload, and the Queue tab loads as its own lazy chunk.

- Hardens the bundled UI per a security audit: provider manifest colors are validated at the CSS sink that binds them (degrading to the neutral fallback), the markdown renderer binds a dedicated DOMPurify instance instead of configuring the process-wide singleton, `track` and `form` join the sanitizer's forbidden tags, and the `ng serve`-only `demo` Angular configuration is renamed `dev-demo` so the deployed demo can never be pointed at it.

## 0.99.1

## 0.99.0

### Minor Changes

- The backtick-path grammar was the last holdout of a bug class already fixed on the `@`-token grammar: its relative prefix was capped at one level, so `../../ui/context/theme.md` matched at no start position and produced neither a link nor a `reference-broken` issue. Both grammars now pin the same prefix construct. The link-target probe also checks scan-root containment before it stats, refusing an escaping target unread; that rule moved to `kernel/util/path-containment.ts`, now shared.

  ## User-facing

  **A path that walks up more than one folder is no longer ignored.** Write `../../ui/context/theme.md` in a skill or agent file and it now shows on the map as a link; if it points nowhere you get a broken-reference error instead of silence.

### Patch Changes

- `sm activity install claude` wrote the bridge path cwd-relative (`node .skill-map/activity/bridge.js claude`) on the premise that hooks always spawn at the project root, so an agent that changed directory mid-session made every later hook die with `MODULE_NOT_FOUND`. The `json-hooks` install descriptor gains an optional `projectDirEnvVar` and Claude declares `CLAUDE_PROJECT_DIR`, so the command anchors on the runtime variable. Codex and Antigravity keep the relative form.

  ## User-facing

  **Claude Code activity hooks survive a change of directory.** Live-activity hooks no longer stop working once the agent moves into a subfolder of your project. If you installed them already, re-run `sm activity install claude` to pick up the new wiring.

## 0.98.0

### Minor Changes

- A drop-in extension's module is no longer imported unless its plugin is trusted and both the plugin and that extension are enabled. The four declarative fields (`version`, `description`, `stability`, `defaultEnabled`) moved to a per-extension `extension.json` beside `index.*`, so the decision no longer needs the code it governs; declaring them in the module is now `invalid-manifest`, `sm plugins upgrade` migrates them, and an untrusted plugin's inventory becomes listable. Built-ins are exempt.

  ## User-facing

  **An extension you switch off no longer runs.** Its code is not even read until you trust the plugin and turn that extension on. `sm plugins list` now shows everything a plugin ships (ids, kinds, versions, maturity) before you trust it, instead of reporting `0 ext`.

### Patch Changes

- `toExtensionRow` dropped `stability` / `defaultEnabled` from every built-in registry row, and `bucketing.ts` never copied them onto user-plugin rows, so `installedDefaultEnabled` read `undefined` for both and answered "enabled": `github/enrichment` (experimental) and `core/node-bump` (`defaultEnabled: false`) registered on a project with no config at all. Execution was never affected, since those gates read live instances rather than rows, so the bug was registry visibility.

  ## User-facing

  `sm help` and the plugin registry no longer list extensions that ship switched off, such as the GitHub enrichment and the version bump. They appear once you enable them.

## 0.97.1

### Patch Changes

- The Quick Start "MCP installed on your agent" row stopped borrowing the MCP server's on/off health, the fact the row above already reports: repeating it here painted this row green while its own detail line read "no agent attached yet". It owns its live-connection probe again ("Not checked yet" until Check, then "Connected" / "Not connected yet"), and an unconnected verdict explains that an agent working the queue over the CLI never opens a session.

  ## User-facing

  The Quick Start MCP row no longer reports itself as done before you check it. It stays "Not checked yet" until you hit Check, then says whether an agent is really connected, with a note explaining that an agent working the queue over the CLI never opens a connection.

## 0.97.0

### Minor Changes

- The `sm plugins` management family (`list` / `show` / `enable` / `disable` / `trust` / `untrust` / `doctor` / `config`) now honours the import-trust gate instead of importing project-local plugin code unconditionally, which made `sm plugins list` the shortest clone-and-scan path to a hostile repo's code and `sm plugins trust` run the code it was asking consent for. Manifest fields survive the gate, `--plugin-dir` stays exempt, and the spec drops its stale `config_plugins` trust references.

  ## User-facing

  **Untrusted plugins stay unexecuted everywhere.** Every `sm plugins` command, `list` included, refuses to run a project-local plugin's code until you have trusted it. You still see its id, description and path; `sm plugins trust <id>` unlocks the rest.

- Closes a critical clone-and-scan vulnerability. Plugin import trust and the privileged project-local config keys lived inside `.skill-map/`, defended only by a `.gitignore` the repo author writes, so a hostile repo could ship a pre-granted plugin (arbitrary code on first scan) or a pre-enabled `scan.followExternalSymlinks`. Both now live in a scope lock anchored to that directory's filesystem identity, which git cannot transport, so a grant made elsewhere never verifies.

  ## User-facing

  Security fix. Plugins and privileged local settings now only take effect where you approved them, so a repo you clone cannot pre-approve its own. After upgrading, re-run `sm plugins trust <id>` for plugins you use, and re-apply any local setting that stops taking effect.

- The map's render cap now fills by selection seniority: with the root excluded and two or more includes, `/api/branch` orders nodes by the first include (in `path=` request order) that admits them, then path, so folders selected first keep their nodes when a later selection overflows the cap; every other scope shape keeps plain path order. The include order travels the whole pipeline and the spec gains the normative Seniority fill rule under §Map scope overrides.

  ## User-facing

  When your folder selection has more nodes than the map can draw, the folders you selected first now stay on the map and the newest selection fills whatever room is left, instead of everything competing alphabetically.

- Errors escaping a verb now render a concise error block on stderr and exit 2 instead of Clipanion's generic exit 1 (which collided with the public `1 = issues found` contract); declining a destructive confirmation (`sm db reset` / `db restore` / `orphans undo-rename`) is now a voluntary no-op (exit 0, info line) per the new spec §Destructive confirmation; and the operations log now covers `refresh`, `db.*`, `orphans.*`, and `config.*` (key only, never the value).

  ## User-facing

  **Cleaner exits.** Answering "no" to a destructive prompt (like `sm db reset`) now cancels cleanly with an info line instead of an error, and an unexpected crash prints one concise error message instead of a stack dump.

### Patch Changes

- The map's render-cap banner now shows only while the CURRENT selection overflows the cap (`branch.truncated`); the corpus-wide fallback that kept the message up after narrowing to a fitting folder is gone, and the copy opens with "This selection has N nodes" instead of "This folder" since the rail scope can span several folders.

  ## User-facing

  The map's node-cap banner no longer lingers after you narrow to a folder that fits, and its copy now says "this selection" instead of "this folder".

- CLI human output now sanitizes the stored and model-authored strings it interpolates: the jobs family renders through a shared terminal-safe row view, and `sm record`, `sm sidecar`, `sm bump` and `sm db migrate` sanitize the tags, paths, reasons and ledger labels they echo. `sm jobs preview` sanitizes its rendered content while `sm graph` formatter output stays byte-exact, a split the spec now states on the `sm jobs preview` row. `sm plugins upgrade` adopts the standard glyph blocks.

  ## User-facing

  **Terminal output is safer to read.** Text that `sm` quotes back from your project database or from an agent's report can no longer smuggle escape codes into your terminal, and `sm plugins upgrade` now prints the same check marks and error blocks as the rest of the CLI.

- The project-preferences 412 consent envelope now carries the exposed folders as structured `error.details.paths` (new `ConfirmRequiredError` in the BFF), so the UI consent dialog for reference paths actually enumerates them instead of rendering an empty list. Also repairs the `--sm-text-muted` theme token (consumed in 36 places but undefined in light/dark/matrix, so muted text rendered at full strength), mirrors title-only settings badges for screen readers, and bumps Foblex Flow to 19.1.6.

  ## User-facing

  **Consent dialog now lists the folders it would expose.** Adding a reference path outside your project shows the exact folders in the confirmation dialog instead of an empty list, and hint text renders properly muted again in the light, dark, and matrix themes.

- Selecting a node no longer makes the whole graph lurch left and glide back while the inspector opens. The a11y focus move onto the opening panel scrolled the overflow-hidden canvas wrap to reveal the still-sliding-in panel; the focus now passes `preventScroll` so the camera stays put.

  ## User-facing

  Fixed a visual glitch where opening the inspector made the whole map shift left and slide back in under a second.

- Images in rendered markdown come back as click-to-load placeholders, replacing the outright drop from the previous entry. The markdown-it `image` rule now emits an inert chip naming the image and the host the request would go to (interactive in block renders, static inline), and the new `[smMarkdownImages]` directive swaps in an `<img referrerpolicy="no-referrer">` only on a real click; `img` stays in the sanitizer's forbidden tags as the backstop.

  ## User-facing

  **Images in rendered markdown now load on click.** Instead of disappearing, an image in a document body shows a placeholder naming it and the site it comes from; click it to load. Nothing is fetched until you do, so opening a file still tells its author nothing about you.

- The rendered-markdown sanitizer now forbids `img` outright. Markdown bodies are author-controlled (a cloned repo's files, sidecar annotations, agent-written prompts), so `![x](https://attacker/pixel.png)` fired an outbound request the moment the operator opened the node, leaking their IP and view timing to the content author, the same beacon channel `css-guard.ts` already refuses for `url(...)`. Deliberate trade: an image in a body disappears instead of degrading to alt text.

  ## User-facing

  **Images in rendered markdown are no longer loaded.** Opening a file from a repo you cloned can no longer tell its author your IP address or when you read it. The trade-off: an image embedded in a document body now disappears instead of rendering.

- Rendered markdown now passes raw HTML through a hardened sanitizer instead of escaping it at the parser, so `<details>`, `<div align>` and `<picture>` embeds render instead of showing as literal tags. Image rewriting moved from the markdown-it rule to a DOMPurify hook, so a raw `<img>` becomes the same click-to-load chip; the config drops the SVG and MathML profiles, forbids `video`, `audio`, `source` and `input`, strips anchor `target`, and voids forged chips.

  ## User-facing

  **Markdown that uses HTML blocks now renders.** Collapsible sections, centered blocks, and chart or badge embeds show as intended instead of as raw tags, and images inside them get the same click-to-load placeholder as the rest: nothing is fetched until you click.

- The Quick Start "MCP installed on your agent" row now verdicts on the MCP server being ON (the attached-client count becomes a detail line refreshed by Check), and the AI-action submit gate dropped its MCP-session half: an agent draining the queue over the CLI holds no MCP session, so a healthy setup sat disabled as "mcp-disconnected" even after a green agent check. The gate now rides the skill install state plus drainage evidence (an observed claim or the manual check's verdict).

  ## User-facing

  AI action buttons no longer lock up when your agent processes the queue without an MCP connection, and the Quick Start MCP row now simply shows whether the MCP server is on, reporting any attached agent after a Check.

- Both packages now publish with npm provenance: every tarball carries a signed attestation binding it to this repo, the `release` workflow and the commit that built it, recorded in the public Rekor transparency log. Enabled twice on purpose, `publishConfig.provenance` per package plus `NPM_CONFIG_PROVENANCE` in the publish step, because a `changeset publish` that dropped the field would fail silently. No code or API changed.

  ## User-facing

  **Verify where your copy came from.** Every published release now carries a signed record of the repository, commit and CI run that built it. Run `npm audit signatures` after installing, or read the Provenance panel on the npm package page.

- Applies the symlink containment gate to the scoped read, not just the directory traversal. The watcher's incremental pass checked containment lexically, so a file reached through a symlinked directory escaping the scan roots was read into the graph on the next save, despite `scan.followExternalSymlinks` being off. Both walks now resolve the real target first and agree: contained links are followed, escaping ones refused. Per-directory verdicts are memoised so the gate stays off the hot path.

  ## User-facing

  Fixed: while watching a project, a symlinked folder pointing outside it could pull that outside content into your map. It is now refused unless you opt in, matching what a full scan already did.

- Security hardening pass from the cli-hacker audit. Untrusted YAML now parses behind a single bounded entry point (a ~500-byte frontmatter of nested anchors could exhaust the heap and take `sm serve` down). Bumps `js-yaml` and overrides `fast-uri` / `qs` / `body-parser`, clearing every production-reachable advisory. Also tightens the project DB and its backups to `0600`, sanitises `sm watch` output, redacts non-home project roots from telemetry, and announces plugins whose code was imported.

  ## User-facing

  Hardening. A malformed or hostile file can no longer crash a scan or a running server, the project database and its backups are now readable only by you, and skill-map tells you when a project-local plugin's code runs.

- Every boolean row in Settings now flips its switch from anywhere on the row, not just the switch itself: a new `[smToggleRow]` directive forwards the click to the row's `<p-toggleswitch>`, covering the ten toggles across Preferences, Realtime, Live, Capture and General while select, text and button rows stay untouched. The Settings section rail also gains per-section icons and matches the Quick Start rail's label scale, padding and active accent bar.

  ## User-facing

  **Click anywhere on a setting to switch it.** Every on/off option in Settings now flips from anywhere on its row, not just the small switch on the right. The Settings sidebar also gains icons and now matches the Quick Start one.

- The sm-process-jobs skill now resolves the MCP endpoint from the live `.skill-map/serve.json` (the running server's real host + port) instead of hardcoding the default port: the MCP-absent checklist probes that endpoint and every per-runtime register snippet carries the composed `<mcp-url>`, with `http://127.0.0.1:4242/mcp` surviving only when the file is absent. `spec/cli-contract.md` §Agent process skill names serve.json as the endpoint authority.

  ## User-facing

  The agent processing skill now discovers the skill-map server's real port from the project (instead of assuming the default), so agents running against a custom port register and probe the right MCP address. Installed skills show an update in Settings; apply it to pick this up.

- Closes an AA accessibility audit of the SPA. The Settings switches gain accessible names paired to their visible labels, both tab strips get the arrow-key handlers their roving tabindex assumed (now a shared `roving-tablist` helper), queue rows become keyboard-operable, graph node hosts drop the `role="button"` that hid their own controls, the closed inspector panel goes `inert`, three colour tokens clear contrast minimums, and the desktop-only breakpoint is gated on `(pointer: coarse)`.

  ## User-facing

  **The interface works from the keyboard.** Tab and the arrow keys now reach every settings switch, both tab strips and the queue rows, screen readers announce what each control is, switch labels are clickable, and text and map colours meet contrast minimums.

## 0.96.0

### Minor Changes

- Deterministic issues can now be dismissed per (analyzer, value): the new `sm issues dismiss / undismiss / suppressions` verbs, server routes, an inspector per-issue button, and MCP tools write a standing `annotations.issueSuppressions` entry in the node's `.sm` that `core/reference-broken` honours at emission time. Broken `@`-mentions whose token is code-shaped (`@ApiSecurity`, `@nestjs/swagger`) now emit `warn` instead of `error`, so they no longer fail `sm scan` / `sm check`.

  ## User-facing

  Broken-reference false positives can now be dismissed: `sm issues dismiss` (or the dismiss button on an issue row) silences an exact flagged value. Code-looking tokens like `@ApiSecurity` or `@nestjs/swagger` now warn instead of error, so scans stop failing on them.

### Patch Changes

- Each Quick Start group now closes with a tutorial pointer: a visible note naming the part of the sm-tutorial book that covers that group (the live-map prologue, the real-time part, the AI-layer part) and how to launch it, with the invocation joined against the active lens's sigil, mirroring the agent-jobs row.

  ## User-facing

  Each Quick Start section now ends with a note pointing at the matching part of the guided tutorial and how to run it in your agent from an empty folder.

- The Check Agent probe no longer enables the AI affordances mid-check: a check that starts with the submit gate closed latches it closed (skill / MCP probe refreshes and the claim heal apply only once the check settles), so only the green verdict reopens them, and a green claim now re-reads MCP status immediately instead of waiting out the poll. Abandoning a check mid-watch settles it with a neutral `abandoned` verdict instead of wedging the shared single-flight slot and the latch.

  ## User-facing

  Pressing Check Agent no longer lights up the AI buttons while the check is still running: they stay disabled until the check actually comes back green.

## 0.95.0

### Minor Changes

- Map visibility flips to a deviation model (spec §Map scope overrides): rail checkboxes start CHECKED, unchecking excludes the subtree, and overrides inherit nearest-ancestor-wins. `/api/branch` and MCP `get_branch` gain `exclude` / `excludeRoot` params evaluated server-side before the render cap; bare `?path=` keeps its historical union meaning via an inference rule, so existing callers are unaffected. The old localStorage include-set migrates automatically.

  ## User-facing

  The file checkboxes now tell the truth: everything starts checked, unchecking a folder hides it from the map, and re-checking something inside brings just that part back. New files show up on the map by default. Use the new header checkbox to hide or show everything at once.

### Patch Changes

- Session anchors no longer dock beside the AGENTS.md / CLAUDE.md card: the instructions-node affinity was retired after live use (the session cluster parked away from the agents actually running). A session now floats above the centroid of the agents it runs; capsule-only sessions hover above the graph top. Clamp, collision dodge and drag overrides are unchanged. Placement note updated in `spec/provider-activity.md`.

  ## User-facing

  Live session capsules now float above the agents they are running instead of docking next to AGENTS.md, so the activity reads right where the work happens. Drag still wins if you prefer them elsewhere.

## 0.94.0

### Minor Changes

- Removed the agent doorbell (wake-on-submit): the `jobs.wakeOnSubmit` key, the `POST /api/agent/doorbell` route, the Settings toggle, and the registration in the generated OpenCode activity plugin. It served one runtime with no path to the others; parking (`sm jobs claim --wait` or the MCP `claim_job` wait) covers the same need at zero idle cost. The activity ingest tolerates and ignores the `agentEndpoint` field plugins generated before the removal still send.

  ## User-facing

  The "Wake an agent when jobs are queued" switch is gone from Settings, Project. To process the queue, keep an agent watching it (ask it to run the processing skill) or process on demand; nothing else changes.

- Dual-base link resolution: a backticked prose path that misses file-relatively now retries against the scan root before being flagged broken (unless it carries an explicit `./` / `../` prefix), and markdown links support GitHub's root-relative form, `[x](/docs/foo.md)` resolves from the scan root instead of being skipped. Closes the false "Broken pointer" on root-relative mentions written from nested folders, the dominant convention in agent docs.

  ## User-facing

  Fewer false "Broken pointer" errors: a path in backticks written from the project root (like docs usually do) now resolves even when the file mentioning it lives in a subfolder, and `[text](/path/from/root.md)` links now work like on GitHub.

### Patch Changes

- Interrupted or failed sub-agent spawns no longer linger on the live map: the claude adapter maps the main-context `Stop` to a new node-less `turnEnd` frame that sweeps the turn's dead sync spawn relations (re-run `sm activity install claude` to wire it), and a completion-less relation is no longer kept alive by its own session's heartbeats. Also fixes the client event guard rejecting the node-less `sessionScope` form (Codex's turn-end release went unprocessed).

  ## User-facing

  If you cancel or interrupt your agent while it delegates work, the dashed live arrow and its capsule now disappear when the turn ends instead of sticking around for the rest of your session. Re-run `sm activity install claude` once so the new turn-end hook gets wired.

- The graph now renders an ephemeral agent capsule for a spawned runtime sub-agent that matches no scanned node (a vendor built-in with no file on disk), aggregated per parent and name with a live-run count and released with its last live relation; a session spawning only built-ins previously drew nothing. Session anchors float beside the project-instructions card (`AGENTS.md` / `CLAUDE.md`), and dragging a live anchor no longer snaps back mid-drag. Spec: `provider-activity.md` §agent.spawn.

  ## User-facing

  When your agent spawns built-in helpers that are not files in your project (an explorer, a planner), the map now shows them as live dashed capsules with a run counter, hanging off whoever spawned them. Your session bubble also docks next to your AGENTS.md / CLAUDE.md card.

- New project-local `ui.showRuntimeAgents` preference (default `true`, subordinate to `ui.realtimeActivity`): gates the map's ephemeral capsules for runtime sub-agents that match no scanned node. Rides the standard preferences pipeline (`project-config` schema, `GET/PATCH /api/project-preferences`, a third toggle in Settings > Project's Real Time block); switching it off restores the pre-capsule rendering without touching resolved-node spawn edges or session anchors.

  ## User-facing

  New toggle in Settings > Project, "Show runtime sub-agents": turn off the floating capsules for your agent's built-in helpers if you prefer the map to show only your own files. On by default.

## 0.93.2

### Patch Changes

- Move the generated-artifact ignore rules into a committed `.skill-map/.gitignore` written by the tool itself, replacing the four entries `sm init` appended to the project-root `.gitignore`. The list now also covers the SQLite `-wal` / `-shm` sidecars, the operations log and the generated activity bridge, which the old entries never matched. `sm init`, the scan persist step and `sm activity install` each top it up, so an older project is fixed on its next scan; a `!` negation opts an entry out.

  ## User-facing

  Skill-map no longer writes to your project's `.gitignore`: it keeps its own inside `.skill-map/`, covering everything it generates. The database sidecars, the operations log and the activity bridge no longer show up as files to commit. Older projects are fixed on the next scan.

## 0.93.1

### Patch Changes

- Graph node cards drop a single-child wrapper (`.sm-gnode__content`) whose flex settings were inert with one child; its sizing moved onto the name row it used to contain. One element less per card, 256 fewer on a full 256-node map. The name still truncates with an ellipsis and the icon / name / actions columns keep their order and offsets.

## 0.93.0

### Minor Changes

- New agent doorbell (`jobs.wakeOnSubmit`, off by default, project-local): instead of an agent parked on a blocking claim, the server wakes a registered runtime when a submit survives a short settle window unclaimed, starting a fresh session that drains the queue in `once` mode and stops. OpenCode's activity plugin registers its local API as the wake endpoint (`POST /api/agent/doorbell`, refreshed per activity event); the wake is loopback-only, cooldown-bounded, and never fires for the boot ping.

  ## User-facing

  Turn on "Wake an agent when jobs are queued" (Settings, Project) and OpenCode starts a session by itself when work arrives, processes the queue, and stops. Nothing sits parked, idle costs zero.

- New `GET /api/agent/presence` reports whether a processing agent has been observed claiming work since the server started, and the inspector's second warning uses it instead of the live MCP session count. That count was the wrong proxy: an agent parked on the CLI `sm jobs claim --wait` talks straight to SQLite and holds no MCP session, so a healthy setup warned forever. Both claim paths count now, and a startup ping learns the answer without waiting for traffic.

  ## User-facing

  The inspector no longer claims no agent is available when one is running through the CLI: it now reports whether an agent has actually picked up work.

- A Provider can now declare that it READS a skill territory another Provider owns, via `scaffold.sharedWith`. Antigravity and OpenCode both read the open `.agents/skills` territory that `agent-skills` owns, so `sm agent install` / `status` and the Quick Start row refused under those lenses even though a skill materialised there is discovered by their runtimes. Per-lens probes now resolve them; destination-choice verbs keep listing owners only, so one territory offers one row.

  ## User-facing

  You can now install and check the processing skill from the Antigravity and OpenCode lenses, instead of having to switch to the Agent Skills lens first.

- The auto-tagger now PROPOSES tags instead of writing them. A record-time write could only honour a standing `.sm` grant (a record callback cannot prompt), so a project without it burned a model call and silently produced nothing. The tags now ride the completion event and open the ordinary tags editor pre-filled, where the operator saves them under the usual consent handshake. The prompt also receives the node's CURRENT tags, so it proposes what is missing rather than near-duplicates.

  ## User-facing

  Auto-tag now suggests tags in the tag editor for you to keep or drop, instead of silently doing nothing when sidecar edits are not allowed, and it stops proposing near-duplicates of tags you already have.

- New sm-tutorial part "The AI layer: your agent works the map" (order 4, both tracks): seven UI-only chapters covering the deterministic vs probabilistic split, wiring the processing agent (Quick Start, MCP, a parked second session), a first AI action with staleness, finders, fixers with human decisions, the tagger's propose-then-save flow, and the security lane over a new `flawed-portfolio` seed with planted flaws. The CLI and Extend parts shift to orders 5 and 6.

  ## User-facing

  The tutorial has a new section on the AI layer: connect your agent to the job queue and watch it summarize, find planted problems, fix them (asking you when the call is yours), propose tags, and refuse a hidden injection, all from the UI.

### Patch Changes

- WCAG AA sweep across all six UI themes, backed by a new automated axe-core + Playwright e2e suite (axe scan + a 1.4.11 border-contrast probe per theme). Per-theme input border and accent-text tokens now meet 4.5:1 / 3:1, the topbar version and lens chips and the demo banner link were recolored (the lens chip derives a readable shade from any provider hue), table row ARIA misuse was removed, the rail tablist now contains only tabs, and the refresh button gained a visible focus ring.

  ## User-facing

  The interface now meets WCAG AA accessibility contrast in all six themes: input borders and highlighted text are easier to see, and keyboard focus on the refresh button shows a clear ring.

- The inspector's AI busy states are now honest about the queue phase everywhere: the summary block's "Analyze again" button disables with a clock while queued and a spinner while running (mirroring the header affordance), and the per-finding Auto-fix and per-issue fix buttons pin the clock while the fixer job is queued instead of jumping straight to the spinner, the same clock-then-spin convention the launchers already followed.

  ## User-facing

  Fix buttons now show a clock while the job waits in the queue and a spinner only once your agent is actually running it, so you can tell "waiting" from "working" at a glance.

- `claim_job`'s blocking `wait` now emits a `notifications/progress` heartbeat every ~15s while parked, when the request carried a `progressToken`. OpenCode calls every MCP tool with `resetTimeoutOnProgress: true` and a 60s default timeout, so its park died at the first minute; with the heartbeat it parks indefinitely. The skill's claim guidance is per-runtime now: Codex and OpenCode park on the MCP claim, Claude Code keeps the free CLI wait.

  ## User-facing

  An OpenCode agent watching the queue can now wait for jobs on a single parked call, spending no tokens while idle, instead of the wait dying after a minute.

- The contradiction fixer's prompt no longer describes asking the author as an `AskUserQuestion`-style options widget with `human-decision` as the fallback for "cannot interact". Runtimes without such a widget read that as permission to defer, so a decision the operator was sitting there to make got recorded as pending instead of asked. The instruction is now capability-neutral: ask in whatever channel you normally reply in, and reserve `human-decision` for genuinely unattended runs.

  ## User-facing

  When a contradiction needs your call, the fixer asks you in chat and applies your answer, instead of quietly parking it for later on agents without a dedicated question widget.

- Provider manifests gain `detect.subsumes`, the candidate ids a Provider absorbs during lens auto-detection because it reads that runtime's territory itself. `opencode` declares `['claude']`: it reads `.claude/skills/` and `CLAUDE.md` by design while Claude Code never reads `.opencode/`, so that pair was never a real tie, yet detection prompted over it. One-way (a mutual pair keeps the ambiguity) and applied after the `fallback` rule, so it only ever collapses a would-be prompt.

  ## User-facing

  A project with both `.claude/` and `.opencode/` now picks OpenCode on its own instead of asking, since OpenCode reads Claude's skills too. Two unrelated runtimes still ask.

- The files rail's table is virtualised: only the rows in the viewport render. On a 1000-node project an expanded tree drops from 19,663 rail DOM elements and 1,019 rows to 945 and 48, and a folder toggle from 95ms to ~53ms. Since Tab can no longer reach unmounted rows, the rail gains arrow-key navigation, `aria-rowcount` / `aria-rowindex`, and a focus rescue for recycled rows. Rows are a uniform 36px and no longer animate in.

  ## User-facing

  The Files panel now draws only the rows on screen, so expanding or collapsing folders in a large project is immediate instead of stalling. You can also move through the list with the arrow keys: Enter opens a file, Space toggles it on the map.

- Fixed findings whose resolution involved the operator now wear an at-a-glance `(human)` marker beside the row, the same inline treatment `(stale)` gets: cyan in the CLI listing, the theme's primary color as a chip in the inspector's fixed bucket. The data was already there (`resolution_actor`); only the glance was missing.

  ## User-facing

  Findings you decided yourself (approved a fix, picked an option, resolved by hand) now show a "human" tag next to them, so your calls stand out from the fixer's autonomous ones.

- Findings the kernel's safety lane authored now carry a `kernel` mark in the inspector. Those rows are stamped with the extension whose run surfaced them, so an injection flagged while the contradiction finder happened to be reading the file read as that finder's own judgment. The mark (with a tooltip saying as much) separates the safety net from the analyzer you actually ran.

  ## User-facing

  Safety findings now show a `kernel` mark, so you can tell the system's safety net from the judgment of the check you ran.

- The kernel safety lane is now replaced per NODE instead of per reporting extension. A safety row states a fact about the node's content, and every probabilistic report carries a complete safety verdict on the body it read, so scoping the replace to the extension kept one copy of the same fact per extension that ever ran: six finders over one trapped file recorded the same injection six times. The finder lane keeps its per-extension supersede.

  ## User-facing

  A file with a prompt-injection trap no longer collects one duplicate warning per AI check you run: the safety flag is recorded once per file.

- "Follow the Activity" (the map-toolbar camera that auto-frames executing nodes) now defaults to ON: watching the agent run is the point of Real Time, so the camera follows out of the box. A stored opt-out is respected as before; the preference stays per browser.

  ## User-facing

  The map camera now follows your agent's activity by default; switch it off from the map toolbar if you prefer a still camera, and your choice sticks.

- "Capture conversations" can no longer be turned on while the real-time hook is not installed, in both Quick Start and Settings. Without the hook no activity event ever reaches skill-map, so the toggle looked available and achieved nothing. Enabling is gated (disabling always works, and an unknown hook state fails open), the row explains what is missing, and the Quick Start indicator stops reporting a hookless capture as ready.

  ## User-facing

  The "Capture conversations" switch now stays locked, and tells you why, until the real-time hook is installed.

- Graph node cards build their expandable panel on demand instead of on every render. The panel is `display: none` while a card is collapsed, so every node used to construct markup the browser refused to paint: the path row, the LLM cluster, the description with its markdown render, and the agent meta rows. On a 256-node map the card drops from 55 to 46 DOM elements and the graph from 21,572 to 19,492, and the saving grows with how much summary content the nodes carry.

- The inspector's AI Actions card gains a "Check Agent" chip (beside the Auto-fixer toggle) running the full-circuit probe on demand: it submits the hidden ping job and watches for a claim, the same check as Quick Start's agent row, extracted into one shared service both use. It holds the verdict five seconds, green on a claim, red on silence (the queued ping is cancelled), then re-arms. Advisory only: the verdict never disables the AI affordances.

  ## User-facing

  When the agent connection looks lost, a "Check Agent" button next to the Auto-fixer pings the queue in place: green five seconds when an agent picks it up, red when nobody does, no more detours to Quick Start.

- The inspector's two no-agent notices (nobody has picked up work yet; the processing skill is missing) now name the exact invocation for the active lens, `sm-process-jobs` joined with the lens's invocation sigil, instead of a generic instruction and a hardcoded `/sm-process-jobs` that was wrong on Codex. The attending notice also points at Quick Start's Check to confirm the agent picked the queue up.

  ## User-facing

  When no agent is processing jobs, the inspector now tells you exactly what to type in your agent (`/sm-process-jobs`, or `$sm-process-jobs` on Codex) and where to confirm it (Quick Start's Check), instead of a generic "start the processing skill".

- `GET /api/mcp/status` now reports `url`, the endpoint a client should register, built by the server from its own bind. Quick Start's MCP row uses it instead of the page origin, which named the dev proxy's port under a split dev setup. The row also stops assuming every runtime has an `mcp` CLI verb: Antigravity and OpenCode have none, so they copy a whole config document plus the file it goes in, always a personal one (OpenCode's global config, never the project file a team commits).

  ## User-facing

  The MCP setup command now carries the port your server is really on, and Antigravity and OpenCode get a ready config file to save. It always points at your own config, never at a file your repository shares with the team.

- The UI's submit gate now closes on either half of the processing-agent pair: the lens's skill not installed, OR no agent attached to `/mcp`. `ProcessingAgentReadinessService` owns both probes and exposes `submitGateClosed` / `submitGateReason`, so every submitting affordance (the Auto-fixer switch included) shares one signal and picks its own tooltip; while `/mcp` is live with zero clients it re-probes on a light poll, reopening the gate as soon as the agent connects.

  ## User-facing

  **AI buttons wait for your agent.** Summarize, auto-tag and the AI Actions buttons now stay disabled while no agent is connected to the MCP, instead of queueing work nobody picks up. They re-enable on their own once you start your agent.

- The inspector header's path chip is now click-to-copy: clicking it writes the full project-relative path to the clipboard and confirms with a check icon for a couple of seconds, mirroring the debug panel's hash cells. The clipboard write moved into a shared `ui/src/services/clipboard.ts` helper the debug panel now reuses instead of its own inline copy.

  ## User-facing

  Click the file path in the inspector header to copy it to the clipboard, the same way the hashes in Metadata already worked. A check mark confirms the copy.

- The OpenCode activity plugin also forwards `chat.params`, reduced at the wiring level to `{ agent, sessionID }` (the user message it carries never leaves the process). It fires before each model call, so the owner index learns which agent a session runs BEFORE the turn's first `task` spawn; `chat.message` only fires with the completed assistant message, after the delegation already ran, so a turn's first delegation arrow still anchored on a session capsule.

  ## User-facing

  On OpenCode, the delegation arrow now starts at the agent that delegated from its very first delegation, instead of a "Session" bubble for the first one. Requires reinstalling the hook and restarting OpenCode.

- Agent presence now flips on an MCP `claim_job` ATTEMPT, not only on a won claim (a parked agent is attending by definition), and gains explicit negative evidence: a liveness ping cancelled while still unclaimed flips `attending` back to false until a later claim or attempt, so a manual Check moves the connected state both ways. The inspector re-probes presence the moment the MCP client connects, so warnings and buttons update together. `lastClaimAt` stays claim-only.

  ## User-facing

  The "no agent has picked up work yet" notice clears as soon as your agent parks on the queue, and a Check nobody answers flips the state back to disconnected, so what you see always matches reality.

- Edge-kind toggles in the graph view are now an independent show / hide per link kind. `FilterStoreService.toggleLinkKind` takes the kinds the palette actually paints as its universe (it started from the spec-fixed catalog, so kinds absent from the scan stayed in the whitelist) and gained the sticky all-off state the node-kind toggle already had, so turning the last kind off keeps the canvas edgeless instead of collapsing the whitelist back to "no filter".

  ## User-facing

  **Link type toggles now just show and hide.** Each link type button in the map toolbar turns those arrows on or off on its own. Turning the last one off leaves the map with no links, instead of switching every type back on.

- The Settings modal now re-opens on the last section the user visited (persisted per project in the browser, `sm.settings.section`) instead of always landing on Plugins. A remembered per-plugin section whose plugin no longer offers settings falls back to the Plugins panel, and explicit deep-links (like the drift banner opening Project) still win and become the new remembered section.

  ## User-facing

  Settings now opens where you left it: the modal remembers the last section you visited instead of always starting on Plugins.

- The `sm-process-jobs` skill gains a hard rule: talk to skill-map only through the typed MCP tools or the `sm` CLI verbs, never by hand-crafting HTTP against `/mcp` (`curl` + JSON-RPC bodies, manual session ids). Live-observed on OpenCode: a session without the native tools improvised its own raw MCP session over curl instead of falling back to the CLI path the skill already provides.

  ## User-facing

  An agent whose session lacks the skill-map MCP tools now falls back to the CLI verbs as intended, instead of spamming your terminal with hand-built curl calls against the MCP endpoint.

- Provider activity adapters declare `spawnCustody`, and a `blocking` runtime's owner-scoped end now carries `terminal: true`, releasing the spawns that owner parents instead of counting as a pause. The pause-is-not-end rule is Claude-shaped: OpenCode blocks the parent inside the `task` call, so an idle parent is finished. Without this a spawn whose completion never arrives, the shape a refused call leaves, stayed drawn for the full five-minute decay window.

  ## User-facing

  A delegation arrow that ends badly (the runtime refused the call, the agent crashed) now clears as soon as the session finishes, instead of hanging on the map for five minutes.

- A spawn that names no parent is now anchored on the agent node its owner is known to be running, through a boot-scoped `owner -> agent node` index fed by agent claims and completed relations. OpenCode's `task` event reports only the spawning session, so every delegation hung off a synthetic session capsule while the real parent glowed elsewhere. The capsule stays the fallback for an owner running no scanned node.

  ## User-facing

  Delegation arrows now start at the agent that actually delegated, instead of a generic "Session" bubble, on runtimes that do not name the parent.

- The `job.completed` event now carries the job's frozen `nodeId` (spec `job-events.md`), and the UI keys the tagger's tag proposal on it: the pre-filled editor offer no longer evaporates when you navigate while the agent works, cannot open over the wrong node's tags, and re-offers itself when you return to the judged node until it is saved or superseded.

  ## User-facing

  Auto-tag suggestions now wait for you: if you browse other files while your agent infers tags, the pre-filled tag editor opens when you come back to the file it judged instead of getting lost.

- Every extra theme now declares its own favicon: new `favicon-neon/neon-green/neon-red.svg` assets follow the matrix stroke-ramp recipe and are wired through the theme registry's `favicon` field, so the browser tab glyph matches the active theme instead of falling back to the default violet mark.

  ## User-facing

  The browser tab icon now follows the theme too: the neon cyan, green, and red themes each swap in a matching favicon while active, like matrix already did.

- Every extra theme now ships its own retinted brand mark: new `skill-map-mark-neon/neon-green/neon-red.svg` assets follow the matrix recipe (strokes in the theme's secondary tone, bottom node in the electric accent), and mark selection was centralized in `ThemeService.markSrc` so the topbar and the Settings About tab always agree (About previously ignored extra themes entirely).

  ## User-facing

  The skill-map logo now matches the active theme: the neon cyan, green, and red themes each get a logo tinted in their own colors, both in the top bar and in Settings.

- Quick Start's "Paste it into `<file>`" hint on the MCP row now paints in the warning hue instead of the muted grey, matching the restart-pending line above it: both name work the operator still has to do by hand. The copy acknowledgement that shares the same line stays muted.

- Every affordance that would queue an AI job is now disabled while no processing agent is set up for the active lens: the inspector's summarize and auto-tag buttons (which gain a short tooltip saying what is missing) plus the AI Actions launchers, run-all links and per-finding fix buttons, whose own tooltips are untouched. A shared readiness probe backs all of them and fails open, so a transport hiccup never locks the UI.

  ## User-facing

  Buttons that need an AI agent are now clearly disabled until you set one up, instead of looking clickable and failing.

## 0.92.0

### Minor Changes

- Codex live-map + queue parity, additive (Claude unchanged). A subagent whose own end signal Codex drops (nested spawn) now releases at turn end: the main-context `Stop` maps to a node-less session-scoped `node.activity` frame (`sessionScope` + `session`) that clears every owner of the session, instead of glowing until the 5-minute decay. And MCP `claim_job` gains an opt-in `wait` (seconds) for a server-side blocking long-poll, so a runtime that cannot park a shell command drains without polling.

### Patch Changes

- Kernel safety-lane findings of type `content-suspicious` (the passive self-report a probabilistic run emits when it judges a node's content suspicious) are now recorded at severity `warn` instead of `info`, matching their siblings `injection-detected` and `content-malformed`. They surface as warnings across `sm findings` and the UI instead of info-level notes.

  ## User-facing

  Content flagged as suspicious now surfaces as a warning instead of an info note, so it stands out in scans and the findings list.

- The process-jobs skill's MCP setup step is now runtime-agnostic (per-runtime registration for claude / codex / opencode / antigravity, plus a Codex note to claim over MCP with `wait`). Quick Start's MCP register command uses the LIVE server URL, so `sm serve --port N` shows `N` instead of a hardcoded 4242, and the "agent waiting for jobs" hint shows the active lens's invocation (`/sm-process-jobs` vs `$sm-process-jobs`). Installing the real-time hook now recommends restarting the agent and `sm`.

  ## User-facing

  The Quick Start MCP command now uses the port your server is actually on, and the agent-processing hint shows the right invocation for your runtime.

## 0.91.1

### Patch Changes

- Formal WCAG 2.1 AA accessibility pass over the desktop UI: async changes are announced via a shared LiveAnnouncer plus `role="alert"` on errors, a skip-to-content link bypasses the topbar, inspector sections expose heading semantics, graph nodes are keyboard-reachable and named, node selection focuses the inspector, resize separators respond to arrow keys, form errors link to inputs, and switchers use real tab semantics. Adds `@angular/cdk`. Contrast and minors deferred to a browser axe pass.

  ## User-facing

  The desktop UI now works far better with a keyboard and screen reader: async updates are announced, a skip link jumps past the topbar, graph nodes are reachable by keyboard, and dialogs expose proper heading and tab semantics.

## 0.91.0

### Minor Changes

- The web UI's topbar tutorial reminder now shows two messages in sequence instead of one: a Quick Start nudge first, then the `sm tutorial` nudge, one dismiss advancing to the next. The project-local config key backing it changed shape from the boolean `tutorialReminderDismissed` to the integer `tutorialReminderStep` (0-2); `GET`/`PATCH /api/project-preferences` reflect the new key.

  ## User-facing

  The "New to skill-map?" topbar reminder now shows a Quick Start tip first, then the `sm tutorial` tip on your next visit after dismissing it.

### Patch Changes

- `GET /api/jobs` (the UI queue list) now hides jobs from host-locked system extensions like the `ai-ping-action` liveness probe, so the Quick Start "agent attending jobs" pings no longer clutter the Queue tab, matching how `locked` already strips them from the plugin list and MCP `list_extensions`. `sm jobs list` (a power-user surface) still shows them.

  ## User-facing

  The Queue tab no longer shows the internal liveness-probe (ping) jobs that the Quick Start "agent attending jobs" check submits.

- The node inspector's AI Actions section now shows a non-blocking warning when no client is connected to skill-map's MCP server (probed via `GET /api/mcp/status`, an O(1) read), so you know that actions you launch may queue without running until an agent connects. The copy is honest that a CLI agent draining the queue also counts, and points to Quick Start for setup.

  ## User-facing

  The inspector's AI Actions now warns you when no agent is connected to the MCP server, so a launched action sitting unprocessed in the queue is no surprise.

- The node inspector's AI Actions warning now layers two mutually-exclusive gates instead of keying off live MCP connection alone. The primary gate fires when the active lens supports a processing skill that is not installed; the secondary gate fires only once the skill is installed but no client is connected to the MCP yet, and clears as soon as the agent opens a session. At most one message shows, and neither shows while its signal is unknown.

  ## User-facing

  The inspector's AI Actions warning is now clearer: it first tells you to install the processing skill, and only then flags that no agent is connected to the MCP yet.

- The topbar Quick Start button now shows a small highlight dot while the tutorial reminder's first message (the one that mentions Quick Start) is showing, so the nudge and the button it points at read as one thing.

  ## User-facing

  The Quick Start button in the header now gets a small highlight dot while the "New to skill-map?" reminder mentions it.

- Quick Start's "MCP installed on your agent" row now verifies the LIVE connection instead of only a project-committed registration. A new `GET /api/mcp/status` reports whether a client is actually connected to `/mcp` (`McpSessionManager` session count), which is scope-agnostic and reads no `$HOME`, so it works whether the agent registered at local, project, or user scope. The row gains a Check button, and the instructions walk copy, run, approve the connection in your agent, then Check.

  ## User-facing

  Quick Start's "MCP installed on your agent" step now has a Check button that confirms your agent is actually connected to the MCP server (in any scope), instead of only detecting a project-committed registration.

- Quick Start: relabel the "MCP installed" row to "MCP installed on your agent" to make clear it checks the agent-side (runtime) registration, not skill-map's own server.

- Quick Start's agent liveness check no longer surfaces a raw duplicate-job error when a prior ping is still queued: it adopts the existing job as the probe and, if no agent claims it in time, cancels it so the next check starts clean. The "MCP installed on your agent" row stacks its Copy and Check buttons in a column so they stop crowding, and the inspector's MCP-disconnected notice is shorter and set in smaller type.

  ## User-facing

  Quick Start's agent check no longer errors when a ping is already queued, and the MCP install step's buttons no longer crowd together.

- Quick Start dialog now shows a dimmed note beside the title (same header row) signalling that its rows are shortcuts to controls that also live in Settings.

  ## User-facing

  The Quick Start panel now carries a dimmed note beside its title that its controls are shortcuts to the same options you'll find in Settings.

- Quick Start "AI Actions" group now leads with the agent-skill install row, so the setup order installs the process skill before the MCP steps.

- `sm-process-jobs` skill: harden the resident watch loop. It now explicitly warns against passing `--timeout` on the resident `sm jobs claim --wait` (a timeout would make it exit and end the loop) and states that a wait returning without a job is not a stop signal, re-arm it. Fixes agents that added `--timeout` and stopped on an empty queue.

  ## User-facing

  The process-agent skill now keeps watching the queue instead of stopping when it goes idle: it no longer bounds the resident wait with a timeout.

## 0.90.2

### Patch Changes

- Fix a project with `ui.liveUpdates` persisted OFF still flash-opening the live channel at startup. The preference load and the cold-start probes were two separate app-initializers, so the first `/ws` subscriber was constructed before the awaited preference GET resolved and the socket opened on the ON default, which the late OFF never closed. Both steps are now folded into one awaited initializer (`settleLivePrefsThenColdStart`) that settles the preference before the loader is built.

  ## User-facing

  **Live Updates now stays off when you turn it off.** A project with Live Updates disabled no longer auto-refreshes the map on file saves; it updates on your next manual scan, matching the toggle.

## 0.90.1

### Patch Changes

- Lift pinned dependencies to their latest patch releases: hono 4.12.31 and kysely 0.29.4 (CLI), plus @foblex/flow (+ flow-dagre-layout) 19.1.4 (bundled UI). Patch-only, no behaviour change.

- Add a security policy (`SECURITY.md`): vulnerabilities are reported privately through GitHub's private vulnerability reporting (no public issue, no email exposed), with documented scope (`@skill-map/cli` + `@skill-map/spec` in scope; third-party plugins are the operator's trust decision), latest-only support pre-1.0, and Sigstore provenance verification.

## 0.90.0

### Minor Changes

- A host-reserved `locked` manifest flag replaces the hardcoded kernel lock-list so the kernel names no plugin identity; five dedicated `inspector.surface.*` slots (version, stability, tags, summary, auto-tag) replace the retired payload-level `surface` re-homing field; the plugin listing wire gains a presentation `order`; and `GET /api/folders` severity badges now sum fresh unresolved findings alongside deterministic issues.

  ## User-facing

  **The files tree now badges AI findings.** A file or folder with unresolved AI findings shows an error/warn badge in the tree, matching its card chips, not just deterministic checks. The `?debug=1` overlay also rings the version, stability, tags, summarize and auto-tag surfaces.

- The opt-in `/mcp` server (`mcp.server.enabled` / `sm serve --mcp`) is no longer read-only: the same toggle also exposes queue tools (submit/claim/record/cancel/fail jobs, plus list/get and extension discovery) and findings-lifecycle tools (list, resolve, dismiss, reopen, undismiss, delete), thin wrappers over the shared claim/record engines the CLI verbs already use, so an MCP host can drive the job queue and manage findings over one endpoint. Loopback-only and unauthenticated as before.

  ## User-facing

  **Your MCP assistant can now run the queue, not just read the map.** One toggle (Settings > Project, or `sm serve --mcp`) lets a connected AI assistant drive the job queue and manage findings over `/mcp`, from submitting and recording jobs to resolving or dismissing findings.

- The `sm-process-jobs` agent process skill becomes a 3-file progressive-disclosure set (`SKILL.md` always loaded, `mcp.md`/`cli.md` read on demand), installed and status-checked atomically by the agent-skill engine. It now defaults to resident/watch (`once` drains a single pass), probes for MCP tools first (silent in hybrid mode, one-time ordered 3-step setup tip when absent), and renames the queue-processing sense `drain` to `process`. README and spec MCP docs updated for the queue-aware server.

  ## User-facing

  **The process skill now runs resident and tries MCP first.** `sm agent install` writes a 3-file skill that stays resident to process the job queue, uses the MCP tools when present, and when the MCP server is off tips you how to turn it on.

- A new Quick Start panel (rocket icon in the topbar) reports what each capability needs across Live update, Real Time and AI Actions, one live status and action per row. `GET /api/health` gains an `mcp` boolean (the live `/mcp` state, separate from the `mcpServerEnabled` preference). A hidden `locked` system extension `core/ai-ping-action` (absent from every catalog; `list_extensions` skips locked ids) backs the agent-liveness check: a claimed ping proves an agent is draining the queue.

  ## User-facing

  **New: a Quick Start panel (rocket icon, top right).** One place to see what each feature needs, live updates, real-time activity, capture, and the AI/MCP pieces, with the status of each and a button to turn it on. It can even check whether an agent is answering the job queue.

## 0.89.0

### Minor Changes

- The per-node Activity section tightens retention: the runtime recent-executions ring and the AI-run history each cap at 15 (was 20), and the conversation view renders at most 10 threads per node. `spec/provider-activity.md` lowers the normative `runs` cap to 15. AI-run rows now show the full qualified extension id and surface a run status only when it deviates from `completed` (failed and cancelled runs show their state).

  ## User-facing

  **Leaner Activity timeline.** Each node keeps its 15 most recent runs and up to 10 conversations. AI-run rows now show each run's full name and only flag its status when it failed or was cancelled.

- The inspector's Activity section interleaves two provenances: live runtime activity and skill-map's own AI-run history from `state_executions` (persistent). `GET /api/activity/node/:pathB64` gains a lean `runs` array (newest-first, capped 20; no report/nonce). The two are distinguished behind a three-way filter (all / runtime / AI runs) persisted at inspector level; the old Executions/Last-start/Contexts/Totals stat grid was dropped.

  ## User-facing

  The inspector's Activity panel now shows a combined timeline of live agent activity and skill-map's own analysis runs, with a filter to focus on either.

- The node card's aggregate `warn` / `error` severity chips now sum both provenances: deterministic issues PLUS a node's unresolved, non-stale findings (open + `human-decision`). `issue-counter` and `sm scan` are unchanged; the findings are added at read time by the BFF node decoration under issue-counter's own chip ids, with a provenance-breakdown tooltip, on every endpoint that embeds contributions (`/api/nodes`, `/api/scan`, `/api/branch`).

  ## User-facing

  A node's error/warning count on the map card now includes its AI findings, not just deterministic issues, so a node flagged only by an analysis run still shows a count. Hover the chip to see the split.

- New built-in `core/ai-frontmatter-action` (experimental, ships disabled) generates or completes a node's missing frontmatter (path-aligned `name`, use-when `description` in the body's language) without overwriting existing fields, gated by the new `frontmatterMissing` precondition so complete files never list it; deterministic-analyzer fixers moved out of the standalone launcher row and now render as a fix button on each matching deterministic issue row.

  ## User-facing

  **AI can fill in missing frontmatter.** A new AI action writes the name and description a file is missing, and only appears while something is actually missing. Fix buttons for scan warnings now sit on the warning row itself instead of a separate launcher row.

- Every built-in `identifierMismatch` knob now declares `warn`, and the new built-in `core/ai-name-action` fixer (mirror of `ai-reference-action`, preconditioned on `core/name-mismatch`) queues a job that aligns the declared `name` with the file-derived handle. The never-implemented `core/contribution-orphan` stub was deleted, and `name-mismatch` plus `schema-violation` findings gained `fix.summary` remediation hints.

  ## User-facing

  **Name mismatches are now warnings, with an AI fix.** A file whose declared name differs from its filename now shows as a warning everywhere, and a new AI fix can align the name for you. A diagnostic rule that could never produce results was removed.

- New built-in fixer `core/ai-reference-action` (stable, enabled by default), the first fixer for a DETERMINISTIC analyzer: it repairs broken reference links that `core/reference-broken` flagged by injecting that analyzer's Issues (`scan_issues`) into a `## Issues to resolve` job section keyed on the broken target. The agent repoints each link at its real in-project target, asking permission before searching outside the project; the inspector button shows only on nodes with such Issues.

  ## User-facing

  New fix-it job for broken links: after a scan flags a broken reference, queue `core/ai-reference-action` and the agent repoints the link to where the file actually lives in your project (asking first before it looks outside the project).

- Two new built-in probabilistic finders split the security lane: `core/ai-security-analyzer` finds hygiene problems the author fixes (plaintext credentials, piped-to-shell installs, unguarded destructive commands, over-broad permissions), while `core/ai-suspicion-analyzer` flags content designed to manipulate AI agents (instruction overrides, human-invisible instructions, purpose-foreign exfiltration) and never gets a fixer by design. Both ship stable and enabled after live playground passes.

  ## User-facing

  **Two new AI security checks, on by default.** One finds security slip-ups in your files (pasted credentials, risky commands), the other flags content that tries to manipulate an AI agent (hidden instructions, data-leak requests). Findings appear alongside the other AI checks.

- New `core/ai-tagger-action` built-in (taxonomy sibling of the summarizer): `sm record` merges its report tags into the sidecar `annotations.tags` under standing `.sm` consent, and the inspector tag row gains a sparkles auto-tag button. Enabled-gate sweep: tag surfaces follow a self-projected `core/node-set-tags` contribution, `POST /api/actions/:id` re-checks the live enabled state (disabled = 404), `sm bump` refuses while `core/node-bump` is off, and boot/shutdown hooks skip disabled ones.

  ## User-facing

  **Auto-tag.** A sparkles button on the tag row asks the AI to suggest topical tags for the file; they merge into your tags once you grant the sidecar write consent. Disabled extensions now stay off everywhere: their buttons, chips, verbs and hooks disappear or refuse to run.

- Three inspector AI-actions fixes. The two-state finder button reflects its FIXER's job: `prob-extensions` computes `state` / `jobId` over `{finder} ∪ fixerIds`, so clicking Fix shows queued/running, not nothing. A plugin toggled mid-session is honored without restarting `sm serve`: the launcher and submit endpoints re-read the enabled set per request via a fresh resolver (drop-ins that booted disabled still need a restart). And the Automatic toggle is relabelled "Auto-fixer".

  ## User-facing

  Clicking a finder's Fix now shows the fixer running instead of looking like nothing happened; enabling AI-action plugins takes effect without restarting the server; and the auto toggle is now labelled "Auto-fixer".

- The `core/annotation-stale` drift analyzer graduates from experimental to stable, so a default scan now surfaces sidecar (`.sm`) drift out of the box as an `info` issue; its read-only detection is safe on by default while the companion writer `core/node-bump` stays experimental (opt-in), decoupling the former bump pair. The `sidecar-end-to-end` conformance case now expects the extra issue, and the inspector drops the `never bumped` audit empty-state.

  ## User-facing

  **Drift shows out of the box.** Scans now flag when a skill's `.sm` sidecar has fallen out of sync with its `.md`, no need to enable anything first. The inspector's Metadata section also drops the old `never bumped` line.

- Removes the `writesSummary` flag from the Action contract. An Action is now a summarizer iff its `report.schema.json` extends a canonical `summaries/<kind>.schema.json` via `$ref`; `sm record` detects the signal from the schema and upserts the validated report into `state_summaries`. The kernel AJV now registers the `summaries/*` schemas so report schemas can reference them.

- Every disable surface (`sm plugins disable` and the three `PATCH /api/plugins` toggle routes) now cancels the disabled extension's `queued` jobs via the shared `core/jobs/cancel-disabled.ts` helper, inside the same DB open as the contributions purge: one `job.cancelled` push or WS broadcast per affected id and one aggregated `jobs.cancel` operations-log line when any job was cancelled; `running` jobs are untouched.

  ## User-facing

  **Switching a plugin off cancels its pending jobs.** Turning a plugin or extension off now also cancels its queued jobs, so nothing keeps processing work for something you switched off. Jobs already running finish normally, and re-enabling does not bring cancelled jobs back.

- `sm doctor` lands for real: seven read-only checks (PRAGMA quick_check, pending migrations, orphan history rows, job-content consistency, job GC stragglers, plugins in error state, detected providers that matched no nodes), exit 0/1/2 per the contract, `--json` envelope included. `sm actions list` / `sm actions show <id>` replace their stubs with the composed manifest view (mode, precondition, expected duration, report schema ref; derived traits carry no field of their own).

  ## User-facing

  **Health check and action catalog.** `sm doctor` now reports DB integrity, pending migrations, queue consistency, and broken plugins. `sm actions list` shows every action you can queue, `sm actions show <id>` its full manifest.

- Two built-in finder Analyzers complete the wave-1 roster: `core/ai-contradiction-analyzer` (directive pairs that cannot both be followed, or whose combination is jointly risky) and `core/ai-incoherence-analyzer` (dangling references, drifting terminology, steps out of order). Same mold as `core/ai-redundancy-analyzer`: probabilistic, stable and enabled by default, each report schema narrowed to its own finding type; finders judge independently.

  ## User-facing

  Two new AI reviews for your files, on by default: contradiction (including risky directive combinations) and incoherence detection. Queue with `sm job submit`, read results with `sm findings`.

- Suppressed-judgment advisory on finder submits: `sm jobs submit` over a node whose `.sm` sidecar suppresses the finder's judgment (a standing `sm findings dismiss`) now warns on stderr, naming the suppressed types, before the agent pass is spent, and queues anyway (the kernel safety lane is never suppressed, and a finder may emit types the suppression does not cover). Human mode only; the `--json` stdout contract is unchanged (`spec/job-lifecycle.md` §Submit).

  ## User-facing

  Queuing an analysis on a file where you already dismissed that finding now warns you upfront that the result will be dropped, so you can skip the run instead of paying for it.

- The finding state `declined` is renamed `human-decision` (Decision #143): it is a fixer's proposal awaiting the author's choice, not a dead-end. A `fixed` finding now records who decided it via `resolution_actor` (`human` / `fixer`): any user interaction is `human`, only a zero-interaction autonomous fix is `fixer`. The fixer report's `resolved[]` entry declares `state` plus `by` when fixed, and a new `sm findings resolve <id>` verb lets the operator mark a finding fixed-by-human directly.

  ## User-facing

  Findings a fix could not settle now read `human-decision` (your call), not "declined". Fixed findings show whether you or the agent decided them, and `sm findings resolve <id>` lets you mark one handled yourself.

- Findings gain a lifecycle state (Decision #142): a fixer puts a finding into `fixed` or `declined` (the report's `resolved[]` declares `state`, not an `applied` boolean). A `fixed` finding hides from the default `sm findings` view, marked with the fixer that handled it, and stays re-checkable (re-running the finder verifies and closes it); `declined` stays visible as the author's decision. The exclusion line reports `fixed` and `stale` counts separately, and `--fixed` reveals the fixed rows.

  ## User-facing

  Once a fix runs, that finding moves to a `fixed` state and drops out of your default `sm findings` list (see it with `--fixed`), instead of lingering as if still open. Re-run the finder to confirm it is really gone.

- Fixer jobs can target a finding subset: `sm jobs submit --finding <id>` (BFF `findingIds`) freezes the ids on the job, the injection narrows to them, and the supersede/duplicate/running gates become overlap-scoped; `fixerBusy` joins the prob-extensions wire. Finding resolution adds a row-grain `dismissed` state via `sm findings dismiss` (`--class` keeps the sidecar suppression) and a new `sm findings reopen` verb plus BFF routes; five optimization finder/fixer pairs ship experimental.

  ## User-facing

  **Finer-grained finding control.** Fixing or dismissing one finding now affects only that finding (dismissing a whole kind stays available in the CLI), fix buttons no longer flicker while a fix starts, and `sm findings reopen` undoes a dismissal.

- `sm findings clear (-n <path> | --all)` wholesale-deletes stored findings (safety rows included), and dismiss became a read-time suppression lens: rows are kept and hidden (`--dismissed` / `?dismissed=1` reveal them, `dismissedExcluded` counts them), new `sm findings suppressions` / `undismiss` list and lift entries with instant reappearance, finder submits auto-undismiss the re-judged class, and reads resolve suppressions from the `scan_nodes.annotations_json` mirror with single-node self-heal.

  ## User-facing

  **Dismissing an AI finding now hides it instead of deleting it.** `sm findings suppressions` lists your dismissals, `sm findings undismiss` brings one back instantly, re-running a finder un-hides its findings, and `sm findings clear` wipes a node's (or all) stored findings.

- Two findings additions (Decision #144). `sm findings dismiss <id>` silences a finding the operator judged acceptable by writing a durable `annotations.suppressions` entry to the node's `.sm` sidecar (keyed by extension + type); the finder's record path then drops matching findings so the judgment stays silenced across re-runs, unlike a row a re-scan erases. And the finder-to-fixer chain can run automatically via the opt-in `core/auto-fix` hook (ships disabled) on `job.completed`.

  ## User-facing

  `sm findings dismiss <id>` permanently silences a finding you have decided is fine (it stays gone across re-scans, recorded in the file's `.sm` sidecar). Enable the new `core/auto-fix` plugin to have fixers run automatically after their finder.

- The findings pipeline lands: probabilistic Analyzers (finders) queue through `sm job submit` like Actions, `sm record` writes their judgments to the new `state_findings` table (plus kernel-derived safety rows from any probabilistic report), and the new `sm findings` verb reads them, stale-aware and advisory. Job rows now carry `extensionId` / `extensionKind`, the matching config keys and flags rename to extension terminology, and the `sm check` `--include-prob` / `--async` stubs are retired.

  ## User-facing

  New `sm findings` command lists what LLM reviews recorded about your files, including prompt-injection warnings, and hides results for files you edited since. `sm job list --action` is now `--extension`, and `sm check` drops the never-functional `--include-prob`.

- Findings workbench: each finding row carries its own actions (auto-fix via the finder fixers, mark fixed, dismiss, restore, delete), hidden buckets render as reveal chips, a finder with open findings sits disabled, and the ALL button submits sequentially, finders first then actions. Stale findings show inline marked `(stale)` instead of hiding, `human-decision` rows read `needs decision`, the Activity section survives server restarts, and deleting a `.sm` no longer hides its `.md` until rescan.

  ## User-facing

  **Fix findings from the row.** Each finding now has its own fix, dismiss, and delete buttons; stale findings show inline with a stale mark instead of hiding; a finder with open findings waits until you handle them; and deleting a `.sm` no longer hides its file until rescan.

- Two more built-in fixers (probabilistic Actions declaring `precondition.analyzerIds`), stable, enabled by default. `core/ai-contradiction-action` resolves `core/ai-contradiction-analyzer` findings by settling conflicting or jointly-risky directive pairs. `core/ai-incoherence-action` resolves `core/ai-incoherence-analyzer` findings (dangling references, drifting terms, missing context). Both refuse when the node has no matching non-stale finding; the draining agent edits the file.

  ## User-facing

  Two more fix-it jobs, on by default: reconcile conflicting or jointly-risky directives, and clarify incoherent docs (dangling references, drifting terms, missing context). Queue one with `sm job submit`.

- Fixer findings injection (Decision #141) plus the first fixer `core/ai-redundancy-action`. Submitting a probabilistic Action that declares `precondition.analyzerIds` now injects the node's non-stale matching findings into a `## Findings to resolve` section of the rendered job (folded into `promptTemplateHash`), and refuses when the node has none. `core/ai-redundancy-action` (stable) resolves `core/ai-redundancy-analyzer` findings via a template-mandated file edit.

  ## User-facing

  New fix-it jobs: after an AI review flags issues, queue a matching fixer (like `core/ai-redundancy-action` for repetition) and the draining agent edits the file to resolve exactly what was flagged.

- A fixer submit now SUPERSEDES a stale queued sibling: when a queued job exists for the same fixer and node but with a different rendered content (the findings or body changed), the old job is cancelled and the new one enqueued in one transaction, instead of both sitting in the queue and wasting an agent pass on findings already resolved. An identical submit keeps the duplicate refusal, and a running job is never superseded.

  ## User-facing

  Re-queueing a fix for a file no longer piles up outdated fix jobs: the newer one replaces the stale queued one automatically. Jobs an agent is already working on are left alone.

- A fixer's outcome now rides the finding it addressed. `state_findings` gains four `resolution*` columns; injected findings carry their `id`, the fixer echoes it back per `resolved[]` entry, and `sm record` stamps the claim onto the matching row in the record transaction, scoped to the job's node and the fixer's `analyzerIds`. `sm findings` and `sm show` render it: `applied` as an unverified claim, `declined` with its note, and the stale excluded-count line names hidden declined rows.

  ## User-facing

  A fixer's outcome now travels with the finding: see which ones it says it fixed, and, crucially, which it refused and why. Its "you need to decide this" note is no longer lost, `sm findings` names those rows even when they are hidden.

- Fixer selection is now open-findings-only: `selectFixerFindings` filters to `resolution IS NULL`, so a `fixed` or `human-decision` row no longer feeds a fixer submit, its injection, or the inspector's `findingCount` / launcher visibility (a resolved judgment is decided, not "to resolve"). Stale-but-open rows still ride flagged as before. Fixes the launcher showing a `(1)` count on a node the operator already corrected (`spec/job-lifecycle.md` §Findings injection, Selection).

  ## User-facing

  A fix action no longer counts findings you already resolved: the number beside a fixer button now reflects only what still needs fixing.

- New built-in `github/enrichment` (ships disabled; enable it from Settings → plugins): `sm refresh` verifies a node's local body against its declared upstream (`source` + `sourceVersion` annotations), via the immutable raw URL for SHA pins or API ref resolution otherwise, and records the verdict in `state_enrichments`. Requires the `allowNetworkActions` project policy; an optional `token` secret setting raises GitHub API limits.

  ## User-facing

  **Know when your copied skills drift from upstream.** Annotate a node with its GitHub `source`, enable the GitHub plugin and `allowNetworkActions`, and `sm refresh` tells you whether your local copy still matches the original.

- The `core/ai-frontmatter-action` standalone action graduated from experimental to stable and now ships enabled by default, after its live playground pass produced the correct frontmatter block first try (name aligned to the file handle, description in the body's language); doctor's default disabled count drops to 4.

  ## User-facing

  **The AI action that fills in missing frontmatter now comes enabled out of the box.** It writes a name matching the filename and a description saying when to use the file, and its button only appears on files actually missing one of those fields.

- The `ai-scope` optimization pair (finder analyzer plus fixer action) graduated from experimental to stable and now ships enabled by default, after proving its prompts in the live playground: both seeded off-mission sections were found naming the responsibility each serves, and the fixer held its conservative bar, parking both relocations as human-decision with the document untouched. All five built-in optimization pairs now ship stable and enabled, completing the one-by-one live pass.

  ## User-facing

  **The focus review now comes enabled out of the box.** It flags content that belongs in another file, completing the set of five built-in content reviews; its fixes always ask you before removing or moving anything.

- The `ai-structure` and `ai-trigger` optimization pairs (finder analyzer plus fixer action each) graduated from experimental to stable and now ship enabled by default, after each proved its prompts end to end in the live playground; the trigger and scope finder prompts now instruct the agent to read the live file for the frontmatter `description`, since the job snapshot carries the body only. Only the `ai-scope` pair stays experimental and disabled.

  ## User-facing

  **Structure and description-check reviews now come enabled out of the box.** Both show up on every file's AI actions row with per-finding fixes, and the description check now reads a file's frontmatter so it actually sees the description it audits.

- The `ai-verbosity` and `ai-vagueness` optimization pairs (finder analyzer plus fixer action each) graduated from experimental to stable and now ship enabled by default, after each proved its prompts end to end in the live playground; the three remaining optimization pairs (`ai-structure`, `ai-trigger`, `ai-scope`) stay experimental and disabled.

  ## User-facing

  **Verbosity and vagueness reviews now come enabled out of the box.** Their finders show up on every file's AI actions row and their fixes can be applied per finding; turn either off in Settings if you don't want them.

- The `defaultEnabled` axis is honored end to end (`core/node-set-stability` and a now-stable `core/node-bump` ship disabled by default), the redundant `core/auto-fix` built-in is removed while the `job.completed` dispatch stays public, bump stamps `version: 1` on a versionless fresh sidecar, the inspector header hosts the stability and version chips as the Set-stability and Bump affordances, and stored analyses gain a delete endpoint and language-matched prompts.

  ## User-facing

  **Stability and version now live next to the file's title.** Enable their plugins to see the chips; a versionless file shows "v?" and bump stamps v1. Analyses get a delete X and are written in the file's language. The auto-fix plugin is gone, the Auto-fixer toggle covers it.

- Step 16 piece 1, the inspector findings workbench: three BFF endpoints (`GET /api/nodes/:pathB64/findings` with honesty counts, `GET .../prob-extensions` classifying finder / fixer / standalone launchers, `POST .../jobs` via the same submit engine as the CLI, extracted to `core/jobs/submit-engine.ts`), three new REST envelope kinds, and the inspector "Judgments" card: fresh findings with provenance plus launcher buttons (fixers appear only when a matching finding exists).

  ## User-facing

  The node inspector now shows the AI findings for the file and lets you run analyzers from buttons: detectors are always available, and fix actions appear only when there is a finding for them to resolve. Queued work still runs through your own agent.

- Inspector and processing-skill polish. The findings card is renamed "AI actions", launcher buttons drop the `node-` prefix, and the empty-state / honesty line were removed. A selected node's selection ring yields while it executes so the live treatment stays readable. Two `sm-process-jobs` fixes: re-scan with `sm scan --changed` (the old `sm scan -n <path>` was wrong, `-n` is `--dry-run`, roots are directories), and report tersely (one line per job).

  ## User-facing

  The inspector's findings panel is now "AI actions" with cleaner button names, and the processing skill reports more concisely and re-scans correctly after a fix.

- Add the Phase C queue primitives `sm job claim` (atomic claim; `--json` returns `{id, nonce, content}`) and `sm job status`, plus the `cancelled` terminal state and a new `sm job fail` verb (`sm job cancel` now moves a job to `cancelled`, not `failed`). Adds a write-side schema-drift guard: a mutating open against an outdated DB refuses with a clean advisory (CLI + BFF `db-drift`) instead of a `CHECK constraint failed` crash. Also routes `RETURNING` DML through `.all()` in `NodeSqliteDialect`.

  ## User-facing

  **Clearer message when your project database is out of date.** After upgrading `sm`, a command that writes to an outdated `.skill-map` database now prints a short "run `sm db reset --hard`, then `sm scan`" advisory instead of crashing with a cryptic error.

- Rendered job content becomes self-contained (Decision #138): the submit render inlines the report contract verbatim after the extension template (the extension's `report.schema.json` plus the canonical envelope chain), hashed into `promptTemplateHash`, so a draining agent learns the exact output shape, enums included, without disk access. Alongside, `sm findings prune` deletes stale findings rows on demand (destructive-verb pattern with `--dry-run` / `--yes`).

  ## User-facing

  Queued jobs now carry their exact answer format inside the prompt, so agents draining your queue stop guessing (and failing) on report fields. New `sm findings prune` clears out findings that refer to file versions you have since edited.

- Live job-transition push: every job-transitioning CLI verb (`sm jobs submit` / `claim` / `cancel` / `fail`, `sm record`) now pushes its event envelope to the running server (`POST /api/job-events`, discovered and token-authenticated via `serve.json`, best-effort fire-and-forget), which rebroadcasts it verbatim over `/ws`. The catalog gains `job.submitted` / `job.cancelled` and the `queue` runId mode; the BFF submit route's broadcast uses the same canonical envelope.

  ## User-facing

  The inspector now updates the moment your agent picks up or finishes a job: state changes made from the terminal show up live in the browser without reloading.

- `sm job preview --last` previews the most recently submitted job without copying its id (exactly one of `<job.id>` or `--last`; empty queue exits 5). The conformance runner implements the new `setup.priorInvokes` staging phase and the `stdout-contains-verbatim` assertion, and the spec-owned `preamble-bitwise-match` case now runs in the suite.

  ## User-facing

  **Preview your latest job instantly.** After `sm job submit`, run `sm job preview --last` to read the rendered prompt without copying the job id.

- Adds `sm job preview <job.id>`: prints a queued job's rendered content (canonical preamble plus the `<user-content>` block) read from the DB-only `state_job_contents` store by `content_hash`, with no on-disk artifact and no execution. The display-only close-tag escaping is reversed before printing so the stored blob's `content_hash` stays stable. Exits 5 when the job or its content row is missing. Backed by a new `jobs.getContent(contentHash)` storage-port method.

- Adds `sm record --id <id> --nonce <n> --status completed|failed`, the nonce-authenticated callback that closes a running job. A nonce mismatch exits 4 (no mutation), a non-running job exits 2, an unknown job exits 5. On `completed` the `--report <path|->` payload is validated against the action's report schema (invalid marks the job `failed`/`report-invalid`, exit 2), then the execution row and terminal transition are written in one transaction. Closes the submit, claim, record loop.

- Adds `sm job run [--all] [--max N]`, the CLI-runner drain loop that reaps, claims, runs, and records jobs against `claude -p --output-format json` (or a mock runner). `sm record` now writes a summarizer Action's report through to `state_summaries`, shown by `sm show` with a `(stale)` marker. A review hardening pass escapes the `</user-content>` injection delimiter case/whitespace-insensitively, strips the `nonce` from `job list`/`show --json`, and verifies the on-disk body hash at submit.

  ## User-facing

  **Run your job queue against the LLM.** `sm job run` (and `--all`) now runs and records jobs end-to-end through `claude`. Two security fixes: a job's record credential no longer leaks via `job list`/`show --json`, and the injection delimiter resists cased or padded close tags.

- Adds the first slice of the Step 10 job queue: real `sm job submit`, `list`, and `show` over the DB-only content-addressed store (`state_job_contents` keyed by `content_hash`). `submit` renders the preamble plus action template, folds `node.path` into the content hash, resolves TTL/priority/nonce, and writes the content and job rows in one transaction, with duplicate detection, `--all` fan-out, and `--force`/`--ttl`/`--priority` flags. No runner, claim, or record yet.

- `sm jobs claim` gains `--wait`: on an empty queue it blocks, re-reaping and re-claiming every `--interval` seconds (flag -> `jobs.claimWaitSeconds` config -> default 2) until a job is claimable, instead of exiting 1; `--timeout <seconds>` bounds the wait. The `sm-process-jobs` skill gains a resident watch mode that arms the blocking claim and processes each job as it arrives. Progress stays on stderr, so the `--json` handover is byte-unchanged.

  ## User-facing

  Leave your agent watching the queue: `sm jobs claim --wait` waits for the next job instead of stopping when the queue is empty, so it wakes up only when there is work. Set how often it checks with `--interval` seconds, or the `jobs.claimWaitSeconds` setting.

- Processing-agent gate on `sm jobs submit`: with no `sm-process-jobs` skill installed under any Provider destination, the submit now refuses (exit 2) with an advisory explaining the pull-only mechanism and the remedy (`sm agent install`), instead of enqueuing work nothing will ever claim. An installed-but-outdated skill passes with a refresh advisory; the auto-fix hook's internal fixer submits bypass the gate. New conformance case `jobs-submit-agent-gate`.

  ## User-facing

  Submitting an analysis job now checks that an agent is actually set up to run it: if you never ran `sm agent install`, the submit stops and tells you how the queue works instead of leaving the job waiting forever.

- The inspector's AI-actions launcher gains a Stop control for an active job: `POST /api/jobs/:jobId/cancel` moves a queued/running job to `cancelled` through the same transition as `sm jobs cancel`, broadcasts the canonical `job.cancelled` envelope, and answers 204 (409 `job-terminal` on an already-closed job). Each prob-extension entry now carries the active `jobId`. This resolves the zombie case (a killed agent holding a claim) without dropping to the CLI, no global TTL needed.

  ## User-facing

  You can now stop a running or queued analysis from the inspector: a killed or stuck agent's job no longer sits there forever, one click cancels it.

- Adds `core/ai-summarizer-action`, the first probabilistic built-in Action: it summarizes a `markdown` node into a structured brief. It ships experimental (disabled by default; opt-in via `sm plugins enable core/ai-summarizer-action`). Built-in probabilistic Actions now inline their `prompt.md` and `report.schema.json` via the built-ins codegen (new optional `IAction.promptTemplate` / `reportSchema`), so `sm job submit` resolves the template with no on-disk source dir.

- `core/ai-summarizer-action` drops its `kind: ['markdown']` precondition and becomes the universal node summarizer: `sm job submit ai-summarizer-action --all` fans out to every non-virtual node regardless of kind. The Action ships experimental / disabled by default (opt-in via `sm plugins enable core/ai-summarizer-action`). The kernel AJV registry drops the removed per-kind summary schemas; write-through detection is unchanged (any report schema extending the `summaries/` namespace).

  ## User-facing

  **Summarize anything (opt-in).** Enable it with `sm plugins enable core/ai-summarizer-action`, then `sm job submit ai-summarizer-action` works on every node (skills, agents, commands, hooks, markdown); `--all` queues a summary for your whole map.

- `sm record --model <name>` is now persisted instead of dropped: the agent's self-declared model id lands on `state_executions.model` and is denormalized onto the `state_findings.model` / `state_summaries.model` rows the same record writes, so every probabilistic analysis answers "which model, when" without joins. `sm findings` renders it alongside the confidence, and the drain skill instructs agents to declare it.

  ## User-facing

  Analyses now remember which AI model produced them: agents report their model when closing a job, and `sm findings` / `sm show` display it next to each result together with its date.

- First built-in finder Analyzer: `core/ai-redundancy-analyzer` (probabilistic, stable, enabled by default) judges a node for internal redundancy through the job queue and lands `type: redundancy` rows in `state_findings`; its report schema narrows the finding type so the finder can only emit its own judgment. The spec gains the `findings-contract` / `findings-contract-kind` conformance pair covering the rendered findings-envelope report contract and the frozen `extensionKind: analyzer` job row.

  ## User-facing

  New AI review that flags repeated instructions inside a file, on by default: queue it with `sm job submit ai-redundancy-analyzer` and read the judgments with `sm findings`.

- Every mutating operation now appends a one-line JSONL record to `.skill-map/operations.log` via the new single writer in `src/core/operations-log.ts`, wired across `sm scan`, watcher persists, and the job and finding lifecycles on both CLI verbs and BFF routes. A new `GET /api/config/resolution` endpoint flattens the effective config to per-key rows with layer provenance (secrets masked), rendered by the new Settings resolution dialog in Settings > General.

  ## User-facing

  **Operations log and settings resolution.** Every scan, job and finding operation now leaves a line in `.skill-map/operations.log`, and Settings > General gained a "Settings resolution" viewer showing each setting's effective value and which config file set it.

- Jobs never expire by default (Decision #139): an interactive drain can hold a claim while its user deliberates. `state_jobs.ttl_seconds` is nullable; expiry arms only from explicit operator sources (`--ttl`, with `0` disarming, `jobs.perExtensionTtl`, or the global opt-in `jobs.ttlSeconds`), the estimate-driven grace formula and its `graceMultiplier` / `minimumTtlSeconds` config keys are retired, and the new `jobs-overdue` doctor check advises on long-running TTL-less jobs.

  ## User-facing

  Queued jobs no longer time out on their own, so an agent can pause mid-job and ask you how to proceed without losing the work. Set `--ttl` (or the `jobs.ttlSeconds` setting) if you want expiring jobs back; `sm doctor` now flags jobs running far longer than expected.

- Enable/disable now applies a pair toggle over Modelo B edges: enabling a fixer action also enables the analyzer(s) in its `precondition.analyzerIds` (and vice versa), and disabling is reference-counted, so a companion falls only when its last enabled edge partner goes down. Covers `sm plugins enable / disable` and the `PATCH /api/plugins*` routes (bulk form keeps explicit-wins semantics). Normative wording in `plugin-author-guide.md` §Paired extensions.

  ## User-facing

  **Reviews and their fixes now switch together.** Turning on a fix also turns on the review that feeds it, and turning off a review turns off its fix unless another review still uses it. No more half-armed pairs after toggling one side in the Settings panel or the CLI.

- `sm plugins show <plugin>/<ext>` now renders a probabilistic extension's two contract files inline: the verbatim `prompt.md` template under a Prompt section and the pretty-printed `report.schema.json` under a Report schema section (`--json` gains `promptTemplate` / `reportSchema`). The prompt is the extension's essence under the forms model, so the inspector surfaces it without disk spelunking.

  ## User-facing

  `sm plugins show` now displays the full prompt and answer format of any LLM-backed extension, so you can read exactly what a queued job will ask an agent to do before submitting anything.

- Preamble v2 (Decision #140): rule 4 now permits file edits ONLY when the extension template explicitly directs an edit as the job's purpose (unblocking fixer Actions; code execution and URL fetching stay absolutely forbidden, user-content can never mandate anything), the wording moves from "runs actions" to "prepares analysis jobs" with "extension" throughout, and the closing line names the Report contract section. Conformance fixture recut as `preamble-v2.txt`; every job re-keys.

  ## User-facing

  The safety instructions inside every queued job got a v2: agents may now edit files when a job's own instructions say so (never because of file content), which enables upcoming fix-it jobs.

- Add the queue inspector: a `GET /api/jobs` BFF endpoint (registry-less `jobs` envelope, the record nonce stripped from every row) and a new workspace-rail Queue tab listing the whole job queue live, with a status glyph, node-first columns, node/extension search, status filter chips carrying live counts, optimistic per-row cancel, pagination, and bidirectional node selection through the shared path bus. The rail is now an activity bar plus a tabbed Files / Queue panel.

  ## User-facing

  **See and manage the whole job queue.** A new Queue tab lists every job with its status, lets you search and filter them, cancel jobs inline, and page through the list. Selecting a job highlights its node on the map, and vice versa.

- Queue inspector write affordances (Step 17, slice 2): a failed row gets a Retry button that re-submits the same extension + node via the existing node-jobs route, Cancel moves inline into the status cell, and a bulk toolbar behind a confirm dialog cancels all active jobs or clears failed / finished ones via the new cancel-all + prune endpoints. Rows now sort strictly by age, cancelled rows render struck-through, and the running-job Cancel tooltip warns the stop is best-effort.

  ## User-facing

  **Manage jobs from the queue panel.** Retry a failed job, cancel a running one inline, or use the bulk buttons to cancel every active job or clear out failed / finished ones at once. Cancelled jobs show struck-through, and cancelling a running job is best-effort.

- The three curation built-ins (`core/node-bump`, `core/node-set-stability`, `core/node-set-tags`) declare their re-homed `surface` in the action-button payload, and the UI now selects the header version and stability chips, the tag row, and the card's version label and tag chips by that declaration instead of matching extension ids; the card version label thereby follows the Bump extension's enabled state like the other surfaces.

  ## User-facing

  **The card version label follows its plugin.** The version label on map cards now appears only while the Bump extension is enabled, matching how the version and stability chips and the tag row already follow their plugins.

- Removes `sm job run`, `RunnerPort`, `ClaudeCliRunner` and the submit `--run` flag: skill-map never spawns an agent. External agents drain the queue instead: `sm job claim` now reaps expired jobs first and stamps `runner=agent`, and `sm record --json` streams the synthetic run envelope as ndjson (`run.started` through `run.summary`, per `spec/job-events.md`).

  ## User-facing

  **Your agent runs the jobs, not skill-map.** `sm job run` is gone: point any agent (Claude Code, Codex, whatever you use) at the queue and it drains it with `sm job claim` and `sm record`. Nothing gets executed behind your back.

- Retire the on-disk job-files model: rendered job content is now stored DB-only in a new `state_job_contents` table (content-addressed by hash) and execution reports are stored inline as JSON on `state_executions`, so there is no `.skill-map/jobs/` directory to manage. `sm job prune` drops its `--orphan-files` flag and no longer walks the filesystem; its retention pass now also collects orphaned content rows in the same transaction that prunes terminal jobs.

- The BFF serves the agent-drain-skill endpoints (`GET/POST /api/agent/install`, `POST /api/agent/uninstall`, 412 consent gate, same engine as the CLI verbs), and Settings → Project gains the matching Install skill / Update skill / up-to-date button with confirm dialogs and uninstall. The materialised `sm-run-queue/` folder is ignored by scans out of the box (bundled default, `!`-re-includable).

  ## User-facing

  **Install the drain skill from the UI.** Settings → Project now offers "Install skill" (and "Update skill" when your copy is outdated): one click teaches your agent to drain the job queue, no terminal needed.

- New `sm agent install / uninstall / status` verb family: materialises the bundled `sm-run-queue` skill into the active lens's skill territory (`.claude/skills`, `.agents/skills`, ...; `--for <provider>` overrides), so any agent runtime learns the queue drain protocol. Install is three-state (installed / updated / already up to date, byte-compared against the bundled template); status reports `stale` when the materialised copy predates the current CLI.

  ## User-facing

  **Teach your agent to drain the queue.** Run `sm agent install` once and your agent (Claude Code, Codex, or any runtime reading the skill folder) picks up the `sm-run-queue` skill: ask it to "drain the queue" and it claims, executes, and records your jobs.

- `core/ai-summarizer-action` graduates from experimental back to stable / enabled by default now that its UI surface landed: a new `GET /api/nodes/:pathB64/summary` route (spec route-table row, direct shape) serves the node's stored summaries with per-row staleness, and the inspector header gains a sparkles button that queues the summarizer and expands the analysis (subject, key facts, quality notes, confidence, stale mark, re-run) under the identity strip.

  ## User-facing

  **Analyze any file from its header.** A magic button next to the file's title runs an AI analysis; when it finishes (or the file already has one) the header shows what the file covers, key facts and quality notes. Outdated analyses are marked and can be re-run in one click.

- The inspector's AI-actions launcher becomes two-state finder buttons plus an Automatic toggle: a finder with a matching fixer is ONE button that morphs Detect ⇄ Fix by the node's open findings (the fixers row is retired), and the toggle makes it one-click detect+fix. Backing it, a per-job `autoFix` flag frozen at submit (`--auto-fix`, POST body, or toggle) chains all matching fixers at record. `prob-extensions` reshapes to `{ finders, standalone }` with `fixerIds` + `hasOpenFindings`.

  ## User-facing

  Each analysis button in the inspector now detects, then turns into its fix once something is found, so there is one button instead of two. Flip the Automatic toggle to make it detect and fix in a single click.

- The collection verb namespaces go plural (breaking, pre-1.0): `sm job` becomes `sm jobs` and `sm sidecar` becomes `sm sidecars`, aligning them with `plugins` / `actions` / `findings` under one rule (a browsed collection is plural). No singular alias. The queue-processing concept renames from "drain" to "process", and the agent skill is renamed `sm-run-queue` to `sm-process-jobs`.

  ## User-facing

  `sm job ...` is now `sm jobs ...` and `sm sidecar ...` is `sm sidecars ...` (no old aliases, update scripts). The queue-processing skill is renamed `sm-process-jobs`; run `sm agent install` to get it.

### Patch Changes

- The `sm-run-queue` drain skill no longer forbids the file edits that fixer jobs require. Its blanket "a job's only output is its report; never edit project files" rule predated the preamble v2 fixer capability and told draining agents not to do a fixer's work. It now says the rendered prompt is authoritative: most jobs produce only a report, but a fixer whose prompt directs a named-file edit as its purpose gets that edit made. Reinstall with `sm agent install`.

  ## User-facing

  Fixed: the agent drain skill told agents never to edit files, which blocked the new fix-it jobs from doing their work. Run `sm agent install` to update your copy.

- The `sm-run-queue` drain skill now tells the agent to `sm scan -n <path>` the file it edited for a fixer job. skill-map learns about edits only from a scan, so until one ran, `sm findings` kept reporting its judgments as fresh against a body that no longer existed on disk. The agent that changed the file is the one that knows, so it owns the re-scan. Reinstall with `sm agent install`.

  ## User-facing

  After an agent applies a fix it now re-scans that file, so results stop describing the version it just replaced. Run `sm agent install` to update your copy.

- Schema-drift advisories now point at `sm scan` alone: scan is a drift-owning verb that deletes and recreates the drifted DB by itself, so the previously prescribed `sm db reset --hard` first step was a redundant detour for the same outcome. The write-refusal, read-failure, and read-warn advisories all drop it (`spec/db-schema.md` §Schema drift).

  ## User-facing

  When your project database is outdated after an upgrade, the error now just says to run `sm scan` (which rebuilds it in one step) instead of a two-command sequence.

- Schema-drift hygiene for non-drift-owning verbs: read verbs whose query fails because of drift now surface the clean drift advisory (exit 2, naming `sm scan` as the remedy) instead of a raw SQL error, and every row-mutating verb (the `sm job` family, `sm record`, `sm findings prune`, `sm refresh`, `sm plugins trust` / `enable` / `disable`, `sm orphans reconcile` / `undo-rename`) refuses cleanly on drift BEFORE loading the plugin runtime, instead of misleading symptoms like `extension not found`.

  ## User-facing

  When skill-map's local cache predates an upgrade, commands now tell you exactly that and how to fix it (`sm scan`), instead of crashing with a database error or claiming an extension does not exist.

- The `sm findings` bucket flags become filters: `--fixed` now shows ONLY the fixed rows and `--stale` ONLY the stale ones (their union when combined), instead of appending the hidden bucket to the default listing. The excluded-count reporting stays a default-view-only honesty device; an explicit bucket filter is the operator's own narrowing, like `--type`.

  ## User-facing

  `sm findings --fixed` now lists just the fixed findings (and `--stale` just the stale ones) instead of mixing them into the full list, so reviewing what a fixer did no longer means scrolling past everything else.

- `sm findings` no longer reports a clean node while hiding stale judgments. The default filter excludes stale rows, but the empty result printed a bare `No findings` with a success glyph, which reads as "nothing was found" when the finders had in fact judged the node and an edit merely aged their verdicts. Human mode now says `No fresh findings` plus the hidden count and its remedy, listings footer the hidden count, and `--json` carries `staleExcluded`.

  ## User-facing

  `sm findings` used to say "No findings" after you edited a file, hiding results that were merely outdated. It now tells you how many are hidden and how to see them (`--stale`) or refresh them.

- `sm findings` human output now prefixes each finding row with its numeric id (right-aligned per node section so the severity glyphs stay in one column), the handle you pass to `sm findings resolve <id>`. Previously the id showed only in `--json`, forcing a jq/grep detour to act on a finding.

  ## User-facing

  `sm findings` now shows each finding's id at the start of its row, so you can pass it straight to `sm findings resolve <id>` without digging through `--json`.

- The prose fixers now RESOLVE a choice only the author can make by asking, not deferring: their prompts direct the processing agent to present the concrete options as a choose-one question (an `AskUserQuestion`-style prompt) and apply the pick in-session (recorded `fixed` / `by: human`), falling back to a `human-decision` note only when the run is non-interactive. The `sm-process-jobs` skill was aligned to permit the choose-one interaction.

  ## User-facing

  When an AI fix needs a call only you can make, the agent now asks you to pick from concrete options right there (via the Claude Code question interface) and applies your choice, instead of only leaving a note for later.

- The three fixer prompts (`ai-redundancy-action`, `ai-contradiction-action`, `ai-incoherence-action`) now tell the draining agent the embedded copy is a submit-time snapshot: a sibling fixer may have edited the file since, so it reads the live file before editing and declines findings already resolved. The `sm-run-queue` drain skill gains matching fixer guidance: confirm the edit with the user when interactive, edit and report when unattended. `sm agent install` refreshes a materialised copy.

  ## User-facing

  Fix jobs now tell agents to read the live file instead of trusting a possibly-outdated snapshot, and to check with you before editing when you are there. Run `sm agent install` to refresh the skill.

- Fixers no longer refuse a node whose findings merely went stale. Staleness is node-level, so any fix stales every finding on the node, including ones about untouched sections whose defects are still present; excluding them discarded valid judgments and forced a re-detection between fixes. The injection now includes stale findings flagged `stale: true`, the agent verifies each against the current body and declines what no longer applies, and submit refuses only when no matching findings exist.

  ## User-facing

  You can now queue every fixer for a file in a row: fixing one issue no longer blocks the rest with "no findings to resolve". Agents check each older finding against the current text and skip the ones already gone.

- The inspector's AI-actions submit strip now replaces the CLI-worded `no-processing-agent` server message with the UI's own wording plus a hint naming the Settings install row and the `/sm-process-jobs watch` invocation, and the stop companion beside a running launcher is a compact rounded text icon matching the per-finding action buttons.

  ## User-facing

  **Clearer "no agent" error.** If no agent is set up to process jobs, the error now says so plainly and points at Settings to install the processing skill, with the exact command to run. The stop button next to a running action is now a compact icon.

- The graph view adopts Foblex Flow 19: node connectors move to the unified `fConnector` model (plain node ids, connection-level sides), selection becomes single-owner (Foblex's selection drives the inspector/highlight state through one bridge), and the v19 opt-in keyboard layer is enabled with connection-creation and delete actions unbound for the read-only map.

  ## User-facing

  The map is now keyboard-navigable: Tab into it, move between nodes with the arrow keys (Ctrl+arrow follows the links), Home/End jump to the first/last node, Space plus arrows moves a node, and +/- zoom. The selected node opens in the inspector, same as clicking.

- The incomplete-namespace hint (`sm jobs` with no subcommand) no longer passes off a three-item sample as the full list: past three subcommands the line reads `..., and N more.` so `Available subcommands:` stops implying exhaustiveness. Observed live on `sm jobs`, which showed 3 of its 9.

  ## User-facing

  Typing a bare namespace like `sm jobs` now tells you how many more subcommands exist beyond the three examples shown, instead of looking like a complete list.

- Fix: the inspector's Activity tab now refreshes its AI-run history live on job completion. It subscribed only to runtime frames (`node.activity`, `agent.spawn`) and re-scans, but `sm record` closes an AI job by pushing `job.completed` (no `node.activity`), so a run that changed no file (finder or summarizer) did not surface until an unrelated refresh fired. The Activity refresh now also merges the job-event stream, so a finished AI run appears immediately.

  ## User-facing

  The inspector Activity tab now shows a finished AI review right away, even when the run did not change any file (finder or summarizer runs); before, those sometimes only appeared after navigating away and back.

- The inspector's AI-actions launcher drops the Finders / Standalone group labels and their wrappers, rendering every finder and standalone action in one flat button row (finders first, then standalone). A new ALL button leads the row and queues every analysis on the current node in one click, each in its current mode (Detect, Fix, or Detect+fix per the Automatic toggle), skipping entries already running.

  ## User-facing

  **One-click run everything.** The inspector's analysis launcher loses its group labels and lines every button up in a single row. A new ALL button on the left runs every analysis on the selected node at once, each in its current mode.

- The inspector's analysis block splits its title row: sparkles and subject on the left, a stacked controls column on the right (delete, re-analyze, confidence, stale), with the confidence percent shown bare with a tooltip; a container query on the summary block lays the column flat as a row when the inspector panel is wider than 400px.

  ## User-facing

  **Tidier analysis controls.** In a file's analysis block, delete, re-analyze, confidence and freshness now sit in a compact column on narrow panels and lie flat in a row when the inspector is wide.

- The inspector's Findings card now hosts everything found on a node: the AI finding rows and the hidden-buckets chips moved in below the deterministic issues (title count sums both), the AI actions card slimmed down to a launcher-only surface with Finders and Standalone groups in dynamic full-width columns, and the Auto-fixer switch got a compact size via design tokens.

  ## User-facing

  **One Findings card.** Everything found on a file now lives in one Findings card, AI results included. The AI Actions card is just the launch buttons, grouped and tidier, with a smaller Auto-fixer switch.

- The inspector's AI-actions launcher buttons drop the hardcoded `secondary` severity so they track the theme's primary color like every other inspector action button; the Stop control uses the `danger` severity, matching its destructive intent.

  ## User-facing

  The AI-action buttons in the inspector now match the app theme instead of rendering in a flat grey.

- The inspector's AI-actions launcher splits into two rows, finders on top and standalone actions below, each led by its own type-scoped ALL button that queues only its group (sequential within the batch, replacing the combined ALL); ALL labels type-qualify when both rows render, and standalone launcher buttons wear the sparkles icon instead of play.

  ## User-facing

  **Launcher rows by type.** The AI-actions launcher now shows finders and standalone actions on separate rows, each with its own run-all button that only queues its type; standalone actions wear the magic icon.

- The inspector's AI actions launcher replaces the right-edge "ALL finders" / "ALL standalone" header buttons with a quiet parenthesised "(run all)" text link right after each group title; same handler and testids, each link still queues only its own group, and the conditional bare-vs-qualified ALL label logic is removed.

  ## User-facing

  **Run-all is now a quiet link.** The launcher's ALL buttons are now a small (run all) link next to each group title, Finders and Standalone. Each link still queues every action of its own group only.

- Inspector action-button and AI-actions launcher tooltips now open to the left and append to `body`, so they no longer collide with the right screen edge or clip inside the inspector's scroll container. The activity "capture on" chip now renders only when conversation capture is enabled and the node has at least one retained spawn, instead of showing on every node whenever the global capture gate is on.

  ## User-facing

  **Inspector tooltips and the capture badge.** Button tooltips in the inspector now open toward the screen instead of getting clipped at the right edge, and the "capture on" badge shows only on nodes that kept conversations, not on every node while capture is on.

- The SPA's node corpus now also refreshes on WS `job.completed` frames (debounced 500ms), not only on `scan.completed`, so the aggregate severity chips folded from open findings at read time reach map cards as soon as an AI action records its result, without an F5.

  ## User-facing

  **Card counters update on their own.** The warning and error chips on map cards now refresh automatically when an AI review finishes, so new findings show up right away, no page reload needed.

- Republish the release candidate: the previous `0.89.0-rc.0` tarball shipped without its `dist/` directory because the release workflow misread the publish pass as a version pass under changesets pre mode and skipped the build, so `sm` failed to start. The pass detector now subtracts changesets already recorded in `pre.json`, and the changelog generators parse the `-rc.N` suffix. This bump ships a correctly built tarball.

- Dev-tooling majors: c8 moves to 12.0.0 (coverage runner for `test:coverage:html`), and the e2e workspace aligns its TypeScript (6.0.3) and @types/node (26) with the rest of the repo.

- Routine minor/patch dependency refresh: hono 4.12.30, @hono/node-server 2.0.10, zod 4.4.3, @sentry/node 10.66.0, posthog-node 5.45.2, kysely 0.29.3, js-yaml 5.2.1, ws 8.21.1, ignore 7.0.6, plus dev tooling (eslint 10.7.0, typescript-eslint 8.64.0, tsx, @types/node 26). The bundled UI refreshes in lockstep (posthog-js, @sentry/angular, markdown-it, dompurify 3.4.12 with its override, fontawesome, vitest) and e2e moves to Playwright 1.61.1 with the CI container image.

- Fix orphaned design-token references in the bundled UI and align its TypeScript with the CLI workspace (6.0.3). Custom CSS referenced tokens no theme ever emitted (`--p-warn-color`, `--p-danger-color`, bare `--p-border-radius`, a `--p-primary-color-300` typo), so those elements silently lost radius, colors, or glow; they now use the project's `--sm-severity-*` / `--sm-radius-md` tokens and the real `--p-primary-300`. Toggle buttons swap the deprecated `styleClass` input for `class`.

  ## User-facing

  Small visual fixes: some banners and chips recover rounded corners and warning colors that a stale style reference had silently dropped, and the selected-node glow on the map is back.

## 0.89.0-rc.4

### Minor Changes

- Two new built-in probabilistic finders split the security lane: `core/ai-security-analyzer` finds hygiene problems the author fixes (plaintext credentials, piped-to-shell installs, unguarded destructive commands, over-broad permissions), while `core/ai-suspicion-analyzer` flags content designed to manipulate AI agents (instruction overrides, human-invisible instructions, purpose-foreign exfiltration) and never gets a fixer by design. Both ship stable and enabled after live playground passes.

  ## User-facing

  **Two new AI security checks, on by default.** One finds security slip-ups in your files (pasted credentials, risky commands), the other flags content that tries to manipulate an AI agent (hidden instructions, data-leak requests). Findings appear alongside the other AI checks.

### Patch Changes

- The inspector's AI actions launcher replaces the right-edge "ALL finders" / "ALL standalone" header buttons with a quiet parenthesised "(run all)" text link right after each group title; same handler and testids, each link still queues only its own group, and the conditional bare-vs-qualified ALL label logic is removed.

  ## User-facing

  **Run-all is now a quiet link.** The launcher's ALL buttons are now a small (run all) link next to each group title, Finders and Standalone. Each link still queues every action of its own group only.

## 0.89.0-rc.3

### Minor Changes

- New built-in `core/ai-frontmatter-action` (experimental, ships disabled) generates or completes a node's missing frontmatter (path-aligned `name`, use-when `description` in the body's language) without overwriting existing fields, gated by the new `frontmatterMissing` precondition so complete files never list it; deterministic-analyzer fixers moved out of the standalone launcher row and now render as a fix button on each matching deterministic issue row.

  ## User-facing

  **AI can fill in missing frontmatter.** A new AI action writes the name and description a file is missing, and only appears while something is actually missing. Fix buttons for scan warnings now sit on the warning row itself instead of a separate launcher row.

- Every built-in `identifierMismatch` knob now declares `warn`, and the new built-in `core/ai-name-action` fixer (mirror of `ai-reference-action`, preconditioned on `core/name-mismatch`) queues a job that aligns the declared `name` with the file-derived handle. The never-implemented `core/contribution-orphan` stub was deleted, and `name-mismatch` plus `schema-violation` findings gained `fix.summary` remediation hints.

  ## User-facing

  **Name mismatches are now warnings, with an AI fix.** A file whose declared name differs from its filename now shows as a warning everywhere, and a new AI fix can align the name for you. A diagnostic rule that could never produce results was removed.

- Fixer jobs can target a finding subset: `sm jobs submit --finding <id>` (BFF `findingIds`) freezes the ids on the job, the injection narrows to them, and the supersede/duplicate/running gates become overlap-scoped; `fixerBusy` joins the prob-extensions wire. Finding resolution adds a row-grain `dismissed` state via `sm findings dismiss` (`--class` keeps the sidecar suppression) and a new `sm findings reopen` verb plus BFF routes; five optimization finder/fixer pairs ship experimental.

  ## User-facing

  **Finer-grained finding control.** Fixing or dismissing one finding now affects only that finding (dismissing a whole kind stays available in the CLI), fix buttons no longer flicker while a fix starts, and `sm findings reopen` undoes a dismissal.

- The `core/ai-frontmatter-action` standalone action graduated from experimental to stable and now ships enabled by default, after its live playground pass produced the correct frontmatter block first try (name aligned to the file handle, description in the body's language); doctor's default disabled count drops to 4.

  ## User-facing

  **The AI action that fills in missing frontmatter now comes enabled out of the box.** It writes a name matching the filename and a description saying when to use the file, and its button only appears on files actually missing one of those fields.

- The `ai-scope` optimization pair (finder analyzer plus fixer action) graduated from experimental to stable and now ships enabled by default, after proving its prompts in the live playground: both seeded off-mission sections were found naming the responsibility each serves, and the fixer held its conservative bar, parking both relocations as human-decision with the document untouched. All five built-in optimization pairs now ship stable and enabled, completing the one-by-one live pass.

  ## User-facing

  **The focus review now comes enabled out of the box.** It flags content that belongs in another file, completing the set of five built-in content reviews; its fixes always ask you before removing or moving anything.

- The `ai-structure` and `ai-trigger` optimization pairs (finder analyzer plus fixer action each) graduated from experimental to stable and now ship enabled by default, after each proved its prompts end to end in the live playground; the trigger and scope finder prompts now instruct the agent to read the live file for the frontmatter `description`, since the job snapshot carries the body only. Only the `ai-scope` pair stays experimental and disabled.

  ## User-facing

  **Structure and description-check reviews now come enabled out of the box.** Both show up on every file's AI actions row with per-finding fixes, and the description check now reads a file's frontmatter so it actually sees the description it audits.

- The `ai-verbosity` and `ai-vagueness` optimization pairs (finder analyzer plus fixer action each) graduated from experimental to stable and now ship enabled by default, after each proved its prompts end to end in the live playground; the three remaining optimization pairs (`ai-structure`, `ai-trigger`, `ai-scope`) stay experimental and disabled.

  ## User-facing

  **Verbosity and vagueness reviews now come enabled out of the box.** Their finders show up on every file's AI actions row and their fixes can be applied per finding; turn either off in Settings if you don't want them.

- Enable/disable now applies a pair toggle over Modelo B edges: enabling a fixer action also enables the analyzer(s) in its `precondition.analyzerIds` (and vice versa), and disabling is reference-counted, so a companion falls only when its last enabled edge partner goes down. Covers `sm plugins enable / disable` and the `PATCH /api/plugins*` routes (bulk form keeps explicit-wins semantics). Normative wording in `plugin-author-guide.md` §Paired extensions.

  ## User-facing

  **Reviews and their fixes now switch together.** Turning on a fix also turns on the review that feeds it, and turning off a review turns off its fix unless another review still uses it. No more half-armed pairs after toggling one side in the Settings panel or the CLI.

- The three curation built-ins (`core/node-bump`, `core/node-set-stability`, `core/node-set-tags`) declare their re-homed `surface` in the action-button payload, and the UI now selects the header version and stability chips, the tag row, and the card's version label and tag chips by that declaration instead of matching extension ids; the card version label thereby follows the Bump extension's enabled state like the other surfaces.

  ## User-facing

  **The card version label follows its plugin.** The version label on map cards now appears only while the Bump extension is enabled, matching how the version and stability chips and the tag row already follow their plugins.

### Patch Changes

- The inspector's AI-actions submit strip now replaces the CLI-worded `no-processing-agent` server message with the UI's own wording plus a hint naming the Settings install row and the `/sm-process-jobs watch` invocation, and the stop companion beside a running launcher is a compact rounded text icon matching the per-finding action buttons.

  ## User-facing

  **Clearer "no agent" error.** If no agent is set up to process jobs, the error now says so plainly and points at Settings to install the processing skill, with the exact command to run. The stop button next to a running action is now a compact icon.

- The inspector's Findings card now hosts everything found on a node: the AI finding rows and the hidden-buckets chips moved in below the deterministic issues (title count sums both), the AI actions card slimmed down to a launcher-only surface with Finders and Standalone groups in dynamic full-width columns, and the Auto-fixer switch got a compact size via design tokens.

  ## User-facing

  **One Findings card.** Everything found on a file now lives in one Findings card, AI results included. The AI Actions card is just the launch buttons, grouped and tidier, with a smaller Auto-fixer switch.

- The inspector's AI-actions launcher splits into two rows, finders on top and standalone actions below, each led by its own type-scoped ALL button that queues only its group (sequential within the batch, replacing the combined ALL); ALL labels type-qualify when both rows render, and standalone launcher buttons wear the sparkles icon instead of play.

  ## User-facing

  **Launcher rows by type.** The AI-actions launcher now shows finders and standalone actions on separate rows, each with its own run-all button that only queues its type; standalone actions wear the magic icon.

- The SPA's node corpus now also refreshes on WS `job.completed` frames (debounced 500ms), not only on `scan.completed`, so the aggregate severity chips folded from open findings at read time reach map cards as soon as an AI action records its result, without an F5.

  ## User-facing

  **Card counters update on their own.** The warning and error chips on map cards now refresh automatically when an AI review finishes, so new findings show up right away, no page reload needed.

## 0.89.0-rc.2

### Minor Changes

- New `core/ai-tagger-action` built-in (taxonomy sibling of the summarizer): `sm record` merges its report tags into the sidecar `annotations.tags` under standing `.sm` consent, and the inspector tag row gains a sparkles auto-tag button. Enabled-gate sweep: tag surfaces follow a self-projected `core/node-set-tags` contribution, `POST /api/actions/:id` re-checks the live enabled state (disabled = 404), `sm bump` refuses while `core/node-bump` is off, and boot/shutdown hooks skip disabled ones.

  ## User-facing

  **Auto-tag.** A sparkles button on the tag row asks the AI to suggest topical tags for the file; they merge into your tags once you grant the sidecar write consent. Disabled extensions now stay off everywhere: their buttons, chips, verbs and hooks disappear or refuse to run.

- Every disable surface (`sm plugins disable` and the three `PATCH /api/plugins` toggle routes) now cancels the disabled extension's `queued` jobs via the shared `core/jobs/cancel-disabled.ts` helper, inside the same DB open as the contributions purge: one `job.cancelled` push or WS broadcast per affected id and one aggregated `jobs.cancel` operations-log line when any job was cancelled; `running` jobs are untouched.

  ## User-facing

  **Switching a plugin off cancels its pending jobs.** Turning a plugin or extension off now also cancels its queued jobs, so nothing keeps processing work for something you switched off. Jobs already running finish normally, and re-enabling does not bring cancelled jobs back.

- The `defaultEnabled` axis is honored end to end (`core/node-set-stability` and a now-stable `core/node-bump` ship disabled by default), the redundant `core/auto-fix` built-in is removed while the `job.completed` dispatch stays public, bump stamps `version: 1` on a versionless fresh sidecar, the inspector header hosts the stability and version chips as the Set-stability and Bump affordances, and stored analyses gain a delete endpoint and language-matched prompts.

  ## User-facing

  **Stability and version now live next to the file's title.** Enable their plugins to see the chips; a versionless file shows "v?" and bump stamps v1. Analyses get a delete X and are written in the file's language. The auto-fix plugin is gone, the Auto-fixer toggle covers it.

- Every mutating operation now appends a one-line JSONL record to `.skill-map/operations.log` via the new single writer in `src/core/operations-log.ts`, wired across `sm scan`, watcher persists, and the job and finding lifecycles on both CLI verbs and BFF routes. A new `GET /api/config/resolution` endpoint flattens the effective config to per-key rows with layer provenance (secrets masked), rendered by the new Settings resolution dialog in Settings > General.

  ## User-facing

  **Operations log and settings resolution.** Every scan, job and finding operation now leaves a line in `.skill-map/operations.log`, and Settings > General gained a "Settings resolution" viewer showing each setting's effective value and which config file set it.

- `core/ai-summarizer-action` graduates from experimental back to stable / enabled by default now that its UI surface landed: a new `GET /api/nodes/:pathB64/summary` route (spec route-table row, direct shape) serves the node's stored summaries with per-row staleness, and the inspector header gains a sparkles button that queues the summarizer and expands the analysis (subject, key facts, quality notes, confidence, stale mark, re-run) under the identity strip.

  ## User-facing

  **Analyze any file from its header.** A magic button next to the file's title runs an AI analysis; when it finishes (or the file already has one) the header shows what the file covers, key facts and quality notes. Outdated analyses are marked and can be re-run in one click.

### Patch Changes

- The inspector's analysis block splits its title row: sparkles and subject on the left, a stacked controls column on the right (delete, re-analyze, confidence, stale), with the confidence percent shown bare with a tooltip; a container query on the summary block lays the column flat as a row when the inspector panel is wider than 400px.

  ## User-facing

  **Tidier analysis controls.** In a file's analysis block, delete, re-analyze, confidence and freshness now sit in a compact column on narrow panels and lie flat in a row when the inspector is wide.

## 0.89.0-rc.1

### Patch Changes

- Republish the release candidate: the previous `0.89.0-rc.0` tarball shipped without its `dist/` directory because the release workflow misread the publish pass as a version pass under changesets pre mode and skipped the build, so `sm` failed to start. The pass detector now subtracts changesets already recorded in `pre.json`, and the changelog generators parse the `-rc.N` suffix. This bump ships a correctly built tarball.

## 0.89.0-rc.0

### Minor Changes

- The per-node Activity section tightens retention: the runtime recent-executions ring and the AI-run history each cap at 15 (was 20), and the conversation view renders at most 10 threads per node. `spec/provider-activity.md` lowers the normative `runs` cap to 15. AI-run rows now show the full qualified extension id and surface a run status only when it deviates from `completed` (failed and cancelled runs show their state).

  ## User-facing

  **Leaner Activity timeline.** Each node keeps its 15 most recent runs and up to 10 conversations. AI-run rows now show each run's full name and only flag its status when it failed or was cancelled.

- The inspector's Activity section interleaves two provenances: live runtime activity and skill-map's own AI-run history from `state_executions` (persistent). `GET /api/activity/node/:pathB64` gains a lean `runs` array (newest-first, capped 20; no report/nonce). The two are distinguished behind a three-way filter (all / runtime / AI runs) persisted at inspector level; the old Executions/Last-start/Contexts/Totals stat grid was dropped.

  ## User-facing

  The inspector's Activity panel now shows a combined timeline of live agent activity and skill-map's own analysis runs, with a filter to focus on either.

- The node card's aggregate `warn` / `error` severity chips now sum both provenances: deterministic issues PLUS a node's unresolved, non-stale findings (open + `human-decision`). `issue-counter` and `sm scan` are unchanged; the findings are added at read time by the BFF node decoration under issue-counter's own chip ids, with a provenance-breakdown tooltip, on every endpoint that embeds contributions (`/api/nodes`, `/api/scan`, `/api/branch`).

  ## User-facing

  A node's error/warning count on the map card now includes its AI findings, not just deterministic issues, so a node flagged only by an analysis run still shows a count. Hover the chip to see the split.

- New built-in fixer `core/ai-reference-action` (stable, enabled by default), the first fixer for a DETERMINISTIC analyzer: it repairs broken reference links that `core/reference-broken` flagged by injecting that analyzer's Issues (`scan_issues`) into a `## Issues to resolve` job section keyed on the broken target. The agent repoints each link at its real in-project target, asking permission before searching outside the project; the inspector button shows only on nodes with such Issues.

  ## User-facing

  New fix-it job for broken links: after a scan flags a broken reference, queue `core/ai-reference-action` and the agent repoints the link to where the file actually lives in your project (asking first before it looks outside the project).

- Three inspector AI-actions fixes. The two-state finder button reflects its FIXER's job: `prob-extensions` computes `state` / `jobId` over `{finder} ∪ fixerIds`, so clicking Fix shows queued/running, not nothing. A plugin toggled mid-session is honored without restarting `sm serve`: the launcher and submit endpoints re-read the enabled set per request via a fresh resolver (drop-ins that booted disabled still need a restart). And the Automatic toggle is relabelled "Auto-fixer".

  ## User-facing

  Clicking a finder's Fix now shows the fixer running instead of looking like nothing happened; enabling AI-action plugins takes effect without restarting the server; and the auto toggle is now labelled "Auto-fixer".

- The `core/annotation-stale` drift analyzer graduates from experimental to stable, so a default scan now surfaces sidecar (`.sm`) drift out of the box as an `info` issue; its read-only detection is safe on by default while the companion writer `core/node-bump` stays experimental (opt-in), decoupling the former bump pair. The `sidecar-end-to-end` conformance case now expects the extra issue, and the inspector drops the `never bumped` audit empty-state.

  ## User-facing

  **Drift shows out of the box.** Scans now flag when a skill's `.sm` sidecar has fallen out of sync with its `.md`, no need to enable anything first. The inspector's Metadata section also drops the old `never bumped` line.

- Removes the `writesSummary` flag from the Action contract. An Action is now a summarizer iff its `report.schema.json` extends a canonical `summaries/<kind>.schema.json` via `$ref`; `sm record` detects the signal from the schema and upserts the validated report into `state_summaries`. The kernel AJV now registers the `summaries/*` schemas so report schemas can reference them.

- `sm doctor` lands for real: seven read-only checks (PRAGMA quick_check, pending migrations, orphan history rows, job-content consistency, job GC stragglers, plugins in error state, detected providers that matched no nodes), exit 0/1/2 per the contract, `--json` envelope included. `sm actions list` / `sm actions show <id>` replace their stubs with the composed manifest view (mode, precondition, expected duration, report schema ref; derived traits carry no field of their own).

  ## User-facing

  **Health check and action catalog.** `sm doctor` now reports DB integrity, pending migrations, queue consistency, and broken plugins. `sm actions list` shows every action you can queue, `sm actions show <id>` its full manifest.

- Two built-in finder Analyzers complete the wave-1 roster: `core/ai-contradiction-analyzer` (directive pairs that cannot both be followed, or whose combination is jointly risky) and `core/ai-incoherence-analyzer` (dangling references, drifting terminology, steps out of order). Same mold as `core/ai-redundancy-analyzer`: probabilistic, stable and enabled by default, each report schema narrowed to its own finding type; finders judge independently.

  ## User-facing

  Two new AI reviews for your files, on by default: contradiction (including risky directive combinations) and incoherence detection. Queue with `sm job submit`, read results with `sm findings`.

- Suppressed-judgment advisory on finder submits: `sm jobs submit` over a node whose `.sm` sidecar suppresses the finder's judgment (a standing `sm findings dismiss`) now warns on stderr, naming the suppressed types, before the agent pass is spent, and queues anyway (the kernel safety lane is never suppressed, and a finder may emit types the suppression does not cover). Human mode only; the `--json` stdout contract is unchanged (`spec/job-lifecycle.md` §Submit).

  ## User-facing

  Queuing an analysis on a file where you already dismissed that finding now warns you upfront that the result will be dropped, so you can skip the run instead of paying for it.

- The finding state `declined` is renamed `human-decision` (Decision #143): it is a fixer's proposal awaiting the author's choice, not a dead-end. A `fixed` finding now records who decided it via `resolution_actor` (`human` / `fixer`): any user interaction is `human`, only a zero-interaction autonomous fix is `fixer`. The fixer report's `resolved[]` entry declares `state` plus `by` when fixed, and a new `sm findings resolve <id>` verb lets the operator mark a finding fixed-by-human directly.

  ## User-facing

  Findings a fix could not settle now read `human-decision` (your call), not "declined". Fixed findings show whether you or the agent decided them, and `sm findings resolve <id>` lets you mark one handled yourself.

- Findings gain a lifecycle state (Decision #142): a fixer puts a finding into `fixed` or `declined` (the report's `resolved[]` declares `state`, not an `applied` boolean). A `fixed` finding hides from the default `sm findings` view, marked with the fixer that handled it, and stays re-checkable (re-running the finder verifies and closes it); `declined` stays visible as the author's decision. The exclusion line reports `fixed` and `stale` counts separately, and `--fixed` reveals the fixed rows.

  ## User-facing

  Once a fix runs, that finding moves to a `fixed` state and drops out of your default `sm findings` list (see it with `--fixed`), instead of lingering as if still open. Re-run the finder to confirm it is really gone.

- `sm findings clear (-n <path> | --all)` wholesale-deletes stored findings (safety rows included), and dismiss became a read-time suppression lens: rows are kept and hidden (`--dismissed` / `?dismissed=1` reveal them, `dismissedExcluded` counts them), new `sm findings suppressions` / `undismiss` list and lift entries with instant reappearance, finder submits auto-undismiss the re-judged class, and reads resolve suppressions from the `scan_nodes.annotations_json` mirror with single-node self-heal.

  ## User-facing

  **Dismissing an AI finding now hides it instead of deleting it.** `sm findings suppressions` lists your dismissals, `sm findings undismiss` brings one back instantly, re-running a finder un-hides its findings, and `sm findings clear` wipes a node's (or all) stored findings.

- Two findings additions (Decision #144). `sm findings dismiss <id>` silences a finding the operator judged acceptable by writing a durable `annotations.suppressions` entry to the node's `.sm` sidecar (keyed by extension + type); the finder's record path then drops matching findings so the judgment stays silenced across re-runs, unlike a row a re-scan erases. And the finder-to-fixer chain can run automatically via the opt-in `core/auto-fix` hook (ships disabled) on `job.completed`.

  ## User-facing

  `sm findings dismiss <id>` permanently silences a finding you have decided is fine (it stays gone across re-scans, recorded in the file's `.sm` sidecar). Enable the new `core/auto-fix` plugin to have fixers run automatically after their finder.

- The findings pipeline lands: probabilistic Analyzers (finders) queue through `sm job submit` like Actions, `sm record` writes their judgments to the new `state_findings` table (plus kernel-derived safety rows from any probabilistic report), and the new `sm findings` verb reads them, stale-aware and advisory. Job rows now carry `extensionId` / `extensionKind`, the matching config keys and flags rename to extension terminology, and the `sm check` `--include-prob` / `--async` stubs are retired.

  ## User-facing

  New `sm findings` command lists what LLM reviews recorded about your files, including prompt-injection warnings, and hides results for files you edited since. `sm job list --action` is now `--extension`, and `sm check` drops the never-functional `--include-prob`.

- Findings workbench: each finding row carries its own actions (auto-fix via the finder fixers, mark fixed, dismiss, restore, delete), hidden buckets render as reveal chips, a finder with open findings sits disabled, and the ALL button submits sequentially, finders first then actions. Stale findings show inline marked `(stale)` instead of hiding, `human-decision` rows read `needs decision`, the Activity section survives server restarts, and deleting a `.sm` no longer hides its `.md` until rescan.

  ## User-facing

  **Fix findings from the row.** Each finding now has its own fix, dismiss, and delete buttons; stale findings show inline with a stale mark instead of hiding; a finder with open findings waits until you handle them; and deleting a `.sm` no longer hides its file until rescan.

- Two more built-in fixers (probabilistic Actions declaring `precondition.analyzerIds`), stable, enabled by default. `core/ai-contradiction-action` resolves `core/ai-contradiction-analyzer` findings by settling conflicting or jointly-risky directive pairs. `core/ai-incoherence-action` resolves `core/ai-incoherence-analyzer` findings (dangling references, drifting terms, missing context). Both refuse when the node has no matching non-stale finding; the draining agent edits the file.

  ## User-facing

  Two more fix-it jobs, on by default: reconcile conflicting or jointly-risky directives, and clarify incoherent docs (dangling references, drifting terms, missing context). Queue one with `sm job submit`.

- Fixer findings injection (Decision #141) plus the first fixer `core/ai-redundancy-action`. Submitting a probabilistic Action that declares `precondition.analyzerIds` now injects the node's non-stale matching findings into a `## Findings to resolve` section of the rendered job (folded into `promptTemplateHash`), and refuses when the node has none. `core/ai-redundancy-action` (stable) resolves `core/ai-redundancy-analyzer` findings via a template-mandated file edit.

  ## User-facing

  New fix-it jobs: after an AI review flags issues, queue a matching fixer (like `core/ai-redundancy-action` for repetition) and the draining agent edits the file to resolve exactly what was flagged.

- A fixer submit now SUPERSEDES a stale queued sibling: when a queued job exists for the same fixer and node but with a different rendered content (the findings or body changed), the old job is cancelled and the new one enqueued in one transaction, instead of both sitting in the queue and wasting an agent pass on findings already resolved. An identical submit keeps the duplicate refusal, and a running job is never superseded.

  ## User-facing

  Re-queueing a fix for a file no longer piles up outdated fix jobs: the newer one replaces the stale queued one automatically. Jobs an agent is already working on are left alone.

- A fixer's outcome now rides the finding it addressed. `state_findings` gains four `resolution*` columns; injected findings carry their `id`, the fixer echoes it back per `resolved[]` entry, and `sm record` stamps the claim onto the matching row in the record transaction, scoped to the job's node and the fixer's `analyzerIds`. `sm findings` and `sm show` render it: `applied` as an unverified claim, `declined` with its note, and the stale excluded-count line names hidden declined rows.

  ## User-facing

  A fixer's outcome now travels with the finding: see which ones it says it fixed, and, crucially, which it refused and why. Its "you need to decide this" note is no longer lost, `sm findings` names those rows even when they are hidden.

- Fixer selection is now open-findings-only: `selectFixerFindings` filters to `resolution IS NULL`, so a `fixed` or `human-decision` row no longer feeds a fixer submit, its injection, or the inspector's `findingCount` / launcher visibility (a resolved judgment is decided, not "to resolve"). Stale-but-open rows still ride flagged as before. Fixes the launcher showing a `(1)` count on a node the operator already corrected (`spec/job-lifecycle.md` §Findings injection, Selection).

  ## User-facing

  A fix action no longer counts findings you already resolved: the number beside a fixer button now reflects only what still needs fixing.

- New built-in `github/enrichment` (ships disabled; enable it from Settings → plugins): `sm refresh` verifies a node's local body against its declared upstream (`source` + `sourceVersion` annotations), via the immutable raw URL for SHA pins or API ref resolution otherwise, and records the verdict in `state_enrichments`. Requires the `allowNetworkActions` project policy; an optional `token` secret setting raises GitHub API limits.

  ## User-facing

  **Know when your copied skills drift from upstream.** Annotate a node with its GitHub `source`, enable the GitHub plugin and `allowNetworkActions`, and `sm refresh` tells you whether your local copy still matches the original.

- Step 16 piece 1, the inspector findings workbench: three BFF endpoints (`GET /api/nodes/:pathB64/findings` with honesty counts, `GET .../prob-extensions` classifying finder / fixer / standalone launchers, `POST .../jobs` via the same submit engine as the CLI, extracted to `core/jobs/submit-engine.ts`), three new REST envelope kinds, and the inspector "Judgments" card: fresh findings with provenance plus launcher buttons (fixers appear only when a matching finding exists).

  ## User-facing

  The node inspector now shows the AI findings for the file and lets you run analyzers from buttons: detectors are always available, and fix actions appear only when there is a finding for them to resolve. Queued work still runs through your own agent.

- Inspector and processing-skill polish. The findings card is renamed "AI actions", launcher buttons drop the `node-` prefix, and the empty-state / honesty line were removed. A selected node's selection ring yields while it executes so the live treatment stays readable. Two `sm-process-jobs` fixes: re-scan with `sm scan --changed` (the old `sm scan -n <path>` was wrong, `-n` is `--dry-run`, roots are directories), and report tersely (one line per job).

  ## User-facing

  The inspector's findings panel is now "AI actions" with cleaner button names, and the processing skill reports more concisely and re-scans correctly after a fix.

- Add the Phase C queue primitives `sm job claim` (atomic claim; `--json` returns `{id, nonce, content}`) and `sm job status`, plus the `cancelled` terminal state and a new `sm job fail` verb (`sm job cancel` now moves a job to `cancelled`, not `failed`). Adds a write-side schema-drift guard: a mutating open against an outdated DB refuses with a clean advisory (CLI + BFF `db-drift`) instead of a `CHECK constraint failed` crash. Also routes `RETURNING` DML through `.all()` in `NodeSqliteDialect`.

  ## User-facing

  **Clearer message when your project database is out of date.** After upgrading `sm`, a command that writes to an outdated `.skill-map` database now prints a short "run `sm db reset --hard`, then `sm scan`" advisory instead of crashing with a cryptic error.

- Rendered job content becomes self-contained (Decision #138): the submit render inlines the report contract verbatim after the extension template (the extension's `report.schema.json` plus the canonical envelope chain), hashed into `promptTemplateHash`, so a draining agent learns the exact output shape, enums included, without disk access. Alongside, `sm findings prune` deletes stale findings rows on demand (destructive-verb pattern with `--dry-run` / `--yes`).

  ## User-facing

  Queued jobs now carry their exact answer format inside the prompt, so agents draining your queue stop guessing (and failing) on report fields. New `sm findings prune` clears out findings that refer to file versions you have since edited.

- Live job-transition push: every job-transitioning CLI verb (`sm jobs submit` / `claim` / `cancel` / `fail`, `sm record`) now pushes its event envelope to the running server (`POST /api/job-events`, discovered and token-authenticated via `serve.json`, best-effort fire-and-forget), which rebroadcasts it verbatim over `/ws`. The catalog gains `job.submitted` / `job.cancelled` and the `queue` runId mode; the BFF submit route's broadcast uses the same canonical envelope.

  ## User-facing

  The inspector now updates the moment your agent picks up or finishes a job: state changes made from the terminal show up live in the browser without reloading.

- `sm job preview --last` previews the most recently submitted job without copying its id (exactly one of `<job.id>` or `--last`; empty queue exits 5). The conformance runner implements the new `setup.priorInvokes` staging phase and the `stdout-contains-verbatim` assertion, and the spec-owned `preamble-bitwise-match` case now runs in the suite.

  ## User-facing

  **Preview your latest job instantly.** After `sm job submit`, run `sm job preview --last` to read the rendered prompt without copying the job id.

- Adds `sm job preview <job.id>`: prints a queued job's rendered content (canonical preamble plus the `<user-content>` block) read from the DB-only `state_job_contents` store by `content_hash`, with no on-disk artifact and no execution. The display-only close-tag escaping is reversed before printing so the stored blob's `content_hash` stays stable. Exits 5 when the job or its content row is missing. Backed by a new `jobs.getContent(contentHash)` storage-port method.

- Adds `sm record --id <id> --nonce <n> --status completed|failed`, the nonce-authenticated callback that closes a running job. A nonce mismatch exits 4 (no mutation), a non-running job exits 2, an unknown job exits 5. On `completed` the `--report <path|->` payload is validated against the action's report schema (invalid marks the job `failed`/`report-invalid`, exit 2), then the execution row and terminal transition are written in one transaction. Closes the submit, claim, record loop.

- Adds `sm job run [--all] [--max N]`, the CLI-runner drain loop that reaps, claims, runs, and records jobs against `claude -p --output-format json` (or a mock runner). `sm record` now writes a summarizer Action's report through to `state_summaries`, shown by `sm show` with a `(stale)` marker. A review hardening pass escapes the `</user-content>` injection delimiter case/whitespace-insensitively, strips the `nonce` from `job list`/`show --json`, and verifies the on-disk body hash at submit.

  ## User-facing

  **Run your job queue against the LLM.** `sm job run` (and `--all`) now runs and records jobs end-to-end through `claude`. Two security fixes: a job's record credential no longer leaks via `job list`/`show --json`, and the injection delimiter resists cased or padded close tags.

- Adds the first slice of the Step 10 job queue: real `sm job submit`, `list`, and `show` over the DB-only content-addressed store (`state_job_contents` keyed by `content_hash`). `submit` renders the preamble plus action template, folds `node.path` into the content hash, resolves TTL/priority/nonce, and writes the content and job rows in one transaction, with duplicate detection, `--all` fan-out, and `--force`/`--ttl`/`--priority` flags. No runner, claim, or record yet.

- `sm jobs claim` gains `--wait`: on an empty queue it blocks, re-reaping and re-claiming every `--interval` seconds (flag -> `jobs.claimWaitSeconds` config -> default 2) until a job is claimable, instead of exiting 1; `--timeout <seconds>` bounds the wait. The `sm-process-jobs` skill gains a resident watch mode that arms the blocking claim and processes each job as it arrives. Progress stays on stderr, so the `--json` handover is byte-unchanged.

  ## User-facing

  Leave your agent watching the queue: `sm jobs claim --wait` waits for the next job instead of stopping when the queue is empty, so it wakes up only when there is work. Set how often it checks with `--interval` seconds, or the `jobs.claimWaitSeconds` setting.

- Processing-agent gate on `sm jobs submit`: with no `sm-process-jobs` skill installed under any Provider destination, the submit now refuses (exit 2) with an advisory explaining the pull-only mechanism and the remedy (`sm agent install`), instead of enqueuing work nothing will ever claim. An installed-but-outdated skill passes with a refresh advisory; the auto-fix hook's internal fixer submits bypass the gate. New conformance case `jobs-submit-agent-gate`.

  ## User-facing

  Submitting an analysis job now checks that an agent is actually set up to run it: if you never ran `sm agent install`, the submit stops and tells you how the queue works instead of leaving the job waiting forever.

- The inspector's AI-actions launcher gains a Stop control for an active job: `POST /api/jobs/:jobId/cancel` moves a queued/running job to `cancelled` through the same transition as `sm jobs cancel`, broadcasts the canonical `job.cancelled` envelope, and answers 204 (409 `job-terminal` on an already-closed job). Each prob-extension entry now carries the active `jobId`. This resolves the zombie case (a killed agent holding a claim) without dropping to the CLI, no global TTL needed.

  ## User-facing

  You can now stop a running or queued analysis from the inspector: a killed or stuck agent's job no longer sits there forever, one click cancels it.

- Adds `core/ai-summarizer-action`, the first probabilistic built-in Action: it summarizes a `markdown` node into a structured brief. It ships experimental (disabled by default; opt-in via `sm plugins enable core/ai-summarizer-action`). Built-in probabilistic Actions now inline their `prompt.md` and `report.schema.json` via the built-ins codegen (new optional `IAction.promptTemplate` / `reportSchema`), so `sm job submit` resolves the template with no on-disk source dir.

- `core/ai-summarizer-action` drops its `kind: ['markdown']` precondition and becomes the universal node summarizer: `sm job submit ai-summarizer-action --all` fans out to every non-virtual node regardless of kind. The Action ships experimental / disabled by default (opt-in via `sm plugins enable core/ai-summarizer-action`). The kernel AJV registry drops the removed per-kind summary schemas; write-through detection is unchanged (any report schema extending the `summaries/` namespace).

  ## User-facing

  **Summarize anything (opt-in).** Enable it with `sm plugins enable core/ai-summarizer-action`, then `sm job submit ai-summarizer-action` works on every node (skills, agents, commands, hooks, markdown); `--all` queues a summary for your whole map.

- `sm record --model <name>` is now persisted instead of dropped: the agent's self-declared model id lands on `state_executions.model` and is denormalized onto the `state_findings.model` / `state_summaries.model` rows the same record writes, so every probabilistic analysis answers "which model, when" without joins. `sm findings` renders it alongside the confidence, and the drain skill instructs agents to declare it.

  ## User-facing

  Analyses now remember which AI model produced them: agents report their model when closing a job, and `sm findings` / `sm show` display it next to each result together with its date.

- First built-in finder Analyzer: `core/ai-redundancy-analyzer` (probabilistic, stable, enabled by default) judges a node for internal redundancy through the job queue and lands `type: redundancy` rows in `state_findings`; its report schema narrows the finding type so the finder can only emit its own judgment. The spec gains the `findings-contract` / `findings-contract-kind` conformance pair covering the rendered findings-envelope report contract and the frozen `extensionKind: analyzer` job row.

  ## User-facing

  New AI review that flags repeated instructions inside a file, on by default: queue it with `sm job submit ai-redundancy-analyzer` and read the judgments with `sm findings`.

- Jobs never expire by default (Decision #139): an interactive drain can hold a claim while its user deliberates. `state_jobs.ttl_seconds` is nullable; expiry arms only from explicit operator sources (`--ttl`, with `0` disarming, `jobs.perExtensionTtl`, or the global opt-in `jobs.ttlSeconds`), the estimate-driven grace formula and its `graceMultiplier` / `minimumTtlSeconds` config keys are retired, and the new `jobs-overdue` doctor check advises on long-running TTL-less jobs.

  ## User-facing

  Queued jobs no longer time out on their own, so an agent can pause mid-job and ask you how to proceed without losing the work. Set `--ttl` (or the `jobs.ttlSeconds` setting) if you want expiring jobs back; `sm doctor` now flags jobs running far longer than expected.

- `sm plugins show <plugin>/<ext>` now renders a probabilistic extension's two contract files inline: the verbatim `prompt.md` template under a Prompt section and the pretty-printed `report.schema.json` under a Report schema section (`--json` gains `promptTemplate` / `reportSchema`). The prompt is the extension's essence under the forms model, so the inspector surfaces it without disk spelunking.

  ## User-facing

  `sm plugins show` now displays the full prompt and answer format of any LLM-backed extension, so you can read exactly what a queued job will ask an agent to do before submitting anything.

- Preamble v2 (Decision #140): rule 4 now permits file edits ONLY when the extension template explicitly directs an edit as the job's purpose (unblocking fixer Actions; code execution and URL fetching stay absolutely forbidden, user-content can never mandate anything), the wording moves from "runs actions" to "prepares analysis jobs" with "extension" throughout, and the closing line names the Report contract section. Conformance fixture recut as `preamble-v2.txt`; every job re-keys.

  ## User-facing

  The safety instructions inside every queued job got a v2: agents may now edit files when a job's own instructions say so (never because of file content), which enables upcoming fix-it jobs.

- Add the queue inspector: a `GET /api/jobs` BFF endpoint (registry-less `jobs` envelope, the record nonce stripped from every row) and a new workspace-rail Queue tab listing the whole job queue live, with a status glyph, node-first columns, node/extension search, status filter chips carrying live counts, optimistic per-row cancel, pagination, and bidirectional node selection through the shared path bus. The rail is now an activity bar plus a tabbed Files / Queue panel.

  ## User-facing

  **See and manage the whole job queue.** A new Queue tab lists every job with its status, lets you search and filter them, cancel jobs inline, and page through the list. Selecting a job highlights its node on the map, and vice versa.

- Queue inspector write affordances (Step 17, slice 2): a failed row gets a Retry button that re-submits the same extension + node via the existing node-jobs route, Cancel moves inline into the status cell, and a bulk toolbar behind a confirm dialog cancels all active jobs or clears failed / finished ones via the new cancel-all + prune endpoints. Rows now sort strictly by age, cancelled rows render struck-through, and the running-job Cancel tooltip warns the stop is best-effort.

  ## User-facing

  **Manage jobs from the queue panel.** Retry a failed job, cancel a running one inline, or use the bulk buttons to cancel every active job or clear out failed / finished ones at once. Cancelled jobs show struck-through, and cancelling a running job is best-effort.

- Removes `sm job run`, `RunnerPort`, `ClaudeCliRunner` and the submit `--run` flag: skill-map never spawns an agent. External agents drain the queue instead: `sm job claim` now reaps expired jobs first and stamps `runner=agent`, and `sm record --json` streams the synthetic run envelope as ndjson (`run.started` through `run.summary`, per `spec/job-events.md`).

  ## User-facing

  **Your agent runs the jobs, not skill-map.** `sm job run` is gone: point any agent (Claude Code, Codex, whatever you use) at the queue and it drains it with `sm job claim` and `sm record`. Nothing gets executed behind your back.

- Retire the on-disk job-files model: rendered job content is now stored DB-only in a new `state_job_contents` table (content-addressed by hash) and execution reports are stored inline as JSON on `state_executions`, so there is no `.skill-map/jobs/` directory to manage. `sm job prune` drops its `--orphan-files` flag and no longer walks the filesystem; its retention pass now also collects orphaned content rows in the same transaction that prunes terminal jobs.

- The BFF serves the agent-drain-skill endpoints (`GET/POST /api/agent/install`, `POST /api/agent/uninstall`, 412 consent gate, same engine as the CLI verbs), and Settings → Project gains the matching Install skill / Update skill / up-to-date button with confirm dialogs and uninstall. The materialised `sm-run-queue/` folder is ignored by scans out of the box (bundled default, `!`-re-includable).

  ## User-facing

  **Install the drain skill from the UI.** Settings → Project now offers "Install skill" (and "Update skill" when your copy is outdated): one click teaches your agent to drain the job queue, no terminal needed.

- New `sm agent install / uninstall / status` verb family: materialises the bundled `sm-run-queue` skill into the active lens's skill territory (`.claude/skills`, `.agents/skills`, ...; `--for <provider>` overrides), so any agent runtime learns the queue drain protocol. Install is three-state (installed / updated / already up to date, byte-compared against the bundled template); status reports `stale` when the materialised copy predates the current CLI.

  ## User-facing

  **Teach your agent to drain the queue.** Run `sm agent install` once and your agent (Claude Code, Codex, or any runtime reading the skill folder) picks up the `sm-run-queue` skill: ask it to "drain the queue" and it claims, executes, and records your jobs.

- The inspector's AI-actions launcher becomes two-state finder buttons plus an Automatic toggle: a finder with a matching fixer is ONE button that morphs Detect ⇄ Fix by the node's open findings (the fixers row is retired), and the toggle makes it one-click detect+fix. Backing it, a per-job `autoFix` flag frozen at submit (`--auto-fix`, POST body, or toggle) chains all matching fixers at record. `prob-extensions` reshapes to `{ finders, standalone }` with `fixerIds` + `hasOpenFindings`.

  ## User-facing

  Each analysis button in the inspector now detects, then turns into its fix once something is found, so there is one button instead of two. Flip the Automatic toggle to make it detect and fix in a single click.

- The collection verb namespaces go plural (breaking, pre-1.0): `sm job` becomes `sm jobs` and `sm sidecar` becomes `sm sidecars`, aligning them with `plugins` / `actions` / `findings` under one rule (a browsed collection is plural). No singular alias. The queue-processing concept renames from "drain" to "process", and the agent skill is renamed `sm-run-queue` to `sm-process-jobs`.

  ## User-facing

  `sm job ...` is now `sm jobs ...` and `sm sidecar ...` is `sm sidecars ...` (no old aliases, update scripts). The queue-processing skill is renamed `sm-process-jobs`; run `sm agent install` to get it.

### Patch Changes

- The `sm-run-queue` drain skill no longer forbids the file edits that fixer jobs require. Its blanket "a job's only output is its report; never edit project files" rule predated the preamble v2 fixer capability and told draining agents not to do a fixer's work. It now says the rendered prompt is authoritative: most jobs produce only a report, but a fixer whose prompt directs a named-file edit as its purpose gets that edit made. Reinstall with `sm agent install`.

  ## User-facing

  Fixed: the agent drain skill told agents never to edit files, which blocked the new fix-it jobs from doing their work. Run `sm agent install` to update your copy.

- The `sm-run-queue` drain skill now tells the agent to `sm scan -n <path>` the file it edited for a fixer job. skill-map learns about edits only from a scan, so until one ran, `sm findings` kept reporting its judgments as fresh against a body that no longer existed on disk. The agent that changed the file is the one that knows, so it owns the re-scan. Reinstall with `sm agent install`.

  ## User-facing

  After an agent applies a fix it now re-scans that file, so results stop describing the version it just replaced. Run `sm agent install` to update your copy.

- Schema-drift advisories now point at `sm scan` alone: scan is a drift-owning verb that deletes and recreates the drifted DB by itself, so the previously prescribed `sm db reset --hard` first step was a redundant detour for the same outcome. The write-refusal, read-failure, and read-warn advisories all drop it (`spec/db-schema.md` §Schema drift).

  ## User-facing

  When your project database is outdated after an upgrade, the error now just says to run `sm scan` (which rebuilds it in one step) instead of a two-command sequence.

- Schema-drift hygiene for non-drift-owning verbs: read verbs whose query fails because of drift now surface the clean drift advisory (exit 2, naming `sm scan` as the remedy) instead of a raw SQL error, and every row-mutating verb (the `sm job` family, `sm record`, `sm findings prune`, `sm refresh`, `sm plugins trust` / `enable` / `disable`, `sm orphans reconcile` / `undo-rename`) refuses cleanly on drift BEFORE loading the plugin runtime, instead of misleading symptoms like `extension not found`.

  ## User-facing

  When skill-map's local cache predates an upgrade, commands now tell you exactly that and how to fix it (`sm scan`), instead of crashing with a database error or claiming an extension does not exist.

- The `sm findings` bucket flags become filters: `--fixed` now shows ONLY the fixed rows and `--stale` ONLY the stale ones (their union when combined), instead of appending the hidden bucket to the default listing. The excluded-count reporting stays a default-view-only honesty device; an explicit bucket filter is the operator's own narrowing, like `--type`.

  ## User-facing

  `sm findings --fixed` now lists just the fixed findings (and `--stale` just the stale ones) instead of mixing them into the full list, so reviewing what a fixer did no longer means scrolling past everything else.

- `sm findings` no longer reports a clean node while hiding stale judgments. The default filter excludes stale rows, but the empty result printed a bare `No findings` with a success glyph, which reads as "nothing was found" when the finders had in fact judged the node and an edit merely aged their verdicts. Human mode now says `No fresh findings` plus the hidden count and its remedy, listings footer the hidden count, and `--json` carries `staleExcluded`.

  ## User-facing

  `sm findings` used to say "No findings" after you edited a file, hiding results that were merely outdated. It now tells you how many are hidden and how to see them (`--stale`) or refresh them.

- `sm findings` human output now prefixes each finding row with its numeric id (right-aligned per node section so the severity glyphs stay in one column), the handle you pass to `sm findings resolve <id>`. Previously the id showed only in `--json`, forcing a jq/grep detour to act on a finding.

  ## User-facing

  `sm findings` now shows each finding's id at the start of its row, so you can pass it straight to `sm findings resolve <id>` without digging through `--json`.

- The prose fixers now RESOLVE a choice only the author can make by asking, not deferring: their prompts direct the processing agent to present the concrete options as a choose-one question (an `AskUserQuestion`-style prompt) and apply the pick in-session (recorded `fixed` / `by: human`), falling back to a `human-decision` note only when the run is non-interactive. The `sm-process-jobs` skill was aligned to permit the choose-one interaction.

  ## User-facing

  When an AI fix needs a call only you can make, the agent now asks you to pick from concrete options right there (via the Claude Code question interface) and applies your choice, instead of only leaving a note for later.

- The three fixer prompts (`ai-redundancy-action`, `ai-contradiction-action`, `ai-incoherence-action`) now tell the draining agent the embedded copy is a submit-time snapshot: a sibling fixer may have edited the file since, so it reads the live file before editing and declines findings already resolved. The `sm-run-queue` drain skill gains matching fixer guidance: confirm the edit with the user when interactive, edit and report when unattended. `sm agent install` refreshes a materialised copy.

  ## User-facing

  Fix jobs now tell agents to read the live file instead of trusting a possibly-outdated snapshot, and to check with you before editing when you are there. Run `sm agent install` to refresh the skill.

- Fixers no longer refuse a node whose findings merely went stale. Staleness is node-level, so any fix stales every finding on the node, including ones about untouched sections whose defects are still present; excluding them discarded valid judgments and forced a re-detection between fixes. The injection now includes stale findings flagged `stale: true`, the agent verifies each against the current body and declines what no longer applies, and submit refuses only when no matching findings exist.

  ## User-facing

  You can now queue every fixer for a file in a row: fixing one issue no longer blocks the rest with "no findings to resolve". Agents check each older finding against the current text and skip the ones already gone.

- The graph view adopts Foblex Flow 19: node connectors move to the unified `fConnector` model (plain node ids, connection-level sides), selection becomes single-owner (Foblex's selection drives the inspector/highlight state through one bridge), and the v19 opt-in keyboard layer is enabled with connection-creation and delete actions unbound for the read-only map.

  ## User-facing

  The map is now keyboard-navigable: Tab into it, move between nodes with the arrow keys (Ctrl+arrow follows the links), Home/End jump to the first/last node, Space plus arrows moves a node, and +/- zoom. The selected node opens in the inspector, same as clicking.

- The incomplete-namespace hint (`sm jobs` with no subcommand) no longer passes off a three-item sample as the full list: past three subcommands the line reads `..., and N more.` so `Available subcommands:` stops implying exhaustiveness. Observed live on `sm jobs`, which showed 3 of its 9.

  ## User-facing

  Typing a bare namespace like `sm jobs` now tells you how many more subcommands exist beyond the three examples shown, instead of looking like a complete list.

- Fix: the inspector's Activity tab now refreshes its AI-run history live on job completion. It subscribed only to runtime frames (`node.activity`, `agent.spawn`) and re-scans, but `sm record` closes an AI job by pushing `job.completed` (no `node.activity`), so a run that changed no file (finder or summarizer) did not surface until an unrelated refresh fired. The Activity refresh now also merges the job-event stream, so a finished AI run appears immediately.

  ## User-facing

  The inspector Activity tab now shows a finished AI review right away, even when the run did not change any file (finder or summarizer runs); before, those sometimes only appeared after navigating away and back.

- The inspector's AI-actions launcher drops the Finders / Standalone group labels and their wrappers, rendering every finder and standalone action in one flat button row (finders first, then standalone). A new ALL button leads the row and queues every analysis on the current node in one click, each in its current mode (Detect, Fix, or Detect+fix per the Automatic toggle), skipping entries already running.

  ## User-facing

  **One-click run everything.** The inspector's analysis launcher loses its group labels and lines every button up in a single row. A new ALL button on the left runs every analysis on the selected node at once, each in its current mode.

- The inspector's AI-actions launcher buttons drop the hardcoded `secondary` severity so they track the theme's primary color like every other inspector action button; the Stop control uses the `danger` severity, matching its destructive intent.

  ## User-facing

  The AI-action buttons in the inspector now match the app theme instead of rendering in a flat grey.

- Inspector action-button and AI-actions launcher tooltips now open to the left and append to `body`, so they no longer collide with the right screen edge or clip inside the inspector's scroll container. The activity "capture on" chip now renders only when conversation capture is enabled and the node has at least one retained spawn, instead of showing on every node whenever the global capture gate is on.

  ## User-facing

  **Inspector tooltips and the capture badge.** Button tooltips in the inspector now open toward the screen instead of getting clipped at the right edge, and the "capture on" badge shows only on nodes that kept conversations, not on every node while capture is on.

- Dev-tooling majors: c8 moves to 12.0.0 (coverage runner for `test:coverage:html`), and the e2e workspace aligns its TypeScript (6.0.3) and @types/node (26) with the rest of the repo.

- Routine minor/patch dependency refresh: hono 4.12.30, @hono/node-server 2.0.10, zod 4.4.3, @sentry/node 10.66.0, posthog-node 5.45.2, kysely 0.29.3, js-yaml 5.2.1, ws 8.21.1, ignore 7.0.6, plus dev tooling (eslint 10.7.0, typescript-eslint 8.64.0, tsx, @types/node 26). The bundled UI refreshes in lockstep (posthog-js, @sentry/angular, markdown-it, dompurify 3.4.12 with its override, fontawesome, vitest) and e2e moves to Playwright 1.61.1 with the CI container image.

- Fix orphaned design-token references in the bundled UI and align its TypeScript with the CLI workspace (6.0.3). Custom CSS referenced tokens no theme ever emitted (`--p-warn-color`, `--p-danger-color`, bare `--p-border-radius`, a `--p-primary-color-300` typo), so those elements silently lost radius, colors, or glow; they now use the project's `--sm-severity-*` / `--sm-radius-md` tokens and the real `--p-primary-300`. Toggle buttons swap the deprecated `styleClass` input for `class`.

  ## User-facing

  Small visual fixes: some banners and chips recover rounded corners and warning colors that a stale style reference had silently dropped, and the selected-node glow on the map is back.

## 0.88.0

### Minor Changes

- The antigravity activity adapter now maps a live MCP tool call to a PATH signal on the `mcp://<server>` node. Antigravity funnels every MCP call through a generic `call_mcp_tool` wrapper carrying the server in `toolCall.args.ServerName`, so the adapter reads that (not a `mcp__<server>__<tool>` name like Claude / Codex) and lights the same node `core/mcp-tools` draws from frontmatter. The `PreToolUse` matcher widens to `^(view_file|call_mcp_tool)$`; re-run the activity installer.

  ## User-facing

  Under the Antigravity lens, calling an MCP tool (like Notion) now lights its node on the map in real time, the same as Claude and Codex. Re-run the activity installer so the hook catches MCP calls.

- OpenCode gains config-side MCP discovery: the opencode provider declares an `mcpConfig` source over `opencode.json`, and the JSON dialect now tolerates OpenCode's `mcp` top-level key plus its `type: remote/local` / `enabled` server shape (unlike Antigravity, OpenCode's MCP config is project-local and committable). So an `mcp://<server>` node materialises config-side from `opencode.json`, the same node `core/mcp-tools` draws from a skill's `tools:` frontmatter.

  ## User-facing

  Under the OpenCode lens, MCP servers declared in your project's `opencode.json` now appear on the map as `mcp://` nodes, even when no skill references them.

- The opencode activity adapter now maps a live MCP tool call to a PATH signal on the `mcp://<server>` node, closing the last live-invocation gap. OpenCode names MCP tools `<server>_<tool>` in `input.tool` with no explicit marker (a Notion call arrives as `notion_notion-create-pages`), so the adapter reads the server as the prefix before the first `_` and lets the resolver drop non-`mcp://` misses. The plugin already forwards every `tool.execute.before`, so this needs no reinstall.

  ## User-facing

  Under the OpenCode lens, calling an MCP tool (like Notion) now lights its node on the map in real time, completing live MCP invocation for all four supported runtimes.

### Patch Changes

- Orphan-sidecar discovery now inverts `sidecarPathFor` for both anchor forms, so a `.sm` next to a non-`.md` node (a Codex `.toml` sub-agent, whose sidecar is `X.toml.sm`) resolves to its real sibling instead of a hardcoded `X.md`. An annotated Codex agent no longer emits a spurious `annotation-orphan` warning and `sm sidecar prune` no longer treats it as prunable; genuine orphans (append-form sidecars whose node is gone) still surface.

  ## User-facing

  Annotating a Codex sub-agent (a `.toml` file) no longer raises a false "orphan sidecar" warning when you scan. Its annotations attach as expected, and prune leaves it alone.

- The Files view now labels every leaf by its real filename with extension, keeping the folder path in the dimmed prefix, instead of a folder-derived name that dropped the filename. A skill's `<name>/SKILL.md` shows its containing folder as the bold name with `/SKILL.md` as a dimmed tail, so the folder is never repeated and `SKILL.md` never competes as a second bold name, across tree, folder-row and flat modes and even when a skill is scanned under a foreign provider lens.

  ## User-facing

  The Files list now shows each file's real name (like `intro.md`). For a skill, it shows the skill's folder name in bold and de-emphasizes the `SKILL.md` file inside, so labels are clearer and never read redundantly.

- Node cards no longer show a "0 B" byte size for virtual / derived nodes (`mcp://<server>`), which have no backing file. The byte pill now hides when a node carries no file mtime, the way the tokens pill already hides on a null count.

  ## User-facing

  MCP nodes on the map no longer show a meaningless "0 B" size.

- Virtual nodes (e.g. `mcp://<server>` derived from a skill's `tools:` frontmatter by `core/mcp-tools`) now survive a cached rescan. `scan_nodes` gains `virtual` + `derived_from_json` columns so a DB-loaded prior recognises synthetic nodes, and the walker carries them forward when their source is a cache hit (the source's extractor is skipped, so nothing re-emits the node). Previously such a node vanished on the first incremental / `sm serve` rescan even though its source still referenced it.

  ## User-facing

  An MCP node drawn from a skill's tool list (with no separate MCP config file, as under the Antigravity lens) no longer disappears from the map after the live watcher's first rescan.

## 0.87.0

### Minor Changes

- Codex now lights the map live when the model calls an MCP tool. The `codex` activity adapter maps a `PreToolUse` for an `mcp__<server>__<tool>` call to a PATH signal on the `mcp://<server>` node (matcher widened to `^(spawn_agent|mcp__.+)$`), reusing the shared `mapMcpInvocation` (Codex reports the same `mcp__` hook tool name as Claude). The `realtime-codex` fixture gains a deepwiki MCP server and a `demo-skill-mcp`.

  ## User-facing

  When your Codex session calls an MCP tool, skill-map now lights up that MCP node on the map live, the same as Claude Code.

- Promotes the `core/mcp-tools` extractor from `experimental` to `beta`, so it now ships ENABLED by default. A project whose skills or agents declare `tools: [mcp__<server>__<tool>]` in frontmatter gets the `mcp://<server>` nodes and reference edges on the map out of the box, no manual enable needed. Justified now that config-side discovery and live invocation (claude + codex) have landed.

  ## User-facing

  MCP tools declared in your skills or agents now show on the map by default: skill-map draws the `mcp://<server>` node and an arrow to it without you enabling anything.

### Patch Changes

- The graph-view live-activity execution halo is smaller and dimmer (tighter inset, less blur, roughly half the opacity), and the bottom-toolbar camera / layout buttons (zoom, fit-to-screen, re-arrange) no longer turn off Follow the Activity: they reposition the camera now and follow re-grabs it on the next activity change. Only the follow toggle, isolate-neighborhood, and the files-view deep-link center still disarm follow.

  ## User-facing

  The map's glow around a running node is now subtler, and the camera buttons (zoom, fit, re-arrange) no longer switch off Follow the Activity: they move the view now and follow re-centers on the next step. Only the Follow toggle turns it off.

## 0.86.0

### Minor Changes

- Bare `sm` (no arguments) in a folder that has files but no `.skill-map/` project now offers to bootstrap it: on an interactive terminal it shows a yes/no confirm (default yes) that runs `sm init` and, on success, continues into the Web UI server (`sm serve`). Declining, a non-interactive stdin, or an empty folder keep the previous behavior (the getting-started menu or the one-line hint plus exit 2).

  ## User-facing

  Run `sm` in a folder that already has files but no project and it now offers to set skill-map up for you; accept and it initializes, scans, and opens the map.

- MCP support lands in three parts. A declarative `mcpConfig` Provider capability and a shared kernel MCP parser materialise `mcp://<server>` nodes from a project's config files, canonical over the consumer-side `core/mcp-tools` emission. Live MCP tool calls light the same node: `node.activity` gains `detail`/`access` and the recent ring records typed `mcp`/`read` entries with `caller`/`target`. A read-only MCP server (`spec/mcp-server.md`) is specified on `sm serve` at `/mcp` (off by default).

  ## User-facing

  The map now shows the MCP servers your project configures and lights them live when an agent calls a tool. The inspector logs each MCP tool call and file read with who ran it. `sm serve` gains an opt-in read-only MCP server at `/mcp` (spec only so far).

- Implements the read-only MCP server for `sm serve`: an opt-in Streamable HTTP endpoint at `/mcp` (stateful sessions) exposing four query tools (query_graph, get_node, list_issues, get_branch) and skillmap:// resources for graph, issues, activity, and per-node views, with live `notifications/resources/updated` off the scan broadcaster. Enabled via `--mcp` / `--no-mcp` or the project-local `mcp.server.enabled` (off by default, toggleable from Settings > Project), behind the loopback-Origin gate.

  ## User-facing

  `sm serve --mcp`, `mcp.server.enabled`, or a Settings > Project toggle now exposes an opt-in, read-only Model Context Protocol server at `/mcp`, so an MCP host like Claude Code can query your project graph as tools and read it as resources, with live updates as the map changes.

- The blanket `pluginTrust.projectEnabled` opt-in (the config key plus its Settings toggle that trusted every plugin the project enables) is removed. Plugin import trust is now per-plugin only: `sm plugins trust <id>` / the Settings Trust button, or `sm plugins trust --all` to trust every discovered drop-in at once. A single config toggle can no longer widen the local code-execution surface. Settings > Plugins also gains a consolidated restart notice when a drop-in changes trust or enable state.

  ## User-facing

  The "Trust plugins this project enables" setting is gone. Trust plugins one by one (the Trust button, or `sm plugins trust <id>`), or run `sm plugins trust --all` to trust them all. Settings now shows a clear "restart to apply" notice after a plugin trust or enable change.

### Patch Changes

- `sm activity install` for `plugin-file` providers (opencode-style) now writes an ESM-pinning `package.json` (`{ "type": "module" }`) next to the generated in-process plugin so the vendor runtime loads its `export`-based `.js` without a `MODULE_TYPELESS_PACKAGE_JSON` warning (or a hard parse error under a CommonJS host). Written only when the plugin dir has no `package.json` (never clobbering the vendor's shared dir); uninstall removes it only when it is exactly ours.

  ## User-facing

  `sm activity install` now drops a small package.json next to a plugin-file provider's hook so your tool loads it without a module-type warning. It won't overwrite a package.json already in that folder.

- The inspector's Activity section now refreshes live off the `node.activity` / `agent.spawn` streams (debounced), so a node's recent-execution rows, counters, and spawn threads update the moment the assistant runs, instead of waiting for the next watcher re-scan.

  ## User-facing

  The inspector's Activity panel now updates live while your assistant runs: recent executions, counters, and spawn threads refresh as they happen, not only on the next scan.

- `sm plugins create` now emits a root `package.json` (`{ "private": true, "type": "module" }`) so Node loads a plugin's ESM `.js` extensions without the `MODULE_TYPELESS_PACKAGE_JSON` warning, and `sm plugins upgrade [<id>]` backfills it on older plugins (adding a missing `type` without clobbering a non-module one). The plugin author guide documents the module-type requirement and the Provider `activity` capability, and the quickstart adds the `sm plugins trust` step.

  ## User-facing

  New drop-in plugins now ship a package.json so Node loads them without a module-type warning. Run `sm plugins upgrade` to add it to plugins you created earlier. The plugin docs now cover the trust step and how a provider wires live activity.

- Enabling the project plugin-trust toggle in Settings now surfaces a restart warning (a `p-message` banner under the row plus a note on its own line in the trust confirm dialog), the workspace files-follow toggle uses a clearer swap icon, and user-facing strings that pointed at `sm serve` now use the bare `sm` alias across settings, inspector, server advisories, activity hints, and the `sm example` next-steps.

  ## User-facing

  Turning on "Trust plugins this project enables" in Settings now reminds you to restart so the change takes effect, and hints across the app and CLI now show the bare `sm` command instead of `sm serve`.

## 0.85.0

### Minor Changes

- Lowers the default scan corpus ceiling `scan.maxScan` from 50000 to 5000 files. Projects above the limit now truncate by default (extra files are left out of the map, not scanned or reference-validated), and `sm scan` prints a reworded advisory pointing at `.skillmapignore` to filter noisy folders (e.g. node_modules/, dist/, build/) or `--max-scan <N>` to raise the limit. Fully overridable per project via `scan.maxScan` in settings.json or per invocation via `--max-scan`.

  ## User-facing

  skill-map now scans up to 5000 files by default (was 50000). Larger projects get a terminal notice suggesting you filter noisy folders with .skillmapignore, or raise the limit with --max-scan. You can set any value under scan.maxScan in .skill-map/settings.json.

### Patch Changes

- `POST /api/activity` now emits one diagnostic log line per ingested event so an operator debugging a Provider's live-activity wiring (`sm serve --log-level info`) sees whether a hook fired and where it ended up, instead of the silent 202 short-circuits. The line names the provider, a sanitized hook-type discriminator, and the outcome (resolved with counts / no-signals / no-nodes / unresolved at INFO; no-provider and token mismatch at WARN). The event body is never logged.

  ## User-facing

  Run `sm serve --log-level info` to see one line per live-activity event: which provider and hook fired, and whether it resolved, mapped nothing, or was dropped (e.g. an untrusted provider). Hard drops and token mismatches show even at the default level.

- Switching the active-provider lens from the marker-drift notice now dismisses it. `PATCH /api/active-provider` refreshes the `activeProviderMarkers` snapshot to the detected set as part of the switch (mirroring the CLI's `sm config set activeProvider`), so the drift banner clears on a lens change instead of lingering. Previously only the explicit Dismiss (`POST /api/active-provider/accept-markers`) reconciled the snapshot, so switching lens left the notice up.

  ## User-facing

  The "new provider markers detected" banner now goes away after you switch lens from it, not only when you press its dismiss button.

- The workspace files panel gains an opt-in rail toggle that makes it follow the map selection. With the toggle on, selecting a node on the map highlights the matching file in the files list, expands its folders, and scrolls it into view. The toggle sits next to the search controls, ships off by default, and its state is remembered per browser.

  ## User-facing

  The files panel has a new toggle: turn it on and selecting a node on the map highlights that file in the list and scrolls to it. Off by default.

- `sm scan` now prints an info advisory when the scanned corpus has more nodes than the map render cap (`scan.maxNodes`, default 256): the full corpus is still scanned and reference-validated, only the graph view paginates. The in-map render-cap banner is now corpus-aware, so it also fires when the whole project exceeds the cap while the selected branch fits, keeping the signal visible when you drill into a small sub-folder.

  ## User-facing

  When your project has more files than the map can show at once (256 by default), sm scan now tells you in the terminal, and the map banner appears even while you are viewing a small folder. Nothing is lost, the map just draws part of the project at a time.

- Fixes `GET /api/plugins` reporting `status: 'enabled'` for an untrusted drop-in plugin that ships config-enabled (e.g. a `beta` provider). Its code never loads without a local trust grant, so the row now reads `status: 'disabled'` with the untrusted reason (per spec/architecture.md) instead of misleadingly showing as active. Plugin-level, so it covers every kind (provider, extractor, analyzer, action, formatter, hook).

  ## User-facing

  An untrusted drop-in plugin no longer shows as enabled in the plugins list. Until you trust it (Settings, or sm plugins trust), it reads disabled with a hint to trust it, since its code does not run without your trust grant.

## 0.84.0

### Minor Changes

- External drop-in Providers now reach parity with built-ins. A `kinds/<name>/kind.json` may declare `identifiers` / `identifierMismatch`, and the provider manifest accepts `resolution` and `reservedNames`. The loader strips the `activity` capability's runtime-only fields from the validated view, so a drop-in can ship a live-activity adapter; the scan claims a drop-in lens's territory ahead of the markdown fallback; and `sm activity` resolves trusted drop-in Providers, not only built-ins.

- The reference-broken verdict gains an on-disk existence probe: a path-style link whose target exists under any scan root no longer flags broken even when the file is not an indexed node (JSON schemas, images, ignored or oversized markdown). The lazy memoized probe runs in `collectBrokenLinks`, threaded by the scan runner, the watcher, and `scan compare-with`. With those false positives gone, `BROKEN_PENALTY` hardens from 0.5 to 0.75: a broken edge folds to 0.25, above the reserved 0.1.

  ## User-facing

  Links to files that really exist on disk (JSON, images, docs) no longer show as broken references. Only links pointing at genuinely missing files flag now, and they stand out more: their arrows render much fainter on the map.

- The scan now folds the project root `.gitignore` into its ignore stack only when the new committed `scan.respectGitignore` key is enabled (default `false`): out of the box a git-ignored note is still indexed unless the bundled defaults, `config.ignore`, or `.skillmapignore` exclude it. The one-shot scan, `sm scan compare-with`, and the live watcher all honour the flag, and a team-shared toggle sits at the end of Settings > Project.

  ## User-facing

  Skill-map no longer skips the files your `.gitignore` skips by default, so notes you keep out of git now show up on the map. A new team-shared toggle at the end of Settings > Project ("Use .gitignore") turns the old behavior back on for the whole project.

### Patch Changes

- `sm init` now also adds `.skill-map/backups/` to the project `.gitignore`, alongside `settings.local.json`, `skill-map.db`, and `serve.json`. The backups directory (pre-migrate DB snapshots and `sm db backup` output) is a per-machine runtime artifact and must never travel via the shared repo.

  ## User-facing

  `sm init` now keeps the `.skill-map/backups/` folder out of git, so your local database backups never get committed to the shared repo.

## 0.83.0

### Minor Changes

- New built-in analyzer `core/name-mismatch` flags nodes whose declared `frontmatter.name` diverges from their filename/dirname handle: warn for open-standard skills (the spec requires name == dirname), info where the vendor documents the override as legal. `core/name-collision` gains a warn tier for a declared name colliding with another node's file-derived handle; declared-vs-declared stays error and plain markdown stays out of the collision index.

  ## User-facing

  Scans now flag naming drift: a skill whose folder name differs from its name field gets a warning, and an agent or command whose name shadows another file's name is flagged too, so references stop pointing at the wrong file silently.

- Scans now validate an ABSENT frontmatter block against the kind's schema: a claude/codex agent or open-standard skill with no frontmatter at all (or with its fence pushed off the first byte by preceding prose) gets the same `frontmatter-invalid` warning a partial block already got, while all-optional kinds (plain markdown, claude command/skill) validate the empty block clean and stay silent. Malformed-fence heuristics keep precedence, one issue per defect.

  ## User-facing

  **Missing frontmatter is now flagged.** An agent or skill file with no frontmatter at all gets the same warning as one with incomplete frontmatter, including when stray text before the `---` fence made the metadata parse as body. Files that need no metadata stay quiet.

- Frontmatter diagnostics close three silent-loss gaps: a blank line before the opening `---` fence now warns via `frontmatter-malformed`, a declared-but-empty block now runs per-kind validation, and an unquoted `:` in a value gets an actionable quoting hint; a parse error no longer also reports present-but-unparseable fields as missing.

  ## User-facing

  Frontmatter mistakes now get clearer feedback: a blank line before the opening ---, an empty frontmatter block, or an unquoted colon in a value are flagged with hints that say how to fix them, instead of losing your metadata silently.

- Frontmatter diagnostics now detect a metadata block closed early by a stray `---` line inside it: a new `frontmatter-malformed` hint `early-close` names the leaked fields (gated on at least one being a schema-declared property) and suppresses the misleading missing-required report for fields sitting below the stray close; the combined BOM + blank-line accident before the fence now classifies as `byte-order-mark` instead of falling through every heuristic.

  ## User-facing

  A stray `---` line inside your frontmatter is now flagged with the fields that were silently falling out of the block, and a byte-order mark plus a blank line before the frontmatter is called out too, instead of the metadata quietly disappearing.

- Move the web UI's "Live updates" and "Real-time node activity" preferences from browser localStorage to the project-local config: new `ui.liveUpdates` / `ui.realtimeActivity` keys in `project-config.schema.json` (project-local only, stripped from the committed layer), read and written through `GET/PATCH /api/project-preferences` and persisted in `.skill-map/settings.local.json`. The SPA loads them before opening the live socket; the former localStorage keys are simply no longer read.

  ## User-facing

  The Live updates and Real-time node activity switches now live in Settings > Project and stick to the project instead of the browser: flip them once and every browser profile on this checkout sees the same choice.

- Hardened the scan pipeline per a cli-hacker audit: rewrote the HTML-tag stripper and capped the inline-code opener in `strip-code-blocks` to linear time (they could hang `sm scan`/`sm watch`), routed disk-sourced `sm config get`/`list` output through `sanitizeForTerminal` (now also dropping a bare CR), validated the activity `serve.json` port, and made the walker skip symlinks whose target escapes the scan roots by default, with a new `scan.followExternalSymlinks` opt-in gated by `--yes`.

  ## User-facing

  **Scans stay inside your project.** Symlinks pointing outside it are no longer followed (security fix); re-enable via the Follow external symlinks setting (Settings → Project) or `sm config set scan.followExternalSymlinks true --yes`. Config values are sanitized before printing.

### Patch Changes

- Added regression specs pinning two audit fixes: fatal-path errors keep landing on stderr under `--json` / `-q` (stdout stays clean for the JSON contract), and the `-v` verbose logger writes to the Clipanion context stderr instead of `process.stderr`. Test-only, no runtime change.

- Fatal command failures now emit their error text via `printer.error()` (stderr) instead of `printer.info()`, so `--json` / `--quiet` runs no longer exit non-zero with no explanation (44 sites across 9 commands); the `core/update-check` hook receives the update probe injected through the `boot` event payload instead of importing it from `cli/`, and two new lint guards block regressions on both fronts.

  ## User-facing

  **Failed commands now always say why.** When an `sm` command fails, the error message is printed even with `--json` or `--quiet`; previously some failure paths exited with a non-zero code and no explanation.

- The minimal-claude conformance fixture moves its skill from the flat `.claude/skills/hello.md` (which classified as `markdown`) to the directory layout `.claude/skills/hello/SKILL.md`, so the basic-scan case exercises one node per kind as intended; alongside, raw control bytes embedded in the frontmatter-yaml and toml parsers and in safe-text were replaced with escape text, with identical compiled patterns and no behavior change.

- Internal cleanup from a cli-ruler compliance pass: built-in plugin string catalogs renamed from `text.ts` to `<extension-id>.texts.ts` so the em-dash lint gate covers them, the frontmatter-yaml and toml parsers share one parse-error sanitiser (the TOML side now also strips DEL bytes), dead legacy metadata projectors dropped from node-build, the activity templates interpolate the shared `.skill-map` path constants, and the BOM heuristic's key-line probe is bounded to 4 KB.

- Closes the remaining cli-ruler audit findings: the REST contract table in cli-contract.md now documents the implemented preferences, project-preferences, project-ignore, favorites, and update-status endpoints, and architecture.md enumerates all eight PROJECT_LOCAL_ONLY_KEYS members. On the src side, published package metadata and the Claude provider schema descriptions drop their em dashes, and a stale $HOME docstring now points at the closed caller list.

- Resolved the app-ruler UI audit findings: migrated the files-tree row animation from the deprecated @angular/animations DSL to the native animate.enter/animate.leave CSS API (dropping the @angular/animations dependency), hardened UI service signals to read-only exposure, and consolidated the duplicated frame-scheduling and panel-resize helpers into shared modules.

## 0.82.0

### Minor Changes

- Live-activity abstraction hardening for future providers: the in-process plugin template keeps only the shared envelope and splices provider-owned hook registrations (new `pluginHooksSource` runtime field, opencode's generated plugin stays byte-identical), uninstall removes the shared bridge dir only when no other json-hooks provider remains wired, duplicated adapter idioms moved to a shared kernel kit, and the install descriptor became a per-kind discriminated union with a schema gate.

  ## User-facing

  Turning live activity off for one agent no longer breaks it for other agents wired in the same project: the shared bridge now stays in place until the last agent unwires.

## 0.81.1

### Patch Changes

- Real Time polish: the topbar toggle and the node-card execution counter swap the bolt for a wave-pulse icon (the bolt collided with the skill glyph) and the blocked toggle now reads clearly disabled. The conversation dialog no longer prints "Invalid Date" on timestamp-less records and names an empty retained thread. The realtime tutorial installs the hook from Settings > Project (no CLI verbs), explains the ephemeral session capsule, and reopens conversations from the inspector.

  ## User-facing

  The Real Time toggle now uses a heartbeat icon and looks clearly off when blocked. The tutorial installs the hook from Settings, shows why the dashed session capsule exists, and reopens agent conversations from the node inspector. No more "Invalid Date" in empty conversations.

## 0.81.0

### Minor Changes

- Codex live-activity parity: the codex adapter wires the spawn_agent Pre/PostToolUse pair (matcher-scoped, the only tool events) and emits spawn relations with the prompt on start and the child agent_id parsed from the JSON-string response on handoff, plus the stop's last_assistant_message as the conversation response via the generic report path. No custody (codex parents never pause), no execution totals (the payloads carry none); spec table updated from the 2026-07-05 probe.

  ## User-facing

  Codex sessions now get the same live map extras as Claude: spawn arrows between agents, per-edge conversation counters, and opt-in agent-to-agent conversation viewing. Execution totals stay empty on Codex, its runtime does not report them.

- OpenCode live-activity spawn parity: the in-process plugin forwards tool.execute.after wiring-filtered to the task tool, and the adapter emits spawn relations from the task pair (callID as spawnId, prompt on start, the child sessionID plus its final report unwrapped from the task_result envelope on completion, relation-only since the task event never names the parent agent). session.idle confirmed nap-free; spec table updated from the 2026-07-05 probe.

  ## User-facing

  OpenCode sessions now draw spawn arrows with per-edge conversation counters and opt-in conversation viewing, with the child's full reply captured natively; the demo fixture mirrors the Claude one (3-turn conversation, unlinked scout, report skill).

- sm-tutorial: new "Real time: watch your agent run" part after the daily loop (wire the hook with its consent prompt, restart and watch nodes light up, opt-in conversation capture, and a closing known-gaps note per provider), shared across claude/codex/antigravity/opencode with per-provider trigger deltas; on the agent-skills lens the part explains it needs a runtime with an activity adapter. Internal part order renumbered (cli 4, extend 5).

  ## User-facing

  The interactive tutorial has a new part: install the live-activity hook, restart your agent, and watch your tutorial project's nodes glow on the map as it runs. On Claude and Codex it ends with a spawn arrow you can click to read the agent-to-agent conversation.

### Patch Changes

- Antigravity live-activity fix: the conversation Stop only releases the owner's claims when the conversation is FULLY idle (fullyIdle is not false). The runtime fires Stop on every mid-run nap while subagents work (live-verified 2026-07-05), and releasing there darkened the whole chain prematurely; nap stops now disclaim, a missing fullyIdle keeps the old behavior for older runtimes. The per-provider spec table also pins why spawn relations are unmappable on this runtime.

  ## User-facing

  On Antigravity, the map no longer goes dark while the main conversation waits for its subagents; everything stays lit until the whole conversation actually finishes.

## 0.80.0

### Minor Changes

- Live activity: sync spawn completions now carry an execution summary (durationMs, tokens, toolUses, extracted from the runtime's live-verified completion totals) on the spawn relation. The stats accumulator folds them into per-node aggregates (toolUses, tokens, summarizedRuns on the stats shape), retained conversation records keep the per-run summary, and the inspector Activity section plus the conversation dialog turn heads display them.

  ## User-facing

  Agent runs now show how long they took, how many tools they used, and how many tokens they consumed, both per conversation turn in the chat dialog and aggregated in the node's Activity panel.

- Live activity: per-pair spawn counters in the stats accumulator (metadata, independent of the capture gate), exposed as a pairs map on GET /api/activity/summary and as an overwrite-only pairCount field on agent.spawn frames, feeding the UI's edge conversation-count labels and the historical edge click-through into the threaded conversation dialog.

  ## User-facing

  Graph edges now show how many agent conversations passed through them, and clicking an edge that carries a count reopens the same chat dialog the inspector shows, even after the live run ended.

- Live activity v1.1: ephemeral per-node execution stats in the BFF (keepAlive-aware counting, summary endpoint, stats riding node.activity frames), stateless agent.spawn WS frames from the new spawn relation on activity signals, sessionized main owners (main:<session_id>) in claude and codex, and opt-in conversation capture (activity.captureConversations, consent-gated, off by default) retaining both spawn halves, with async responses attached from the child's terminal stop report.

  ## User-facing

  Nodes now show how many times your AI assistant ran them, live dashed arrows connect agents to the agents they spawn (with a session marker when spawned from your chat), a topbar switch toggles Real Time, and you can opt in to view agent-to-agent conversations from the map.

## 0.79.0

### Minor Changes

- New read-only verb `sm activity status [provider]` (normative row in cli-contract.md §Activity): one line per activity-capable provider reporting installed, not installed, or partial (config wired but the shared bridge artifact missing; the inverse reads as not installed because the bridge is shared across hook-file providers), and the `activity install`/`uninstall` help texts now describe both install shapes with opencode examples.

  ## User-facing

  **Check where live activity stands with `sm activity status`.** One line per provider tells you if its hook is installed, missing, or half-broken, plus the exact re-install command that repairs it.

- Antigravity joins live activity: the contract gains three additive install-descriptor fields (`install.group`, `install.commandCwd`, `events[].entryShape`) and a node-less owner-release signal form, the bridge derives its scope root from its own installed location instead of the spawn cwd, and the new adapter lights everything the agent reads via `view_file` and releases the whole chain on conversation `Stop` (demo fixture: `fixtures/realtime-antigravity/`).

  ## User-facing

  **The live map now works with Antigravity.** Run `sm activity install antigravity` and watch skills, workflows and notes light up as the agent reads them, going dark the moment it finishes. Skills invoked with a slash stay dark (Antigravity reports no event for them).

- The codex provider ships the second live-activity adapter: `sm activity install codex` wires `.codex/hooks.json` (same json-hooks convention as claude) and maps `$skill` prompt tokens (same dollar grammar as the `dollar-skill` extractor) plus named SubagentStart/Stop boundaries. The codex row of the spec's informative per-provider table is rewritten to the shipped facts, README gains a live-activity section with a support matrix, and a demo fixture lands at `fixtures/realtime-codex/`.

  ## User-facing

  **Live activity now works with Codex.** Install its hook from Settings or with `sm activity install codex`, then watch your `$skills` and named agents light up on the map as they run (file reads stay dark for now, Codex does not yet expose them).

- The opencode adapter closes the four-provider live-activity set and implements the spec's `plugin-file` install kind: `sm activity install opencode` writes one self-contained in-process plugin at `.opencode/plugin/skill-map-activity.js` (wiring and bridge in a single marker-stamped file, a foreign file at that path is never touched) forwarding named skill / command / agent signals, markdown reads by path, and the native `session.idle` owner release (demo fixture: `fixtures/realtime-opencode/`).

  ## User-facing

  **Live activity now covers OpenCode, completing the set.** Run `sm activity install opencode`: skills, commands and agents light up by name (even asked in prose), markdown reads glow by path, and each session goes dark the instant it idles.

## 0.78.0

### Minor Changes

- The live-activity hook is now manageable over HTTP: `spec/provider-activity.md` gains a normative install-management contract (status probe plus install/uninstall that MUST answer 412 and touch nothing without `confirm: true`), the BFF serves the three routes on a shared `core/activity` engine (CLI verbs byte-identical), and Settings → Project offers install/uninstall for the active lens, with the real-time toggle hinting when the hook is missing.

  ## User-facing

  **Wire the activity hook from Settings.** Install or remove the live-activity hook for your assistant right from Settings → Project, with a clear confirmation before anything touches your files. The real-time toggle now tells you when the hook is missing.

- Live node activity now ends natively instead of by TTL decay: activity signals and the `node.activity` wire gain optional `ownerScope` (a terminal subagent stop releases every claim that owner holds) and `sticky` (lifecycle claims get a long safety-net window), the Claude adapter keeps a spawning parent lit via spawn custody handed to the child only while it still runs (`async_launched`), and `spec/provider-activity.md` is now published and hashed in the spec index.

  ## User-facing

  **Map lights now follow your agents natively.** A node switches off the moment its agent actually finishes instead of fading on a timer, and an agent that delegates work stays lit until its whole delegation chain completes.

- Settings → General gains two live-channel switches persisted in a new localStorage seam (`LivePreferencesService`): one gates the whole `/ws` socket via a new `'disabled'` connection state (distinct from `'lost'`, so the banner never nags about a chosen disconnect), the other gates real-time node activity (off drops buffered frames and clears every lit claim immediately). Both persist and apply atomically through the feature owners' `setEnabled`.

  ## User-facing

  **Live updates on your terms.** Settings → General gains two switches: turn live updates on or off entirely, and toggle real-time node activity (the glow that follows your assistant) separately. Both take effect instantly, no reload.

## 0.77.0

### Minor Changes

- Live activity now lights markdown nodes: activity signals gain a path-based form (`{ path, phase, owner? }`, resolved by exact `node.path` match across providers), and the claude adapter maps `Read` tool events to path signals with a filter-first early disclaim (non-`.md` reads and paths outside the scope root never reach the node set). `sm activity install` switches to refresh semantics so re-running updates skill-map's own hook entries in place.

  ## User-facing

  **Markdown files light up too.** When Claude Code reads any scanned `.md` (your notes, docs, a skill's file), its node now glows on the live map like skills and agents do. Re-run `sm activity install claude` once to pick up the new wiring.

- Backticked `@handle` mentions and `/command` / `$skill` invocations now become graph links: the new `claude/backtick-mention`, `core/backtick-slash`, and `codex/backtick-dollar` extractors match inside code spans and fences, gated post-walk so only tokens resolving to a real entity survive (npm scopes, decorators, shell tokens never link nor flag broken). Claude mentions also resolve to skills and markdown docs via priority-ordered matrices, and usage-example self-loops no longer warn.

  ## User-facing

  Names in backticks or code fences now link on the map when they exist: `@my-agent`, `@my-skill`, `@some-doc`, `/my-command`, and `$my-skill` all connect. Unrelated code tokens (npm packages, shell paths) stay ignored, and a doc showing its own command no longer warns.

## 0.76.0

### Minor Changes

- Live node activity v1 (contract in `spec/provider-activity.md`): Providers gain an optional `activity` capability, `sm serve` publishes `.skill-map/serve.json` (bind address plus per-session token) and serves a token-gated `POST /api/activity` that resolves provider hook events to scanned nodes and broadcasts `node.activity` over `/ws`, `sm activity install|uninstall` wires a zero-dependency bridge into the provider's hook config, and the map lights executing nodes. Ships the `claude` adapter.

  ## User-facing

  **Watch your map light up as your assistant works.** With `sm serve` running, run `sm activity install claude`: every skill, agent, or command Claude Code invokes now glows on the map in real time, and the path between an agent and the skill it runs lights up as one chain.

- Add `server.port` / `server.host` project-config keys, resolved through the normal config layering (defaults, project, project-local) with the `--port` / `--host` flags as the per-invocation override, mirroring the `scan.watch.backend` precedent; `sm serve` records the resolved values in `serve.json` and the loopback-only rule applies regardless of which layer supplied the host.

  ## User-facing

  **Pin your port in config.** Set `server.port` (and optionally `server.host`) in `.skill-map/settings.json` and `sm serve` always boots there, no flags needed; `--port` still wins for a one-off run.

## 0.75.0

### Minor Changes

- Remove the `scan.followSymlinks` setting: the scan walker now always follows symbolic links, to targets inside or outside the project, guarded only by cycle detection (the realpath-containment gate is gone). Change `scan.watch.backend` to `chokidar` (default) or `parcel` and drop the `auto` value, and add a `--watch-backend <chokidar|parcel>` flag on `sm serve` / `sm watch` / `sm scan --watch` that overrides the setting per invocation.

  ## User-facing

  Symlinked folders are now always indexed, even when the link points outside your project. The file watcher defaults to `chokidar`; pass `--watch-backend parcel` on `sm serve` / `sm watch` for very large trees (scales better, but no live updates behind symlinks).

- Surface provider-marker drift in the web UI instead of the server log. `sm serve` / `POST /api/scan` no longer log the `Provider markers changed` warning; `GET /api/active-provider` now returns a `markerDrift` field and the SPA shows a dismissable notice to switch lens or dismiss. Dismissing (`POST /api/active-provider/accept-markers`) reconciles the `activeProviderMarkers` snapshot so the drift clears in both UI and CLI. `sm scan` / `sm watch` keep the warning.

  ## User-facing

  **Marker-change notice moved into the map.** If a new provider folder (like `.claude/`) appears, the map shows a dismissable banner to switch lens or keep your current one, instead of repeating a warning in the server console. Dismissing it remembers your choice.

### Patch Changes

- Set `PRAGMA busy_timeout` on every SQLite connection so a contended writer waits for a held write lock instead of failing immediately with `SQLITE_BUSY` ("database is locked"). Legitimate concurrent access (a second `sm serve`, a `sm scan` while the watcher is live, an editor-triggered rescan) now succeeds once the brief in-flight transaction commits, instead of surfacing a "watcher batch failed" warning.

  ## User-facing

  **No more spurious "database is locked" errors.** Running `sm scan` while `sm serve` is watching (or two servers on one project) no longer fails with a database-locked error; the operations queue and complete.

## 0.74.2

### Patch Changes

- Anchor the watcher runtime's scan roots to `runtimeContext.cwd` instead of `process.cwd()` (the walker's fallback for a bare `.`). A no-op for real `sm serve` / `sm watch` runs, where the two coincide; it keeps the scan, the watcher subscription, and the config layer all anchored to the same directory when a caller supplies a `cwd` that differs from the process cwd.

## 0.74.1

### Patch Changes

- Make the primary scan watcher backend selectable via `scan.watch.backend` (`auto` default, `parcel`, `chokidar`). `auto` uses `@parcel/watcher` (a single native inotify instance that scales to huge trees without chokidar's `EMFILE` failure) and switches to `chokidar` when `scan.followSymlinks` is on so symlinked dirs keep updating live. The meta-watcher stays on chokidar. Defaults preserve existing behaviour.

  ## User-facing

  **Watcher scales to large repos.** The file watcher now uses a native single-instance backend, so `sm serve` / `sm watch` no longer crash with `EMFILE: too many open files` on projects with very many folders. Set `scan.watch.backend` (auto / parcel / chokidar) to force a backend.

- Add an opt-in `scan.followSymlinks` setting (default `false`). When enabled, the scan walker follows symlinked directories and files instead of skipping them, so a softlinked `.claude/skills` is indexed. Following is gated by cycle detection and realpath containment (a link is followed only when its target stays inside the scan roots), and the incremental watcher re-scan applies the same policy as a full scan.

  ## User-facing

  **Scan symlinked folders.** Turn on `scan.followSymlinks` in settings to index skills behind a symbolic link (for example a `.claude/skills` that points elsewhere). Off by default; links pointing outside your project are never followed.

## 0.74.0

### Minor Changes

- Fold the project `.gitignore` into the scan and watcher ignore filter (precedence: bundled defaults, `.gitignore`, `config.ignore`, `.skillmapignore`, where later layers may `!`-re-include) and scope the live watcher to only the file types a scan opens: the registered providers' `read.extensions` (`.md` everywhere, `.toml` under codex) plus `.sm` sidecars. A provider that ships a custom walker disables the extension gate.

  ## User-facing

  **Quieter live map, cleaner scans.** The scan and live map now also respect your project's `.gitignore`, and the live watcher only reacts to `.md`, `.toml`, `.sm`, and `.skillmapignore` changes, so edits elsewhere (including `node_modules`) no longer cause a rescan.

## 0.73.0

### Minor Changes

- Add a dismissable topbar reminder pointing first-time users at `sm tutorial`. Its dismissal persists via a new project-local `tutorialReminderDismissed` config key (`.skill-map/settings.local.json`), read and written through the project-preferences BFF route.

  ## User-facing

  **Tutorial reminder.** The map's header now shows a one-time reminder to run `sm tutorial`, with a dismiss button that remembers your choice for this project.

### Patch Changes

- `sm tutorial` now offers OpenCode alongside Antigravity on the open-standard basic track: OpenCode shows up in the destination prompt and an OpenCode project (detected by `.opencode/`) resolves to the basic walkthrough built on the shared `.agents/skills/` standard.

  ## User-facing

  **OpenCode tutorial.** `sm tutorial` now lists OpenCode as a destination, and running it in an OpenCode project gives you the basic open-standard walkthrough.

- Trim the antigravity and opencode `plugin.json` descriptions to drop text that duplicated their provider extension descriptions (plus a "contributes the runtime identity and reserved built-in names" boilerplate clause the other built-in plugins do not carry); the per-extension provider descriptions still hold the full path-by-path classification detail.

## 0.72.0

### Minor Changes

- Add an `opencode` built-in provider lens for the OpenCode CLI. Under the opencode lens, skill-map classifies OpenCode agents (`.opencode/agent/*.md`) and commands (`.opencode/commands/*.md`), and discovers skills from the three homes OpenCode reads (`.opencode/skills/`, `.claude/skills/`, `.agents/skills/`). Claude compatibility is asymmetric: OpenCode reads Claude skills but not Claude agents or commands, so those fall through to markdown. A `.opencode/` folder auto-detects the lens (beta).

  ## User-facing

  skill-map now recognizes OpenCode projects. Open a repo with a `.opencode/` folder and the map shows your OpenCode agents, commands, and skills (including the Claude-compatible skills OpenCode reads). Pick the OpenCode lens from the lens dropdown.

## 0.71.0

### Minor Changes

- The `@<file>` and `/<command>` grammars are consolidated into one vendor-neutral pair of `core` extractors (`core/at-file`, `core/slash-command`), each gated by `precondition.provider` to the lenses whose runtime reads that syntax. Antigravity now draws `@filename` file references (a file-shaped `@path` becomes a path-resolved `references` edge, the file-picker grammar Codex already had); `claude/at-directive` narrows to bare-handle agent mentions.

  ## User-facing

  Antigravity projects now draw `@filename` file references on the map: an `@path` token in a workflow or skill body becomes an arrow to that file, the same file-picker behavior Codex already had.

- The kernel now flags an unclosed backtick in a node body during the scan walk: an opening fenced block (``` or ~~~) that is never closed, or an inline span whose backtick run has no equal-length closer. The verdict is derived from the same code-strip scanner the prose extractors rely on, so it pinpoints the body-syntax defect where a dangling fence swallows the rest of the file and prose extractors stop emitting edges. The warning is persisted and reused across incremental scans.

  ## User-facing

  Scans now warn when a Markdown file has an unclosed backtick (a code fence ```never closed, or an inline`code` span missing its closer). The warning carries the offending line so you can fix it before it breaks how the file's links are read.

### Patch Changes

- The shared `@`-token grammar (`kernel/util/at-token.ts`) now recognises a multi-level relative prefix (`@../../x`), not just a single `./` / `../` level. So a file-shaped `@`-reference that climbs more than one directory (in a Claude, Codex, or Antigravity body) resolves to its target instead of being silently dropped.

  ## User-facing

  `@`-file references that climb more than one folder (e.g. `@../../docs/guide.md`) now draw an arrow to the target file; before, only single-level `@../x` references were recognised.

- The Antigravity `workflow` kind now uses the same amber as Claude's `command` kind, since a workflow is Antigravity's command-equivalent, so node colors read as one cross-provider vocabulary. The `sm tutorial` open-standard destination is relabelled to lead with the standard (`Standard: Agent skills (Google's Antigravity, others)`), and the basic tutorial track is reframed as the Agent Skills open standard, with supporting vendors noted parenthetically rather than fronting the book.

  ## User-facing

  Antigravity workflows now show in the same amber as Claude commands on the map (a workflow plays the same role as a command). And `sm tutorial` lists the open standard as `Standard: Agent skills (Google's Antigravity, others)` instead of fronting one vendor.

## 0.70.0

### Minor Changes

- Fix the OpenAI Codex connector model, which cloned Claude's grammar and was wrong per the official docs. Under the codex lens, skills are now invoked with `$name` (new `dollar-skill` extractor) not `/name`, `@` is a path-resolved file reference (new `at-file` extractor) not an agent mention, and codex plus the neutral `agent-skills` lens no longer flag skill names as reserved (a `$`-skill cannot shadow a `/` command). Claude and Antigravity are unchanged.

  ## User-facing

  Codex projects: a skill now connects via `$name` (not `/name`), `@file.md` references a file, and a skill named like a built-in (e.g. `model`) is no longer wrongly flagged as a reserved-name collision. `/` is left to Codex's own built-in commands.

- Lens auto-detection now gives a vendor marker precedence over the open-standard `agent-skills` fallback. The `agent-skills` provider declares `detect.fallback`, so its `.agents/` marker resolves a lens only when no vendor marker is present. A project carrying `.codex/` (or `.agent/workflows/`) alongside the shared `.agents/skills/` home now resolves to that vendor outright instead of prompting `codex` vs `agent-skills`. Several vendor markers together still surface an ambiguous prompt.

  ## User-facing

  Codex and Antigravity projects no longer hit a spurious "which lens?" prompt on first scan: a `.codex/` (or `.agent/workflows/`) project is detected as that lens even though it also uses the shared `.agents/skills/` folder. `/` is left to the vendor's own behavior.

- Add an optional `presentation.invocationSigil` to the Provider manifest: the single glyph a lens's runtime uses to invoke a skill (`/` for Claude and Antigravity, `$` for Codex). The BFF projects it into `providerRegistry`, and the link-kind palette now paints the `invokes` edge-kind glyph (and its tooltip example) for the active lens instead of a hardcoded `/`. Lenses with no `/`/`$` invocation channel (`agent-skills`, `markdown`) omit it.

  ## User-facing

  Under the Codex lens, the Invokes connector filter on the graph now shows a `$` glyph, matching how Codex invokes skills, instead of a `/`.

## 0.69.0

### Minor Changes

- Split plugin enable (operational) from import trust (security). Enable/disable now persist to the config layers, not the DB; `config_plugins` becomes a per-plugin local trust store. New `sm plugins trust / untrust` verbs, a trust PATCH route, a Settings UI Trust control, and a `pluginTrust.projectEnabled` opt-in grant or revoke consent to run a project-local plugin. It runs only when enabled AND trusted, so disabling one no longer re-reads as untrusted.

  ## User-facing

  Plugins now have two separate switches: enable (is it part of the project, shared) and trust (may its code run on your machine). New `sm plugins trust` / `untrust` plus a Trust button in Settings. A plugin you disabled stays disabled instead of nagging that it is untrusted.

## 0.68.1

### Patch Changes

- Reworked the `sm tutorial` destination prompt to list providers by vendor name rather than their shared destination folder (several providers share `.agents/skills`), with the open standard shown aka-first. Reorganized the interactive tutorial book: the 'Connect the harness' part is merged into 'The project from zero' so building and wiring the harness is one continuous part, alongside a chapter-by-chapter copy pass across the Claude, Codex and open-standard tracks.

  ## User-facing

  The `sm tutorial` picker now lists each agent by name (Claude, OpenAI Codex, Google's Antigravity) instead of its install folder. The guided tutorial is tighter: building and connecting your project's harness is now one continuous part, with clearer copy throughout.

## 0.68.0

### Minor Changes

- Project-local plugins under `<cwd>/.skill-map/plugins/` are now discovered but their code is NOT imported or executed by the runtime verbs until the operator grants local trust with `sm plugins enable <id>`; the committed `settings.json` cannot grant it, so cloning and scanning a repo no longer auto-runs its plugins. Built-ins and `--plugin-dir` stay exempt. The BFF actions route also rejects a sidecar write whose path escapes the project root (400).

  ## User-facing

  **Project plugins no longer run until you trust them.** Plugins committed in a repo's `.skill-map/plugins/` are now listed but not executed by `sm scan` / `sm serve` until you run `sm plugins enable <id>`, so cloning and scanning a repo no longer auto-runs its plugins.

- The `sm tutorial` book now adapts to the active provider lens via two tracks: a rich track (Claude / Codex, with agents, commands, slash and mentions) and a basic track (the open-standard Agent Skills / Antigravity family, skills and markdown wired by markdown references). Scaffolding for the open standard now lays a complete references-based campaign instead of a Claude-shaped book with gaps, and the provider/lens narration was corrected to the current model.

  ## User-facing

  `sm tutorial` now runs end to end beyond Claude: a basic skills-and-references book on the open Agent Skills standard (agent-skills / Antigravity) and a rich book for OpenAI Codex, each matching how scans resolve your project.

### Patch Changes

- `sm db restore` now validates the source before previewing or swapping: it refuses a non-SQLite file, or a backup written by a newer minor or different major than the running CLI (same version rules `sm scan` applies on open). `--dry-run` and the live swap share one read-only check, so a dry run no longer green-lights a source the restore would reject. Separately, `--max-scan` / `--max-nodes` on `scan` / `serve` / `watch` now reject exponent notation like `1e3`, matching `--port`.

  ## User-facing

  **Safer restores, stricter limits.** `sm db restore` now refuses a backup that isn't a real database, or one written by a newer `sm`, before touching your data. And `--max-scan` / `--max-nodes` reject values like `1e3` instead of silently treating them as 1000.

- `<sm-node-card>` and `<sm-kind-palette>` hardcoded per-kind colours in CSS for only the four core kinds, so any Provider-declared kind (e.g. Antigravity's `workflow`) fell back to neutral markdown grey, icon included. The colour now comes from the kind: the node card binds `--accent` / `--kind-bg` / `--kind-fg` from the runtime kind registry's `--sm-kind-<kind>` vars and the palette binds the accent per button, so every Provider-declared kind paints its declared colour with no per-kind CSS.

  ## User-facing

  **Provider kinds get their own colour.** Node kinds added by providers (for example Antigravity workflows) now show their declared colour in the graph and the kind filter, icon included, instead of falling back to grey.

- Hardened the local server and opt-in telemetry. The BFF Content-Security-Policy now carries `object-src 'none'`, a zero-breakage backstop that blocks plugin-content (`<object>` / `<embed>`) script execution if the markdown sanitizer ever regresses. Separately, the opt-in UI error-telemetry SDK no longer auto-records console, fetch, xhr, or DOM breadcrumbs, which could otherwise carry project paths or request URLs into a report; navigation breadcrumbs stay and are still home-scrubbed.

- Updated every outdated `src/` dependency to its latest exact pin and migrated the code the four major bumps required. The only runtime-touching change is js-yaml 4 to 5: importers switch to named `load`/`dump` with `schema: CORE_SCHEMA`, which emits byte-identical YAML 1.2 so canonical frontmatter and sidecar hashes are unchanged. TypeScript 6, @types/node 26, @hono/node-server and kysely 0.29 needed only build-config and type-cast tweaks. The bumps clear the known CLI-tree advisories.

- Updated UI dependencies to close the advisories from the UI security audit. Angular moves to 21.2.17 (the XSS sanitizer-bypass fixes) and `dompurify` to 3.4.11; a pnpm-workspace override forces `posthog-js`'s bundled `dompurify` to the same 3.4.11 so the shipped bundle no longer carries a vulnerable copy. `@sentry/angular`, `markdown-it`, `posthog-js`, `primeng`, and `vitest` also move to current patches.

## 0.67.0

### Minor Changes

- Give the Antigravity provider its own `workflow` kind and promote it to `beta` (enabled by default). Under the antigravity lens, `.agent/workflows/<name>.md` (singular `.agent`) classifies as a `workflow` node (handle = filename) while skills keep the open-standard `.agents/skills/` classifier. The slash extractor now runs under antigravity, so `/name` resolves to both skills and workflows, reserved verbs are flagged on both, and `.agent/workflows/` auto-detects the lens.

  ## User-facing

  **Antigravity is on by default now.** A project with a `.agent/workflows/` folder auto-detects the Antigravity lens; those files show up as workflows (not plain Markdown), and a `/name` reference links to the matching workflow or skill.

## 0.66.0

### Minor Changes

- The lens selector now offers a single open lens, `agent-skills` ("Agent Skills"), promoted to stable and locked and made the universal default for projects with no vendor marker (replacing the old `markdown` default). The non-gated `core/markdown` becomes the invisible base: it still classifies every orphan `.md` but is no longer a selectable lens. A new `isLens` flag drives the dropdown, and `PATCH /api/active-provider` rejects non-lens ids.

  ## User-facing

  The provider lens picker is simpler: one open "Agent Skills" lens (the default when no vendor like Claude or Codex is detected) replaces the old separate "Markdown" and "Open Skills" entries. Plain `.md` files are still mapped, same as before.

- The Codex lens now classifies open-standard Agent Skills (`.agents/skills/<name>/SKILL.md`, the layout OpenAI Codex actually reads) as `codex`/`skill`, by composing the `agent-skills` open-standard pieces over a new multi-rule `read`. A provider's `read` may now be an array of rules so one provider reads several file families with different parsers (Codex reads `.toml` agents and `.md` skills), and a `/skill-name` invocation in an agent prompt resolves to its skill.

  ## User-facing

  OpenAI Codex projects now show their Agent Skills (`.agents/skills/<name>/SKILL.md`) on the map as skill nodes next to the Codex agents, and a slash invocation from an agent to a skill is drawn as a link.

- The provider / active-lens labels now follow one consistent naming pattern: vendor lenses use a possessive `<Vendor>'s <product>` form ("Anthropic's Claude", "OpenAI's Codex", "Google's Antigravity") and the vendor-neutral open standard uses a `Standard: <name>` prefix ("Standard: Agent skills"). The non-selectable `core/markdown` base keeps its internal "Markdown" label. The provider schema and kernel JSDoc document the pattern.

  ## User-facing

  The provider lens names now read consistently: "Anthropic's Claude", "OpenAI's Codex", "Google's Antigravity", and "Standard: Agent skills". The change shows up in the lens dropdown, the topbar lens chip, and the per-node provider chips.

- The inspector's Body section gains a Raw / Rendered toggle: a button at the top of the expanded section flips between the rendered Markdown and a read-only source view, line-numbered and syntax-highlighted like a code editor (the markdown body, or a Codex agent's `developer_instructions`). The preference is sticky across nodes within the session. No extra fetch, the raw view reuses the content already loaded for rendering.

  ## User-facing

  The inspector's Body section now has a Raw / Rendered toggle: flip between the formatted Markdown and a read-only, syntax-highlighted source view (with line numbers) of a node's body, without leaving the panel.

- The inspector now renders OpenAI Codex agents (`.codex/agents/*.toml`) like a Markdown node: the TOML `developer_instructions` field becomes the Body section (rendered as Markdown) and the other TOML keys the Definition/metadata card, instead of showing the raw TOML file. A new optional `bodyField` on each `providerRegistry` entry (projected from the provider's `read.bodyField`) drives the split, so it stays provider-driven with no hardcoded provider id.

  ## User-facing

  Codex agents (`.codex/agents/*.toml`) now open in the inspector with a proper metadata section and a readable, Markdown-rendered body, instead of a wall of raw TOML.

- The OpenAI Codex provider is now beta (enabled by default): a `.codex/` directory auto-detects the codex lens and `.codex/agents/*.toml` files classify as agents. A Codex agent's prompt (the TOML `developer_instructions` field) flows through the link extractors via the new declarative `read.bodyField` knob, so `@mention` and `[link]` references inside it surface in the graph. `AGENTS.md` is no longer a detection marker (it is the vendor-neutral agents.md standard, common in non-Codex repos).

  ## User-facing

  OpenAI Codex is now a built-in provider. Open a project with a `.codex/` folder and skill-map maps your Codex sub-agents plus the links inside their developer instructions, the same way it does for Claude. Pick it anytime from the provider lens.

- Make `name`/`description` per-kind requirements instead of universal ones: the frontmatter base only defines the two fields, and `required` moves to the kinds whose vendor mandates them (Claude agent, Codex agent, Agent Skills skill), leaving the `markdown` fallback and Claude skill/command optional. Per-kind schemas are re-certified against current vendor docs, and the redundant base check in `core/schema-violation` is dropped so each per-kind schema is the single source of truth.

  ## User-facing

  **Frontmatter checks now follow each vendor's rules.** Plain Markdown files and Claude skills/commands without a `name` or `description` are no longer flagged, and Codex/Claude model fields accept current values like `xhigh` reasoning effort and the `fable` model alias.

- The OpenAI Codex provider and plugin id was renamed from `openai` to `codex`, aligning the id with its `.codex/` marker and the product-name scheme of the other built-ins. The lens value (`activeProvider`), `node.provider`, the conformance scope (`provider:codex`), and qualified extension ids (`codex/codex`) change accordingly. Breaking but greenfield (no released consumers); the displayed lens label "OpenAI's Codex" is unchanged.

  ## User-facing

  The OpenAI Codex provider id is now `codex` (was `openai`). If you set it by hand, use `codex` in `sm config set activeProvider` or `sm plugins enable`. The name shown in the app is unchanged.

### Patch Changes

- Centralize the `backups` directory segment behind a single kernel primitive (`kernelBackupsDir(dbPath)` plus the `BACKUPS_DIRNAME` literal in `skill-map-paths.ts`, re-exported through `core/paths` and the CLI `db-path` helper). The migrations runner's pre-migrate snapshot path and `sm db backup` now both derive `<dbDir>/backups` from that one source instead of composing the literal by hand. Behaviour is unchanged.

## 0.65.0

### Minor Changes

- The vendor-neutral open-skills Provider (`agent-skills`, lens "Open Skills") gains an open-standard base reserved-name catalog under `skill`: a user skill shadowing a universal built-in like `help`/`config` is now flagged by `core/name-reserved`, and Antigravity inherits the base by manifest composition and appends its own verbs. Its `skill` frontmatter schema now enforces the open-standard `name` pattern/length and `description` length. Shared primitives renamed to a `COMMONS_*` vocabulary.

  ## User-facing

  With the Open Skills lens active, a skill you authored that shares a name with a built-in command (like `help` or `config`) now gets a warning, and skill names or descriptions that break the open-standard format (bad characters, too long) are flagged too.

## 0.64.1

### Patch Changes

- Patch release of `@skill-map/cli` with no functional change, used to exercise the changesets version-packages PR and the end-to-end release pipeline.

## 0.64.0

### Minor Changes

- Bare `sm` in an empty folder now offers a getting-started menu: on an interactive terminal it asks whether to run the guided tutorial (`sm tutorial`) or drop a ready-to-explore example project (`sm example`), then dispatches the chosen verb. In a non-empty folder, or on a non-interactive stdin, it still prints a one-line hint and exits 2, now pointing at `sm tutorial` / `sm example` when the folder is empty and at `sm init` otherwise.

  ## User-facing

  Run `sm` in an empty folder and it now asks how you want to start: a guided tutorial, or a ready-made example project to explore. Pick one and it sets it up for you.

- New `sm example` verb: drops a ready-to-explore example project (the same wired harness the public demo renders) into an empty directory, so a new user can run `sm scan` then `sm serve` against a real connected graph without authoring files first. The payload is the single canonical `fixtures/demo-scope/` fixture, shared with the web demo, and ships unscanned (no `.skill-map/`). Refuses a non-empty cwd unless `--force`.

  ## User-facing

  New `sm example` command: run it in an empty folder to drop a small ready-made project, then `sm scan` and `sm serve` to explore it as a live graph. The fastest way to try skill-map without setting up your own files first.

## 0.63.0

### Minor Changes

- The active provider lens no longer has an unlensed (permissive) state. A project with no marker now resolves to the universal `markdown` lens (never null, never persisted, so a later vendor marker still auto-detects) instead of running every provider at once. The Settings dropdown drops the dead `(none)` entry and keeps Markdown as a selectable neutral lens, and `sm serve` now re-scans under the chosen lens after a switch instead of re-detecting it from disk.

  ## User-facing

  A repo with no `.claude/`, `.codex/`, or `.agents/` now opens in the Markdown view instead of mixing every platform together, with no warning. Pick Markdown anytime from Settings to see your files as plain markdown. The empty `(none)` option is gone.

- Removed the `comingSoon` provider flag: not-ready providers use `stability: 'experimental'`, shipping disabled by default (not classified, auto-detected, or selectable until enabled). `openai`, `antigravity`, `agent-skills` are experimental; `agent-skills` is gated to its own lens (only `core/markdown` stays universal). Antigravity reuses the agent-skills classifier, dropping the kernel's cross-provider reservedNames lens-scope. `sm tutorial --experimental` offers them as destinations.

  ## User-facing

  The lens dropdown no longer shows "(coming soon)" rows. Not-ready providers (OpenAI Codex, Antigravity, Open Skills) are hidden until you enable them with `sm plugins enable <id>`; `sm tutorial --experimental` offers them as tutorial destinations.

## 0.62.2

### Patch Changes

- The `/api/branch` map projection now keeps an edge when its RESOLVED target is a rendered node, not only when the raw authored target is. Trigger-style `invokes` / `mentions` links store the trigger (`/cmd`, `@agent`) in `target` and the real node path in `resolvedTarget`; the old filter matched the raw target alone, so every resolved trigger edge was dropped from the graph and the map showed only path-style `references`. Genuinely-broken links (no resolved node) stay excluded.

  ## User-facing

  The graph map again draws `invokes` and `mentions` arrows (a command running a skill, an agent referenced by name), not just plain file references. A recent change had hidden every resolved trigger edge from the map.

## 0.62.1

### Patch Changes

- Audit pass over the bundled `sm tutorial` content: fixed a broken `sm plugins create extractor demo-highlight` command, corrected a contribution that was silently dropped by emit-time slot validation, refreshed the stale `sm plugins doctor` count and UI references, trimmed two redundant chapters from the Extend track, and aligned the chapter-count test with the trim.

  ## User-facing

  **`sm tutorial` cleanup.** The Extend track now runs the right commands end to end (the plugin-authoring walkthrough no longer dead-ends on a broken command or a dropped chip), drops two redundant chapters, and matches what `sm` actually prints today.

## 0.62.0

### Minor Changes

- Splits the scan cap into two knobs: `scan.maxScan` (corpus ceiling, default 50000) bounds what the walk parses and reference-validates, while `scan.maxNodes` (default 256) now caps only the graph render. References resolve across the whole corpus, so large repos no longer flag links to unrendered files as broken. Adds the `--max-scan` flag and the `/api/folders`, `/api/branch`, and `/api/scan?meta=1` endpoints that back the lazy folders tree and branch-scoped map.

  ## User-facing

  Large repos now scan and validate references across the whole tree; check folders (with per-folder issue counts) to choose what the map shows. Map palettes count what is shown; a Reset filters button clears it all; the refresh button spins while any scan runs.

### Patch Changes

- Restores the files rail's per-row stale-clock icon, dropped when the rail switched to building from the lightweight `GET /api/folders` payload (which carried the error / warn counts but not the sidecar drift status). The endpoint now emits a `sidecarStatus` field (the persisted `scan_nodes.sidecar_status`, `null` when there is no parseable sidecar), threaded from the kernel loader through the BFF into the rail so staleness flags corpus-wide in demo and `sm serve` mode.

  ## User-facing

  The files rail again flags out-of-date nodes with the clock icon, so you can see at a glance which files have drifted since their last review.

- Incremental scans now skip unchanged files. The full-walk path (`sm scan --changed`, boot scan, fallback) reads and YAML-parses only files whose on-disk mtime differs from the prior snapshot, reusing the cached node otherwise. The watcher path (`sm serve` / `sm watch`) threads chokidar's exact changed-path set through the scan, enumerating the corpus from the prior snapshot and reading only the touched files instead of re-walking the tree. Results stay byte-identical to a full scan.

  ## User-facing

  **Faster live updates.** Saving a file while `sm serve` or `sm watch` is running now refreshes the map almost instantly, because only the file you changed is re-read instead of the whole project being re-scanned on every save.

- Body extractors now strip raw HTML (comments and tag tokens) before matching, alongside the existing code-region strip. A markdown link commented out as `<!-- [x](old.md) -->` or hidden in an attribute value (`<img alt="[x](y.md)">`) no longer produces a phantom edge. The strip is bounded to comments and tag tokens, so markdown nested inside a `<div>` block still resolves; `core/backtick-path` is unaffected (HTML is not a code region).

  ## User-facing

  Scanning `.md` files that contain HTML no longer creates phantom links or false broken-reference warnings from links that were commented out or tucked inside HTML attributes.

## 0.61.5

### Patch Changes

- Tutorial and inspector polish. The bundled `sm-tutorial` daily-loop part merges the styling and preview chapters into one, serves the site from a third terminal, clarifies the frontmatter rename, reframes the publish confirmation, invites the tester to keep building, and adds a confidence note; the `content-editor` agent uses a free image placeholder. The inspector's tag row gains a `TAGS:` title so a node with no tags no longer shows a lone pencil.

  ## User-facing

  The inspector now shows a "TAGS:" label on the tag row, so nodes with no tags read clearly instead of showing a lone edit pencil. The interactive tutorial's daily-loop part also got several narration and flow improvements.

## 0.61.4

### Patch Changes

- `sm tutorial` now lists coming-soon providers in its destination prompt instead of offering them as real targets. Claude is the only selectable destination; OpenAI Codex, Antigravity, and Open Skills appear greyed as "(coming soon)" and re-ask the tester if picked. The prompt still renders on a TTY even with a single selectable target (so the others stay visible), non-TTY stdin takes Claude silently, and `--for <coming-soon-id>` exits with an unknown-provider error.

  ## User-facing

  Running `sm tutorial` now sets up the tutorial for Claude. Other assistants (Codex, Antigravity, Open Skills) show as "coming soon" in the prompt and cannot be selected yet.

## 0.61.3

### Patch Changes

- Add a `comingSoon` flag to a Provider's `presentation` (spec + kernel). A coming-soon Provider ships in the registry (node chips still render) but is never selectable as the active lens: auto-detect skips its markers, the BFF drops it from `GET /api/active-provider`'s `selectable` set, and the UI greys it with a `(coming soon)` suffix. `openai`, `antigravity`, and `agent-skills` are marked coming-soon, so only `claude` is selectable today.

  ## User-facing

  Only the Claude provider is selectable for now. Codex, Antigravity and Open Skills appear greyed out as "coming soon" in the provider lens, and projects auto-detect Claude without a lens prompt.

## 0.61.2

### Patch Changes

- The bundled `sm-tutorial` skill now demos the `claude` provider only; the other providers (`openai`/Codex, `agent-skills`/Antigravity) are presented as "coming soon". Provider detection always resolves to `claude`, the settings lens step drops the live switch to `openai` and shows only the auto-detected `claude` lens, and the project-kickoff markers prompt tells the tester the other lenses are coming soon. The `--provider` fixture plumbing stays wired so they drop in later.

  ## User-facing

  The interactive tutorial now focuses on Claude only. Other assistants (Codex, Antigravity, agent-skills) show as "coming soon" instead of being offered as setup options.

## 0.61.1

### Patch Changes

- Restructure the bundled `sm-tutorial` daily-loop part toward a UI-first walkthrough: split bringing the site up into a new `preview` chapter (with an express-missing recovery note), drop the orphan-draft / wire-and-improve arc, and rework `broken-ref`, `reserved`, and the renamed `stability` chapter to watch results on the live Map instead of running `sm scan` / `sm check`. Also hardens the publish frontmatter paste guidance and clarifies auto-advance still announces every chapter's number.

- Iterative polish of the bundled `sm-tutorial` skill, found while test-walking it: clearer prologue narration (floating "nodes" not "dots", broken reference reworded off the "bare mention" jargon, fixed edit attribution, stale inspector and Beat-marker notes dropped), a pre-flight HARD STOP so the two-terminals confirmation lands before the menu, a new `edit-link` beat where the tester adds `.md` to resolve the broken reference, an always-reseed fix, and less frontmatter noise on the fixture.

## 0.61.0

### Minor Changes

- `sm version` no longer prints the `kernel` row, and `sm version --json` drops the `kernel` field: the matrix is now `{ sm, spec, dbSchema }`. The CLI and kernel ship in one package and always carried the identical number, so the second row was redundant noise rather than information; the row returns the day the kernel publishes as its own package. Pre-1.0 breaking change shipped as a minor per the versioning policy.

  ## User-facing

  `sm version` no longer shows a separate `kernel` line, it always matched `sm` exactly. The matrix now lists sm, spec, runtime, and db-schema.

### Patch Changes

- Refactor the bundled `sm-tutorial` skill so fixture-file generation and progress tracking run as two zero-dependency Node scripts inside the skill (`scripts/state.js`, `scripts/fixtures.js`) reading a single `fixtures-data/` source of truth, instead of the agent reproducing fixture content verbatim and hand-editing a YAML state file each chapter. State moves to `tutorial-state.json` fed by a generated `references/_manifest.json` sidecar; tester-facing narration is unchanged.

## 0.60.4

### Patch Changes

- Two sm-tutorial fixes from tester feedback: the first-agent chapter no longer repeats its framing (the redundant `Context` field is dropped, so the tester sees the agent-created message once instead of twice), and the scaffolded `.skillmapignore` guidance now guards against broadening the ignore to the whole `.claude/`, which would hide the harness agents and commands the tester builds.

## 0.60.3

### Patch Changes

- The web demo now ships the view-contribution registry, so the node card footer slot icons (tools, links, external refs, issue counts) render in demo mode instead of a bare value with no glyph. The static data source primes it from the bundled meta like the live BFF path does, and the demo build derives it from the kernel. Also reverts the earlier folder/dark-theme icon swap back to Font Awesome (a misdiagnosis: the demo fonts load fine).

- The workspace search now narrows the map by default, not just the files rail: a query filters both surfaces so it focuses the whole workspace at once. The prior default (map keeps its full layout while only the rail narrows) moves behind the rail's search-to-map toggle and the persisted `sm.workspace.search-affects-map` preference (an absent key now reads as on). Tutorial references updated to match.

  ## User-facing

  Typing in the workspace search now filters the map too, not just the files list, so a query focuses the whole workspace. Want the map to keep its full layout? Turn off the search-to-map toggle next to the search box.

## 0.60.2

### Patch Changes

- The map card's file-path folder icon and the dark-theme toggle icon switched from Font Awesome's regular weight (`fa-regular`) to the matching PrimeIcons glyphs (`pi-folder-open`, `pi-moon`). These were the only two first-party icons relying on the `fa-regular` webfont, which is not reliably served on the public demo deploy, so they rendered blank there; PrimeIcons is already the icon set the surrounding controls use, so the icons now render consistently. Icon meaning is unchanged.

## 0.60.1

### Patch Changes

- The graph map's camera behaviour changes on two interactions. Clicking a tag chip on a card now curates the map in place without panning or zooming, so the operator stays on the card they clicked. The explicit re-arrange and fit-to-screen buttons now glide the camera to the new framing instead of snapping, matching the automatic auto-fit that already animated on scan add / remove. Which nodes get framed is unchanged.

  ## User-facing

  Clicking a tag on a card now filters the map without jumping the view around, it stays where you are. And the Re-arrange and Fit buttons glide the map into place instead of snapping, so it is easier to follow where things moved.

## 0.60.0

### Minor Changes

- New committed project setting `allowSidecarWriters` (default `true`) lets shared projects forbid every extension that writes `.sm` annotation sidecars. Actions declare the capability via `writes: ['sidecar']` on their manifest; when the policy is `false` the scan composer drops those actions (buttons never render) and the sidecar store refuses the write (BFF 403 `sidecar-writers-forbidden`), a hard gate that wins over the per-machine `allowEditSmFiles` consent.

  ## User-facing

  Shared projects can now turn off sidecar writers: a new Project setting stops actions from creating or editing the `.sm` files next to your notes. It is saved in the committed settings.json so it applies to the whole team and cannot be overridden locally.

- The inspector tag row (`<sm-node-tags>`) is now an inline editor: `core/node-set-tags` no longer self-projects an `inspector.action.button`; a pencil opens an add / remove editor (shown even with no tags) that offers the tags already present in the graph as click-to-add chips, derived live from the loaded scan; typing a brand-new tag still works. The author guide's self-projection example switched from Edit tags to Set stability.

  ## User-facing

  Edit a node's tags right where they are shown: click the pencil in the inspector's tag row to add or remove them inline, with one-click chips for tags already used in your graph (you can still type new ones). The separate Edit tags button is gone.

### Patch Changes

- Fix the `--analyzers` (CLI) and `?analyzerId=` (BFF) filter so a qualified `<plugin>/<id>` form matches the persisted short analyzer id (issues store the short kebab id with no slash, per `issue.schema.json`). Before, only a short filter matched, so `sm check --analyzers core/node-stability` returned nothing while the bare `node-stability` worked. Both `matchesAnalyzerFilter` and the `/api/issues` SQL now reduce a qualified filter entry to its suffix; the short form is unchanged.

  ## User-facing

  `sm check --analyzers core/<id>` now matches issues, not only the bare `<id>` form.

- Fix a stale doc comment in the `annotation-orphan` analyzer: the header claimed `nodeIds` is empty, but the analyzer sets it to the orphan's would-be `.md` path (the missing sibling, to satisfy the issue schema's `minItems: 1`). Comment-only; no behavior change.

- Sanitize the tags written by the `core/node-set-tags` action: it now keeps strings only, trims them, drops empty entries (the `annotations.tags` schema requires non-empty items), and dedups, instead of writing the free-form input verbatim. Prevents the Edit tags flow from producing a schema-violating or messy sidecar.

  ## User-facing

  Editing a node's tags now drops blank and duplicate entries and trims whitespace, instead of saving them as-is.

- The `node-stability` experimental / deprecated card-footer chips were being suppressed: `card.footer.right` is a counter slot that treats `value: 0` as empty, and the contributions set `emitWhenEmpty: false`, so the badges never rendered. They now emit-when-empty and show again as icon-only badges (the `fa-flask` / `pi-ban` icon carries the meaning, value is always 0).

  ## User-facing

  The experimental / deprecated badge on a node's card now shows again.

## 0.59.0

### Minor Changes

- Ship the `core/node-bump` action and the `core/annotation-stale` analyzer as `experimental`, so the sidecar bump/drift surface is disabled by default (Decision #128). Gated as a unit: with the action disabled no Bump button projects, and with the drift analyzer disabled no stale finding fires. The `sidecar-end-to-end` conformance case drops its `annotation-stale` assertion accordingly (a default scan now surfaces only `annotation-orphan`; the node still carries the derived `sidecar.status`).

  ## User-facing

  The Bump button and the sidecar drift ("stale") finding are off by default now. Staleness still shows on the node's status; re-enable with `sm plugins enable core/node-bump core/annotation-stale` or the Settings toggles.

### Patch Changes

- Remove a dead per-node aggregation loop from the `annotation-field-unknown` analyzer: it counted offending keys per node for a card chip that was already retired, then discarded the result via `void`. No behavior change; the emitted findings are unchanged.

## 0.58.0

### Minor Changes

- Move the inspector Set stability button to the `core/node-set-stability` action's scan-time `project()`. The button now tracks the action's enabled state (a disabled action projects no button) instead of the `core/node-stability` analyzer emitting it unconditionally. The analyzer also stops raising an `info` for `experimental` nodes (only `deprecated` still raises a finding, experimental stays a chip) and ships a clearer plugins-list description.

  ## User-facing

  The Set stability button no longer shows when its action is turned off (it used to leave a dead button), and experimental files no longer add an info row to Findings; the experimental badge still shows on the card.

- Remove the `supersede` feature end to end. The `supersedes` link kind is dropped from the global link-kind enum, the `annotations.supersedes` and `supersededBy` sidecar fields are removed from the spec, and the three built-ins that powered it (the `core/annotations` extractor, the `core/node-supersede` action, the `core/node-superseded` analyzer) are deleted. Scans no longer produce supersede links, and the inspector drops the Supersede button and the superseded-by banner.

  ## User-facing

  The Supersede inspector button, the "superseded by" banner, and supersede links on the map are gone. The `supersedes` and `supersededBy` keys in `.sm` sidecars are no longer recognized, remove them from any sidecar that still declares them.

- The inspector sidecar action buttons (Set stability, Edit tags, Bump) now project on every real (non-virtual) node, not only nodes that already have a `.sm` sidecar. The write creates the sidecar when absent (gated by the write-consent flow), so a node can get its first annotation straight from the inspector. Bump is enabled on a node with no sidecar (it creates one) or a stale sidecar, and disabled only on a fresh one. Synthetic nodes stay excluded since there is no file to anchor a `.sm`.

  ## User-facing

  You can now set stability, edit tags, or bump any node straight from the inspector, even ones without a `.sm` yet. The action creates the sidecar for you, with the usual write consent.

## 0.57.0

### Minor Changes

- Normalize every built-in analyzer finding into one canonical message shape via the shared `formatFinding` helper: an optional backtick-quoted subject line, then `L<line>: <what>; <why>` (the `L<line>:` prefix only when the finding maps to body line(s)). Remediation advice moves out of `message` into `Issue.fix.summary`. `issue.schema.json` documents the grammar as normative; all 14 message-emitting analyzers were migrated, so `sm check` and the UI Inspector read consistently.

  ## User-facing

  **Finding messages now read the same way everywhere.** Each one shows the offending subject on its own line, then `L<line>: what; why`, with the fix hint shown separately instead of appended. Output in `sm check` and the Inspector is more consistent and easier to scan.

- Fix two built-in finding messages that drifted from the canonical `<what>; <why>` shape: `core/name-reserved` said "Name collision" (clashing with the separate `core/name-collision` rule) and now reads "Reserved name"; `core/job-file-orphan` now names the orphan file as the finding subject, matching `core/annotation-orphan`. A new format-consistency test pins every analyzer body to the grammar so messages stay uniform.

  ## User-facing

  **Finding messages read more consistently.** Reserved-name findings no longer say "Name collision" (now "Reserved name"), and orphan-job-file findings name the file they point at, like the other findings.

- Redesign the link-confidence scoring model: the kernel seeds a 1.0 baseline on every link (the per-extractor emit floor is dropped) and the score-phase detectors subtract a fixed penalty on top, so `core/name-reserved` lands a reserved link at 0.1 and `core/reference-broken` a broken one at 0.5, while disabling a detector leaves its link at 1.0. The built-in `core/score-resolution` analyzer is deleted (its 1.0 is now the baseline), so a clean resolved link records no `scan_link_scores` row.

  ## User-facing

  **Link confidence now starts at 1.0 and each rule subtracts a fixed amount.** A clean link reads 1.0, a reserved one 0.1, a broken one 0.5. Turning a rule off leaves its links at full confidence. The internal score-resolution scorer was retired.

- Add a `fix.summary` remediation hint to the `core/reference-broken` error finding: fix the path or name, remove the broken link, or add the file's folder under "Folders for link validation" (the `scan.referencePaths` escape hatch, which clears path-style breaks only). Detection and `error` severity are unchanged.

  ## User-facing

  **Broken-reference findings now suggest how to fix them.** Each one points at correcting the path or name, removing the link, or adding the file's folder under Folders for link validation in Settings, so links to files outside the project still validate.

- Reword the `core/reference-redundant` finding to be kind-agnostic: it no longer says "Duplicate reference" (the redundancy can span different link kinds, e.g. `invokes` plus `references` to one node), and the remediation moves out of the message into `fix.summary`. The hint now reads as optional, the rule is `info` and keeping multiple forms can be deliberate.

  ## User-facing

  **Redundant-link findings read clearer.** The message no longer assumes the links are "references" (they may be a mix of kinds), and the fix hint now reads as optional: consolidate the links, or keep the overlap on purpose.

- Remove the `core/job-file-orphan` analyzer, which flagged `*.md` files under `.skill-map/jobs/` that no job row referenced. The scan-time plumbing that fed it (`IAnalyzerContext.orphanJobFiles`, `RunScanOptions.orphanJobFiles`, scan-runner computation) is removed too, so no dead context survives. The `findOrphanJobFiles` helper and the `sm job prune --orphan-files` verb stay. The analyzer returns later under a probabilistic evaluation model.

  ## User-facing

  The orphan-job-file check is gone from scans for now; it will come back with a smarter, probabilistic model. You can still remove leftover job files with `sm job prune --orphan-files`.

- Rename the built-in analyzer `core/link-conflict` to `core/link-kind-conflict`. The rule flags two detectors emitting different `kind` values for the same `(source, target)` pair, so the id now names what it actually checks (a kind disagreement). Folder, id, texts, spec, and tests were renamed together, no compatibility alias. The rule also gains a `fix.summary` remediation hint (drop one conflicting source, or ignore the overlap deliberately).

  ## User-facing

  **The `link-conflict` rule is now `link-kind-conflict`.** If you enabled or disabled it via `sm plugins`, re-apply the toggle under the new id; the old id is no longer recognized. The warning it raises is unchanged.

- Rename `core/signal-collision` to `core/extractor-collision` (the rule surfaces two extractors colliding over the same span of text; "Signal" was internal IR jargon) and drop the dead `extractorDisabled` / `belowFloor` rejection stubs from the resolver schema, the `ISignalResolution` type, and the analyzer. The finding now carries the canonical `L<line>:` prefix and a `fix.summary` hint (rephrase one token, or accept the winner).

  ## User-facing

  **`signal-collision` is now `extractor-collision`** and reads clearer: it points at the body line, names the two extractors that overlapped, and suggests how to resolve it (rephrase one token, accept the winner, or flip the tiebreak).

- Rename `core/trigger-collision` to `core/name-collision` and key it on the resolution identifier instead of the slashed trigger. It fires (`error`) when two or more name-resolvable nodes (kinds whose `identifiers` include `frontmatter.name`) declare the same normalised `name`. The subject is the bare name (the old `/` sigil was wrong for agents), and case / separator invocation variants no longer false-positive.

  ## User-facing

  **`trigger-collision` is now `name-collision`** and fires only when two files declare the same resolvable name (a command and an agent both named `deploy`, say), across any name-resolvable kind. Plain notes, addressed by path, never collide.

- `core/schema-violation` no longer re-warns a node whose frontmatter the kernel already flagged. Its universal base-field check (missing `name` / `description`) reads `accumulatedIssues` and stays silent when a `frontmatter-invalid`, `frontmatter-malformed`, or `frontmatter-parse-error` already covers the node, so a single bad frontmatter surfaces one warning instead of two. The check still fires when the kernel said nothing (dispatch never reached the per-kind validator).

  ## User-facing

  A file with invalid frontmatter now shows one warning instead of two. The schema check stops repeating what the per-kind validator already reported, so the issue list and the per-node warning count read cleaner.

- Make the link-confidence scoring mechanism spec-official. `analyzer.schema.json` gains a `phase` enum so external analyzers can declare `phase: 'score'` and adjust link confidence via `ctx.adjustConfidence(link, op)` (op kinds `set` / `delta` / `ceil` / `floor`), folded deterministically and clamped to [0,1] before the read-only phases. The spec now documents the phase, the fold, and the `scan_link_scores` attribution table, with a `score-phase-confidence` conformance case locking it.

  ## User-facing

  **Plugin authors can ship a `score`-phase analyzer that adds or subtracts link confidence.** Declare `phase: 'score'` and call `ctx.adjustConfidence(link, op)` to compose on top of the kernel's own scoring; every adjustment is recorded in `scan_link_scores` for auditing.

- The `/ws` server now pings every client every 30s so idle connections survive intermediary proxies and half-open peers get terminated, and the SPA's WebSocket client resets its reconnect backoff only after a connection stays open long enough to be stable. Together these stop a flapping connection from looping at 1s and re-seeding `GET /api/scan` in a tight poll storm; an unrecoverable drop now escalates to the non-fatal 'connection lost' state.

  ## User-facing

  **The live view stops hammering the server on a dropped connection.** Idle tabs stay connected instead of silently dropping, and a connection that cannot recover now shows a clear 'connection lost' notice instead of retrying scans forever in the background.

- Stop the reconnect re-seed storm when the server flaps. The SPA re-seeds (`GET /api/scan` plus the cascading node / issue fetches) only after the WebSocket RE-STABILISES, not on every raw `open`. A flapping connection (a `--watch` BFF restarting, a rolling deploy) opens then drops within the stability window, so re-seeding on each open hammered the read endpoints with `ECONNREFUSED`; gating on a new `stableConnected` signal fires at most one re-seed per recovered connection.

  ## User-facing

  **No more request storm when the dev server restarts.** The UI waits for the connection to stabilise before re-fetching, instead of hammering the API every time a restarting server flaps the socket.

## 0.56.0

### Minor Changes

- Plugin extensions declare operator-configurable `settings` in their manifest, read at scan time via `ctx.settings` and resolved through the config layers under `plugins.<id>.extensions.<extId>.settings`. The `sm plugins config <plugin>/<ext>` verb, `GET`/`PATCH /api/plugins`, and per-plugin sections in Settings all read and write them; `secret` values route to the gitignored project-local file (no encryption). Adds a `number` (decimal) input-type to the catalog.

  ## User-facing

  Plugin extensions can expose options: edit them per plugin in Settings (one global Apply) or via `sm plugins config <plugin>/<ext>` (saved in `.skill-map/settings.json`; secrets stay local, never committed). Run `sm scan` to apply. New decimal `number` option type.

### Patch Changes

- Reserve the claude built-in slash names under `skill` as well as `command`. The two kinds share the `/` invocation namespace (`invokes: ['command','skill']`), so a built-in like `/help` shadows a user skill named `help` just as it shadows a command; the list is extracted to a shared `RESERVED_SLASH_NAMES` const. The `core/name-reserved` warnings are reworded around "Name collision: ..." so the operator reads what happened instead of internal shadowing terms.

  ## User-facing

  **Skills that shadow a built-in slash command are now flagged.** A skill named like a built-in (e.g. `/help`) is reported as a name collision, the same as a command was, and the collision warnings are reworded to read more plainly.

- Consolidate link-target resolution onto the kernel's authoritative `link.resolvedTarget` (stamped by the post-walk lift). `core/link-counter` now tallies footer chips by that field and shares a single `isSelfLoop` helper with `core/link-self-loop`, and the graph view reads `resolvedTarget` instead of recomputing its own name index. The duplicate kernel and UI resolvers are gone, so footer chip counts, drawn graph edges, and the incoming panel can no longer disagree.

- Remove the dead `data.selfLoop: true` flag from `core/link-self-loop` issues. No consumer ever read it: the graph view recomputes the `source === resolvedTarget` predicate independently in its render-pipeline mirror, so the flag (and its "authoritative detector" doc claim) was vestigial. The doc comment now states the rule reports and the layout draws as deliberately independent paths, and the two obsolete `data.selfLoop` test assertions are dropped.

- Fix `core/link-conflict` embedding two literal NUL bytes (0x00) as the `(source, target)` group-key separator: git treated the file as binary so its diffs were hidden in review and grep skipped it. The separator is now a plain JS unicode escape (still NUL at runtime, identical behavior) and the hardcoded `pluginId: 'core'` reads the shared `CORE_PLUGIN_ID` const like the other core analyzers.

- Make `core/reference-broken` a pure projector of the kernel's broken-link verdict. The post-walk lift now computes the genuinely-broken set (the kind-agnostic "the name exists nowhere" notion of `spec/architecture.md` §Provider · resolution rules) and threads it via `IAnalyzerContext.brokenLinks`. The rule projects that set instead of re-deriving a frontmatter-name-only index that false-flagged links resolving via a filename / dirname identifier; `core/name-reserved` reads `link.resolvedTarget`.

  ## User-facing

  **Fewer false broken-reference errors.** A `@name` or `/name` that points at a same-named file no longer reports as broken, even when that file has no `name:` in its frontmatter; the reference resolves like the runtime follows it.

- Consolidate `core/reference-redundant` onto the kernel's `link.resolvedTarget` (stamped by the post-walk lift) instead of rebuilding its own name index, deleting the duplicated `buildNameIndex` / `collectIdentifiers` / `resolveTargetPath` machinery. Grouping now tracks the resolved graph; a trigger that matches a name but fails the strict kind matrix is no longer grouped as redundant (that mismatch is `core/link-conflict`'s concern). The three documented redundancy cases are preserved.

## 0.55.0

### Minor Changes

- Inspector action buttons are now self-projected by the dispatching Action instead of a sibling projector Analyzer: an Action may declare a `ui` button plus an optional deterministic scan-time `project(ctx)` (read-only graph) that emits its own `inspector.action.button` per node. The pure projector analyzers `core/supersede` and `core/tags` were removed and `core/annotation-stale` trimmed to its badge + issue (the Bump button moved to `core/node-bump`).

  ## User-facing

  No change to how the inspector behaves: the Supersede, Edit tags, and Bump buttons look and work exactly as before, they are just now produced by the action they trigger rather than a separate analyzer.

- Extensions declaring `stability: 'deprecated'` now also ship DISABLED by default, joining `experimental` in the ships-disabled set: a deprecated extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override), the same opt-in `experimental` uses. `beta` / `stable` keep running. No built-in is deprecated today, so the default scan is unchanged until one is marked.

  ## User-facing

  Deprecated plugin extensions now start **disabled**, like experimental ones: they show an off toggle (with the deprecated badge) in Settings and `sm plugins list`, and don't run until you enable them. Enabling one keeps it working while you migrate off it.

- Extensions declaring `stability: 'experimental'` now ship DISABLED by default: their installed default flips from enabled to disabled, so the extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override). `beta` / `deprecated` / `stable` keep running. Built-ins flipped to experimental: `core/mcp-tools` and the Supersede declarer (`core/supersede` button + `core/node-supersede` action).

  ## User-facing

  Experimental plugin extensions now start **disabled**: an off toggle (with the experimental badge) in Settings and `sm plugins list`, not running until you enable them. The MCP tools extractor and the Supersede button are experimental, so both are off until you turn them on.

- The scan now captures each file's modification time (`mtime`) from the walker's existing `lstat`, persisted on `scan_nodes.modified_at_ms` and surfaced on the node wire shape as `modifiedAtMs` (nullable for virtual / derived nodes). The files table gains a sortable "Modified" column at the end, rendered as an ISO short date with a full date+time tooltip; sorting orders by the raw timestamp and sinks fileless nodes to the bottom. The value never participates in `bodyHash` / `frontmatterHash`.

  ## User-facing

  The files table has a new **Modified** column showing when each file was last edited (for example `2026-06-13`). Click the header to sort newest or oldest first, and hover a cell to see the exact date and time.

- The `core/node-superseded` analyzer (surfaces a node's `supersededBy` declaration as an `info` finding) is now `experimental`, joining the rest of the supersession family (`core/supersede`, `core/node-supersede`) which already shipped experimental. As an experimental extension it ships disabled by default, so the "node is superseded by X" finding no longer appears until the operator enables the family with `sm plugins enable core/node-superseded` (or the Settings toggle).

  ## User-facing

  The supersession info finding ("this node is superseded by X") no longer shows by default: `core/node-superseded` is now experimental, so the whole supersession family (declare button + this finding) is off until you enable it in Settings or with `sm plugins enable`.

- `sm plugins show` is now extension-only: it takes a qualified `<plugin>/<ext>` id and renders one extension's detail. The whole-plugin view (manifest plus extension rows) moves to `sm plugins list <id>`, and the top-level `sm plugins list` index drops the per-extension name sub-lines. A bare `show <plugin>` id and a qualified `list <plugin>/<ext>` id are each rejected with a directed redirect to the other verb.

  ## User-facing

  **Plugin commands split by altitude.** `sm plugins list <id>` now shows a whole plugin's extensions (kinds, versions, status); `sm plugins show` is for a single `<plugin>/<ext>` extension. The plain `sm plugins list` stays a clean index, one row per plugin.

- The `sm tutorial` campaign's second half is now a single "daily loop" part (add, improve, publish) that operates the harness for real instead of by hand: the content-editor, check-links, and publish steps actually run, the maintenance analyzers (broken reference, orphan, reserved name, `.sm` sidecar) surface from real work, and the portfolio it builds ships with a styled, personalized site. MCP is parked out of the menu pending its own iteration.

  ## User-facing

  The interactive tutorial's second half is now a single "daily loop": you add a page with your agent, improve it, and publish, running the harness for real. The portfolio it builds ships with a clean, personalized site you can serve and deploy.

### Patch Changes

- `core/backtick-path` now matches bare `.md` filenames inside code spans, not only slashed paths: a backticked `` `algo4.md` `` becomes a `points` edge the way the runtime follows it. The `/` separator is now optional, with the first path segment anchored to a word char so globs and placeholders (`{PROJECT}-x.md`, `*-S.md`) stay rejected. Slashless names like `SKILL.md` match too; a self-reference becomes a self-loop, other misses flag via `core/reference-broken`.

  ## User-facing

  Backticked filenames now become links even without a folder: writing `` `algo4.md` `` inside code formatting (not just `` `docs/algo4.md` ``) draws an arrow to that file in the graph, matching how an agent actually follows the reference.

- Broken graph edges now render fainter than resolved ones. `core/markdown-link` emits the spec's `0.95` (unambiguous syntax) instead of a hardcoded `1.0`, and the post-walk confidence-lift transform adds a `BROKEN_TARGET_CONFIDENCE = 0.5` downgrade for links that resolve to nothing (no path and no name-index match, like `core/reference-broken`). A dangling `[x](missing.md)`, `@missing.md`, or `/no-such-command` now sits at `0.5`, below a resolved `1.0` and above a reserved `0.1`.

  ## User-facing

  Broken links in the graph now appear fainter than working ones: a markdown link, `@file`, or `/command` pointing at something that does not exist renders at low opacity, so dangling references stand out at a glance instead of looking like solid edges.

- Every built-in extractor description now ends with a concrete usage example. The `markdown-link`, `external-url-counter`, `annotations`, `mcp-tools`, `backtick-path`, `tools-counter`, and `slash-command` manifests keep their existing leading sentence and append a short `Example: ...` clause, so the text shown in `sm plugins list`, `sm plugins show`, and the Settings plugins panel illustrates what each extractor matches.

  ## User-facing

  Extractor descriptions in `sm plugins list` and Settings now include a usage example.

- The post-walk confidence-lift transform no longer bumps a link to `1.0` when its resolved target is a `virtual: true` node (today only `core/mcp-tools`' `mcp://<server>` nodes, reconstructed from frontmatter, never verified on disk). The edge still resolves (`resolvedTarget` set, navigable) but keeps its extractor emit confidence, so an MCP edge stays `0.85`: an unverified entity is not full certainty, like the reserved-target downgrade.

## 0.54.0

### Minor Changes

- Adds the `core/backtick-path` extractor: relative `.md` paths written inside inline code spans and fenced blocks become edges, resolved like markdown links. The token grammar is pinned in `spec/architecture.md` (new section "Extractor: code-region file references"), unresolved targets surface via `core/reference-broken`, and the kernel exports `extractCodeRegions`, the exact inverse mask of `stripCodeBlocks`.

  ## User-facing

  Skills that tell the agent to read a bundled doc with a backtick path (like `references/rules.md`) now show those arrows on the map, and a backtick path pointing at a missing file is flagged as a broken reference.

- Extensions can declare an optional `stability` lifecycle label (`experimental`, `beta`, `stable`, `deprecated`) in their manifest. Presentation-only: non-default values render as a badge in `sm plugins list` / `sm plugins show` and the Settings plugins panel; missing means `stable` and the kernel never gates behaviour on it. Declared in the spec's extension base schema and threaded through the loader, the BFF, and the SPA. `core/mcp-tools` is the first built-in flagged `experimental`.

  ## User-facing

  **Plugin maturity at a glance.** Extensions can now carry an experimental, beta, or deprecated badge next to their name in the Settings plugins panel and in `sm plugins list`, so you can tell which parts of a plugin are still settling before relying on them.

- Adds the `points` link kind to the closed enum: `core/backtick-path` now emits `points` instead of `references`, so a backtick path and a markdown link to the same target persist as two coexisting edges instead of merging, and `core/link-conflict` treats `points` as compatible with every other kind (no false conflict warns). `core/reference-broken` labels the kind "pointer".

  ## User-facing

  Backtick paths get their own "Points" connector kind: a new palette toggle with a backtick glyph, its own edge colour per theme, and arrows separate from markdown-link references on the map.

- The `tools-counter` extractor moved from the `core` plugin into the `claude` plugin: its qualified id is now `claude/tools-counter` (settings toggles keyed `core/tools-counter` no longer match), and disabling the `claude` plugin now drops the agent tools chip together with the provider it serves.

### Patch Changes

- Reworks every built-in analyzer message into a compact finding grammar: the involved artifact (target, trigger, sidecar) leads on its own line, followed by a short label, count, detail, and a `(line N)` location suffix wherever the link records one (broken references, self-loops, reserved-name downgrades); duplicate occurrences group by trigger, and messages about the node itself drop the redundant path. The inspector renders the line break and `sm check` flattens it to one row.

  ## User-facing

  Findings are shorter and clearer: the file or trigger involved leads on its own line, duplicates collapse to `Duplicate reference (2): \`refs/x.md\` (124, 145)`, broken references name the line they sit on, and messages no longer repeat the node's own path.

- Downgrades the `core/reference-redundant` analyzer severity from `warn` to `info`: a multi-form reference to the same target is a consolidation hint, not a defect, so it no longer shares the visual bucket of actionable warnings like `reference-broken`.

  ## User-facing

  Referencing the same file twice in different forms (a markdown link plus a backtick path, for example) now shows as an info note instead of a warning, so the warning chips on cards only count things worth fixing.

- Decouples the workspace text search from the map: `FilterStoreService.apply()` gains an `includeSearch` option and the graph view only applies the query when the new persisted `searchAffectsMap` preference (toggle next to the rail search input, default off) is enabled. The files rail keeps filtering on every query.

  ## User-facing

  Searching no longer rips nodes out of the map: by default the query narrows only the files list while the map keeps its layout. A new toggle next to the search box brings back the old filter-everything behavior, and your choice is remembered.

## 0.53.6

### Patch Changes

- Tutorial-review pass on the bundled `sm-tutorial`: the example fixtures stop inventing frontmatter fields skill-map ignores (`args`/`shortcut` on commands, `inputs`/`outputs`/`metadata`/`version`/`tags` on skills and notes, which live in the `.sm` sidecar or nowhere); the `.sm` annotations lesson is de-duplicated across parts; the Maintain section is retitled "Maintain the harness"; and chapters now carry `section.chapter` numbers. `sm --help` also leads with a tutorial call-to-action.

  ## User-facing

  `sm --help` now opens with a pointer to `sm tutorial`, the guided hands-on walkthrough. The tutorial reads cleaner too: the maintain part is renamed, chapters are numbered (5.1, 5.2…), and the annotations lesson no longer repeats across parts.

## 0.53.5

### Patch Changes

- Tutorial-review pass on the bundled `sm-tutorial` walkthrough: the connector-confidence lessons now match the resolver (a faint 0.50 mention versus a resolved 1.00 reference, with no phantom 0.85 step), the `@AGENTS.md` connector is labelled `references`, an optional `content-editor` chapter was added, the `sm bump` chapter was removed, and the MCP part now runs last.

## 0.53.4

### Patch Changes

- Part 8 (`cli`) of the bundled `sm-tutorial` skill now self-seeds its own copy of the Part 0 demo fixture (`preflight: seed`, new `prologue-built` snapshot) instead of assuming it is still on disk. Before, running the campaign after the prologue deleted that fixture, yet Part 8 stayed in the menu and ran against the wrong project. Now it rebuilds the fixture on entry (resetting the portfolio if present) and, like the campaign parts, is always shown.

  ## User-facing

  The built-in tutorial's CLI deep-dive now rebuilds its own demo fixture when you enter it, so it works correctly even after you have run the project campaign, and it always appears in the menu instead of staying hidden until the prologue is done.

- The workspace files-panel collapse button now shows a left chevron instead of an `✕`, so it no longer reads as a clear-search control sitting next to the search box. The bundled `sm-tutorial` skill drops the slashed `# /publish` / `# /init` headers from its command fixtures (the slash token produced a spurious self-loop link the tester saw before it was explained) and adds a third-terminal heads-up to the maintenance part, where the live server and one-off `sm` commands run side by side.

  ## User-facing

  The files panel's collapse button is now a chevron instead of an `✕`, so it clearly hides the panel rather than clearing the search. The built-in tutorial fixes a stray self-link in its command examples and reminds you to open a third terminal during the maintenance part.

## 0.53.3

### Patch Changes

- Graph view gains three Neon themes (R/G/B) with a glow treatment, selectable from the theme picker. The toolbar tooltips were trimmed and the "edge style" control renamed to "connector style". The bundled `sm-tutorial` skill adds part 3 ("run the harness") and reworks the finale.

  ## User-facing

  Three new Neon graph themes (red/green/blue) with a glow effect in the map's theme picker. Toolbar tooltips are shorter and "edge style" is now "connector style". The built-in tutorial adds a third part and a reworked ending.

## 0.53.2

### Patch Changes

- Graph view: "Fit to screen" (and the boot / auto fit) now caps zoom at natural size instead of magnifying, so opening a project with a single node no longer renders it gigantic; the wheel still zooms in to 2x. The "Re-arrange layout" toolbar tooltip also drops its redundant "(re-run auto layout)" tail.

  ## User-facing

  Opening a project with one node no longer zooms in too far: the map fits content at natural size (you can still wheel-zoom in). The "Re-arrange layout" tooltip is shorter.

## 0.53.1

### Patch Changes

- The cache-rebuild prompt shown on a version skew (re-scanning a DB written by a different CLI version) is reworded to be shorter and calmer: it no longer recites the pre-1.0 derived-cache rationale or uses "delete" / "deleted" phrasing. The post-rebuild receipt is now suppressed after an interactive y/N confirm (the operator already answered) and only prints for automatic rebuilds (`--yes`, non-TTY, the BFF), where it is the only signal the cache was wiped.

  ## User-facing

  When you upgrade and re-scan, the cache-rebuild prompt is short and reassuring, and once you confirm it no longer prints a redundant "rebuilt" notice. Automatic rebuilds (for example with `--yes`) still show a one-line confirmation.

- The default graph layout direction is now left-to-right instead of top-to-bottom. The "Balanced" (dagre network-simplex) algorithm was already the default, so only the direction changed: a fresh map with no saved layout preference now flows horizontally. Users who already picked a direction keep their choice.

  ## User-facing

  New maps now lay out left-to-right by default (with the Balanced algorithm), so the skill dependency chain reads along the natural left-to-right axis. You can switch back to top-to-bottom from the graph toolbar or Settings.

- Tutorial polish for `sm tutorial` (the prologue and shared conventions): the session now opens on a numbered menu where you pick the part to run, each chapter asks for confirmation once instead of several times in a row, and the prologue's references to the live UI are refreshed to the current names (the "Connections" panel, "Re-arrange layout"). The watcher/browser are no longer translated in the Spanish flow, and the tutorial no longer creates harness tasks.

  ## User-facing

  The interactive tutorial now opens on a numbered menu to pick where to start, and walks each step with a single confirmation instead of several. Its references to the live UI match what is on screen.

## 0.53.0

### Minor Changes

- Inspector action-button adopters: `core/node-stability`, `core/supersede` and a new `core/tags` analyzer emit Set stability / Supersede / Edit tags buttons, each parametrized via an input-type prompt pre-loaded with the current value, backed by deterministic actions `core/node-set-stability`, `core/node-set-tags`, `core/node-supersede`.

  ## User-facing

  The inspector now offers Supersede, Set stability and Edit tags buttons; each opens a small form pre-filled with the node's current value.

- Plugins can now contribute action buttons to the inspector: a new `inspector.action.button` slot renders buttons that dispatch a kernel Action via `POST /api/actions/:id`, and the two header badge sub-slots collapse into one `inspector.header.badge` slot. The `.sm` write consent splits into `confirm` (one-shot) and `always` (persists `allowEditSmFiles`). `core/annotation-stale` now emits the Bump button and stale badge as contributions instead of hardcoded UI.

  ## User-facing

  The inspector now renders the Bump button and the stale indicator from a plugin instead of hardcoded UI. Writing a `.sm` sidecar now asks for consent every time, with an "always allow" checkbox that persists the permission for the project.

- Inspector body view contributions now render one collapsible section per plugin (titled by the trusted `pluginId`, collapsed by default) instead of a shared drawer; the `inspector.body.section` slot is retired. New optional inspector-only `order` fields on `plugin.json` (sorts sections) and the extension manifest (sorts bricks) drive layout, default 100. `inspector.action.button` is now uncapped.

  ## User-facing

  Plugin contributions in the inspector now appear as one collapsed section per plugin, ordered by the new `order` fields you can set in `plugin.json` and your extension manifest. The inspector also shows every action button a plugin contributes.

- Runtime contribution rejections (an undeclared ref, or a payload that fails the slot's schema) are now persisted per scan to a `scan_contribution_errors` table. `sm plugins doctor` prints a per-plugin "Runtime contribution errors" section and exits non-zero when any exist; `GET /api/plugins` embeds a per-plugin `runtimeContributionErrors[]` field the Settings panel renders as a warning badge plus a collapsible list. The `extension.error` scan event still fires.

  ## User-facing

  `sm plugins doctor` now reports view-contribution errors from your last scan (and exits non-zero if any), and the Settings plugin panel shows a per-plugin warning badge with the failed emissions, so a plugin whose chips silently vanished now tells you why.

- View contributions are now emitted by object reference, not a string id: declare each as a const in the `ui` map and pass it to `ctx.emitContribution(ref, payload)`. The kernel recovers the id by object identity and rejects an undeclared ref with a loud `extension.error`. The payload is type-checked at author time via generated `SlotPayload<slot>` types (AJV still enforces it at runtime). The three list-payload fields were renamed: breakdown `bars`, key-values `pairs`, link-list `links`.

- The bundled `sm-tutorial` skill gains the portfolio campaign: Parts 1-5 of the book (start the project from zero, connect the harness, maintain the site, MCP, and the live-site finale) are now authored and active. They build one accumulating example project, a static portfolio served by a tiny Express server plus the `.claude/` harness that maintains it, around which the prologue and the advanced parts (extend skill-map, the CLI in depth) already sit.

  ## User-facing

  The interactive tutorial (`sm tutorial`) now walks a full campaign: you build a real static portfolio site and the `.claude/` harness that maintains it, from `sm init` to the live site, picking parts from the in-skill menu.

- The portfolio-campaign parts of the bundled `sm-tutorial` skill become jumpable. Each now declares `preflight: seed`, so entering one out of order fast-forwards the project to that part's starting state (it lays the cumulative `.claude/` harness from a checklist, then inits and scans) instead of forcing the tester through the earlier parts first. Run in order it stays a no-op; the skipped predecessors are marked and stay in the menu for later.

  ## User-facing

  In the interactive tutorial you can now jump straight into any part of the portfolio campaign from the menu (say the maintenance or MCP part). If you skipped the earlier parts, the tutorial sets the project up for you so you can start right there.

- The `sm tutorial` verb drops its `master` positional variant and now materializes a single `sm-tutorial` skill, restructured into a "book" of ordered parts and chapters with a manifest-driven menu. The advanced walkthrough (plugins, settings, view-slots) and the CLI deep-dive are parts inside that one skill, reached from its menu after the live-UI prologue. `sm tutorial master` exits 2; `.claude/skills/sm-master/` is removed.

  ## User-facing

  `sm tutorial master` is gone. Run `sm tutorial`: the advanced parts (plugins, settings, view-slots) and the CLI in depth are now chapters you pick from a menu inside the tutorial, after the live-UI prologue.

### Patch Changes

- Plugin load failures read better. A wrong view-slot value collapses AJV's `must be equal to constant` wall into one `<path> is not a valid value` linking to the slot catalog (`spec/view-slots.md`) on GitHub; other manifest errors link to the kind schema. The warning is one non-repetitive line, `plugin <id> (<status>), all extensions skipped: <reason>`. Plugin-load warnings also no longer print twice at `sm serve` boot.

  ## User-facing

  Clearer plugin errors: a wrong view-slot name now gives a short message linking to the slot catalog, and the warning spells out that the plugin and all its extensions were skipped. It also no longer appears twice when the server starts.

- Harden test and conformance coverage for the emit-by-reference view-contribution refactor: orchestrator rejection-path and renderer unit tests, `sm plugins doctor` runtime-error coverage, two new conformance cases (renamed list payloads with off-shape rejections, and a manifest declaring all 14 slots) plus a fixture-drift fix. The conformance suite now runs in CI via `validate:test`, and the `plugins doctor` docs gain a runtime-error note. No CLI or normative spec change.

## 0.52.0

### Minor Changes

- `sm bump` and the BFF bump route (`POST /api/sidecar/bump`) now stamp `audit.lastBumpedBy` / `audit.createdBy` with the project's Git author name (`git config user.name`) when the node lives in a Git repository, falling back to the channel literal (`'cli'` / `'ui'`) otherwise. This supersedes Decision A5, which kept the invoker a literal.

  ## User-facing

  Bumping a node now records **who** bumped it: the audit `by` fields show your Git author name (`git config user.name`) instead of `cli` / `ui`, when the project is a Git repo. It falls back to `cli` / `ui` outside a Git repo or when no `user.name` is configured.

- The inspector body renders markdown with full prose styling plus highlight.js syntax highlighting and re-renders live on `scan.completed`. The connections panel drops its duplicate Findings sub-section and header and reuses the node-card icon vocabulary for Outgoing / Incoming / External; sidecar tags move to a clickable header row, the Annotations panel leads with Authors, and the map isolate gesture now focuses a node and its direct (one-hop) neighbors instead of its whole chain.

  ## User-facing

  **Inspector polish.** The body now renders rich markdown with code syntax highlighting and updates live after a re-scan. Node tags moved to a clickable row in the header, and "isolate" on the map now shows a node plus its direct neighbors.

- A malformed or schema-invalid `.sm` sidecar now emits its `invalid-sidecar` diagnostic at `error` severity instead of `warn`. The scan still completes (the node is marked present with a null status), but `sm check` now exits non-zero when any sidecar fails to parse or validate, surfacing broken annotations in CI rather than letting them pass as a warning.

  ## User-facing

  `sm check` now **fails** (non-zero exit) when a `.sm` sidecar is malformed or breaks schema validation. These were previously reported as warnings and did not affect the exit code. Fix or remove the offending sidecar to make the check pass.

### Patch Changes

- The active-provider lens dropdown in Settings → Project now greys out (and refuses to select) any Provider the operator has disabled. `GET /api/active-provider` gained a `selectable` field listing the Provider ids that are enabled right now; the SPA renders Providers absent from it as disabled instead of offering a lens whose extractors would never run.

  ## User-facing

  Disabling a provider plugin now removes it as a choice in **Settings → Project → Active provider**. The provider stays listed but greyed out and labelled `(disabled)`, so you can no longer switch the lens to a provider whose extractors would not run.

- The `core/annotation-stale` analyzer is now neutral instead of warning-tinted: drift is informational, not a warning. Its footer chip (`staleIcon`) carries no severity (the clock renders in the foreground colour instead of the warn tint), and the stale Findings issue is lowered from `warn` to `info`. As `info`, it no longer counts toward the card's warn chip (the issue-counter buckets error/warn only) and never affected `sm check`'s exit code (info and warn are both non-failing).

## 0.51.0

### Minor Changes

- Security hardening. `sm serve` now refuses any non-loopback `--host` (the BFF is loopback-only and unauthenticated pre-1.0, Decision #119; off-loopback previously leaned on the DNS-rebinding gate alone). The `/api/nodes/:pathB64` 404 sanitizes the decoded path for the terminal (log-injection parity with sibling routes), the `/ws` broadcaster caps concurrent clients (refuses past the cap with close 1013), and published tarballs now carry npm provenance.

  ## User-facing

  `sm serve` now refuses a non-loopback `--host` (for example `0.0.0.0`): the local server has no auth and is loopback-only, so bind it to `127.0.0.1` or `::1`. Multi-host serve reopens after v0.6.0.

### Patch Changes

- Internal quality pass from a review. The kernel no longer imports the `core/` runtime layer: pure leaves (`atomic-write`, `schema-fingerprint`, `update-check`, the `SKILL_MAP_DIR` literal, the provider detector) moved into `kernel/` and the sidecar consent gate is now injected, with a new lint rule enforcing the boundary. The BFF's two `409` responses dispatch via a typed `ConflictError` instead of a message-prefix match, and `sm scan`'s count nouns moved into the i18n catalog.

## 0.50.1

### Patch Changes

- The reference-redundant finding message is shorter and more direct: "Duplicate reference to <target> (<n> occurrences): <list>." It drops the source-node name (the finding already hangs off that node) and the trailing "consider consolidating..." advice.

  ## User-facing

  The redundant-reference finding now reads with shorter, more direct wording so the duplicated target and where it appears are easier to scan at a glance.

- Polish on the fused workspace: the floating kind / severity / favorites palette counts now reflect the files-rail curation (filtering from the tree reshapes the numbers); selecting a file whose node is hidden from the map no longer pans the camera to empty space; the layout reset only prompts when the user has actually positioned nodes and the warning is lower intensity; and the link-kind palette lists every link kind regardless of node curation.

  ## User-facing

  The map palettes now count only the nodes you've curated visible. Selecting a hidden file no longer jumps the camera to empty space, and "Re-arrange layout" only asks to confirm when you have moved nodes yourself.

## 0.50.0

### Minor Changes

- Fuse the standalone files and map views into one workspace at `/`: a resizable files rail, the graph, and a floating inspector linked through the shared `?path` selection. The rail curates which nodes the map shows via per-file/per-folder visibility checkboxes, folder-depth presets, and an isolate-chain gesture (persisted to localStorage); the layout reset re-arranges only the visible nodes. Retires the `/files` and `/map` routes and the stability / has-issues / stale filters.

  ## User-facing

  The Files and Map tabs are gone: skill-map opens on one screen, file tree left, graph right. Tick files or folders (or the 0/1/2 depth buttons) to pick what the map shows; the tree's map icon isolates a node's whole chain. "Re-arrange layout" tidies just what's visible.

## 0.49.0

### Minor Changes

- Fuse the standalone files and map destinations into one workspace view, now the default landing: a drag-resizable files rail on the left, the graph in the center, and the inspector as a right-side slide-over, all linked through the shared `?path` selection. The file tree gains a tri-state control to curate which nodes appear on the map, with a `Show all` toolbar action to clear it. The `/files` and `/map` routes stay reachable.

  ## User-facing

  **New workspace view**: the file list, graph, and inspector now share one screen. Drag the divider to resize the file rail, click a file to focus its node on the map, and use the tree checkboxes to choose which nodes the map shows (`Show all` clears the selection).

## 0.48.0

### Minor Changes

- `sm plugins create <kind> <plugin-id>` now takes the extension kind as a required first positional and scaffolds a loader-clean stub for each of the six kinds (provider, extractor, analyzer, action, formatter, hook). The slot / input-type catalog gains a single source of truth: the spec enums become `oneOf` const+description, and the kernel + CLI mirrors are generated from it by `scripts/generate-view-catalog.js`, guarded by `view-catalog:check` in `validate:compile`.

  ## User-facing

  `sm plugins create` now takes the extension kind as a required first argument: `sm plugins create <kind> <plugin-id>` (kinds: provider, extractor, analyzer, action, formatter, hook). Previously it only scaffolded extractors.

### Patch Changes

- Restore the left-to-right order of the `card.footer.right` chip cluster that the `core/issue-counter` aggregate had displaced: the stability badge leads (priority 10), then the stale-drift clock chip (priority 20), then the warning and error counters anchor the right edge. A reader notices it as the card-footer status icons returning to lifecycle, stale, warnings, errors order.

  ## User-facing

  **Card footer icon order restored.** The status icons in the bottom-right of each card are back to their previous order: lifecycle/stability first, then the stale indicator, then warnings and errors on the far right.

- The phrase `sm tutorial` surfaces to start each walkthrough now matches the website and READMEs: the basic tutorial trigger is `run the tutorial` / `ejecuta el tutorial` (was `start the tutorial` / `arranquemos el tutorial`) and the master tutorial trigger is `run the master tutorial` / `ejecuta el tutorial maestro`. The two SKILL.md trigger lists pick up the new phrases.

  ## User-facing

  After `sm tutorial`, start the tutorial by typing `run the tutorial` (or `ejecuta el tutorial`), matching the website. The master tutorial uses `run the master tutorial` / `ejecuta el tutorial maestro`.

## 0.47.1

### Patch Changes

- The marketing site gains a Quickstart section just below the hero, with the tutorial first steps as a copy-paste terminal card (install, scaffold, open Claude Code, plus the in-Claude prompt). The documented way to start the tutorial moves from the stale `@sm-tutorial.md` file mention to the natural `run the tutorial` / `run the master tutorial` trigger phrase across the root and CLI READMEs, matching the skill directory that `sm tutorial` now installs.

## 0.47.0

### Minor Changes

- Wired the `tokenizer` project-config key to actually select the scan encoder. It is now a closed enum (`cl100k_base` default, `o200k_base`); the resolved name is recorded in `scan_meta.tokenizer` / `ScanResult.tokenizer` and an out-of-set value is dropped with a warning and falls back to the default. The orchestrator lazily loads only the chosen `js-tiktoken` rank table, and an incremental scan recomputes per-node token counts when the persisted encoder differs from the resolved one.

  ## User-facing

  **Pick your tokenizer.** `tokenizer` in settings.json now selects the encoder for token counts: `cl100k_base` (default, GPT-4) or `o200k_base` (GPT-4o). Any other value is ignored with a warning. Changing it recomputes counts on the next scan.

### Patch Changes

- Detect database schema drift by fingerprint. A sha256 of the migration DDL is stored in `scan_meta.schema_fingerprint` per scan and checked at open, so a DB whose columns fell behind an inline schema edit is caught instead of failing later as a cryptic `no such column` error. Write paths (`sm scan`, `sm serve`) prompt to rebuild (or `--yes`); read verbs warn and point at `sm scan` / `sm db reset`.

  ## User-facing

  skill-map now notices when your local DB schema is out of date (not just an older version): `sm scan` and `sm serve` offer to rebuild the cache, and read commands warn instead of failing with a confusing database error.

- Settings → Plugins gains a single filter bar: a shared **All** reset, a source axis (Built-in / Project), and the existing kind axis on one line. The two axes compose independently (picking a source does not clear a kind), so an operator can isolate the project's own drop-in plugins and extensions from the built-ins. A dedicated empty state points at `sm plugins create` when there are none yet; choices persist per browser.

  ## User-facing

  Settings → Plugins now has a unified filter bar (All, then Built-in / Project, then the kinds), so you can quickly isolate your project's own plugins and extensions from the built-ins.

- The UI WebSocket client no longer raises a stream error when it gives up reconnecting after the dev server stops. It now exposes a `connectionState` signal instead: a new `<sm-connection-banner>` shows a non-fatal "connection lost" notice with a Reconnect button, the data stream stays alive, and the collection re-seeds via `/api/scan` once the socket re-opens. This stops a routine `sm serve` shutdown from surfacing in Sentry as an uncaught error.

  ## User-facing

  When the dev server stops, the UI now shows a "connection lost" banner with a Reconnect button instead of failing silently, and it refreshes automatically once the connection is back.

## 0.46.0

### Minor Changes

- The plugin loader now rejects a disk-loaded extension manifest that re-declares a structure-as-truth field (`id`, `kind`, provider `kinds`, formatter `formatId`) as `invalid-manifest` instead of silently stripping it. These are derived from the folder layout, so declaring one was a second source of truth that could drift. `pluginId` is unchanged. `sm plugins create` no longer emits `kind` in the stub. Breaking for external plugins that inlined any of these fields.

- `sm <namespace> --help` (and `sm help <namespace>`) now render a namespace overview, header, USAGE, an optional DESCRIPTION, and a COMMANDS list of the subcommands, for command prefixes that own subcommands but are not themselves runnable (`plugins`, `db`, `config`, `job`, `actions`, `sidecar`, `hooks`, `conformance`, plus nested ones like `plugins slots`). Previously these fell through to Clipanion's terse "Multiple commands match" listing. Leaf verbs and unknown names are unchanged.

  ## User-facing

  `sm plugins --help` (and `db`, `config`, `job`, and the other command groups) now print a tidy overview with a one-line description and a list of their subcommands, matching the look of `sm scan --help`, instead of a terse internal list.

- Removed seven project-config keys that had no runtime consumer: `i18n.locale`, `providers` (the enabled-list; `activeProvider` stays), `history.share`, the `autoMigrate` config key (the `sm db migrate` / `backup` adapter option is untouched), `plugins.<id>.config`, `plugins.<id>.extensions`, and `scan.followSymlinks` (the walker always hard-skips symlinks). Dropping `plugins.<id>.config` closed the last open subtree, so project-config is now fully `additionalProperties: false`.

  ## User-facing

  **Config cleanup.** Several settings.json keys that never did anything (`i18n`, `providers`, `history`, `autoMigrate`, `scan.followSymlinks`, per-plugin `config` / `extensions`) were removed. If still present they are now ignored and reported with a warning on load.

### Patch Changes

- `sm plugins create` now scaffolds a plugin that loads. The generated `plugin.json` drops the `id` and root `settings` keys (both rejected by the structure-as-truth `PluginManifest` schema), and the extractor stub declares `ui` instead of the dead `viewContributions` field, with its `settings` co-located per-extension. A freshly scaffolded plugin now passes `sm plugins doctor` and emits its contribution on `sm scan` instead of failing with `invalid-manifest`.

- The active-provider auto-detect line (`Auto-detected activeProvider = ... persisted to settings.json`) no longer interleaves with the scan summary. The bootstrap printed it to stderr while `sm scan` writes its summary to stdout, so on a tty the two streams glued together with no newline between them. The bootstrap now stays silent and the CLI announces the auto-detect on the summary's own stream (stdout for `sm scan`, stderr for `sm init`), in order, on its own line.

  ## User-facing

  `sm scan` no longer glues the `Auto-detected activeProvider` notice onto the results line. The auto-detect message now prints on its own line, right above the scan summary.

- Normalize plugin terminology: "bundle" is no longer used as a synonym for "plugin". The installable unit is now consistently called a "plugin" everywhere (types, identifiers, spec prose, CLI output, and Settings labels); the word "bundle" is reserved exclusively for the aggregate toggle that flips all of a plugin's extensions at once (the "bundle macro"). No behavior or wire-shape changes.

  ## User-facing

  `sm plugins list` / `show` and the Settings → Plugins UI now consistently say "plugin" instead of "bundle". The only place "bundle" remains is the name for toggling a whole plugin (all its extensions) at once.

- The release pipeline now uploads CLI source maps to the Sentry Node project (`skill-map-cli`) using debug IDs injected before publish, and the published tarball no longer ships `.map` files when telemetry is configured at build time. A hidden `/intentional-fail` UI route was added as a browser-side Sentry self-test, mirroring the existing `sm intentional-fail` command.

## 0.45.1

### Patch Changes

- Use a slash-free Sentry release identifier (`skill-map-cli@<version>` instead of `@skill-map/cli@<version>`). Sentry rejects forward slashes in release names, so the CI sourcemap upload failed the moment it ran; the UI SDK was also tagging events with a bare version that never matched the upload. The CLI SDK release tag, the UI SDK release tag, and the CI upload now use the same slash-free value so events resolve against their sourcemaps.

## 0.45.0

### Minor Changes

- `sm tutorial` now materializes the walkthrough skill into the chosen agent's territory instead of always `.claude/skills/`. Providers declare an optional `scaffold` block (`skillDir` plus display-only `aka` names); the destination comes from `--for <provider>` or a prompt defaulting to Claude. It now also requires an empty cwd, seeding a self-contained scenario the tester can later delete wholesale, so a non-empty directory is refused (exit 2) unless `--force` is passed.

  ## User-facing

  `sm tutorial` can now target other agents: `--for agent-skills` (open-standard layout, used by Antigravity and OpenAI Codex) or `--for claude` (default). It now requires an empty directory: run it in a fresh folder, or pass `--force` to seed into the current one.

### Patch Changes

- Tidy two run-together lines in `sm init` output: insert a blank line before `Running first scan...` so the scaffolding summary and the first scan are visually separated, and terminate the `Auto-detected activeProvider = ...` line with a newline so it no longer abuts the `First scan: ...` summary.

## 0.44.0

### Minor Changes

- Reserved-name detection gains a lens scope: when a Provider is the active lens, its `reservedNames` catalog also applies to the `agent-skills` skill nodes its runtime consumes, matched by kind. This activates Google Antigravity's catalog, refreshed from `agy /help` (v1.0.3) and now declared under `skill`, so a `.agents/skills/<name>` skill shadowing a built-in like `/goal` is flagged by `core/name-reserved` under the antigravity lens. Claude is unchanged.

  ## User-facing

  Under the Antigravity lens, `sm scan` now warns when a `.agents/skills` skill shadows a built-in `agy` slash command (e.g. a skill named `goal` collides with `/goal`), so you can rename it before the runtime silently ignores the file.

- Add opt-in, anonymous error reporting (Sentry) across the CLI, BFF, and UI, OFF by default. Consent lives in `~/.skill-map/settings.json` (`telemetry.errorsEnabled`), surfaced through `GET/PATCH /api/preferences` and a new Settings Privacy toggle; `SKILL_MAP_TELEMETRY=0` force-disables every surface. A pure, deny-by-default scrubber strips home paths and host identity from every event before it leaves the machine. The normative contract is `spec/telemetry.md`.

  ## User-facing

  skill-map can now report crashes anonymously to help fix bugs, and it is OFF by default. Turn it on or off in Settings, or set `SKILL_MAP_TELEMETRY=0` to force it off. File contents, paths, and your settings are never sent.

- Add opt-in, anonymous usage analytics (PostHog) for the CLI and UI, OFF by default. Three independent toggles in `~/.skill-map/settings.json` (`telemetry.usageCliEnabled`, `usageUiEnabled`, alongside `errorsEnabled`); one shared first-run prompt consents to all and mints an anonymous install id used as the PostHog `distinct_id`, exposed read-only via `GET/PATCH /api/preferences`. `SKILL_MAP_TELEMETRY=0` force-disables every surface. Contract: `spec/telemetry.md`.

  ## User-facing

  skill-map can now share anonymous usage (which commands and views you use) to guide development, OFF by default. Toggle CLI usage, UI usage, and error reports independently in Settings, or set `SKILL_MAP_TELEMETRY=0` to force all off. Files and paths are never sent.

## 0.43.0

### Minor Changes

- dc5c115: Migrate the canonical domain from `skill-map.dev` to `skill-map.ai` everywhere: schema `$id` / `$ref` and the `spec/index.json` canonical URL prefix, the bundled plugin schemas and validators, the public site (canonical URLs, Open Graph, Twitter, JSON-LD, the `/demo/` deploy), and the UI's Settings about-link and demo banner. No shape or behavior change; the spec scheme stays `v0`.

  ## User-facing

  The skill-map website and in-app links (Settings, About and the demo banner) now point to **skill-map.ai** (previously skill-map.dev). Spec schema URLs are now `https://skill-map.ai/spec/v0/...`.

- 43eb1e5: Frontmatter coverage pass for Claude and the Agent Skills open standard, plus a breaking revert of dual-source tags to single-source. Claude's `skill-base` gains the `disallowed-tools` denylist; the `agent-skills` Provider declares the open-standard `license` / `compatibility` / `metadata` / `allowed-tools` fields; and `tags` now live only in the `.sm` sidecar, dropping the universal `tags` field, the `scan_node_tags.source` column, and the `sm list --tag-source` flag.

  ## User-facing

  Claude skills and commands now show their `disallowed-tools` in the inspector. Tags come only from `.sm` sidecars now: the `sm list --tag-source` flag is removed and cards show a single tag style. Agent Skills `license` / `compatibility` / `metadata` fields are recognized.

- e953f9f: Pre-1.0 schema-drift rebuild: `sm scan`, `sm watch`, and the BFF watcher compare `scan_meta.scanned_by_version` against the running CLI and, on any `major.minor` difference, delete and recreate the project DB from `001_initial.sql` instead of failing on the stale schema. The DB is a derived cache (`.sm` sidecars hold the authored data) so no backup is taken; patch differences stay compatible and read verbs keep the version-skew advisory.

  ## User-facing

  After updating skill-map, the next `sm scan` rebuilds the local database when it was created by an older version (your `.sm` sidecar files are never touched). On a terminal it asks first; pass `--yes` to skip the prompt.

### Patch Changes

- Updated dependencies [dc5c115]
- Updated dependencies [43eb1e5]
- Updated dependencies [e953f9f]
  - @skill-map/spec@0.40.0

## 0.42.0

### Minor Changes

- f2b59c5: Makes the registered Provider set the single source of truth for the UI's provider surfaces (active-lens dropdown, topbar lens chip, per-node provider chip) and for active-lens auto-detection. Removes four divergent hardcoded provider lists that no longer matched the real built-in Providers (the lens dropdown offered phantom `gemini` / `cursor` entries and hid the real `antigravity` / `agent-skills`; the card chip did not know `openai` / `antigravity`; the detection table still listed `cursor`).

### Patch Changes

- Updated dependencies [f2b59c5]
  - @skill-map/spec@0.39.0

## 0.41.0

### Minor Changes

- d3c47b2: Adds a hard cap on the number of files `sm scan` and `sm watch` accept after `.skillmapignore` filtering, plus a persistent UI banner that fires when the graph crosses the recommended limit. Default cap is **256 nodes**. Override per invocation with `--max-nodes <N>` (bidirectional: raises OR lowers the cap).

### Patch Changes

- ac87936: Fix `sm -version` / `sm -help` (and any single-dash long-form typo) printing the no-project hint when run from a directory without `.skill-map/`. The bare-invocation router now bypasses serve-routing for single-dash long forms so Clipanion's parser always surfaces the proper unknown-option diagnostic with the `Did you mean '--foo'?` suggestion, regardless of project state. Double-dash flags (`--max-nodes`, etc.) still route through serve as before, and the no-project hint still fires for `sm --max-nodes 5` outside a project. The CI test job was the trigger: `src/cli/__tests__/cli-parse-errors.spec.ts` ran from a fresh checkout (no DB) and the two single-dash typo cases hit the no-project hint path instead of the parse-error path.

- 018dd8b: Internal test coverage for the `--max-nodes` flag surface introduced in the previous release and for the `<sm-kind-palette>` inline search added during the same UI pass.

- Updated dependencies [d3c47b2]
  - @skill-map/spec@0.38.0

## 0.40.1

### Patch Changes

- 6381646: UI polish across Settings, topbar, list / graph empty states, the Matrix theme, and the list-view column order. Pure `ui/` change, no spec / kernel / CLI verbs touched; the patch bump on `@skill-map/cli` is the carrier because `ui/` ships bundled in the CLI.

## 0.40.0

### Minor Changes

- f66dbfe: Decouple built-in extensions from per-extension semver. Built-ins ship inside the CLI bundle, so authors no longer declare a `version` literal in each `<plugin>/<kind>s/<name>/index.ts` manifest under `src/plugins/`. The codegen at `scripts/generate-built-ins.js` now reads the CLI version from `src/package.json` and stamps it onto every built-in (alongside the existing `pluginId` stamp) when emitting `src/plugins/built-ins.ts`. The resulting runtime objects still satisfy the full kind interface (`IAnalyzer`, `IExtractor`, ...) and every downstream consumer continues to see `ext.version: string`, so `state_executions.extension_version` keeps recording a meaningful value (= CLI version) for reproducibility.

- d852217: Eliminate the bundle-level toggle entirely. Every plugin extension is now independently toggle-able by its qualified `<bundle>/<ext>` id; the bundle itself is a presentational grouping only.

- aab9500: Aggregate severity counter for cards, drive-by cleanups in the footer-right slot.

- 212fdcf: List view as a first-class surface, harmonised severity icons across graph and list.

### Patch Changes

- 9d37094: Settings → Changelog tab: cap the rendered list and add a permanent escape hatch to the full history.

- c067765: Suppress the per-extension version chip for built-in plugins in both the UI Settings → Plugins panel and the CLI `sm plugins show` human output. Built-ins ship inside the CLI bundle and inherit the CLI version, so a per-extension semver chip on every row is noise; per-extension semver only carries meaning for external (user-authored) plugins, which keep showing it.

- 457a60d: Reserve the `graph.node.alert` slot for special-case signals; disconnect every built-in core analyzer from it. Define the **chip-vs-issue policy** for plugin authors and align `reference-broken` to it. The corner badge on the NE tip of each graph card is no longer a generic "this node has a problem" surface. Routine findings (`reference-broken`, `annotation-field-unknown`, `schema-violation`) now ship only as `card.footer.right` chips, the slot's natural home for paired-icon-and-count signals.

- d66bc71: Three findings from a second `sm-tutorial` external-tester session (Adolfo, 2026-05-25).

- Updated dependencies [f66dbfe]

- Updated dependencies [d852217]

- Updated dependencies [457a60d]

- Updated dependencies [d66bc71]
  - @skill-map/spec@0.37.0

## 0.39.0

### Minor Changes

- 8ab68ed: Rename `core/field-unknown` to `core/annotation-field-unknown` so it
  groups alphabetically with the other sidecar (`.sm`) annotation rules
  (`core/annotation-orphan`, `core/annotation-stale`). The rule's job has
  not changed: it still flags typos / unrecognised keys in sidecars and
  emits a warn issue plus the same `alert` + `chip` view contributions
  on `graph.node.alert` / `card.footer.right`.

- 880fe3e: Rename 14 built-in extension ids to a consistent `<domain>-<detail>` pattern. The naming was inconsistent: 10 ids already followed the "area first, attribute after" shape (e.g. `annotation-orphan`, `link-conflict`) while 14 were inverted, redundant, or vague. All built-ins now agree.

- 1b6e368: Honour per-extension toggles inside bundle-granularity plugins end-to-end. Closes the Phase 4b follow-up (commit `e45d2fd`) gap: BFF + Settings UI started accepting per-extension toggles for any granularity, but three call sites still treated bundle granularity as "one knob, every extension follows", so flipping an individual extension off (e.g. `claude/at-directive`) persisted to `config_plugins` and then did nothing on the next scan.

### Patch Changes

- 8a05b2b: Dev builds now SUPPRESS the version chip in two decorative surfaces and surface a lone `[dev]` marker instead.

- 5d3d757: Restore the animated viewport fit when a WS-scan refresh adds or removes nodes, fix two correctness gaps that surfaced once the tween was back. The graph view's auto-fit-on-topology-change effect had been snapping the camera in place since the zoom-clamp commit `d60e4a4`, losing the "camera glides to frame the new layout" beat the boot-time tween used to deliver. Putting the tween back exposed a long-latent reconcile bug where `nodePositions` (the user-pin map that drives rendering) kept the pre-relayout coordinates of every existing node when dagre rearranged the graph, so a new node would land on top of an existing one and the fit bbox was computed from coordinates that did not match what was rendered.

- 7f15817: The CLI logger's `defaultFormat` now paints each line with the project's standard glyph + color per level, matching the rest of the output surface (see `context/cli-output-style.md` §Glyph catalog). Previously every level emitted as a plain `HH:MM:SS | LEVEL | message` row, so warnings the user is supposed to read scanned the same as low-noise debug lines.

- 49b70fb: Three quality-of-life fixes to the `sm serve` SPA + a small CLI / BFF listing tweak that keeps the user-visible plugin order coherent across surfaces.

- be116dd: Two bugs surfaced by the `sm-tutorial` external-tester walkthrough.

- Updated dependencies [8ab68ed]

- Updated dependencies [880fe3e]

- Updated dependencies [1b6e368]
  - @skill-map/spec@0.36.0

## 0.38.0

### Minor Changes

- b5f6a57: Internal: rename the registry's base extension shape from `Extension` to `IExtension` so the kernel's type naming convention is uniformly applied. `Extension` was an unprefixed Category 4 internal interface (the registry's storage view, distinct from the Category 3 `IExtensionBase` author contract), the only one of its kind outside the closed grandfathered list (`RunScanOptions`, `RenameOp`, `Kernel`, `ProgressEvent`, `LogRecord`, `NodeStat`) documented in `context/kernel.md` §Type naming. Renaming to `IExtension` brings it in line with `IPluginRuntimeBundle`, `IPruneResult`, `IDbLocationOptions`, and the rest of the bucket.

### Patch Changes

- f69d519: cli-architect review pass on `src/`: mechanical hygiene fixes, no behavioural change.

- 556f526: End-to-end `nodes[]` filter on the issues query, threaded from SQLite storage through the BFF route into the UI data-source contract. Motivated by the linked-nodes panel's N+1 fan-out: the panel needs issues for a focused node PLUS its neighbours, and the prior single-path `node=<path>` filter forced one request per neighbour.

- 1c916d5: Security hardening pass on `src/` (audit findings H1, H2, M1, M2, L1).

## 0.37.0

### Minor Changes

- de68f09: Soft-warn drift detection for the active provider lens. When `activeProvider` is set (whether by auto-detect on first scan, the interactive prompt for ambiguous markers, or `sm config set activeProvider <id>`), the runtime now persists the set of provider markers that existed on disk at the moment of the choice as `activeProviderMarkers` in `.skill-map/settings.json`. On every subsequent scan the bootstrap re-detects markers and diffs against this snapshot; when the diff is non-empty (new markers appeared, recorded markers disappeared), it emits ONE soft warn before the scan and continues with the cached lens.

- c318b58: CLI output-style audit pass 2. Pass 1 (landed in `21920e8`) covered `init`, `scan`, `config`, `help`, `history`, `export`, and the bare-`sm` no-project entry. Pass 2 migrates the remaining error / warning surfaces across twelve catalogs to `context/cli-output-style.md` §3.1b, the two-line block: glyph + headline followed by a dim hint sourced from a sibling `<key>Hint` catalogue entry. Colour resolution stays at the CLI seam (`ansiFor`-resolved glyph + `ansi.dim`-wrapped hint threaded through the texts pipeline at the call site).

- 821a9ed: DB version-skew detection. When the local `.skill-map/` SQLite DB was written by a different `@skill-map/cli` version than the one currently running, the operator used to get either silent corruption (older CLI reading a newer DB) or a cryptic "Invalid LinkKind value ..." from the enum parsers downstream. This changeset adds an opt-in classification seam at the SQLite open path so the skew surfaces at open time with a recovery hint, before the kernel touches the rows.

- 75a91eb: Fix two kernel bugs surfaced in a manual link-matrix test session, both affecting how invocation/mention edges land in a real scan.

- a58989f: Lens-gated classification for vendor providers. Vendor Providers (`claude`, `openai`, `antigravity`) now opt into being gated by the active lens via a new `gatedByActiveLens: true` field on their manifest. The walker (`src/kernel/orchestrator/walk.ts`) pre-filters `opts.providers` before the walk loop: a gated Provider runs only when `provider.id === opts.activeProvider`, so vendor providers no longer attempt to classify files outside their lens. Universal providers (`core/markdown`, future `agent-skills` open standard) leave the flag absent / `false` and run unconditionally.

- a4ce684: `core/link-counts` analyzer no longer counts self-loop links toward the per-node footer chips (`linksIn` / `linksOut`). The chips disagreed with the `LinkedNodesPanel` sidecar which already filtered self-loops out of its outgoing / incoming lists.

- 21920e8: Drain pass after the link-matrix walkthrough surfaced rough edges across the CLI surface and the inspector. No new normative spec, only impl polish and tightened error semantics.

- d207cfa: Observable link analysis. The link-matrix walkthrough surfaced a recurring complaint, "the inspector tells me there is an edge but not where, why, or whether it overlaps with another", and a small cluster of detection bugs that were hiding real problems and inventing fake ones. This changeset is the drain pass.

- 5a12e5c: Phase 2.D of the Signal IR migration: new `core/signal-collision` built-in analyzer surfaces resolver rejections as operator-visible `warn` issues. The analyzer reads `IAnalyzerContext.signals`, finds every Signal whose `resolution.outcome === 'rejected'`, and emits one issue per rejection naming the loser extractor + matched text + byte range, the winner extractor + range, and the tiebreak reason (`kind-priority` / `higher-confidence` / `longer-range` / `earlier-declaration`). Phase 4+ stubs (`extractorDisabled`, `belowFloor`) are handled with their own message templates so the surface stays forward-compatible.

- 3ca095b: Wire the Signal IR resolver end-to-end (Phase 2.A of the active-lens migration). The kernel's `resolveSignals` runs after extraction and before analysis: filters disabled extractors (Phase 4+ stub), ranks intra-Signal candidates via `IProvider.resolverRules.kindPriority` (when declared) + confidence + extractor declaration order, builds overlap clusters from body-scoped Signals sharing a source, picks a cluster winner per the four-step tiebreak chain (`kind-priority` -> `higher-confidence` -> `longer-range` -> `earlier-declaration`), materialises winners as Links indistinguishable from `emitLink`-emitted ones, and annotates each Signal's new `resolution` field with the outcome + reason. Rejected (losing) Signals remain accessible to analyzers via `IAnalyzerContext.signals` so a future `core/signal-collision` analyzer can surface them as `warn` issues naming WHO won and WHY.

### Patch Changes

- e91681f: Internal: expand the `antigravity` Provider's `reservedNames.command` seed catalog from 6 entries to the full 38-verb Gemini CLI slash-command surface plus its 4 documented aliases (42 total). Google's transition blog (2026-05-19) states that the Antigravity CLI fully replaces Gemini CLI, preserves the four feature pillars (Agent Skills, Hooks, Subagents, Extensions), and shares the same agent harness as the Antigravity 2.0 desktop app, so the operator's built-in slash-command vocabulary almost certainly carries over 1:1. The catalog stays inactive (the analyzer keys on `node.provider` and the `antigravity` Provider still classifies nothing), no behavioural change today; the seed is in place for the day Antigravity grows its own kind. Provisional label inline; reconcile when antigravity.google/docs publishes the authoritative reference.

- 1362de9: Phase 2.B of the Signal IR migration: `claude/at-directive` extractor now routes through `ctx.emitSignal` instead of `ctx.emitLink`. Each `@<token>` match emits a single-candidate Signal carrying the byte range, scope (`body`), and a candidate with the same kind / target / confidence / trigger / rationale shape the extractor used to embed directly into a Link. The resolver phase materialises the winning candidate as a Link indistinguishable from the prior direct-emit shape, including `occurrences[]` round-tripping; full `pnpm validate` stays green with 1734 tests passing and zero behaviour change.

- 8d9e820: `sm init --force` now wipes the existing `.skill-map/skill-map.db` (and its WAL / SHM sidecars) before provisioning the fresh one, matching the greenfield posture per AGENTS.md: --force means "reset every project artefact", not just the config files. Re-opening a stale DB whose schema predates the current `001_initial.sql` produced `JSON.parse(undefined)` crashes inside `loadScanResult` (columns added post-DB-creation come back as `undefined` from Kysely, and the defensive wrap surfaced them as "Failed to read scan rows" errors on the very next auto-scan); the wipe sidesteps the problem at the right layer instead of bolting in-place ALTER TABLE migrations against the greenfield rule.

- b8c7c0d: Internal cleanup that rides with the post-active-lens documentation sweep.

- 0df19f0: Phase 2.C of the Signal IR migration: the remaining five link-emitter extractors (`claude/slash`, `core/markdown-link`, `core/annotations`, `core/mcp-tools`, `core/external-url-counter`) now route through `ctx.emitSignal` instead of `ctx.emitLink`. Each one emits single-candidate Signals with the same kind / target / confidence / trigger shape the prior emission produced; the resolver materialises them as Links indistinguishable from direct-emit shape so 1734 tests and full `pnpm validate` stay green with zero behavioural change.

- 526cebd: Internal: regression tests for the BFF `/api/links?to=` resolved-target lookup and the `core/reserved-name` source-side issue through `runScan`.

- ba07e2f: Internal: bump `tsx` from 4.21.0 to 4.22.3. The 4.21.1 release added official support for Node 26.1.0 (switched the loader from the now-deprecated `module.register()` to `module.registerHooks()`), so dev-mode invocations under Node 26 no longer print the `DEP0205` deprecation banner at startup. Node 24 floor (`engines.node >= 24.0`) is unaffected: tsx 4.22.3 retains the legacy path on older Node versions. Touches `src/package.json` and the workspace lockfile only; no runtime behavioural change for the built CLI distribution.

- Updated dependencies [de68f09]

- Updated dependencies [1362de9]

- Updated dependencies [a58989f]

- Updated dependencies [d207cfa]

- Updated dependencies [5a12e5c]

- Updated dependencies [3ca095b]
  - @skill-map/spec@0.35.0

## 0.36.0

### Minor Changes

- 2593664: Retire the `gemini` Provider and onboard the `antigravity` Provider. Google released the Antigravity CLI on 2026-05-19 as the replacement for the Gemini CLI (which sunsets 2026-06-18 for consumer tiers). Antigravity preserved the four pillars of Gemini CLI (Agent Skills, Hooks, Subagents, Extensions/plugins) but adopted the open-standard `.agents/` layout instead of carrying forward a vendor-specific `.gemini/` directory, so the old Provider classified obsolete paths.

- ee919da: Reserved-name catalog per Provider. Each Provider runtime owns a set of invocation names its built-ins consume (Claude reserves `/help`, `/clear`, `/init`, `/agents`, `/model`, … under `command`, and `general-purpose`, `output-style-setup`, `statusline-setup` under `agent`). User files declaring one of these names are silently shadowed at runtime, the kernel now surfaces the collision.

### Patch Changes

- Updated dependencies [2593664]

- Updated dependencies [ee919da]
  - @skill-map/spec@0.34.0

## 0.35.0

### Minor Changes

- da26519: Provider-aware confidence bump for resolved invocation links. Three changes ship together.

### Patch Changes

- Updated dependencies [da26519]
  - @skill-map/spec@0.33.0

## 0.34.1

### Patch Changes

- 4af662b: Loosen the active-provider lens gate to lens-only: per-provider extractors run on every visited node when the active lens is in the extractor's declared `precondition.provider` allowlist, regardless of which provider classified the node.

- Updated dependencies [4af662b]
  - @skill-map/spec@0.32.1

## 0.34.0

### Minor Changes

- a5d6f12: `sm plugins enable` and `sm plugins disable` now accept multiple plugin ids in one invocation, e.g. `sm plugins disable gemini openai agent-skills`. The single-id form and `--all` keep working unchanged.

### Patch Changes

- 270fc6f: Implement the spec'd active-provider auto-detect at scan entry (`spec/cli-contract.md` §Auto-detect on first scan), closing the gap where `activeProvider` only flowed when the operator typed `sm config set activeProvider <id>` manually.

- a1e5fdc: Two P3 polish bugs from the providers-test-plan re-pass.

- 3ee3d19: Unify path normalisation between `claude/at-directive` and `core/markdown-link`, and upgrade `dedupeLinks` to merge cross-extractor duplicates with the maximum confidence.

- 0fa452d: Three fixes to provider classification and Claude extractor heuristics, surfaced by the new provider end-to-end test plan.

- 8bec353: Wire the active-provider lens gate through the orchestrator so per-provider extractors run only when both the node's provider AND the active lens are in the extractor's declared `precondition.provider` allowlist.

- 0da1ab2: Post-resolution confidence bump for `mentions` links (closes `bd-owi`).

- dba02a2: Unify the orchestrator's post-walk link transforms under a single internal seam, and pay down two complexity-rule hot-spots flagged by lint.

- Updated dependencies [a5d6f12]
  - @skill-map/spec@0.32.0

## 0.33.0

### Minor Changes

- 29fb253: Active-provider lens model, Signal IR scaffold, numeric `Confidence`, MCP virtual nodes, OpenAI Codex provider, and the Phase 4b extractor mudanza in one coherent migration.

### Patch Changes

- Updated dependencies [29fb253]
  - @skill-map/spec@0.31.0

## 0.32.0

### Minor Changes

- 5f4b181: Remove `@skill-map/testkit` and `examples/hello-world` from the monorepo.
  The packaged plugin-author helper layer is retired. Plugin authors test
  extensions by building fake `ctx` literals against the public types
  re-exported from `@skill-map/cli` (`IExtractor`, `IAnalyzer`,
  `IFormatter`, the matching `*Context` shapes, `Node`, `Link`, `Issue`).
  Reason: zero downstream consumers in the public ecosystem after Step
  9.3; the maintenance cost of an independently-versioned npm package +
  its own changesets, validate phases, and narrative outweighed the value
  of a thin packaged helper layer.

- 6964be3: Add a UI surface for editing the project's `.skillmapignore` file from
  Settings → Project. The new section sits below "Folders for link
  validation" and uses the same add / remove list pattern, so the
  operator can manage gitignore-style scan filters without opening the
  file by hand.

- dcd6b78: Tighten the Settings → Project surface (paths) end-to-end: client + BFF
  validation, audit logging on the server console, banner visibility for
  the configured roots, watcher hot-reload when `scan.extraFolders`
  changes, and a scoped red signal for error banners inside the Settings
  modal.

- d95e5b8: Remove the `scan.extraFolders` config key. Project-local persistent
  extension of the indexed scan no longer exists; to walk a directory
  outside the project root pass it as a positional argument to
  `sm scan [roots...]` (per-invocation, not persisted). The narrower
  `scan.referencePaths` key (validate links against on-disk files
  without indexing them) is unaffected.

### Patch Changes

- Updated dependencies [5f4b181]

- Updated dependencies [d95e5b8]
  - @skill-map/spec@0.30.0

## 0.31.0

### Minor Changes

- 5783372: `sm tutorial` now materializes a full Claude Code skill folder under
  `<cwd>/.claude/skills/<slug>/` instead of a single `.md` file at the
  cwd top level. This unblocks `sm tutorial master`: the canonical
  `sm-master` skill ships a `references/` sub-folder (tour bodies +
  fixture templates) that the SKILL.md reads at runtime, and the
  previous single-file payload left those references missing when a
  tester ran the verb.

## 0.30.0

### Minor Changes

- 9a27192: Broken-ref findings now carry a hint when a same-named file exists on
  disk but does not advertise `name:` in its frontmatter. Common case:
  the author writes `@c` (or `/c`) expecting it to resolve to
  `.claude/agents/c.md`, but the agent's frontmatter is missing the
  `name: c` line, so trigger resolution falls through.

- 993df04: Align `core/slash` and `core/at-directive` with how LLM hosts (Claude
  Code, Gemini CLI, Cursor) read author-intent tokens in prose. An
  external tester surfaced false-positive broken-ref issues on inputs
  like `re-invoke @sm-tutorial.md from /Volumes/foo/...`; cross-runtime
  research confirmed a consistent pattern across providers and reference
  runtimes (Codex, Cursor, Aider).

### Patch Changes

- Updated dependencies [4e0646c]
  - @skill-map/spec@0.29.0

## 0.29.0

### Minor Changes

- 834fede: Replace the graph view's hand-tuned d3-force layout with an
  algorithm dispatcher and surface the knobs through three new
  popovers in the bottom toolbar (next to the zoom controls). Two
  engines feed the dispatcher: Foblex's `@foblex/flow-dagre-layout`
  plugin (versions pinned to 18.5.0, matches the installed
  `@foblex/flow`) for the layered `Balanced` and `Stretched` modes,
  and the existing d3-force simulation kept around as the `Organic`
  mode for users who want a physics-based arrangement without a
  fixed flow direction.

- e21216e: Simplify plugin manifest fields beyond the file-layout refactor. The
  previous `structure-as-truth-plugins` changeset moved bundle / kind /
  id discovery onto the filesystem; this one extends the same principle
  into the manifest schemas themselves so the only fields that survive
  are the ones the kernel cannot derive from disk.

- 8b7abbf: Structure-as-truth refactor for plugin extensions. The filesystem
  layout (rather than declarative manifest fields) is now the single
  source of truth for bundle / kind / extension id.

- 8e457dd: Adopt the convention that every test file lives in a `__tests__/`
  folder next to its SUT and uses the `.spec.ts` suffix. The legacy
  central `src/test/` and `testkit/test/` directories are gone:
  the 145 specs under `src/` were moved to colocated `__tests__/`
  folders, end-to-end cross-module flows landed under
  `src/__tests__/integration/`, and the 5 testkit specs moved to
  `testkit/src/__tests__/`. Same convention `makius-base/api` and
  the `cli-ruler` agent enforce, now wired into this repo.

### Patch Changes

- fcc2341: Ship `.skillmapignore` at POSIX mode `0o644` so anyone with checkout
  access can read it on multi-user hosts and shared-mount workflows
  without a chmod dance. The file is meant to be committed alongside
  `.gitignore`, the project-private default of `0o600` (kept for
  `settings.json` and sidecars that may carry private paths) was
  misapplied here. Implementation: `writeFileAtomicExclusive` gains a
  third `mode: number` parameter with the previous `0o600` as default;
  the init command passes `0o644` for `.skillmapignore` only. On
  Windows the parameter is a no-op (Node maps POSIX modes to the
  readonly attribute only).

- Updated dependencies [e21216e]

- Updated dependencies [8b7abbf]
  - @skill-map/spec@0.28.0

## 0.28.0

### Minor Changes

- 88b2491: Add a Matrix theme as an opt-in extra theme alongside the existing
  dark / light / auto tri-state. `ThemeService` grows an orthogonal
  `extraTheme: 'matrix' | null` signal that overrides the dark/light
  mode when set, persists at `localStorage:skill-map.ui.extra-theme`,
  and is selectable from Settings → General → Theme. Clicking the
  topbar dark/light toggle clears the extra theme AND advances the
  mode one step in the same gesture, so users always have a one-click
  exit path.

### Patch Changes

- 76304be: Group and sort the extension list rendered by `sm plugins show <bundle>`
  by the canonical pipeline order (provider, extractor, analyzer, action,
  formatter, hook), then alphabetically by short id within each kind.
  Previously the list followed the declaration order of `built-ins.ts`,
  which mixed analyzers after formatters and gave readers no quick way to
  scan a bundle by kind. Mirrors the kind order published on the marketing
  site so the CLI and the web tell the same story. Affects human output of
  the bare-bundle form (`sm plugins show core`, `sm plugins show <user-plugin>`);
  `--json` keeps emitting the source manifest order so existing JSON
  consumers see no shape change, and the single-extension detail form
  (`sm plugins show core/superseded`) is untouched.

- e8be298: Swap the leading glyph in the `Update available` banner header from
  `⬆` (HEAVY UPWARDS BLACK ARROW, U+2B06) to `⬇` (HEAVY DOWNWARDS BLACK
  ARROW, U+2B07). The down arrow reads as "a newer version is coming
  DOWN to your machine" (incoming download), which is the same semantics
  the banner is already conveying with the `<current> → <latest>` line
  just below; the previous up arrow's "upgrade outward" reading was
  inconsistent with that downward flow. Single-character edit in
  `src/cli/util/update-check-banner.ts:189`; both characters are East
  Asian fullwidth and occupy the same number of terminal cells, so
  `BANNER_WIDTH` math and the border `─` fill remain correct without
  adjustment.

## 0.27.0

### Minor Changes

- f1efd1b: Remove the `-g/--global` flag and every implicit `$HOME` read from
  skill-map. The CLI now operates exclusively on the project scope
  (`<cwd>/.skill-map/`); there is no global / user scope, no
  `SKILL_MAP_SCOPE` env var, no silent merge of user-level config or
  plugins.

### Patch Changes

- fd909bd: Fix `sm plugins show <bundle>/<ext>` rendering the full parent
  bundle's detail instead of the requested extension. The CLI now
  branches on whether the resolver returned a qualified id and emits
  a focused single-extension block (header + Kind / Version /
  Stability / Description / Preconditions / Entry) in human mode,
  with `--json` returning just the extension object instead of the
  whole bundle envelope. Bare bundle ids (`sm plugins show core`)
  keep the original bundle-listing output. Two new renderers
  (`renderBuiltInExtensionDetail`, `renderUserExtensionDetail`) plus
  a shared `renderExtensionFields` block live in
  `src/cli/commands/plugins/show.ts`; the user-plugin path reads
  optional metadata off `ILoadedExtension.instance` via a new
  `readInstanceMeta` helper. `IBuiltInBundleRow.extensions[]` in
  `src/cli/commands/plugins/shared.ts` now carries optional
  `description` / `stability` / `preconditions` / `entry`, populated
  through a new `extensionRowFromBuiltIn` builder that respects
  `exactOptionalPropertyTypes`. Six new tests in
  `src/test/plugins-cli.test.ts` replace the previous "renders
  parent bundle" assertion (which was locking in the bug) and cover
  single-ext built-in + user paths, JSON shape, disabled-glyph
  reflection, optional-field surfacing, and a bare-id regression.
  Bundled together: `src/test/git-helpers.test.ts` now `t.skip()`s
  the two "no `.git/` parent" cases with a directed message when
  the host's tmpdir lineage contains a stray `.git/` ancestor (e.g.
  `/tmp/.git/`); the branch was unreachable on polluted
  environments and the skip keeps the suite green without masking
  real coverage (the rest of the file still exercises
  `isInsideGitRepo` end-to-end via the project root's real
  `.git/`). No spec change: `cli-contract.md` already says "Full
  manifest + compat detail" for `sm plugins show <id>`, and the new
  behaviour is strictly closer to that wording than the old
  dump-the-whole-parent-bundle behaviour.

- Updated dependencies [f1efd1b]
  - @skill-map/spec@0.27.0

## 0.26.1

### Patch Changes

- 4d2a540: Rework the `sm tutorial` demo fixture (`sm-tutorial` skill) so the
  Live UI block teaches the three link kinds (`mentions`, `invokes`,
  `references`) from the syntax the tester writes. Step 3 now creates
  four files instead of three, the extra node is a second
  `markdown` (`notes/demo-guideline.md`) that gives the hub a real
  `references` target. Step 5 collapses three separate file edits
  into a single edit on `notes/todo.md`, which becomes the only
  source of connectors in the demo: four bullets, one per target,
  covering `@demo-agent` (`mentions`), `/demo-command` (`invokes`),
  `/demo-skill` (`invokes`), and `[demo-guideline](./demo-guideline.md)`
  (`references`). The downstream count references, the
  `.skillmapignore` tree shown in Step 6, the deep-dive edit target
  in Step 8, the `sm list` expected output in Step 9, the Provider
  detection global substitution rule, and the start-over wipe list
  all updated to match.

## 0.26.0

### Minor Changes

- 48800d4: Drop `requires`, `related`, and `conflictsWith` from the curated annotation catalog.

### Patch Changes

- 7e3acb9: Extract the `.sm` sidecar consent gate strings shared by `sm bump`,
  `sm sidecar refresh`, and `sm sidecar annotate` into a single
  `src/cli/i18n/consent.texts.ts` module (`CONSENT_TEXTS`). The directed
  error prefixes are now driven by a `{{verb}}` placeholder filled by
  each caller (`'sm bump'` or `'sm sidecar'`), so the user-visible output
  is unchanged and the catalogs (`bump.texts.ts`, `sidecar.texts.ts`)
  stop carrying duplicated copies of the same paragraph. Internal DRY
  cleanup, no behaviour or surface change.

- 21875e5: Fix double-counted incoming/outgoing link totals when a relation is
  declared from BOTH sides of a `.sm` annotation pair (e.g. `supersedes: [B]`
  on `A.sm` AND `supersededBy: A` on `B.sm`). The `core/annotations`
  extractor walks each node in isolation, so each side independently emits
  the same `(A → B, supersedes)` edge; without a global dedup the orchestrator
  returns two copies, `recomputeLinkCounts` and the `core/link-counts`
  chip then surface inflated `linksInCount` / `linksOutCount` values, and
  the watcher's per-rescan `delta.ts#diffLinks` `Set`s occasionally
  collapse the duplicate by accident on save, which is what made the bug
  appear as "wrong number on cold start, correct after editing anything".

- 49243b9: Three related fixes around graph link semantics and node health surfacing.

- Updated dependencies [48800d4]
  - @skill-map/spec@0.26.0

## 0.25.0

### Minor Changes

- a53532b: Replace BYTES with TOKENS in the human-mode output of `sm list` and `sm show`. Tokens are the metric users actually care about for LLM budgeting; bytes were a leftover from the early file-size mental model.

- 2129b40: Add an optional positional `variant` argument to `sm tutorial`. Default (no argument) keeps the previous behaviour and materializes `<cwd>/sm-tutorial.md` (the basic walkthrough). Passing `master` materializes `<cwd>/sm-master.md` (the advanced walkthrough: plugin tour, plugin authoring, settings + view-slots) through the same channel. The value is validated against the closed set `{ tutorial, master }`; anything else exits with code 2 and an `invalidVariant` error pointing at the valid values. The build pipeline (`tsup.config.ts → onSuccess`) now copies both SKILL.md sources into `dist/cli/tutorial/`, and the runtime resolver caches each variant independently. CLI i18n strings under `tutorial.texts.ts` were parameterized with a `{{filename}}` placeholder so the success block points the tester at whichever file was materialised. Spec § `sm tutorial` was rewritten to document the new positional and exit-code rule.

### Patch Changes

- Updated dependencies [a53532b]

- Updated dependencies [2129b40]
  - @skill-map/spec@0.25.0

## 0.24.5

### Patch Changes

- 2e1c0f4: Third pass of the release-pipeline shakedown. The second pass (`verify-pipeline-second-pass`) confirmed the Railway demo deploy is now green end-to-end, but the post-publish smoke step still failed: `npm i -g @skill-map/cli@0.24.4` returned `ETARGET` for the full 5-retry window even though the registry already had the version (`curl https://registry.npmjs.org/@skill-map/cli/0.24.4` returned 200 during the failure). Root cause is the npm CLI's local metadata cache, the first 404 gets cached and every retry replays it. This bump exists to verify the fix: the smoke step now passes `--prefer-online` (forces a fresh staleness check on every attempt), runs the install from a clean `mktemp -d` cwd (so the repo's pnpm-flavored `.npmrc` does not bleed into npm's config resolution), and retries up to 10 times with 30 second back-off. No code or contract change in any of the four packages.

- Updated dependencies [2e1c0f4]
  - @skill-map/spec@0.24.3

## 0.24.4

### Patch Changes

- 5eb79ba: Second pass of the release-pipeline shakedown after the pnpm migration. The first pass (`verify-release-pipeline`) surfaced two issues that this bump exists to verify the fixes for: (a) the Railway demo deploy crashed in `web/scripts/build-demo-dataset.js` because `node --import tsx` could not resolve `tsx` from the demo fixture's cwd (pnpm's strict hoist keeps it in `src/node_modules/`), and (b) the post-publish smoke step hit `ETARGET` on `@skill-map/cli@latest` because the npm CDN had not yet propagated tarball metadata at every edge when the install ran. Both are now fixed: `build-demo-dataset.js` imports the tsx loader by absolute `file://` URL, and the smoke step now reads the explicit version from `changesets.outputs.publishedPackages` and retries up to 5 times with 30 second back-off. No code or contract change in any of the four packages.

- Updated dependencies [5eb79ba]
  - @skill-map/spec@0.24.2

## 0.24.3

### Patch Changes

- fb52d17: Migrate the monorepo's package manager from npm to pnpm 11.

- 56fef3b: Verify the release pipeline end-to-end after the pnpm 11 migration: `release.yml` boots through `pnpm install --frozen-lockfile`, `release:version` bumps versions and refreshes the lockfile in one shot, `release:publish` propagates the four versioned packages to npm, and `deploy-web.yml` rolls out the new public site on the post-migration `pnpm/action-setup` chain. No functional or contract change in any of the four packages, this exists purely so the next "chore: version packages" PR exercises every moving part of the new pipeline at least once.

- Updated dependencies [fb52d17]

- Updated dependencies [56fef3b]
  - @skill-map/spec@0.24.1

## 0.24.2

### Patch Changes

- dc92b12: Add a per-browser graph edge style preference to Settings → General. The new selector picks between the four Foblex connection shapes (orthogonal / straight / bezier / adaptive curve) and persists in `localStorage`, so it does not sync across machines.

- 88cb607: Polish the graph view's default edge look to match Foblex's `schema-designer` example.

- 4e57f22: Enable user-driven edge selection in the graph view. Removed `[fSelectionDisabled]="true"` from `<f-connection>` so Foblex's built-in click-to-select kicks in. When an edge is selected, the line grows from its per-kind base (1-1.5px) to 2.5px and the kind's muted base colour is promoted to its full-saturation `*-active` counterpart (e.g. `invokes` goes from desaturated `#b8843a` to vivid `#f59e0b`), marker dot and arrowhead follow the path so the picked edge pops without changing hue family.

- 38a24a0: Swap the card-footer `linksIn` / `linksOut` icons from `pi-arrow-up` / `pi-arrow-down` to `pi-download` / `pi-upload`. The tray-with-vertical-arrow glyphs read as "things landing on / leaving this node" while keeping the pure arrow shape exclusive to the graph's own edges.

## 0.24.1

### Patch Changes

- dc92b12: Add a per-browser graph edge style preference to Settings → General. The new selector picks between the four Foblex connection shapes (orthogonal / straight / bezier / adaptive curve) and persists in `localStorage`, so it does not sync across machines.

## 0.24.0

### Minor Changes

- dd25272: Apply 13 of 15 findings from the `cli-architect` review of `src/` (audit run 2026-05-13). Behaviour and architecture only; lint and security audits were out of scope.

### Patch Changes

- 2b09ce8: Apply findings from the `app-hacker` security audit of `ui/` (audit run 2026-05-13). Defence-in-depth and hardening only; no user-observable behaviour changes.

- 8e06f8a: Apply 3 findings from the `cli-hacker` security audit of `src/` (audit run 2026-05-13). Defence-in-depth and hardening only; no user-observable behaviour changes.

- Updated dependencies [2b09ce8]
  - @skill-map/spec@0.24.0

## 0.23.1

### Patch Changes

- 45e275c: M1 PrimeNG `::ng-deep` audit (verified against `primeng@21.1.6`). Two phases of work plus documentation, all internal to `ui/` (the workspace ships bundled inside `@skill-map/cli`).

## 0.23.0

### Minor Changes

- c1ed77a: Add `IAnalyzer.recommendedActions` so an Analyzer can declare which per-node Actions resolve its findings.

### Patch Changes

- a34858a: Audit fix L6 on the BFF: `/api/issues` now paginates (`offset`, `limit`, default 100, max 1000, mirroring `/api/nodes`) and pushes its three filters (`severity`, `analyzerId`, `node`) into the storage layer instead of loading every persisted issue into memory and filtering in JS.

- 608e6ae: BFF compliance audit follow-ups (`bff-ruler` on `src/server/`).

- 639a95b: Finish the em-dash sweep across `src/` and lock it down with an ESLint rule.

- 639644d: Strip em dashes (`—`) from CLI / kernel / built-in user-facing strings. Stylistic sweep matching the project rule against em dashes in written text; each replacement is a comma, colon, semicolon, or parenthetical pair chosen to read naturally in context.

- 8c3bc0d: Follow-up sweep on the cli-ruler audit. Four pieces.

- c2152cc: Add `--json` output to four verbs that previously emitted only human-formatted text: `sm refresh` (and `sm refresh --stale`), `sm plugins doctor`, `sm conformance run`, plus `--format json` on `sm graph` (`sm graph` uses the formatter catalog rather than the global `--json` flag). Closes the spec drift where the global `--json` flag was advertised but ignored on these verbs, and unblocks CI / scripting consumers that parse the output.

- 665a21a: Security hardening, two BFF fixes from a follow-up audit. No user-visible behavior changes; defence-in-depth on the loopback HTTP surface.

- 15bf673: Security hardening, three follow-up audit fixes. No user-visible behavior changes; defence-in-depth on internals.

- 36b1865: Security hardening, three fixes from a follow-up audit. No user-visible behavior changes; defence-in-depth on internals.

- ff3121f: Security hardening, safer Windows browser launcher in `sm serve`. No user-visible behavior changes; defence-in-depth on internals.

- 5f4de1c: Security audit sweep (cli-hacker follow-up). Three highs, three mediums, three lows, plus the shared prototype-pollution helper and a plugin-author doc note.

- b17bf41: Tutorial F3 — close consent-gate leak across user-level config layers. `allowEditSmFiles`, `scan.extraFolders`, and `scan.referencePaths` are spec'd as project-local-only, but the loader's strip used to fire only on the committed `project` layer; values in `user` / `user-local` / `override` survived and silently granted consent (or applied paths) in every project. Now stripped from every non-project-local layer, with a directed warning naming the offending layer + key.

- Updated dependencies [c1ed77a]

- Updated dependencies [608e6ae]

- Updated dependencies [c2152cc]

- Updated dependencies [5f4de1c]

- Updated dependencies [639a95b]
  - @skill-map/spec@0.23.0

## 0.22.0

### Minor Changes

- 39a61e9: Remove the implicit "scan HOME" surface and consolidate every out-of-project scan path under a single, explicit `scan.extraFolders` setting. Privacy-by-default: the CLI / BFF / UI never read the user's home automatically anymore; every path outside the project root must be listed by the operator.

### Patch Changes

- 1e48d2e: Follow-up sweep on the cli-architect spec-drift audit. Three pieces.

- b6aa85e: Apply four P1 findings from the cli-architect audit on `src/` — three are pure internal refactors (no observable behaviour change), one tightens BFF input validation.

- a91b1dd: Architect-audit follow-up: split `cli/commands/bump.ts` into a pure plan-computation half and a side-effect adapter half.

- 129483e: Split `cli/commands/db.ts` (943 LOC, 7 subverbs in one file) into one file per subverb under `cli/commands/db/`, plus a `shared.ts` for cross-subverb helpers. Same shape as the earlier `cli/commands/plugins/` split.

- c5959d2: Architect-audit follow-up: split `kernel/orchestrator.ts` (2972 LOC, 5 `eslint-disable complexity`) into one file per pipeline stage under `kernel/orchestrator/`. Two-phase change in a single commit.

- 5f19e71: Split two coupled kernel-side files into per-concern directories. Same shape as the earlier `kernel/orchestrator/` split.

- 4d8d527: Architect-audit follow-up: split `cli/commands/plugins.ts` (1700 LOC, 7 `eslint-disable complexity`, 7 subcommands) into per-verb modules under `cli/commands/plugins/`.

- 598135c: Architect-audit follow-up: full complexity-disable sweep across `src/kernel/adapters/sqlite/`. **18 `eslint-disable complexity` → 0** across 7 files. Pure structural refactor — every function preserves its prior signature and behaviour; tests pass unchanged.

- 093e2e9: Refactor `npm run validate` orchestration: every compilation-stage check across every workspace runs FIRST, then every test suite runs LAST. Fast-fail on typecheck / lint / build / spec-check / reference-check without paying the test-suite wait.

- Updated dependencies [1e48d2e]

- Updated dependencies [39a61e9]
  - @skill-map/spec@0.22.0

## 0.21.0

### Minor Changes

- 08c33b8: Fold `core/sidecar-drift` into `core/annotation-stale` and fix a per-tuple sweep bug that left stale view-contribution rows orphaned for nodes whose path contained slashes.

- c43e499: Surface `core/broken-ref` and `core/unknown-field` issues on the graph card, reshape `core/annotation-stale` to a single icon-only chip, and clean up the renderer chrome across `node-icon` / `node-counter` / `node-alert`.

- f72dbfc: Card body + topbar polish, plus catalog rename of the topbar scope slot.

- 04f858d: Consolidate the card-footer link counters into a single `core/link-counts` pair and run a top-to-bottom icon-review pass across the topbar, the graph card, and the alert / chip surfaces of `broken-ref` + `unknown-field` + `stability`. Greenfield: no `catalogCompat` bump, no migration shim — the manifest catalog of built-in view contributions changes shape (three extractor chips drop, two analyzer chips appear, two analyzer payloads change) and no released external plugin keys off these IDs.

- 2c9aaad: Lock `core/annotations` so it can no longer be disabled.

- fe13254: Tighten the manifest `icon` grammar on `viewContributions[].icon` from "single emoji-or-PrimeIcons-bare-name" to a prefix-discriminated string with four explicit shapes. Greenfield migration: no compat shim, no `catalogCompat` bump, bare names now fail at manifest load.

- 4f89a84: Plugin toggles in the Settings modal now apply at the next scan instead of needing an `sm serve` restart. The "Restart required" banner is gone for the common case; only plugins that were disabled at server boot keep a per-row warning because their handlers were never loaded into memory.

- b840302: Rename the view slot `card.footer.left.counter` to `card.footer.left`.

- 62ab63d: Promote sidecar-awareness into the kernel's per-(node, extractor) cache key so `.sm` edits propagate to the UI on every code path (watch, scan, CLI, BFF cold start) without busting unrelated cached extractors.

- 13f8484: Fix two bugs around sidecar-driven UI updates and adopt Font Awesome Free in the bundled UI as a webfont addition (no spec changes, no plugin-author surface yet).

- a96c257: Add a per-project consent gate for `.sm` sidecar writes, generalise the "privacy-sensitive, must not be committed" idea to a closed set of project-local-only keys, and cache config on the daemon so repeated reads in `sm serve` no longer re-walk six file layers.

- b676fdb: Migrate the experimental / deprecated stability indicators on graph cards from hardcoded template markup into a new built-in extractor `core/stability` that emits chips to the `card.footer.right` slot. Remove the dead-code injection icon that shared the same wrapper.

### Patch Changes

- 5ed14cb: Disabling a plugin now wipes its `scan_contributions` rows immediately, instead of waiting for the next `sm scan` to sweep them. Without the eager purge, the catalog sweep documented in `db-schema.md` § scan_contributions only ran on the next scan, so the UI kept rendering the plugin's footer / card chips even though the toggle showed `enabled: false`.

- b840302: Unify footer-chip icons across the three outgoing-reference extractors and remove three legacy hardcoded chips from the card now that the per-extension view contributions cover them.

- 1212f18: Rewrite the `description` field on every built-in plugin (extractors, analyzers, actions, formatters, hooks) in user-facing language. Removes internal jargon — slot ids, frontmatter key names, kernel-side concepts — in favour of explanations that match what the operator actually sees in Settings → Plugins and on the cards / graph.

- 3b17043: Fix two `sm plugins` inconsistencies and align the tester tutorial with the verbs that actually exist at v0.20.0.

- 0f621e9: `update available` banner now fires on the first invocation after a fresh install or a `npm i -g` upgrade. Previously the banner required two runs to surface: the first run loaded the empty / not-yet-populated cache row, skipped the banner, fetched the latest from npm, and persisted the cache; only the second run actually printed the message. Operators who installed and ran `sm` once a day effectively never saw the notification because the cache freshness window (24h) and the run cadence collided.

- Updated dependencies [f72dbfc]

- Updated dependencies [5ed14cb]

- Updated dependencies [fe13254]

- Updated dependencies [4f89a84]

- Updated dependencies [b840302]

- Updated dependencies [a96c257]
  - @skill-map/spec@0.21.0

## 0.20.1

### Patch Changes

- fd6926f: Surface the project path under the brand mark in the topbar.

## 0.20.0

### Minor Changes

- 5600a60: Move `updateCheck.enabled` to user scope and add a reusable typed config helper. Settings UI's General section now exposes the toggle.

- a1bfe15: Eliminate the view-contribution `contract` abstraction — plugin authors now pick `slot` directly.

- 5600a60: Hook trigger set grows from 8 to 10: add CLI-process-driven `boot` and `shutdown`. First built-in concrete consumer: `core/update-check` (the once-per-day update banner moves from an inline call site to a hook subscribing to `boot`).

- 802e64f: Rename the `rule` plugin extension kind to `analyzer`.

- 5600a60: Add `sm scan -g` (global scan) plus three privacy-sensitive project scan settings: `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`. Settings UI exposes them in a new "Project" section.

- 825dce4: View-contribution slot expansion + new `node-icon` contract + host-enforced plugin lock.

### Patch Changes

- 5600a60: Add the `core/job-orphan-file` built-in rule. Surfaces orphan MD files under `.skill-map/jobs/` (no matching `state_jobs.filePath` row) as `warn` issues during `sm scan`. Mirrors the `core/annotation-orphan` model: detection runs OUTSIDE the rule and the rule only projects.

- 5600a60: Move file parsers under `src/built-in-plugins/parsers/` for layout consistency with the other built-ins.

- Updated dependencies [5600a60]

- Updated dependencies [a1bfe15]

- Updated dependencies [5600a60]

- Updated dependencies [802e64f]

- Updated dependencies [5600a60]

- Updated dependencies [825dce4]
  - @skill-map/spec@0.20.0

## 0.19.0

### Minor Changes

- 3376a75: spec 0.18.0 — universal markdown fallback as a built-in Provider. The format-named generic kind `markdown` moves out of the per-vendor Provider catalogs (claude / gemini) into a dedicated built-in `core/markdown` Provider. Markdown is provider-agnostic — no vendor owns the universal `.md` format — and bundling the fallback as a regular Provider under the `core` group preserves the spec invariant that no extension is privileged. The kernel orchestrator now dedups files across the multi-Provider walk so each path is offered to AT MOST one `classify`: vendor Providers retain priority on files inside their territory, and `core/markdown` (registered LAST) picks up exactly the orphan `.md` files no vendor claimed — files at the project root, under `.claude/hooks/`, `notes/`, `CLAUDE.md`, `GEMINI.md`, or anywhere else outside a known vendor path. The fallback can be disabled via `sm plugins disable core/markdown` (consistent with every other extension under `core`); orphan markdown then becomes silently invisible, matching pre-0.18.0 behaviour.

- f0ddae0: Move the cross-vendor Extractors out of the `claude` plugin bundle and into `core`, and rename `frontmatter` → `annotations` to reflect the post-Step 9.6 reality that the canonical home for those structured references is the sidecar `.sm` `annotations:` block (Decision #125), not the markdown frontmatter.

- d7ddd08: Drop the `parsed` view contribution from `core/annotations`.

- 454311c: Drop the transitional legacy `metadata:` frontmatter fallback from `core/annotations`. The extractor now reads structured references (`supersedes`, `supersededBy`, `requires`, `related`, `conflictsWith`) **only** from the sidecar `.sm` `annotations:` block (Decision #125 / Step 9.6 canonical surface). The `core/superseded` rule follows the same path and now reads from the sidecar.

- b3ba3de: Drop the four denormalised fields (`title`, `description`, `stability`, `version`) from the public `Node` surface. The DB columns survive as indexing surface; the JSON wire shape and TypeScript `Node` interface no longer carry them.

- 22f4439: Reduce the Extractor extension kind to **deterministic-only**. The `mode` field is removed from `extractor.schema.json`; `IExtractor` no longer carries `mode`; `IExtractorContext` no longer exposes `ctx.runner`. `Extractor` joins `Provider` and `Formatter` as an extension that sits on the deterministic scan path; LLM-driven enrichment of a node is now strictly an **Action** concern, queued through the job subsystem.

- e636074: Fold every post-001 SQLite kernel migration into `001_initial.sql`: the original four (`002_sidecar_columns.sql`, `003_drop_node_author.sql`, `004_sidecar_root_json.sql`, `005_node_favorites.sql`) plus the later `002_view_contributions.sql` introduced after the first fold by the view contribution system. Pre-1.0 greenfield consolidation — no released consumer depends on the historical migration steps, so collapsing the schema evolution into a single up-only migration removes the per-step bookkeeping cost and gives new databases the final shape on first init. The runner now sees `user_version: 1` as the latest. Schema content unchanged from the pre-fold endpoint (sidecar denormalisation via `sidecar_present` / `sidecar_status` / `annotations_json`, `author` column dropped from `scan_nodes`, `sidecar_root_json` column, `state_node_favorites` table, `version INTEGER` per Decision #125, plus `scan_contributions` table from the view contribution system).

- 40d0a81: Two small wire enrichments that the new Settings modal needs.

- 40d0a81: Add `POST /api/scan` so the SPA's topbar refresh button can trigger a manual scan + persist without dropping the user back to the CLI. The same `runScanWithRenames` + `persistScanResult` pipeline the watcher uses runs end-to-end inside the BFF, broadcasting `scan.started` then `scan.completed` over `/ws` so every connected client refreshes — `CollectionLoaderService`'s reactive subscription already handles the SPA side.

- 496fb72: Complete the `IAnalyzerContext.emitContribution` runtime channel and add `core/link-counts` built-in rule.

- 2b44d6c: Settings → Changelog tab + user-facing changelog pipeline.

- 40d0a81: Add a global Settings modal in the SPA with a Plugins section — the first user-facing surface for toggling installed plugins from the UI. Backed by two new BFF mutation endpoints and an enriched `GET /api/plugins` shape.

- 68709b9: Sidecar schema cleanup: rename root block `for:` → `identity:` and drop the unused `hidden` field from the curated annotations catalog.

- 8577563: Tags · click-to-multi-select via Foblex Flow's native selection.

- 762aad3: Tags · Phases 2-7 (full implementation): persistence, BFF wire shape, CLI, UI.

- f3e6347: Tags · zoom-to-matching on click + active chip indicator + side-panel-aware fit.

- 89c1c17: Add an "update available" notification surface (CLI banner + UI chip).

- 5624143: view contribution catalog reorg — kernel side + bundled UI debug toolkit. Pre-1.0 minor per `spec/versioning.md`; pairs with the matching `@skill-map/spec` minor that drives the rename.

- 0702381: spec 0.19.0 — view contribution system. Plugin extensions can now surface per-node typed data in the UI by picking a `contract` name from a closed kernel-published catalog (10 contracts: `per-node-counter`, `per-node-tag`, `per-node-breakdown`, `per-node-records`, `per-node-tree`, `per-node-key-values`, `per-node-link-list`, `per-node-summary`, `node-marker`, `scope-summary`) and emitting payloads at scan time via `ctx.emitContribution(id, payload)`. Plugin authors NEVER ship UI code, never write JSON Schema, and never pick UI slots — they declare intent via `viewContributions: Record<string, IViewContribution>` on each extension manifest, and the closed catalog of input-types (10 entries: `string-list`, `single-string`, `boolean-flag`, `integer`, `enum-pick`, `enum-multipick`, `path-glob`, `regex`, `secret`, `key-value-list`) drives the `settings:` declarations on the plugin manifest root. New CLI verbs `sm plugins create`, `sm plugins contracts list`, `sm plugins upgrade` make scaffolding the canonical entry point.

### Patch Changes

- d8630e8: Redesign the `sm check` human renderer. Issues are now grouped by file with a sectioned layout: a header line summarises severity counts (only non-zero ones, joined with `·` and individually colored), each touched file gets its own heading, and rows render as `    <glyph>  <analyzerId>   <message>` with the rule-id column padded to align messages within the rendered set. Severity glyphs replace the old `[severity]` prefix — `✕` red for errors, `⚠` yellow for warns, `ℹ` cyan for infos — and the same color precedence as `sm plugins list` / `sm serve` applies (stdout TTY plus `--no-color`). Multi-node issues attach to their primary `nodeIds[0]`; when the rule message embeds `" from <primary>"` and the primary path is already in the section header, the renderer trims the redundancy so prose like "Broken X reference from <path> → <target>" reads as "Broken X reference → <target>". Plugin-authored fields are sanitised once into a flat row shape before rendering. The previous flat one-line-per-issue format is gone; tests that asserted on `[warn]` / `[error]` prefixes now match on the new glyphs.

- 9534efe: Redesign the `sm config list` human renderer. Effective dot-paths are now grouped into a closed catalogue of sections — General, Scan, Jobs, Roots & plugins, History, plus an `Other` catch-all for future keys — printed in that order. Each section gets a header followed by indented `  <key>   <value>` rows, with the key column padded to the longest key in the section and entries sorted alphabetically by their displayed form (the section prefix is stripped in display, so `scan.tokenize` shows as `tokenize` under Scan, `jobs.maxConcurrency` as `maxConcurrency` under Jobs, etc.). Empty sentinels (`null`, `[]`, `{}`) collapse to a dim em-dash so the eye skips defaults and lands on populated overrides. The flag surface is unchanged and `--json` output is byte-identical to before; only the human path is touched. Tests that asserted on the old flat `key = value` shape now match the new padded `<key>   <value>` rows.

- ccad7da: Polish `sm config get / set / show / reset` human output to share the visual rhythm of the rest of the CLI. Each success line now opens with the green ✓ glyph; the trailing `(wrote <path>)` and `(from <layer>)` suffixes are dim; settings paths render relative to cwd when they sit under it (so the user sees `.skill-map/settings.json` instead of an absolute path). No flag surface change; `--json` paths unchanged.

- b3500b0: Polish `sm db backup` / `sm db restore` / `sm db reset` / `sm db migrate` human output: prefix every success line with the green ✓ glyph, render DB / backup / target paths relative to cwd when they sit under it (so the user sees `.skill-map/skill-map.db` instead of the absolute `~/projects/.../skill-map.db`), and add the same glyph to the `kernel · …` and `plugin <id> · …` migration status lines so a glance is enough to confirm "everything ok". Failure paths still emit on stderr without a glyph (existing UX). No flag surface change.

- c9d0e15: Universal blank line before the `done in <…>` elapsed-time footer. The line was rendering tight against each verb's body output (`<final body line>\ndone in 5ms`) which read as visually crowded. Now every verb gets a blank-line separator. Tutorial's verb-specific trailing `\n` (added a few commits ago for the same purpose) reverts since the universal one covers it.

- c6436a6: Polish `sm graph` error path: the `No formatter registered for format=…` message now opens with a red ✕ glyph, matching the rest of the CLI's error-line style. The successful render path is untouched — its output comes from the registered formatter (markdown-flavored ASCII), which is intentionally preserved as-is for diff-tool / pipe compatibility.

- 19e8da3: `sm history` and `sm history stats`: redesign the human renderers to match
  the visual rhythm of the recent `sm scan` / `sm refresh` / `sm list` /
  `sm config list` / `sm show` polish.

- a224379: Polish `sm init`, `sm bump`, and `sm hooks install pre-commit-bump` human output to share the green ✓ glyph rhythm of the rest of the CLI. Each success line — gitignore update, .skill-map/ provisioning, first-scan summary, single-node bump (with or without sidecar creation), pre-commit hook install / chain / already-installed — now opens with `✓`. Pluralised nouns in the first-scan summary (`1 node` / `N nodes`) replace the old `(s)`-suffix style. No flag surface change; `--json` paths unchanged.

- 2d66cb6: Redesign the `sm list` human renderer. The fixed 50-column path / 8-column kind table is replaced with a dynamic layout: column widths are computed from the actual data (PATH soft-capped at 60, every other column unbounded so single- and double-digit counts don't waste a 4-char slot), rows carry a 2-space indent matching the rhythm of `sm plugins list`, `sm check`, and `sm config list`, and the old single-dash separator is gone. Header columns and the KIND column render dim (chrome / metadata), the ISSUES column turns yellow when non-zero so triage targets pop and stays dim at zero, and the data values (OUT / IN / EXT / BYTES) stay plain. A footer block follows: a blank line, `<count> node(s)` (singular / plural via the new `tableFooterNoun*` keys), then a dim tip pointing at `sm show <path>` and `sm check`. Color resolution goes through `ansiFor({ isTTY, noColorFlag })` so `--no-color` and non-TTY pipes stay byte-clean. The flag surface is unchanged and `--json` output is byte-identical to before; only the human path is touched. Tests that asserted on the old `header + sep + N data` line counts now count data rows by `.md` matches (robust to header / footer churn) and additionally assert the new footer's `<count> nodes` line.

- 4a2d36a: Refresh the public-facing tagline across README (EN/ES), CLI compact help header, and the UI top bar. The new line — "The missing map for your generative-AI ecosystem — discover what your Markdown is trying to tell you." / "El mapa que le faltaba a tu ecosistema de IA generativa — descubre lo que tus Markdown intentan decirte." — replaces the previous "graph explorer" wording everywhere it surfaces to users. The CLI `sm --help` compact header mirrors the README "In a sentence" line per the doc-comment contract on `HELP_TEXTS.compactHeader`; `context/cli-reference.md` already covers the new wording and needs no regeneration.

- 1485204: Redesign `sm orphans` / `sm orphans reconcile` / `sm orphans undo-rename` human output to match the visual rhythm of the rest of the CLI.

- addd5cf: Terminal-UX polish across `sm plugins doctor` and `sm tutorial`. Doctor warning bodies no longer repeat the qualified id (`Provider '<id>' declares ...`) — the id already lands in the entry header glyph row, so the body now reads `Declares explorationDir '<path>', but ...`. `sm tutorial` opens with the same violet "Skill Map" figlet block that `sm serve` does (printed to stderr so it stays out of any pipe consuming stdout), and a trailing blank line in the success template puts breathing room between the body and the `done in <…>` footer.

- c26aab4: `sm refresh`: redesign the human renderer to a single result line in the
  rhythm of the recent `sm scan` / `sm list` / `sm config list` polish.

- 7e1a756: Polish `sm scan compare-with` and `sm sidecar annotate / refresh / prune` human output.

- d1e2f17: Redesign the `sm scan` outcome renderer and fix a real bug in the orchestrator's contribution-rejection error path. The outcome layout switches from a single dense summary line to the same sectioned shape as `sm check` and `sm plugins list/show/doctor`: a header `<glyph>  N nodes · M links · K issues   in <Xms>  (P roots)` with `✓` green when no error-severity issues land and `✕` red otherwise, the issues count colored by worst severity (yellow when warn-only, red when errors present, dim when zero), and an indented body line with the relative DB path (or "would persist to <path> (dry-run)" under `--dry-run`). Color resolution mirrors `sm check` / `sm serve`: stdout TTY plus `--no-color`, forwarded explicitly through `IScanRunOpts.colorEnabled` into `createStderrProgressEmitter`, which now wraps its `⚠` glyph in xterm-214 yellow when enabled. The progress emitter's `extension.error:` literal prefix is gone — the line now reads `<glyph>  <message>`, where the glyph carries the severity and the message stays the message. Bug fix on the way: the two `emitContribution` rejection paths in the orchestrator (`unknown-contribution-id` and `payload-invalid`) previously emitted extension-error events without a `message` field, so the stderr emitter fell through to the cryptic "extension reported an error (no detail)." line on every scan that hit a contribution validation failure (e.g. a frontmatter value over `per-node-key-values`'s 512-char ceiling). Both call sites now build a real human message from new `orchestrator.texts.ts` templates so the user sees what was rejected and why.

- 9abeb32: `sm show`: redesign the human renderer to match the visual rhythm of
  the recent `sm scan` / `sm check` / `sm refresh` / `sm list` /
  `sm config list` polish.

- b94ce7f: Document `.sm` sidecar files in user-facing READMEs and the interactive
  tutorial. Adds a "Sidecar `.sm` files (don't be alarmed when they appear)"
  section to `README.md` and `README.es.md` (between Quick start and the
  Interactive tutorial), a terser one-paragraph summary in `src/README.md`
  (which ships in the `@skill-map/cli` npm tarball), and replaces the
  buried sidecar paragraph in `sm-tutorial` Step 3 with a short
  heads-up blockquote. The content explains what `.sm` files are, why they
  sit beside the `.md` instead of inside its frontmatter, that `sm scan` /
  `sm watch` / the live UI never create them (only `sm bump` and
  `sm sidecar annotate` do), and that they belong in git. No behavioural
  change — purely documentation surfacing of an existing architectural
  decision (Step 9.6, Decision #125).

- bb74f42: Apply the in-CLI visual style to `sm version`, `sm tutorial`, and the four `sm plugins enable / disable` rejection error messages.

- b2f56ff: Polish `sm watch` per-batch summary line and stub verbs to match the visual rhythm of the rest of the CLI.

- Updated dependencies [3376a75]

- Updated dependencies [f0ddae0]

- Updated dependencies [b3ba3de]

- Updated dependencies [22f4439]

- Updated dependencies [40d0a81]

- Updated dependencies [40d0a81]

- Updated dependencies [496fb72]

- Updated dependencies [40d0a81]

- Updated dependencies [68709b9]

- Updated dependencies [9f04fc2]

- Updated dependencies [89c1c17]

- Updated dependencies [5624143]

- Updated dependencies [0702381]
  - @skill-map/spec@0.19.0

## 0.18.0

### Minor Changes

- 305e75a: Step 9.6.3 — built-in `bump` Action + sidecar write channel. Adds the deterministic `core/bump` Action and the new `ISidecarStore` port (with the `FilesystemSidecarStore` impl) that materialises Action-returned `{ kind: 'sidecar', path, changes }` payloads against on-disk `.sm` files. The Action stays pure — `invoke()` computes a deep-merge patch and returns it; the Store re-reads the on-disk sidecar, deep-merges (objects RECURSE; arrays REPLACE), revalidates the merged result against `sidecar.schema.json` + `annotations.schema.json`, and writes back inside a path-keyed critical section using the standard atomic `.tmp + rename` pattern.

- 79dfdea: Step 9.6 catalog-curation follow-up (2026-05-07): remove the vestigial `Node.author` denormalisation end-to-end. The 9.6.2 migration sourced `Node.author` from `annotations.author`; the 2026-05-07 catalog curation dropped `author` from `annotations.schema.json`, leaving the column without a canonical source. The earlier curation changeset said `Node.author` would stay untouched; this follow-up reverses that — keeping a denorm path for an opaque `additionalProperties: true` rider was inconsistent with the curated catalog and added persistence + display surface for a field the schema no longer documents.

- 670eaa4: Catalog refinement: drop `released` from the curated annotation catalog. The catalog now stands at **14 fields**.

- d12f7d2: Two new built-in Providers — `gemini` and the vendor-neutral `agent-skills` — plus a tighter `IProvider.classify()` contract so multiple Providers can scan the same roots without colliding.

- 5e0ebcd: Rename five public type aliases on the kernel surface to match the project's `T*` prefix convention for type aliases (categories 1-4 already documented in `context/kernel.md` + `src/kernel/types.ts`; category 5 was implicit and is now formalized).

- e17ff6a: Per-user favorites. The UI gains a subtle heart button on every node card (stacked under the chevron in the actions cluster) plus a "Favorites only" toggle in the filter-bar that hides while the user has zero favorites. State persists across `sm scan` and `sm db reset` because favorites live in a new `state_node_favorites` table (zone `state_`).

- 864e373: Phase 0 of the multi-provider rollout: rename the Claude Provider's fallback kind `note` → `markdown`.

- 305e75a: Step 9.6 review queue R14 — `loadPluginRuntime` now honours an explicit `runtimeContext` override. The BFF composition root (`server/index.ts:assembleBootBundle`) threads its already-resolved `runtimeContext` through to plugin discovery so a `createServer({ runtimeContext: { cwd: <tempdir>, ... } })` boot actually walks `<tempdir>/.skill-map/plugins/` instead of the real `process.cwd()`. Pre-R14 the option was silently ignored — `loadPluginRuntime` fabricated a fresh `defaultRuntimeContext()` per helper.

- 305e75a: Step 9.6.6 (BFF half) — `GET /api/annotations/registered` over the Hono BFF. Read-only catalog of plugin-contributed annotation keys, surfaced so a future UI autocomplete can offer plugin-namespaced and root-exclusive contributions the UI can't otherwise discover at runtime. The endpoint is a pure projection of `kernel.getRegisteredAnnotationKeys()` — populated once by `registerEnabledExtensions` after every plugin loads at server boot, frozen, surfaced unchanged. Built-in catalog keys (from `annotations.schema.json`) are NOT included; the UI knows the built-in set via the bundled spec.

- 305e75a: Step 9.6.5 (BFF half) — `POST /api/sidecar/bump` over the Hono BFF. The endpoint mirrors the `sm bump <node.path> [--force]` CLI verb 1:1: same built-in `core/bump` Action, same `FilesystemSidecarStore`, same fresh-vs-stale refusal semantics. The only differences from the CLI verb are the invoker label (`'ui'` vs `'cli'`) and the wire shape. Batch (`--pending`) stays CLI-only at 9.6.5 — surfacing it over REST needs a job-style progress channel and lands later.

- 305e75a: Step 9.6.4 — sidecar CLI verbs. Six new verbs split between `sm bump` (top-level, ROADMAP-named per Decision #125) and the `sm sidecar` sub-namespace (administrative helpers; the existing `sm refresh` from Step A.8 — enrichment-layer — stays untouched). Plus `sm hooks install pre-commit-bump` for the opt-in commit-time auto-bump.

- 305e75a: Step 9.6.6 — plugin annotation contributions + Tier-1 `unknown-field` rule. Closes the last sub-step of the Step 9.6 annotation system.

- 305e75a: Step 9.6.2 — kernel sidecar reader + drift detection. The walker now reads `<basename>.sm` next to every `<basename>.md` it finds, validates against `spec/schemas/sidecar.schema.json` + `spec/schemas/annotations.schema.json` via the kernel AJV stack, and computes drift versus the live body / canonical-frontmatter hashes. Stale state surfaces through a new built-in Rule `core/annotation-stale` (`warn` severity); orphan `.sm` files (no matching `.md`) surface through `core/annotation-orphan` (`warn`). Schema-invalid or YAML-malformed sidecars produce an `invalid-sidecar` warning and the scan continues — drift detection is soft-mode, never blocking.

- 687823d: R15 closure (Step 9.6 review queue): extend `Node.sidecar` overlay with the full parsed `.sm` root.

- 305e75a: Step 9.6.5 (UI half) — sidecar surface in the SPA. Closes 9.6.5 alongside the BFF half that landed earlier on the same date. The `ui/` workspace stays private (per project policy); user-visible UI changes ship bundled inside `@skill-map/cli`.

- 305e75a: Step 9.6.7 — wire-shape cleanup. Closes two §Step 9.6 review-queue items in one batch (R7 + R9) so the BFF's REST and WS surfaces match the canonical contracts every other route already follows.

- 1019d5f: Pluggable kernel walker + parser registry. Provider manifests gain a declarative `read: { extensions, parser }` field; the kernel owns the file walker and a closed registry of built-in parsers. The Claude Provider drops its hand-rolled `walk()` (~70 lines of fs walking + frontmatter parsing) and becomes pure metadata + classification.

### Patch Changes

- 79dfdea: Step 9.6 catalog curation. The annotation surface settled in Steps 9.6.1 → 9.6.7 went through a UX review on 2026-05-07; 16 fields with no clear value or that duplicated other surfaces were dropped from the curated catalog, and the per-bump rationale field `audit.bumpReason` was rolled back together with its CLI / BFF inputs.

- 71aab31: Internal cleanup across `src/`. No public API or CLI surface change. Absorbs the M2, M3, M5, M7, M8 findings from the latest `cli-architect` review on `src/` (C1, C2, M1 already shipped in the previous commit).

- 9d64507: Internal cleanup across `src/`. No public API or CLI surface change. Closes the M4 + M6 themes plus the residual minors (m2–m9), the n1 nit, and the H1 hypothesis from the latest `cli-architect` review on `src/`.

- 9c4680f: Internal cleanup across `src/cli/`, `src/kernel/`, `src/server/`, `src/conformance/`. No public API changes. Folds 22 hand-rolled `(err as Error).message` / `err instanceof Error ? err.message : String(err)` sites onto a kernel-level `formatErrorMessage` helper (`src/kernel/util/format-error.ts`). Kills inline `'.skill-map'` literals outside the path-helper modules — kernel callers now route through `src/kernel/util/skill-map-paths.ts`, CLI callers through the existing `defaultSettingsPath` / `defaultIgnoreFilePath` helpers. Wires the `IPrinter` channel surface into `SmCommand`: status banners (`Initialised`, `Running first scan…`, `Updated .gitignore`, dry-run plan, `sm job prune` retention rows) now route through `printer.info` to stderr (consistent with the M1 review), with the public-facing payload still reserved for stdout. New `pluginRuntime.emitWarnings(printer)` consolidates six identical for-loops; new `registerEnabledExtensions(kernel, pluginRuntime)` consolidates the five-site built-ins-+-plugins manifest registration dance. Adds `WATCH_TEXTS.maxConsecutiveFailuresInvalid`, `DB_TEXTS.dumpFailure`, `SERVE_TEXTS.uiDistInvalid` for previously-inline English; `requireDbOrExit(path, stderr)` collapses the 14-site `if (!assertDbExists(...)) return ExitCode.NotFound` boilerplate; `THealthDbState` narrows to `'present' | 'missing'` (the `'error'` state was reserved but never produced — widening the union later is non-breaking). New BFF query helper `src/server/util/parse-query.ts` (`parseCsv`, `parsePagination`, `parseBooleanFlag`) replaces hand-rolled equivalents in `routes/nodes.ts`, `routes/issues.ts`, `routes/links.ts`, `routes/scan.ts`. New kernel-level `matchesAnalyzerFilter` (`src/kernel/util/analyzer-filter.ts`) replaces the inline copy in `cli/commands/check.ts` and `server/routes/issues.ts`. Per-route plugin-warnings forwarding (`routes/plugins.ts`, `routes/graph.ts`, `routes/config.ts`) now flows through `log.warn(sanitizeForTerminal(warn))` instead of `process.stderr.write` directly. Behaviour-visible change: `sm init` and `sm init --dry-run` print their status banners to stderr now (so a future `--json` mode can keep stdout clean); test suite updated accordingly.

- 1132e69: Internal architectural cleanup across `src/`. No public API or CLI surface change. Absorbs the C1, C2, M1 findings from the `cli-architect` review on `src/`. C1 — eliminates the residual `core/ → cli/` boundary leak the v0.6 audit could not surface structurally: `IPrinter` + `createPrinter` move to `core/runtime/printer.ts` (was `cli/util/printer.ts`); `truncateHead` / `truncateTail` move to `kernel/util/text.ts` (was `cli/util/text.ts`); `createCliProgressEmitter` is renamed `createStderrProgressEmitter` (the helper is stream-based, never was CLI-specific) and lifted to `core/runtime/progress-emitter.ts` with its catalogue at `core/runtime/i18n/progress-emitter.texts.ts`; the two strings the runtime itself emitted (`changedNoPriorWarning`, `priorSchemaValidationFailed`) move from `cli/i18n/scan.texts.ts` to a new `core/runtime/i18n/scan-runner.texts.ts`. Historic `cli/util/{printer,text,cli-progress-emitter}.ts` and `cli/i18n/cli-progress-emitter.texts.ts` stay as thin re-export shims so every CLI / test import keeps working unchanged. C2 — adds a third `core/**` block to `src/eslint.config.js`, peer of the existing `kernel/**` block: `no-restricted-imports` blocks `../cli/*` at every depth (8 patterns); `no-restricted-syntax` blocks `process.cwd()` and `process.env` reads with messages that point to the correct fix (inject through `IRuntimeContext` or resolve in the CLI / BFF adapter). One narrow exception: `core/runtime/runtime-context.ts:32` carries `eslint-disable-next-line no-restricted-syntax` over the single `process.cwd()` read — this is the factory that lifts the live process context into the typed `IRuntimeContext` bag every other `core/` module consumes. M1 — `composeScanExtensions` no longer reads `process.env`. New exported type `IConformanceKillSwitches` (in `core/runtime/plugin-runtime.ts`) and new helper `cli/util/conformance-env.ts: readConformanceKillSwitches(env?)` reads the three kill-switch env vars (`SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}`) at the CLI boundary, treating only the literal `'1'` as truthy so a stray developer-shell export cannot silently disable production scans. Five CLI verbs wire the bag through options (`scan.ts`, `check.ts`, `refresh.ts`, `scan-compare.ts`, `watch.ts`); `core/watcher/runtime.ts` accepts `killSwitches` per call and threads it to the composer per-batch; `core/runtime/scan-runner.ts` adds `killSwitches?` to `IScanRunOpts`. The BFF intentionally does not honour the env vars (production caller). Tests: `plugin-runtime-branches.test.ts` is reorganised — composer behaviour is tested with `killSwitches` injected directly (4 cases), and the env-var contract is tested at the helper (3 cases including the `'1'`-literal enforcement). The existing `conformance-disable-flags.test.ts` integration suite still passes intact (sub-process injects env, the verb reads at the boundary). Drive-by: drops a stale `eslint-disable-next-line complexity` in `cli/commands/check.ts` whose function no longer triggers the rule. Net: 16 modified, 6 new, +246/-279.

- d529e47: Internal architectural cleanup across `src/`. No public API or CLI surface change. Extracts a new `src/core/` boundary (`runtime/`, `sqlite/`, `paths/`, `watcher/`) so the BFF (`src/server/`) no longer reaches into `src/cli/util/` for shared machinery — the two grep gates (`from '../../cli/util'` and `from '../cli/util'` under `src/server/`) now both return zero. Physically moves `runScanForCommand` / `composeScanExtensions` / `loadPluginRuntime` / `emptyPluginRuntime` / `defaultRuntimeContext` (plus their i18n texts), `tryWithSqlite` / `withSqlite`, and `defaultProjectPluginsDir` plus sibling pure path helpers into `core/`; the old `cli/util/{runtime-context,with-sqlite,plugin-runtime,scan-runner,db-path}.ts` modules become thin re-export shims so historic CLI/test imports keep working. CLI-only helpers (`assertDbExists`, `requireDbOrExit`, ExitCode-aware paths) stayed in `cli/util/db-path.ts`. The BFF now imports `formatErrorMessage` directly from `kernel/util/format-error.ts` instead of going through the `cli/util/error-reporter.ts` shim. Watcher consolidation: new `src/core/watcher/runtime.ts` exports `createWatcherRuntime(opts): IWatcherRuntimeHandle` with pure machinery (config + ignore filter, plugin-runtime load, primary + meta-file chokidar wiring, debounced batch dispatch, prior-snapshot strict validation, persist branch, circuit breaker, `maxBatches` test hook) and an events bag (`onBatch`, `onWatcherError`, `onPluginWarning`, `onReady`, `onBreakerTripped`); `subscribeBeforeInitial` knob preserves both adapters' historic ordering. `cli/commands/watch.ts` shrank 465→322 lines, `server/watcher.ts` shrank 468→178 lines — each is now just the Clipanion / Hono adapter. `cli/commands/init.ts` drops its inline pipeline composition and reuses `runScanForCommand` with `noPlugins: true` / `allowEmpty: true`, mapping the discriminated outcome to `INIT_TEXTS.*` framing. `server/health.ts` memoises `resolveSpecVersion()` via a module-level cached promise (`??=`), so the dynamic import only runs once per process. Net: 21 files modified, 7 new files under `src/core/`, 1 file deleted, ~−1555 lines.

- 529c106: Internal refactor of the frontmatter extractor in `src/built-in-plugins/extractors/frontmatter/index.ts`. No behavior change — same emission rules, same dedup, same comment about the inverse-direction `supersededBy` edge. The duplicated body that processed each annotations-shaped block (sidecar `annotations:` and legacy `metadata:` frontmatter) is extracted into a new `processBlock(block, sourcePath, emit)` helper at module scope, plus a small `EmitFn` type alias. `extract` now does only: build the `seen` dedup set + `emit` closure, then call `processBlock` once per source. Drops cyclomatic complexity from 15 to under the project's max of 8 so the file no longer needs a per-function ESLint disable. Lint, typecheck, and the extractor test suite (30/30) are green.

- faaa813: Fix Step 9.6 migration gap in the `frontmatter` extractor. The extractor was emitting structured links (`supersedes`, `supersededBy`, `requires`, `related`, `conflictsWith`) by reading the legacy `metadata:` block in markdown frontmatter; Step 9.6.2 hard-cut the column denormalisation (`stability` / `version` / `author`) but never migrated this link-emission path. Result: any node whose annotations migrated to the new `.sm` sidecar lost its structured links from the graph (visible as a sudden link gap in the UI after the fixture migration).

- ead5cab: Internal refactor: move BFF error message literals (catch-all 404 envelopes, sidecar bump refusals, body-parse failures, missing-invoke envelope) into `src/server/i18n/server.texts.ts` so every operator-facing string lives in one catalog. The route bodies now reference `SERVER_TEXTS.*` keys (interpolated through `tx()` for the path-bearing 404s) instead of inlining the literals.

- Updated dependencies [305e75a]

- Updated dependencies [79dfdea]

- Updated dependencies [79dfdea]

- Updated dependencies [670eaa4]

- Updated dependencies [d12f7d2]

- Updated dependencies [e17ff6a]

- Updated dependencies [864e373]

- Updated dependencies [c47c131]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [687823d]

- Updated dependencies [305e75a]

- Updated dependencies [1019d5f]
  - @skill-map/spec@0.18.0

## 0.17.0

### Minor Changes

- bd5e360: Absorb Anthropic Claude's documented frontmatter verbatim into the Claude Provider's per-kind schemas, drop the obsolete `hook` node kind.

- 77579b3: Add a `sm db browser` sub-command that opens the project's SQLite DB in DB Browser for SQLite (sqlitebrowser GUI). Read-only by default; pass `--rw` to enable writes. Replaces the previous `scripts/open-sqlite-browser.js` standalone script.

- 84c3f07: `npm run start` now opens Windows Terminal with two side-by-side panes that run `bff:dev` (the BFF watcher with the Hono API + the Angular dev-mode placeholder) and `ui:dev` (the Angular dev server with HMR). Replaces the previous `start` which was a thin alias to `ng serve` that booted the SPA without a backing BFF.

### Patch Changes

- f706e57: Improve the `sm db browser` error message when `sqlitebrowser` is not installed: multi-line block, aligned columns, three OS variants (Debian/Ubuntu, macOS, Windows), softer framing ("if you want a GUI…" rather than imperative). The Windows hint links to the official downloads page. The shortcut at root `npm run sqlite` is moved up to sit next to `start` so the daily-use entry points are grouped at the top of the scripts block.

- 696008a: Add a `--no-ui` flag to `sm serve`. With it, the BFF stops serving the Angular bundle (stale or otherwise) and the root `/` renders an inline dev-mode placeholder pointing the user at `npm run ui:dev` + `http://localhost:4200/`. Used by the root `bff:dev` shortcut so iterating on the BFF alongside the Angular dev server doesn't surface a stale UI by accident.

- Updated dependencies [77579b3]

- Updated dependencies [696008a]

- Updated dependencies [bd5e360]
  - @skill-map/spec@0.17.0

## 0.16.6

### Patch Changes

- 508c96a: Two coordinated landings on the landing footer plus a whitespace cleanup.

## 0.16.5

### Patch Changes

- b1a59e8: Graph view: place newly-detected nodes around the existing layout instead of on top of it.

## 0.16.4

### Patch Changes

- 383ce0b: Graph view: persist every node's position, not just the manually-dragged ones.

- 07cd144: `sm tutorial` success message now surfaces the bilingual trigger phrase as the most visible part of the output, and reminds the tester that the first message they write to Claude sets the tutorial language for the rest of the session.

- 37bde96: `sm-tutorial` SKILL: heads-up before scaffolding the scenario.

## 0.16.3

### Patch Changes

- bf7c434: Tutorial audit pass.

## 0.16.2

### Patch Changes

- 8b55382: Watcher fix + tutorial polish.

## 0.16.1

### Patch Changes

- f5db61e: Tutorial polish + UI fix.

## 0.16.0

### Minor Changes

- c981430: Rename the project ignore file from `.skill-mapignore` to `.skillmapignore` (no dash).

- 15f2b4e: `sm serve` and `sm watch` now react in-flight to edits of `.skillmapignore` and `.skill-map/settings.json`. Previously, both verbs loaded the ignore filter once at startup and required a restart for new patterns to take effect — invisible to the user except via stale results. After this change, a secondary chokidar watcher monitors both meta-files; on change, the watcher rebuilds the filter from disk, re-reads `config.ignore` / `scan.tokenize` / `scan.strict` from settings, and dispatches a fresh scan so the DB and `/ws scan.completed` reflect the new state.

### Patch Changes

- Updated dependencies [c981430]
  - @skill-map/spec@0.16.0

## 0.15.0

### Minor Changes

- d7e8dd9: Rename the tester onboarding verb and its companion Claude Code skill from `sm-guide` to `sm-tutorial` across spec, CLI, bundled materialised payload, runtime state file, and report file. Breaking change to the public CLI surface (`sm guide` is gone — no compat shim); pre-1.0 so it ships as a minor bump per the project's pre-1.0 policy (no major while a workspace stays in `0.Y.Z`).

### Patch Changes

- 89a3e59: `sm-guide` tester-feedback iteration plus a handful of CLI/UI polish fixes that ride along.

- Updated dependencies [d7e8dd9]
  - @skill-map/spec@0.15.0

## 0.14.1

### Patch Changes

- b1f6018: `sm serve` shows a figlet-style ASCII-art startup banner; non-TTY output is unchanged.

- e02eab9: `sm guide` UX polish: clearer trigger phrase + richer bundled walkthrough.

## 0.14.0

### Minor Changes

- 17a908c: Add a new built-in `markdown-link` extractor that catches `[text](path)` markdown links and emits one `references` link per resolved file path. Closes the gap surfaced by the slash-regex fix: even after that bug stopped generating false positives, sm had no extractor that mapped relative markdown links to real edges in the graph — the dominant cross-reference shape in real knowledge bases was invisible. The new extractor.

- c486f74: Add a new `sm guide` verb that materializes the interactive tester guide as `sm-guide.md` in the current working directory. Companion to the `sm-guide` Claude Code skill: a tester drops into an empty directory, runs `sm guide` to seed the canonical SKILL.md content, then opens Claude Code there and triggers the skill ("guíame") to start the interactive walkthrough. The verb.

### Patch Changes

- b4fceb7: Two UX improvements to the CLI error surface, addressing tester friction.

- c99b972: Two small CLI improvements driven by tour findings.

- 0ecf2af: `sm db dump` no longer requires the external `sqlite3` binary. Reimplemented on top of `node:sqlite` (already a dep via the storage adapter), so the verb works on any host that can run sm without an extra install step. The output format mirrors sqlite3's `.dump` closely enough to round-trip into a fresh DB via either `node:sqlite` or the system `sqlite3` if present (`PRAGMA foreign_keys=OFF;` + `BEGIN TRANSACTION;` + schema objects in `rootpage` order + per-table `INSERT INTO …` + `COMMIT;`).

- 34d57db: Doc-only fix to remove a misleading reading of "built-in kinds" in the Node schema and one test, plus a small batch of internal CLI refactors and tightened null checks. No external surface change.

- 17a908c: Fix the slash extractor's regex so markdown relative links `[label](./foo.md)` no longer trigger false-positive `broken-ref` issues. URLs (`https://...`), Windows drive letters (`c:/...`), and dotted paths (`domain.com/api`) were also affected — same root cause in the previous-char guard. Switched from a character-class guard to a negative lookbehind that explicitly excludes `.`, `:`, `?`, `#` in addition to the original word / `/` exclusions.

- 53d39d8: Pin `@skill-map/spec` to an exact version instead of the wildcard `"*"`. The wildcard let `npm install -g @skill-map/cli@X.Y` resolve the spec dep to whatever was newest in the registry at install time — not necessarily the version the CLI was tested against. End users could end up running an `X.Y` CLI binary against a spec it had never seen, producing the "code is one version, spec is OTA" symptom (renamed config keys rejected, documented flags missing, conformance suite drifting).

- Updated dependencies [34d57db]
  - @skill-map/spec@0.14.1

## 0.13.0

### Minor Changes

- 34768b2: Replace Clipanion's full-catalog error dump with a concise diagnostic on argv parse errors.

- e42cb62: Ship the Angular UI bundle inside `@skill-map/cli` and resolve the correct Angular `application`-builder output path so `sm serve` actually serves the SPA in installed mode.

## 0.12.0

### Minor Changes

- 8f2a66d: Bare `sm` defaults to `sm serve` instead of printing help

### Patch Changes

- Updated dependencies [8f2a66d]
  - @skill-map/spec@0.14.0

## 0.11.1

### Patch Changes

- 103fc1a: Doc revision pass — greenfield framing across READMEs, spec prose, ROADMAP, AGENTS, web, and workspace landing pages.

- Updated dependencies [103fc1a]
  - @skill-map/spec@0.13.1

## 0.11.0

### Minor Changes

- e0fb57e: Step 14.2 — REST read-side endpoints + DataSource contract

- d5488bf: Step 14.4.a — BFF WS broadcaster + chokidar wiring + scan event emission

- 4ff3f38: Step 14.5.d — Provider-driven kind presentation + envelope kindRegistry

- de20bc2: Step 14.5 (a + b) — Inspector polish: markdown body opt-in + linked-nodes panel + dead-link verify hybrid

### Patch Changes

- Updated dependencies [e0fb57e]

- Updated dependencies [d5488bf]

- Updated dependencies [4ff3f38]

- Updated dependencies [de20bc2]
  - @skill-map/spec@0.13.0

## 0.10.0

### Minor Changes

- 9b55981: cli-architect review follow-up — `SmCommand` base class wires every spec § Global flag (`-q/--quiet`, `-v/--verbose`, `--no-color`, env vars), every read-side verb now emits `done in <…>` per spec § Elapsed time, watch grows a circuit breaker, scan extracts the runner, and two invariant tests gate future regressions.

- 68c5e28: Step 14.1 — `sm serve` + Hono BFF skeleton

### Patch Changes

- Updated dependencies [68c5e28]
  - @skill-map/spec@0.12.0

## 0.9.0

### Minor Changes

- 67fb4ae: refactor: cli-architect audit sweep — boundary hygiene, i18n discipline, enum hardening, IAction stub

- 2ef6b15: refactor: cli-architect follow-up — finish kernel i18n migration, dedupe DB-path helpers, normalize conformance type names, switch `sm db` / `sm init` to async fs

- 723c022: cli-architect audit follow-up — output sanitization hardening, `StoragePort.migrations.writeBackup` signature change, atomic config write, and shared helper extraction.

- 147adb8: feat(cli): compact `sm --help` and per-verb help

- 256fb70: security: harden CLI/kernel against prototype pollution, ANSI injection, and path-escape attacks (audit findings H1–H3, M1–M6, L1)

### Patch Changes

- 3c07b8f: refactor: cli-architect audit follow-up — i18n discipline in built-in plugins, scan-compare delta, plugin-runtime warnings, and `IDbLocationOptions` runtime-context unification

- 62d3124: refactor: cli-architect audit follow-up — i18n discipline, runtime-context sweep, ExitCode literal cleanup

- 7d14da9: refactor: cli-architect re-audit follow-up — dedupe `dbPathForScope`, share `SKILL_MAP_DIR` const, fold trigger-collision joiner into the i18n template

- 4080efd: refactor: i18n discipline sweep across CLI renderers + storage-port-promotion follow-up

- 33383c9: Security audit fixes (cli-hacker sweep).

- Updated dependencies [f8fca25]
  - @skill-map/spec@0.11.0

## 0.8.0

### Minor Changes

- bb7ff01: Audit cleanup pass — close four mechanical items from the
  `cli-architect` audit in a single sweep. **Pre-1.0 minor bump** per
  `spec/versioning.md` § Pre-1.0; the API changes below are technically
  breaking but ship as a minor while the package stays `0.Y.Z`.

- d058bf8: Close H1 / M1 / M3 from the cli-architect review.

- b5a1a1e: Correct misclassified exit codes in `sm export` and `sm graph`.

- 698dd5d: Introduce `LoggerPort` on the kernel and a concrete CLI `Logger`
  adapter, replacing the last direct `console.error` write inside the
  kernel.

- 124ccda: Open `Node.kind` and `IProvider.classify` to `string` end-to-end on the TS side (Phases B + C).

- 558cf43: Replace the placeholder `PluginLoaderPort` shape with the real
  contract the concrete loader has been exposing since Step 0b, and
  pin the adapter to the port via `implements PluginLoaderPort`.

- 91fea6a: Split the orchestrator's `walkAndExtract` into three named helpers and
  close audit item V4 by reusing the kernel's extractor loop from
  `sm refresh`. **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0;
  the API addition below would warrant a minor on its own, and the
  internal split is non-breaking (no public signature changes).

- e8cbd19: Storage-port promotion — Phase A (`scans` / `issues` / `enrichments` / `transaction` namespaces).

- 19fbc08: Storage-port promotion — Phase B (`history` namespace).

- 19fbc08: Storage-port promotion — Phase C (`jobs` namespace).

- 19fbc08: Storage-port promotion — Phase D (`pluginConfig` namespace).

- 19fbc08: Storage-port promotion — Phase E (`migrations` / `pluginMigrations` namespaces) + Phase F (cleanup).

### Patch Changes

- bf30b67: Update `AGENTS.md` to reflect the post-sweep lint state: every quality rule is now `'error'` (no more `'warn'` tier), and codify the six categories where `eslint-disable-next-line` is the right answer (CLI orchestrators, parsers, multi-accumulator folds, migration runners, pure column mappers, discriminated-union dispatchers). Anything outside those categories should be split, not disabled — pointers to the canonical split commits included.

- 3cc603b: Close audit items D3 (i18n discipline) and D4 (rename `extensions/`) in
  a single sweep. **Patch bump**: pure refactor + docs; zero public API
  changes, no spec change, no behaviour change. The directory rename and
  the i18n migration are both internal to the workspace.

- 9c5db60: Close L1 / L2 / L3 from the cli-architect review.

- 369213c: Continue the complexity sweep — 5 more functions reduced or disabled with rationale.

- e9e04c7: Continue the complexity sweep.

- aa550a6: Code-quality follow-up to commit `518180d` — final wave of the
  ongoing complexity sweep ("hasta menos de 8") plus a tightening pass
  on the ESLint config so the workspace lint is now fully strict.
  **Patch bump**: zero public API changes (every refactored function
  keeps its exported signature; no new exports); pure internal
  restructuring + dev-tooling.

- 66ea293: Extract `buildFreshNodeAndValidateFrontmatter` from `walkAndExtract` (orchestrator). Internal-only refactor — moves the `else` branch (no cache hit: build a fresh `Node` and run frontmatter validation) into a focused helper. `walkAndExtract` complexity drops from 35 to 33. No public API change; behaviour preserved.

- a785a16: Three follow-up tests for the open-node-kinds refactor — close gaps the Phase E smoke test left implicit.

- b3debbe: Phase E of the open-node-kinds refactor — end-to-end smoke verification baked into the test suite.

- 518180d: Code-quality follow-up to commit `369213c` — eighth batch of the
  ongoing complexity sweep ("hasta menos de 8"). Eight functions
  addressed: two splits into focused private helpers, six justified
  inline disables on CLI orchestrators / safe-apply loops where the
  cyclomatic count is intrinsic to the contract. **Patch bump**: zero
  public API changes (every refactored function keeps its exported
  signature; no new exports); pure internal restructuring.

- 5ca7c36: Continue the complexity-reduction sweep — six more high-complexity
  functions split into focused helpers in a single batch. **Patch bump**:
  zero public API changes (no exported signatures touched, no new
  exports), pure internal restructuring; 602 / 602 tests still green
  after each split individually and after the batch.

- efa8972: Code-quality follow-up to commit `91fea6a` — split the next three
  high-complexity offenders into focused private helpers. **Patch bump**:
  zero public API changes (every refactored function keeps its exported
  signature; no new exports); pure internal restructuring.

- 33cfea4: Close audit item SD4 — clean ROADMAP "Step N / Phase N" references from kernel docstrings. 78 refs eliminated or reworded; 22 algorithm-internal "Step N" / "Phase N" comments preserved (they describe numbered steps inside an algorithm, not roadmap milestones — `trigger-normalize.ts`, `scan-persistence.ts:upsertEnrichmentLayer`, `plugin-loader.ts:loadOne`, `orchestrator.ts:detectRenamesAndOrphans` and friends). Updated one assertion in `hook-extension.test.ts` so the test no longer pins the literal string "Step 10" in the deferral message.

- 4fbb23c: Split `evaluateJsonPath` (complexity 25) and `runConformanceCase` (complexity 20) in `src/conformance/index.ts`. Internal-only refactor — no public API change. Extracted helpers: `traverseJsonPath` (pure walker over a parsed segment list), `applyJsonPathComparator` (justified inline disable for the 4-comparator chain), `runPriorScansSetup` (the priorScans replay loop). Both monsters drop below or just above the threshold; no test regressions.

- 11c4382: Split `renderMarkdown` (complexity 19) in `src/cli/commands/export.ts`. Extracted `countIssuesPerNode` (issue index helper) and `renderNodesByKindSection` (the per-kind nodes block with grouping + sorting + rendering). `renderMarkdown` itself drops below the threshold; the extracted section helper sits at 11 (parallel branches over `KIND_ORDER`, manageable). Pure refactor, no public API change.

- 6d031d8: Code-quality follow-up to commit `66ea293` — split the audit's other
  big offender, `loadOne` in `src/kernel/adapters/plugin-loader.ts`
  (310 lines, complexity 31), into focused private helpers. **Patch
  bump**: zero public API changes (the `PluginLoader` class still
  exposes the same `loadOne(pluginPath): Promise<IDiscoveredPlugin>`
  signature; new helpers are `#`-prefixed truly-private methods plus
  one private free function); pure internal restructuring.

- Updated dependencies [f8a7125]
  - @skill-map/spec@0.10.0

## 0.7.0

### Minor Changes

- 88afe24: Cleanup pass post-v0.8.0 — finishing the renames and wiring the
  conformance kill-switches.

### Patch Changes

- Updated dependencies [88afe24]
  - @skill-map/spec@0.9.0

## 0.6.0

### Minor Changes

- 6dad772: v0.8.0 — Pre-1.0 stabilization pass.

### Patch Changes

- Updated dependencies [6dad772]
  - @skill-map/spec@0.8.0

## 0.5.0

### Minor Changes

- 0463a0f: Step 9.1 — plugin runtime wiring. Drop-in plugins discovered under
  `<scope>/.skill-map/plugins/<id>/` now participate in the read-side
  pipeline: their detectors / rules emit links + issues during `sm scan`,
  and their renderers are selectable via `sm graph --format <name>`.

- 0463a0f: Step 9.2 — plugin migrations + triple protection. Plugins declaring
  `storage.mode === 'dedicated'` can now ship their own SQL migrations
  under `<plugin-dir>/migrations/NNN_<name>.sql`, and `sm db migrate`
  applies them after the kernel pass. Two new flags from
  `spec/cli-contract.md:304` light up.

### Patch Changes

- 0463a0f: Step 9.3 — `@skill-map/testkit` lands as a separate workspace + npm
  package (per the Arquitecto's pick of independent versioning over a
  subpath export). Plugin authors install it alongside `@skill-map/cli`
  and use it to unit-test detectors, rules, renderers, and audits
  without spinning up the full skill-map runtime.

- 0463a0f: Step 9.4 — plugin author guide + reference plugin + diagnostics polish.
  **Step 9 fully closed** with this changeset.

- Updated dependencies [0463a0f]
  - @skill-map/spec@0.7.1

## 0.4.0

### Minor Changes

- a73f3f4: Step 7.1 — File watcher (`sm watch` / `sm scan --watch`)

- a73f3f4: Step 7.2 — Detector conflict resolution

- a73f3f4: Step 7.3 — `sm job prune` retention GC

- d3ad73c: Step 8.1 — `sm graph [--format <name>]` real implementation

- d3ad73c: Step 8.2 — `sm scan --compare-with <path>` delta report

- 13727a3: Step 8.3 — `sm export <query> --format <json|md|mermaid>` real implementation

### Patch Changes

- b067f35: Runtime catch-up — thread `mode: 'deterministic'` explicitly through the built-in detectors and rules

- Updated dependencies [d730094]

- Updated dependencies [a73f3f4]

- Updated dependencies [a73f3f4]
  - @skill-map/spec@1.0.0

## 0.3.3

### Patch Changes

- 16e782a: Fix `tsc --noEmit` regressions surfaced by CI after the Step 6
  follow-up commits (`7d4b143`, `4669267`). The commits validated
  through `tsup` (which does not enforce `noUncheckedIndexedAccess` /
  `exactOptionalPropertyTypes`) but tripped CI's stricter `npm run
typecheck` step. Eight TS errors across six files; runtime behaviour
  unchanged.

- f41dbad: Step 6.2 — Layered config loader for `.skill-map/settings.json`. Walks the
  six canonical layers (defaults → user → user-local → project → project-local
  → overrides), deep-merges per key, validates each layer against the
  `project-config` JSON schema, and is resilient per-key: malformed JSON,
  schema violations, and type mismatches emit warnings and skip the offending
  input without invalidating the rest of the layer. Strict mode (`--strict`,
  wired in 6.3+) re-routes every warning to a thrown `Error`.

- f41dbad: Step 6.3 — `sm config list / get / set / reset / show` go from
  stub-printing-"not implemented" to real implementations. The five verbs
  share the layered loader from 6.2 and gain a `--strict` flag on
  the read side that escalates merge warnings to fatal errors.

- f41dbad: Step 6.4 — `.skill-mapignore` parser + scan walker integration.
  Layered ignore filter composes bundled defaults + `config.ignore`
  (from `.skill-map/settings.json`) + `.skill-mapignore` file content;
  the walker honours it so reorganising `node_modules`, `dist`, drafts,
  or any user-defined private dir keeps them out of the scan in one
  predictable place.

- 8a4667f: Step 6.5 — `sm init` scaffolding. Replaces the
  "not-implemented" stub with a real bootstrap verb that provisions
  everything Step 6 has built so far in one command.

- 8a4667f: Step 6.6 — `sm plugins enable / disable` + the `config_plugins`
  override layer they read from. The two stub verbs become real, and
  the `PluginLoader` finally honours user intent: a disabled plugin
  surfaces in `sm plugins list` with status `disabled`, but its
  extensions are NOT imported and the kernel will not run them.

- 8a4667f: Step 6.7 — Frontmatter strict mode. The orchestrator now validates each
  node's parsed frontmatter against `frontmatter/<kind>.schema.json`
  during `sm scan` and emits a `frontmatter-invalid` issue when the shape
  doesn't conform. Severity is `warn` by default (scan still exits 0);
  `--strict` (CLI) or `scan.strict: true` (config) promote every such
  finding to `error` so the scan exits 1.

- 7d4b143: Step 6 follow-up — unify the `--strict-config` flag (introduced in 6.2
  for the layered loader) with the existing `--strict` flag (introduced
  in 6.7 for frontmatter validation). One name, same intent across every
  verb that touches user input: "fail loudly on any validation
  warning".

- 4669267: Step 6 follow-up — two UX polish fixes surfaced during the post-Step-6
  manual walkthrough.

- Updated dependencies [f41dbad]

- Updated dependencies [8a4667f]
  - @skill-map/spec@0.6.1

## 0.3.2

### Patch Changes

- dacd4d9: Move the auto-generated CLI reference from `docs/cli-reference.md` to
  `context/cli-reference.md`. Spec change is editorial: `cli-contract.md`
  references the file path in three spots (`--format md` description, the
  NORMATIVE introspection section, and the "Related" link list); all three
  updated to the new location. No schema or behavioural change.

- 551f6ec: Persist scan results to SQLite (scan_nodes/links/issues).

- 4c34af1: Step 4.10 — scenario coverage. Pure regression-test growth, no behavior
  changes, no new dependencies, no migrations, no spec edits. Backfills
  the scenarios surfaced by the manual end-to-end validation in
  `.tmp/sandbox/` that the existing test suite did not codify.

- 4c34af1: Step 4.11 — three layers of defense against accidental DB wipes when
  `sm scan` receives invalid or empty inputs.

- 551f6ec: Compute per-node token counts via `js-tiktoken`.

- 551f6ec: Add `external-url-counter` detector and orchestrator-level segregation for
  external pseudo-links.

- 551f6ec: Add `sm scan -n` / `--dry-run` (in-memory, no DB writes) and `sm scan
--changed` (incremental scan against the persisted prior snapshot).

- 551f6ec: Promote `sm list`, `sm show`, `sm check` from stubs to real
  implementations backed by the persisted `scan_*` snapshot.

- 551f6ec: Add Step 4.6 acceptance coverage: a self-scan test and a 500-MD
  performance benchmark.

- 551f6ec: Reconcile the runtime `ScanResult` shape with `spec/schemas/scan-result.schema.json`.

- 551f6ec: Three fixes surfaced by the Step 4 end-to-end validation.

- 4c34af1: Two more fixes from the Step 4 end-to-end validation pass.

- 9a89124: Step 5.1 — Persist scan-result metadata in a new `scan_meta` table so
  `loadScanResult` returns real values for `scope` / `roots` / `scannedAt` /
  `scannedBy` / `adapters` / `stats.filesWalked` / `stats.filesSkipped` /
  `stats.durationMs` instead of the synthetic envelope shipped at Step 4.7.

- 9a89124: Step 5.10 — Two polish fixes for the `sm history` CLI surfaces, both
  surfaced during end-to-end walkthrough.

- 9a89124: Step 5.11 — `sm history` human renderer now shows `failure_reason`
  inline when present, so the human path stops hiding info that's
  already in `--json`.

- 9a89124: Step 5.12 — `loadSchemaValidators()` now caches the compiled validator
  set at module level. Before: every call paid ~100 ms cold to read +
  AJV-compile 17 schemas (plus 8 supporting `$ref` targets). After: the
  first call costs the same; every subsequent call in the same process
  returns the same instance for free.

- 9a89124: Step 5.13 — `frontmatter_hash` is now computed over a CANONICAL YAML
  form of the parsed frontmatter, not over the raw text bytes.

- 9a89124: Step 5.2 — Storage helpers for the history readers (`sm history`,
  `sm history stats`) and for the rename heuristic / `sm orphans` verbs
  landing in 5.3 — 5.6.

- 9a89124: Step 5.3 — `sm history` CLI lands. The stub is removed from
  `stubs.ts`; the real implementation lives at `src/cli/commands/history.ts`
  and is registered in `cli/entry.ts`.

- 9a89124: Step 5.4 — `sm history stats` CLI lands alongside `sm history` in
  `src/cli/commands/history.ts`. The stub is removed from `stubs.ts`
  and the real class registered in `cli/entry.ts`.

- 9a89124: Step 5.5 — Auto-rename heuristic lands at scan time per
  `spec/db-schema.md` §Rename detection.

- 9a89124: Step 5.6 — `sm orphans` verbs land. The three stubs are removed from
  `stubs.ts`; the real implementations live at
  `src/cli/commands/orphans.ts` and are registered as `ORPHANS_COMMANDS`
  in `cli/entry.ts`.

- 9a89124: Step 5.7 — Conformance coverage for the rename heuristic.

- 9a89124: Step 5.8 — fire the rename heuristic on every `sm scan`, not just
  `sm scan --changed`. Closes the follow-up flagged at the close of
  Step 5.

- 9a89124: Step 5.9 — Orphan issues now persist across scans as long as `state_*`
  has stranded references. Closes a gap surfaced during end-to-end
  walkthrough.

- Updated dependencies [dacd4d9]

- Updated dependencies [9a89124]

- Updated dependencies [9a89124]
  - @skill-map/spec@0.6.0

## 0.3.1

### Patch Changes

- 18d758a: Editorial pass across spec/ and src/ docs: convert relative-path text references (e.g. `plugin-kv-api.md`, `schemas/node.schema.json`) to proper markdown links, so they resolve on GitHub and in renderers. No normative or behavioural changes — prose, schemas, and CLI contract are unchanged.

- b6c46f8: Pin all dependencies to exact versions in `src/package.json` (no `^` / `~` ranges). Matches the new repo-wide rule in `AGENTS.md`. No runtime behaviour change — all versions match what the lockfile already resolves to. Re-evaluate when `src/` flips to public (published libs usually prefer caret ranges so consumers can dedupe).

- 48c386b: First npm publish of `@skill-map/cli` — name registration. The package was previously private; flipping `private: false` plus adding `publishConfig.access: public` lets the next "Version Packages" merge publish to the npm registry under the `@skill-map` org alongside `@skill-map/spec`. Status remains preview / pre-1.0 (Steps 0a-3 done; full scan lands at Step 4). Subsequent releases follow the standard changeset flow.

- Updated dependencies [18d758a]
  - @skill-map/spec@0.5.1

## 0.3.0

### Minor Changes

- 128a678: Step 1a — Storage + migrations.

- a0e6578: Step 1b — Registry + plugin loader.

- 8bda522: Step 1c — Orchestrator + CLI dispatcher + introspection.

- eedaf90: Step 2 — First extension instances.

### Patch Changes

- Updated dependencies [69572fd]

- Updated dependencies [2699276]
  - @skill-map/spec@0.5.0

## 0.2.0

### Minor Changes

- 3e89d8f: Bump minimum Node version to **24+** (active LTS since October 2025).

### Patch Changes

- 5935948: Align kernel domain types with `spec/schemas/`. The Step 0b stub types for `Node`, `Link`, `Issue`, `Extension`, and `PluginManifest` were invented names that diverged from the normative schemas; they compiled only because the `runScan` stub never materialized any instance. This patch closes the drift before Step 4 starts consuming the types in earnest.

- 1455cb1: Fix `sm version`: the `spec` line now reports the `@skill-map/spec` npm package version (e.g. `0.2.0`) instead of the `index.json` payload-shape version (which was `0.0.1` in every release).

- Updated dependencies [334c51a]

- Updated dependencies [3e89d8f]

- Updated dependencies [334c51a]

- Updated dependencies [d41b9ae]

- Updated dependencies [93ffe34]

- Updated dependencies [d41b9ae]

- Updated dependencies [5935948]

- Updated dependencies [1455cb1]

- Updated dependencies [1455cb1]

- Updated dependencies [93ffe34]

- Updated dependencies [1455cb1]

- Updated dependencies [334c51a]

- Updated dependencies [93ffe34]

- Updated dependencies [93ffe34]

- Updated dependencies [d41b9ae]

- Updated dependencies [93ffe34]

- Updated dependencies [93ffe34]
  - @skill-map/spec@0.3.0

## 0.1.0

### Minor Changes

- 5b3829a: Step 0b — Implementation bootstrap.

### Patch Changes

- Updated dependencies [5b3829a]

- Updated dependencies [4e0aec4]
  - @skill-map/spec@0.1.0
