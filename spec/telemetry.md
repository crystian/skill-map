# Telemetry

skill-map is local-first; by default it sends **nothing** off the operator's
machine. This is the normative contract for the optional exceptions: two
independently-consented, anonymous telemetry surfaces, both **OFF by default**.

- **Error reporting** (Sentry), so crashes in installations the maintainers do
  not control can be learned about and fixed.
- **Usage analytics** (PostHog), so the maintainers learn which verbs and
  built-in extensions are used in the wild and prioritise the roadmap.

The two surfaces share one consent prompt, one kill switch, and one scrubber,
but each has its own carrier, toggle, and stability contract. Either can be
shipped independently.

## Scope and non-goals

In scope:

- **Errors.** Uncaught exceptions and unhandled rejections in the CLI
  process, unhandled errors in the BFF (`sm serve`) request path, unhandled
  runtime errors in the browser UI, plus a small fixed set of triage tags
  (`surface`, `verb`, `phase`, `plugin_id` for built-ins, `extension_kind`,
  `route`, `method`, `status`).
- **Usage.** Which `sm` verb ran and the NAMES of its flags; the set of
  built-in extension ids that executed during a scan (presence, not volume);
  which UI view or feature was opened. Plus environment facts (`cli_version`,
  `node_major`, `os`, `arch`).

Out of scope (MUST NOT be collected under this contract, on either surface):

- **Flag values, file names, markdown bodies, frontmatter values, annotation
  contents, settings values.** Only flag names and built-in extension ids
  ever leave the machine.
- **Performance traces:** latency, throughput, span timing.
- **Project-shape signals:** file counts, node counts, frontmatter key sets,
  project size. "Which extensions ran" is presence only, never a count.
- **Any cross-session or cross-install correlation identifier**, with one
  documented exception: the single anonymous usage `distinct_id`
  (`telemetry.anonymousId`, below), which carries no identity and exists only
  to de-duplicate usage events from the same install. The error surface
  carries no correlation id at all.

## Consent contract (shared)

Both surfaces are **OFF by default**, running only after the operator opts in.
Consent state lives in the user-settings file at `~/.skill-map/settings.json`
under the `telemetry` object (see
[`user-settings.schema.json`](./schemas/user-settings.schema.json) and the
narrow `$HOME` exception in [`cli-contract.md`](./cli-contract.md) §User-settings file):

- `telemetry.errorsEnabled`, `telemetry.usageCliEnabled`,
  `telemetry.usageUiEnabled` (booleans). Opt-in for error reporting, CLI usage
  analytics, and UI usage analytics respectively. For each, absent or `false`
  MUST be treated as OFF.
- `telemetry.anonymousId` (string UUID, or null). The PostHog `distinct_id`
  for the usage surface. Minted once when any usage toggle first becomes
  `true`; never regenerated. The single allowed anonymous correlation id,
  scoped to usage only.
- `telemetry.firstRunAt` (integer milliseconds, or null). The first run on
  which the prompt was eligible, so it can be deferred to the next eligible run.
- `telemetry.promptedAt` (integer milliseconds, or null). When the consent
  prompt was shown, so it is never shown twice.

Rules:

1. **Default OFF.** When a toggle is absent or `false`, the matching SDK is
   not initialised at boot, no endpoint is contacted proactively, and there is
   zero added latency. On the usage surface this is absolute. On the errors
   surface a caught crash MAY still ask the operator per incident (see
   §Per-incident crash-report consent below); in a non-interactive context
   nothing is ever sent without the persisted opt-in, and an interactive crash
   always shows the consent question, with its default and bounded wait
   announced, before anything is sent. MUST hold on every surface (CLI, BFF,
   UI).
2. **One shared consent prompt, TTY only, deferred to the second eligible
   run.** A run is "eligible" when the prompt could appear: an interactive
   terminal (`process.stdout.isTTY` true), at least one carrier configured
   (a Sentry DSN or the PostHog key non-empty), the kill switch unset, and
   `promptedAt` absent. The CLI MUST NOT prompt on the FIRST eligible run, it
   only stamps `firstRunAt`, so the operator's first `sm` invocation is not
   asked two things at once (a first `sm scan` may already prompt for the
   provider lens). The NEXT eligible run shows the interactive prompt
   (yes (default) / no / details). A single **yes** sets `errorsEnabled`,
   `usageCliEnabled`, and `usageUiEnabled` all to `true` and mints
   `anonymousId`; a **no** sets all three to `false` and mints nothing. Either
   way it stamps `promptedAt`. On a non-eligible run (non-TTY CI, pipes)
   nothing is asked or recorded and every surface stays OFF.
3. **Asked once.** Once `promptedAt` is set, the prompt MUST NOT be shown
   again; the persisted toggles are authoritative thereafter.
4. **Env override.** `SKILL_MAP_TELEMETRY=0` forces OFF on every surface
   (errors and both usage toggles) regardless of persisted settings. It is a
   kill switch, not a toggle: no value of it forces ON. Exactly one
   kill-switch variable covers all surfaces.
5. **Independent toggles.** After the first run, the operator changes consent
   through the Settings UI (persisted via the BFF), like the update-check
   toggle. The three toggles are independent: `usageCliEnabled` and
   `usageUiEnabled` can each be turned off without affecting the other or
   `errorsEnabled`. Because the CLI reads `~/.skill-map/settings.json` fresh
   per invocation, turning CLI usage off from the browser is honoured on the
   next `sm` run. There is intentionally no dedicated `sm config` key:
   `sm config` writes project-local settings, these flags are per-machine.
   A future `sm telemetry` verb family MAY expose status and toggling from
   the CLI.
6. **Anonymous id.** `anonymousId` is a random UUID v4 with no personal data,
   minted once the first time any usage toggle becomes `true` (consent prompt
   or Settings enable), never regenerated for the life of the install. It is
   the PostHog `distinct_id` shared by the CLI and UI usage surfaces. The BFF
   exposes it read-only (see below) so the browser uses the same id; it MUST
   NOT be writable over the wire.

### Per-incident crash-report consent (errors surface)

The errors surface carries a second consent path, scoped to a single event:
when a crash is caught on an interactive surface, the implementation asks the
operator whether to send THAT report, even when `errorsEnabled` is `false` or
absent. Under this contract `errorsEnabled` is not a master switch for the
errors surface; it governs only the **non-interactive fallback**:

1. **The prompt appears on every promptable crash.** CLI: a crash is
   promptable when stdin and stderr are both interactive TTYs, the run is not
   CI, and the invocation did not pass `--json` or `-q` (a machine consumer
   must never block on a consent question). UI: every unhandled runtime error
   is promptable (a browser session is interactive by definition), but
   implementations MUST bound repetition: duplicate errors are deduplicated
   per session and at most one consent dialog is open at a time.
2. **The default answer is Yes.** An empty answer sends the report; an
   explicit no always wins and is honoured unconditionally. The CLI prompt
   MAY bound the wait and resolve to Yes, so an unattended terminal still
   reports the crash; the bound and its Yes resolution MUST be announced on
   the prompt itself (the operator is told what silence does).
3. **Nothing is persisted per incident.** A yes sends exactly one report and
   MUST NOT flip `errorsEnabled`; a no sends nothing and is not remembered.
   The next crash asks again.
4. **Non-promptable contexts fall back to the toggle.** With `errorsEnabled`
   `true` the report is sent automatically; otherwise nothing is sent. This
   preserves the pre-incident-consent semantics for CI, pipes, `--json`, and
   `-q`.
5. **Dormancy gates are unchanged and take precedence.** The
   `SKILL_MAP_TELEMETRY=0` kill switch or an empty DSN mean no prompt and no
   send, ever.
6. **Covered error classes.** CLI: process-fatal errors (uncaught exceptions
   and unhandled rejections; the process exits `1` after the flow) and
   per-verb errors caught by the command boundary (the documented exit code
   `2` is unchanged). UI: unhandled runtime errors reaching the Angular
   `ErrorHandler`, EXCEPT module-load failures: a dynamically imported chunk
   that fails to fetch (the native-import failure in its browser phrasings,
   `Failed to fetch dynamically imported module`, `error loading dynamically
   imported module`, `Importing a module script failed`) means the serving
   process is gone or a cached shell went stale, not a defect in the running
   code, so there is nothing actionable to report (and typically no server
   behind the page anyway); the consent dialog MUST NOT open for that class,
   the error still reaches the console. The BFF (`sm serve`) is excluded: it
   has no interactive operator to ask and keeps the toggle-only model.
7. **Scrubbed preview.** The prompt MUST offer a details view rendering the
   would-be payload after the same pure scrubber that runs in the pre-send
   hook, so the operator can inspect what would leave the machine before
   answering.

## Surface: Errors (Sentry)

Three surfaces report independently so a crash is attributed to the right
layer, across **two** Sentry projects.

| Surface | Runtime | Discriminator | Project |
|---|---|---|---|
| `sm <verb>` | Node (CLI) | `surface: cli` tag | shared Node project |
| `sm serve` BFF | Node (Hono) | `surface: bff` tag | shared Node project |
| UI | Browser (Angular) | own project | `skill-map-ui` |

The two Node surfaces share one project (same workspace code, same runtime); the
`surface` tag plus the per-event `route` / `method` tags separate a CLI crash
from a BFF request-path crash. The UI has its own project and needs no `surface`
tag. Each project carries a hardcoded DSN (`SENTRY_DSN_NODE` for the shared Node
project, `SENTRY_DSN_UI` for the UI), centralized in `src/public-config.ts` and
`ui/src/app/core/public-config.ts`. Sentry DSNs are public by design (they
identify an ingest endpoint, not secrets) and safe to ship. The BFF MUST NOT
emit usage events; it reports only unhandled errors in the request path.

The error surfaces send **no proactive beacons**: no release-health sessions,
no transactions, no performance traces. An event leaves the machine ONLY when
an error is captured, and capture itself is consent-gated: the persisted
opt-in in non-interactive contexts, or the per-incident answer (§Per-incident
crash-report consent) everywhere else. The browser SDK MUST drop the default
session integration so no session is sent on page load or route change.

### Error wire format

An error event MAY carry:

- A stack trace whose `filename` and `abs_path` frames have been run through
  the path scrubber (below).
- Environment facts: `cli_version`, `node_major`, `os`, `arch`, and, for the
  UI, browser family and version.
- The fixed tag set: `surface` (`cli` / `bff` on the shared Node project),
  `verb`, `phase`, `plugin_id` (built-in ids only), `extension_kind`,
  `route` (BFF), `method`, `status`.
- The error name, error code, and a scrubbed message.
- Breadcrumbs (a bounded recent-event trail), each message scrubbed.

## Surface: Usage (PostHog)

Usage analytics are carried by **PostHog Cloud (EU region)**, for data
residency parity with the Sentry `.de` projects. The public PostHog project
key is hardcoded and centralized in `src/public-config.ts` (`POSTHOG_KEY_NODE`)
and `ui/src/app/core/public-config.ts` (`POSTHOG_KEY_UI`). Like a Sentry DSN it
is a public ingest identifier, not a secret, and safe to ship. Setting a key to
`''` forces that surface dormant (no init, no network, SDK not even imported),
the same dormancy gate the error surface uses.

Only **two** runtimes emit usage events:

| Surface | Runtime | Toggle | Carrier |
|---|---|---|---|
| `sm <verb>` | Node (CLI) | `usageCliEnabled` | PostHog (server SDK) |
| UI | Browser (Angular) | `usageUiEnabled` | PostHog (browser SDK) |

The **BFF MUST NOT emit usage events** (its activity is the UI's, already
covered by the UI surface; double-emitting would double-count). The BFF
participates only by reading/writing consent and by exposing `anonymousId`
read-only on `GET /api/preferences` so the browser uses the same `distinct_id`
as the CLI.

Both usage SDKs send nothing beyond the allow-list below: PostHog autocapture,
pageview/pageleave capture, session recording, and client IP / geo-IP
enrichment are all disabled.

An invocation marked agent-driven (`SM_AGENT` env var set to any non-empty
value other than `0`) keeps the CLI usage surface DORMANT: an agent
following the queue protocol is not operator usage. The shipped
processing-agent skill marks exactly its protocol-mandated post-record
`sm scan --changed` with it; the agent's `sm jobs claim` / `sm record` are
deliberately unmarked (the successful claim is already event-less, and the
record IS the queue-lifecycle signal).

## Usage event taxonomy

Usage collection is **deny by default**: only the events and properties named
here may be sent. Every event carries `distinct_id = telemetry.anonymousId`,
the common environment facts (`cli_version`, `node_major`, `os`, `arch`; the UI
also carries browser family/version where the SDK provides it), and
`environment` (`dev` / `prod`, see below). The UI also attaches the active
theme as super-properties on every event: `theme_base` (`light` / `dark`) and
`theme_extra` (the active extra theme id, or `none`); future extra themes flow
through by value with no spec change. No other identity property is ever
attached.

Every UI event ALSO attaches `$screen_name` so PostHog's URL / Screen column
carries signal instead of a constant localhost URL: the feature name on
`ui.feature.*`, the `group:value` pair on `ui.filter` (e.g. `kind:skill`),
the collapsed toggled ids each suffixed with the state the apply SET (`<id>:true` / `<id>:false`) on `plugin.apply` (both surfaces, CLI and UI), and `app-start` on boot. The
SDK's own URL properties (`$current_url`, `$pathname`, `$host`) are dropped
outright via the client's `property_denylist`: a local tool's URL is always
`localhost` noise, and the path / search query values inside it were already
masked by the scrubber (which still walks the remaining URL-bearing fields,
e.g. `$session_entry_url`).

The `environment` tag lets the maintainers filter their own dogfooding out of
real-world data. It is `dev` when `SKILL_MAP_TELEMETRY_ENV` is set to any
non-empty value other than a production marker (`prod` / `production`); the dev
tooling sets it. It is `prod` when the variable is absent, empty, or a
production marker. It is NOT a kill switch (it labels the source, never disables
telemetry) and rides on both surfaces: usage events as above, and Sentry's
native `environment` field on error events.

| Event | Surface | Properties |
|---|---|---|
| `cli.<verb>` | CLI | `flags` (array of flag NAMES that were set), and, on the verbs that execute or queue extensions, `extensions` (deduped, sorted set of the built-in extension ids involved): the executed extractor set on `cli.scan`, the extractor and enrichment-action ids the deterministic pass refreshed on `cli.enrich`, and the job's extension id on the probabilistic queue lifecycle (`cli.jobs` submit, `cli.record`). On that queue lifecycle, where exactly one extension is involved, the same id (after third-party collapse) is ALSO attached as `$screen_name`, so PostHog's URL / Screen column names the involved finder / fixer at a glance; it duplicates a value already allowed in `extensions`, never new data. A FRESH lens resolution additionally rides the event as `lens` (the resolved provider id, third-party ids collapse) + `lens_source`: `autodetect` when a scan resolved the lens from markers (including the ambiguity prompt's pick), `set` on an explicit `sm config set activeProvider`; a scan that merely reads the persisted lens attaches nothing, and when no queue `$screen_name` applies the pair doubles as the URL / Screen value (`<lens>@<source>`). A tutorial completion ping (`sm tutorial --completed <part-id|book>`, run by the shipped skill at each part close and at the final wrap-up) rides as `tutorial_part`: a part id from the SHIPPED tutorial manifest, or `book` for the whole-book milestone; any out-of-catalog value collapses to the literal `unknown` before emit, and the id doubles as the URL / Screen value (`tutorial:<id>`) when nothing else claimed it. One event per invocation, with one deliberate exception: a SUCCESSFUL `sm jobs claim` emits NO usage event, because its execution is fully represented by the paired `cli.record` (every claimed job ends in a record or a reap) and emitting both doubled the volume of the busiest lifecycle; a claim that hands out nothing still emits a plain `cli.jobs`. The event NAME is the verb (`cli.scan`, `cli.check`, ...), restricted to the registered closed verb set so an unknown command collapses to `cli.unknown` (a typo never mints a junk event name); the root `--help` / `-h` and `--version` / `-v` surfaces report as `cli.help` / `cli.version`, not `cli.unknown`. |
| `ui.app.start` | UI | emitted ONCE when the SPA boots with the usage surface active (right after the consent probe arms the SDK), carrying `lens`, the active provider lens at boot (best-effort probe; third-party provider ids collapse to `external_plugin`; omitted when the probe fails). No other properties beyond the common env facts and super-properties. The session-presence signal; there is deliberately NO per-view / per-route event (the app has a single fused workspace view, so a view event only counted interactions). |
| `ui.feature.<feature>` | UI | the used feature is the event name, from a closed set: `ui.feature.settings`, `ui.feature.settings-resolution` (the config-resolution dialog inside Settings), `ui.feature.settings-changelog` / `ui.feature.settings-about` (the only tracked tab entries; the working tabs' usage is visible through their own gestures), `ui.feature.quick-start`, `ui.feature.files`, `ui.feature.queue`, `ui.feature.sessions` (the workspace rail's tabs), `ui.feature.files-search-map` and `ui.feature.files-follow-selection` (the files rail's coupling toggles), `ui.feature.live-toggle`, `ui.feature.scan`, `ui.feature.theme-toggle` (the topbar buttons), `ui.feature.job-cancel` (the per-job cancel, wherever it surfaces), `ui.feature.job-cancel-all` / `ui.feature.job-clear-failed` / `ui.feature.job-clear-finished` (the queue's bulk actions, emitted on the CONFIRMED dialog accept, never on a dismissed confirm), `ui.feature.favorite-toggle` (the node star, card or inspector header; no node identity attached), and the Settings Project rows: `live-updates`, `realtime-activity`, `runtime-agents`, `capture-conversations`, `follow-symlinks`, `mcp-server`, `skill-actions`, `allow-sidecar`, `use-gitignore` (boolean `value` = the state the gesture set), `hook-install` / `hook-uninstall`, `skill-install` / `skill-uninstall` / `skill-update`, and the list gestures `reference-paths-add` / `reference-paths-remove` / `ignore-patterns-add` / `ignore-patterns-remove`, which carry NO value, NEVER the path or pattern text. Quick Start re-exposes several of those actions; every gesture reachable from both surfaces is source-stamped from BOTH call sites (`live-updates`, `realtime-activity`, `capture-conversations`, `follow-symlinks`, `mcp-server`, the hook / skill installs). Quick Start's own rows close the set: `ui.feature.mcp-copy` (copy the MCP register command / config), `ui.feature.mcp-check` (the live MCP connection probe), `ui.feature.agent-jobs-check` (the queue full-circuit probe; the inspector's Check Agent button runs the same probe and emits the same event stamped `@inspector`). The inspector adds `ui.feature.auto-fixer` (the Auto-fixer checkbox, boolean `value` = the state set; the gated no-op flip never emits), `ui.feature.ai-action` (one per launcher click, `value` = the collapsed extension id + `auto_fix` boolean; the group-ALL buttons emit ONE `ui.feature.ai-action-all` with the group as `value`, never one event per queued entry), `ui.feature.node-action` (a plugin-contributed action button dispatch, `value` = the collapsed action id, emitted per REAL dispatch, a cancelled parameter prompt never counts, and the prompt value never rides), `ui.feature.summarize` (the header sparkles QUEUEING click only; the ready-state expand toggle never emits), and the findings-lifecycle gestures `ui.feature.finding-fix` / `finding-dismiss` / `finding-resolve` / `finding-restore` / `finding-delete` (deterministic issue rows and probabilistic finding rows share the same names; NEVER the node, finding id, or content). `finding-fix`, `finding-dismiss` and `finding-resolve` carry a `value` naming WHAT they act on: the finding TYPE (e.g. `incoherence`; a third-party finder's vocabulary collapses with its plugin) or, on a deterministic row, the analyzer id (plugin-qualified ids collapse); `finding-restore` / `finding-delete` stay bare. The `.sm` write-consent dialog resolution rides as `ui.feature.sidecar-consent`, ONE per showing, with `value` = `always` (accepted with the always-allow checkbox), `once` (accepted one-shot), or `declined` (any decline path, button / X / escape / mask), plus `action` naming what parked behind the gate: the qualified action id (third-party ids collapse) or a findings-flow literal (`findings-restore` / `findings-delete` / `issue-dismiss`); omitted when unknown. The Ignore affordance (the files rail's file / folder rows and the inspector header, appending to `.skillmapignore`) rides as `ui.feature.ignore-path`, ONE per resolved gesture, with `value` = `once` / `always` (confirmed without / with the don't-ask-again checkbox), `declined` (any decline path), or `auto` (the persisted `ui.confirmIgnore` suppression skipped the dialog), stamped `source` (`files` / `inspector`); NEVER the path or pattern text. The tags row adds `ui.feature.auto-tag` (the tagger's QUEUEING click), `ui.feature.tags-edit` (the pencil opening the inline editor; the auto-tag proposal's programmatic open never emits), and `ui.feature.tags-save` (the committed edit; tag values NEVER ride). `ui.feature.findings-reveal` (`value` = the bucket, `dismissed` / `fixed`) fires only when a hidden-bucket chip REVEALS its rows (hiding, or the implicit close when another bucket opens, never emits), and `ui.feature.reanalyze` is the analysis block's re-run QUEUEING click, distinct from the first-run `summarize`. One per user gesture; an auto-open (e.g. the rail's large-corpus default) never emits. A toggle-flavored feature MAY carry a `value` with the state the gesture SET, a boolean or a closed-enum string (today: `ui.feature.live-toggle` with `true` / `false`, `ui.feature.theme-toggle` with the set mode `auto` / `light` / `dark`, `ui.feature.theme-extra` with the selected extra-theme id from the UI's shipped registry or `none`, `ui.feature.lens-select` with the CONFIRMED target lens, third-party provider ids collapsed, riding BOTH as `value` and as `lens`, the same property name `ui.app.start` and the CLI lens signals use, so one breakdown covers every lens event). A gesture reachable from more than one surface (Settings, Quick Start, the inspector and the files rail share actions) ALSO stamps `source` (`settings` / `quick-start` / `inspector` / `files` / `topbar`) from every call site, so the adoption of each path is comparable (`ui.feature.theme-extra` is reachable from Settings and from the topbar theme menu, 2026-08-29). `$screen_name` folds both in: `<feature>[:<value>][@<source>]`. The node inspector open is deliberately NOT tracked: a per-selection event was interaction-level noise. |
| `ui.filter` | UI | one event per map-toolbox filter gesture, carrying `group` (`kind` / `severity` / `link` / `favorites`) and, for the valued groups, `value`: the node-kind name (built-in Provider kinds pass through, any plugin-declared kind collapses to `external_plugin`), the severity tier (`error` / `warn`), or the link kind (closed set: `invokes` / `references` / `mentions` / `points`). Gesture-only: auto-clears and URL restores never emit. |
| `plugin.apply` | CLI + UI | `enabled` / `disabled`: deduped, sorted sets of the plugin / extension ids toggled (built-in ids pass through, third-party collapse to `external_plugin`). Emitted on `sm plugins enable` / `disable` and on the Settings plugins Apply. |

Rules:

- **Flag names only, never values.** `--max-nodes 500` reports the name
  `max-nodes`, never `500`.
- **Extension ids are presence, not counts.** `extensions` is a set; it never
  carries how many nodes an extension processed or project size. Only
  extensions that actually ran (or, on a submit, were queued) in that
  invocation appear (cached extractors on an incremental scan do not), so the
  signal is "which extensions this project exercises", aggregated across
  runs.
- **Third-party ids collapse.** Any extension id whose plugin is not a
  built-in MUST be replaced with `external_plugin` before the event leaves the
  machine. The allow-list is the set of plugin ids the implementation itself
  ships, so it grows with the reference impl rather than being frozen here; a
  plugin the operator installed is never in it. Collapsing MORE than the
  allow-list requires is always conforming, since it can only reduce what
  leaves the machine, never widen it.
- **No node paths, titles, or content** in any UI event; the feature is the
  event name, from a closed set. The only UI events carrying properties
  beyond the common env facts and super-properties are `ui.filter` (`group` +
  `value`, closed enums, plugin-declared kinds collapse to `external_plugin`)
  and `plugin.apply` (collapsed id sets).

## Scrubbing rules (shared)

Scrubbing is **deny by default**, applied client-side in each SDK's pre-send
hook (`beforeSend` for Sentry, `before_send` for PostHog) before any event
leaves the machine. It applies to error events AND usage event properties
(defense in depth: the usage collectors emit only names and enums, but every
payload is still walked). An event MUST have the following removed or replaced:

- **Absolute paths**, anywhere they appear (frame `abs_path`, frame
  `filename`, inside the error message, breadcrumb messages, any nested event
  or property field). The home directory is replaced with `<HOME>` and the OS
  username with `<USER>`.
- **Path- or content-bearing URL query parameters.** Wherever a URL or query
  string appears in an event (the SDK-attached `$current_url`, navigation
  breadcrumbs, messages, any nested field), the VALUES of parameters that
  carry node paths or operator-typed text (`path`, `search`) MUST be replaced
  with a mask (`<masked>`). Closed-enum parameters (`kinds`, `linkKinds`,
  `severities`, `favoritesOnly`) may pass through; any future parameter that
  carries a path, a file name, or free text joins the masked list.
- **File names of user content** (scanned markdown files).
- **Markdown bodies, frontmatter values, annotation contents.** None of these
  are ever attached to an event.
- **IP address.** Opted out client-side and disabled at the project level.
- **Hostname** (`server_name` stripped).
- **OS username.**
- **Third-party plugin ids.** Only built-in plugin ids may appear; any
  non-built-in id MUST be replaced with the literal `external_plugin`.
- **Settings values** (`scan.referencePaths`, etc.).

The scrubber is a pure function with no SDK dependency, so it can be unit
tested against hostile inputs (Windows paths, symlinked paths, paths embedded
mid-message, nested `abs_path` fields, breadcrumb data, structured usage
properties) independently of SDK wiring.

## Server-side guarantees

As a second line of defense behind the client-side scrubber:

- Each **Sentry** project MUST be configured to not store IP addresses and to
  run a server-side data-scrubbing rule with the same path pattern as the
  client scrubber. The UI error surface additionally restricts reporting to
  loopback: Sentry retired its server-side allowed-domains setting, so this is
  enforced client-side via the SDK `allowUrls` option pinned to `localhost` /
  `127.0.0.1` (the UI is only served from loopback).
- The **PostHog** project MUST be configured to discard client IP addresses
  and disable geo-IP enrichment (the client SDKs disable geo and autocapture
  too, but the project setting is the backstop).

## Stability

The **consent model** (default OFF on every surface, the `telemetry` toggles
and bookkeeping in `user-settings.schema.json`, the `SKILL_MAP_TELEMETRY=0`
kill switch, prompt-once semantics) is stable as of the spec minor in which it
lands. The per-incident crash-report path is part of that model: the stable
invariant is that no error event leaves the machine without operator consent,
persisted or per-incident. Loosening any default (anything other than OFF),
removing the kill switch, or removing either consent gate is a major bump.

The **two surfaces are independent.** Error and usage scope each evolve on
their own minor bump. Adding a new usage event or property, or a new error tag
or environment fact, is a minor bump. Performance traces remain out of scope on
both and would be a third, separately-consented surface.

The **`anonymousId` exception** is normatively scoped to the usage surface
only: the one anonymous correlation id the contract permits, and the error
surface MUST remain free of any cross-session or cross-install id. Widening it
beyond usage, or attaching any identity, is a major bump.

The scrubbing exclusion list (what MUST NOT leave the machine) is the stable,
normative core and may only grow, never shrink, without a major bump.

Consumers and alternate implementations MAY ship neither surface; both are
optional. An implementation that ships a surface MUST honor the consent
contract and the scrubbing rules in full.
