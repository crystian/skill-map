# Provider activity (live node activity)

Normative contract for the **live node activity** feature: while an operator works
in an external AI-coding CLI (Claude Code, Codex, Antigravity, opencode, ...), that
runtime's own hook system reports which skill / agent / command is being invoked,
and the skill-map UI lights up the matching node (and the active execution spine)
in real time.

This surface is UNRELATED to skill-map's internal `hook` extension kind
([`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set)),
which subscribes to skill-map's own scan lifecycle. Provider activity consumes the
PROVIDER runtime's hook system, an external event source. The two never compose.

## Roles and boundary

The pipeline crosses four independently-owned pieces:

```
[provider runtime hook]                     (vendor-owned, fires on invocation)
        v  spawns / calls
[bridge]                                    (skill-map-installed artifact, dumb forwarder)
        v  POST /api/activity  (loopback + token)
[BFF ingest + mapper]                       (long-running `sm serve` process)
        v  broadcaster
[WS `node.activity`]  ->  [UI lighting]
```

- **Kernel** owns only the ABSTRACTION: the optional `activity` capability on the
  `provider` extension manifest (install descriptor + event mapping). The kernel is
  a scan-time engine; it is not alive at runtime and never transports events.
- **BFF** owns the runtime: the ingest route, the event->node resolution against the scanned node set, the WebSocket broadcast, the execution-stats accumulator (§Execution stats; an in-memory hot path CHECKPOINTED into the project DB's `state_activity_*` tables, so counts survive a restart), the consent-gated conversation store (§Conversation capture), and the session journal (§Session journal). Live claims, spawn state and conversations are in-memory only and die with the process; the durable outputs are the stats checkpoint and the journal's per-session files of RESOLVED, content-free frames under `.skill-map/sessions/`.
- **Bridge** is the tiny artifact installed into the provider's own hook config. It
  has ZERO skill-map logic beyond discovery + forwarding (see §Bridge contract).
- **UI** owns presentation: per-node lighting, the active spine (including the source-to-target particle flow it carries while it executes, so the direction of the live call reads on the map), TTL decay, and the replay's narration chrome (the camera that follows the node each frame is about, and the step numbers along the route the tape walked, both derived from the same fold that lights the replay).

## The `provider.activity` capability

A Provider that integrates a runtime hook system declares an optional `activity`
capability on its manifest (schema: [`schemas/extensions/provider.schema.json`](./schemas/extensions/provider.schema.json)).
Like `scaffold`, it is a provider-owned capability sub-object, NOT a new extension
kind: the same Provider that owns the on-disk layout and invocation grammar owns
how its runtime reports invocations. Providers without a hookable runtime
(`agent-skills` as a pure format, the `core/markdown` base) simply omit it.

Two halves:

- **Declarative (manifest JSON)**: the `install` descriptor. Where the provider's
  project-local hook config lives (`configPath`, always relative to the scope root)
  and which install shape applies (`kind`). The remaining fields are PER-KIND:
  `events` / `group` / `commandCwd` / `projectDirEnvVar` parameterize the
  spawned-bridge wiring and are valid ONLY on `json-hooks` descriptors
  (schema-enforced; a `plugin-file` descriptor carries only `kind` +
  `configPath`, since it runs in-process and there is no command to spawn).
- **Runtime (TypeScript only, never in the manifest, mirroring `classify()` /
  `walk()`)**: `mapEvent(raw)` receives one raw provider hook payload and returns
  zero or more activity signals, or `null` to disclaim. Providers with a
  `plugin-file` install additionally supply `pluginHooksSource`, the
  hook-registration half of the generated in-process plugin (see the
  `plugin-file` paragraph below); like `mapEvent`, it is payload knowledge and
  lives with the Provider, never in the manifest. A signal names its unit in
  one of two forms:
  - **By name**: `{ kind, name, phase, owner? }`. The generic BFF mapper resolves
    `(kind, name)` to a scanned `node.path` using the provider's kind identifiers
    ([`architecture.md` §Provider · kind identifiers](./architecture.md#provider--kind-identifiers)).
  - **By path**: `{ path, phase, owner? }`, where `path` is scope-relative
    (forward-slash). Used when the runtime reports a FILE rather than a named unit
    (a markdown read or write via the provider's file tools). Path signals match the
    scanned node with that exact `path`, ACROSS providers and kinds (the file may
    be a `markdown` node, a skill's `SKILL.md`, anything scanned), because the
    path already identifies one node unambiguously.

  - **Owner release (node-less)**: `{ phase: "end", owner, ownerScope: true }`
    with NO `kind`/`name`/`path`. Used when the runtime reports the end of a
    whole execution context that is not itself a node (Antigravity's `Stop`:
    a conversation going idle). The resolver forwards it without resolution
    and consumers release every claim that `owner` holds.

  - **Relation-only (spawn)**: `{ phase, owner, spawn }` with NO `kind`/`name`/
    `path`. Used when a spawn happens in a context that is not itself a node
    (the main session spawning a subagent): there is no parent node to claim,
    but the relation still matters. The resolver emits one `agent.spawn` frame
    (§WS event: `agent.spawn`) and no `node.activity` event.

  Three optional fields refine a signal's meaning:

  - `keepAlive` (start-only): marks a CUSTODY claim (a parent held lit through
    a spawn, §WS event: `node.activity`, parent custody) rather than an
    execution of the named unit. Keep-alive starts light nodes exactly like any
    other start but are EXCLUDED from execution counting (§Execution stats).
  - `spawn`: a spawn-relation block `{ spawnId, phase: "start" | "handoff" |
    "end", parentOwner, childKind?, childName?, childOwner?, prompt?,
    response? }` riding the signal produced by the spawning tool call.
    `spawnId` is the raw spawn tool-call id (never a synthetic owner key;
    nothing parses owner strings). The BFF turns each block into one
    `agent.spawn` frame, resolving `childKind`/`childName` through the same
    identifiers contract as name signals. `prompt` / `response` are the
    inter-agent conversation halves; they never ride the WS and are retained
    ONLY under the capture gate (§Conversation capture). A sync completion
    MAY also carry `execution` (`{ durationMs?, tokens?, toolUses? }`), the
    child run's aggregate execution summary as the runtime reported it
    (Claude: `totalDurationMs` / `totalTokens` / `totalToolUseCount` on the
    completion payload, live-verified 2026-07-05). Execution summaries are
    METADATA (plain numbers): they feed the per-node aggregates and the
    retained records independently of the capture gate's content rules.
    Async completions carry no summary (the terminal stop does not either);
    the fields simply stay absent. The vendor `toolStats` / `usage`
    breakdowns stay uncaptured until their inner shapes are pinned against
    a live run.
  - `report` (only on `phase: "end"` boundary signals): the ENDING context's
    final message, as the runtime reported it on its stop event (Claude:
    `last_assistant_message`). CONTENT, not metadata: it never rides the WS,
    and the BFF hands it to the conversation store ONLY under the capture
    gate, where it completes the response half of spawns whose completion
    frame carries no content (async spawns), matched by the record's
    `childOwner`. Runtimes fire stop events on pause too; overwrite
    semantics make the terminal message win.

  Either way the provider owns payload knowledge and does NOT resolve nodes;
  `mapEvent` is also where irrelevant runtime events are FILTERED with an early
  disclaim (a file read or write of a non-markdown source file, a path outside the scope
  root), so obviously-unresolvable events never reach the node set. Signals that
  resolve to no scanned node are dropped (a phantom node is never lit).

Install shapes (`install.kind`, closed set, extensible by minor bump):

| kind | meaning | example target |
|---|---|---|
| `json-hooks` | merge hook entries into a JSON settings/hooks file that spawns the bridge command | `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json` |
| `plugin-file` | write an in-process plugin file that POSTs directly (no spawn) | `.opencode/plugin/skill-map-activity.js` |

`json-hooks` covers two document shapes, selected by the optional
`install.group` field, and THREE command-path conventions.

The preferred one is `install.projectDirEnvVar`: the name of an environment
variable the runtime sets to the project root when it spawns a hook command
(Claude Code: `CLAUDE_PROJECT_DIR`). When declared, install writes
`node "$VAR"/.skill-map/activity/bridge.js <provider>` and `commandCwd` no
longer applies, because the path is absolute at spawn time. Implementations
SHOULD prefer it wherever the runtime offers one. The two cwd-relative forms
below assume the hook is spawned at the project root, and that assumption
holds when a session starts but not for its lifetime: an agent that changes
directory while working takes the hook cwd with it, so every later hook
resolves against the subdirectory and activity ingestion stops with a
module-not-found naming a path the operator never wrote. Note the asymmetry
this removes, the bridge already refuses to trust the spawn cwd (it derives
its scope root from its own installed location), so a cwd-relative command
made the wiring depend on exactly what the bridge distrusted.

An absolute literal would also defeat the cwd problem and introduce a worse
one: these hook configs are routinely committed, so a baked machine-specific
path breaks every other contributor. Quote the VARIABLE only, never the whole
path, so an expansion containing spaces survives and the bare
`.skill-map/activity/bridge.js` substring stays intact for the ownership
marker uninstall keys on. A provider MUST NOT declare a variable name its
runtime does not actually set: an unset variable expands to empty, the path
resolves at the filesystem root, and the hook then breaks always rather than
only from a subdirectory, which is strictly worse than the relative form.

The remaining two are selected by the optional `install.commandCwd` field
(`'scope-root'` default / `'config-dir'`
for runtimes that spawn hook commands at the hook config's own directory, in
which case install writes the bridge command with the relative hops from
`dirname(configPath)` back to the root). Claude / Codex nest the per-event entry map under the
vendor's fixed `hooks` key, where operator entries coexist with skill-map's
(removal is marker-filtered: every skill-map entry's command contains the
bridge path). Antigravity's `.agents/hooks.json` instead maps NAMED GROUPS to
event maps; a provider declaring `group` makes skill-map write its entries
under its own group key (and uninstall remove exactly that group). The inner
per-event shape (`[{ matcher?, hooks: [{ type: "command", command }] }]` for
tool events) is identical in both shapes.

`plugin-file` installs write ONE self-contained plugin file at `configPath`
(opencode: `.opencode/plugin/skill-map-activity.js`, loaded in-process by the
runtime). The file IS both the wiring and the bridge, and its source splits
along the same ownership line as the rest of the capability: the install
engine owns the ENVELOPE (the header marker, `serve.json` discovery under the
plugin context's project directory, scope + loopback + token checks, the
fetch timeout, and the NEVER-throw invariant, an exception inside an
in-process hook could alter the host session, the in-process analog of the
exit-0 invariant, §Bridge contract), while the Provider supplies the
HOOK-REGISTRATION half via its runtime `pluginHooksSource` (the in-process
analog of the `events` list, which `plugin-file` descriptors MUST omit): it
registers exactly the hooks `mapEvent` consumes, applies any wiring-level
filters (dropping high-frequency host traffic before it ever leaves the
process), and forwards each payload as a `{ hook, directory, ... }` wrapper
through the envelope's POST. Payload knowledge therefore stays with the
Provider even in the generated artifact; the engine never names another
runtime's hooks. Status: `configWired` and `bridgePresent` both derive from
that one file (present and carrying the skill-map header marker). Because
the generated plugin is an ES module (`export const …`), the engine also
writes an ESM-pinning sibling `package.json` (`{ "type": "module" }`) next
to it so the runtime loads it cleanly whatever the host project's module
type is (the ESM counterpart of the spawned bridge's CommonJS-pinning
`package.json`), but ONLY when the plugin dir has no `package.json`: that
dir is the vendor's territory, shared with its own plugins, so a
vendor-authored one is never clobbered. Uninstall deletes the plugin file
plus that sibling `package.json` when its content is exactly ours, leaving
any vendor file untouched.

## `serve.json` (server discovery file)

The bridge is a short-lived process with no channel to the long-running `sm serve`;
it discovers the server through `<scopeRoot>/.skill-map/serve.json`, written by the
`serve` verb. Shape: [`schemas/serve-info.schema.json`](./schemas/serve-info.schema.json).

- **Lifecycle**: written atomically right after the listener binds (it records the
  RESOLVED host/port actually bound, plus `pid`, `scopeRoot`, `startedAt`,
  `smVersion`, and the per-session `token`); deleted on shutdown. A hard kill
  (SIGKILL) cannot clean up, so a stale file may remain: readers MUST fail open
  (see §Bridge contract). A new server overwrites any stale file on boot.
- **It is a runtime artifact, not user config** (lockfile-like). It is gitignored
  (listed in the scope ignore file, [`cli-contract.md` §Scope ignore
  file](./cli-contract.md)) and never committed. The place to CONFIGURE
  host/port is the project config; `serve.json` publishes the resolved outcome.
- **Token**: a random per-session secret minted at boot. Readers present it on
  every ingest request (§Ingest). It rotates on every server restart. Because the
  file is project-local and gitignored, only co-located local processes can read it.

## Bridge contract

The bridge is the artifact `sm activity install <provider>` wires into the
provider's hook config (a zero-dependency CommonJS script spawned per event, or an
in-process plugin file for `plugin-file` providers). Because a bare `.js` inherits
the nearest `package.json`'s module type, the installer writes a sibling
`package.json` pinning `{"type": "commonjs"}` next to the bridge so it parses as
CommonJS even inside an ESM host project. Normative behavior:

1. Derive its scope root from its OWN installed location (`../..` from the
   bridge script). Never from the spawn cwd: runtimes disagree about it
   (Claude spawns hook commands at the project root; Antigravity at the hook
   config's own directory, live-verified 2026-07-04), and the bridge's
   physical location already identifies the project it was installed into.
2. Read `<scopeRoot>/.skill-map/serve.json`. Missing or unparseable: exit
   silently. Verify the file's `scopeRoot` equals the derived root. Mismatch:
   exit silently (a hook firing in project A must never reach project B's
   server).
3. Verify `host` is loopback (`127.0.0.1`, `::1`, `localhost`). Non-loopback: exit
   silently (a tampered `serve.json` must not exfiltrate events to a remote host).
4. Forward the provider's raw event (stdin for spawned bridges) verbatim to
   `POST http://<host>:<port>/api/activity` with the provider id and the token.
   No mapping, no filtering, no interpretation: the bridge stays dumb so all
   payload knowledge lives in exactly one place (the provider's `mapEvent`).
5. **Invisibility invariants (HARD)**: the bridge ALWAYS exits `0`, ALWAYS keeps
   stdout EMPTY, and emits at most one short warning line to stderr. Provider
   runtimes interpret hook exit codes and stdout as control flow (deny/allow
   decisions); a bridge that breaks these invariants can block or alter the
   operator's session. Every failure path (no server, refused connection, bad
   JSON, timeout) is a silent no-op. Activity is best-effort by design.
6. **It is a generated per-machine artifact, never committed.** The installer
   owns `<scopeRoot>/.skill-map/activity/` end to end (bridge + sibling
   `package.json`), regenerates it on every install, and the directory is
   listed in the scope ignore file ([`cli-contract.md` §Scope ignore
   file](./cli-contract.md)) so it stays out of the shared repo. A committed
   bridge would go stale against the implementation that generated it, and a
   teammate who never ran the installer would inherit hook wiring pointing at
   a script their checkout does not have.

## Ingest: `POST /api/activity`

Served by the BFF, loopback-gated like every `/api/*` route, plus token-gated:

- **Request**: `{ "provider": "<provider-id>", "event": <raw provider payload> }`
  with the serve.json token in the `x-skill-map-token` header. An optional
  `agentEndpoint` (string) sibling is tolerated and ignored: it fed the removed
  agent doorbell (`job-lifecycle.md` §Blocking claim, removal note), and plugins
  generated before the removal still stamp it on every event; rejecting it would
  silence their activity until reinstall.
- **Responses**: `202` accepted with `{ "ok": true, "resolved": <n>, "spawns":
  <n> }` (also when the event maps to nothing; the bridge never needs the
  outcome), `403` on missing/mismatched token (before any body processing),
  `400` on malformed body shape.
- The handler resolves the Provider by id, calls its `mapEvent(raw)`, resolves
  `(kind, name)` against the scanned node set, feeds each resolved signal to the
  execution-stats accumulator (§Execution stats), and broadcasts one
  `node.activity` WS event per resolved signal (stats-enriched) plus one
  `agent.spawn` event per spawn relation (§WS event: `agent.spawn`). Spawn
  conversation content reaches the conversation store ONLY while the capture
  gate is on (§Conversation capture). The raw event is then discarded.
- **Observability log**: each ingest emits ONE diagnostic line through the
  server logger so an operator debugging a Provider's wiring (`sm serve
  --log-level info`) can tell whether a hook fired and where it ended up,
  instead of the otherwise-silent `202` short-circuits. The line names the
  Provider id, a sanitized hook-type discriminator (see the Privacy bullet),
  and the coarse outcome: `resolved` (with the activity / spawn counts),
  `no-signals` (`mapEvent` disclaimed), `no-nodes` (nothing scanned yet), or
  `unresolved` (signals produced, none matched a node), all at INFO; the hard
  drop `no-provider` (no registered Provider with that id and an `activity`
  adapter, i.e. untrusted / disabled / unknown) and a token mismatch log at
  WARN so they surface at the default level. No further body field is logged.
- **Privacy**: the raw event may contain prompts, command text, and file contents.
  The route's request body is excluded from error reporting (Sentry), access logs,
  and error messages. The only body-derived value the observability log may emit
  is a single sanitized, length-capped hook-type discriminator (a fixed vendor
  event name such as `PreToolUse` / `command.execute.before`, read from a
  closed key allow-list: `hook_event_name`, `hook`, `type`), never any content
  field. Nothing beyond the minimal WS payload leaves the process, and nothing
  ever leaves the machine (see §Privacy).

## Wiring self-test

Every failure mode in the chain above is SILENT by construction. The bridge's
invisibility invariants forbid it from reporting anything (§Bridge contract),
the ingest answers `202` even when nothing resolves, and the install-state
report is pure disk state: hook entries present plus bridge artifact present
reads `installed` whether or not a single event has ever arrived. An operator
whose bridge crashes on every invocation, whose server is down, or whose
`serve.json` is stale therefore sees a green check and a dark map, with no
surface that disagrees. The self-test is the surface that disagrees: it sends
one synthetic event through the REAL installed bridge and asks the server
whether it arrived.

**Probe payload**. A raw event carrying the string field `__skillMapProbe` is a
probe, not a provider event. The double-underscore camelCase key cannot collide
with a vendor payload (every runtime in §Per-provider signal notes uses
snake_case or lowercase dotted keys), so the discriminator needs no
provider-specific knowledge.

**Ingest short-circuit (normative)**. `POST /api/activity` MUST test for
`__skillMapProbe` AFTER the token gate and body validation but BEFORE resolving
the Provider, and on a match MUST record the nonce and return `202` without
calling `mapEvent`, without touching the stats accumulator, the owner index or
the conversation store, and without broadcasting any WS frame. A probe is
therefore observable only through the endpoint below: it can never light a node,
count as an execution, or appear in the map. Recording is boot-scoped and
bounded (a ring of at most 64 nonces, oldest evicted); nothing persists.
Passing through the token gate is deliberate, it makes the self-test cover the
`serve.json` token path exactly as a real event does.

### `GET /api/activity/probe?nonce=<nonce>`

Loopback-gated, no token (operator surface, like the install probe). Returns
`{ "nonce": "<nonce>", "seen": boolean, "at": <epoch-ms> | null }`. `seen` is
`true` only when an ingest recorded that exact nonce since the server booted.
A missing or empty `nonce` param → `400` `bad-query`. Read-only: reporting a
nonce never consumes or clears it.

**What the self-test proves** (`sm activity status --verify`,
[`cli-contract.md` §Activity](./cli-contract.md)): that the installed bridge
executes under the local Node runtime (the module-type trap in §Bridge contract
is the archetype), derives its scope root correctly, finds and parses
`serve.json`, passes its own scope + loopback + port gates, authenticates with
the session token, reaches a listening server, and that the server accepted the
event. The wiring half is already covered by the reported install state: a hook
entry counts as wired only when its command string CONTAINS the installed
bridge's scope-relative path, so a config pointing somewhere else reads
`not installed` / `partial` and the self-test reports that instead of probing.

**What it does NOT prove**: that the provider runtime actually spawns the hook.
No local test can establish that (it depends on the runtime's own settings
discovery, trust model, and matcher evaluation), so the self-test MUST NOT claim
a working end-to-end wiring, only that everything downstream of the spawn works.

**Security (normative)**. The self-test MUST spawn the bridge at the path the
implementation composes itself (`<scopeRoot>/.skill-map/activity/bridge.js`) and
MUST NOT execute the command string read from the provider's hook config. That
file is operator territory skill-map does not own and, under clone-and-scan,
is authored by whoever wrote the repository: executing a string from it would
turn a diagnostic verb into arbitrary code execution on checkout. The wired
command is compared as TEXT and never run.

## Mapper digest

The self-test above proves the TRANSPORT half of the chain and, by the
short-circuit it depends on, is structurally incapable of proving the MAPPING
half: a probe never reaches `mapEvent`, so a Provider whose adapter disclaims
every real payload passes the self-test with a green check. That gap is not
hypothetical. An adapter cloned from another Provider inherits the donor's
payload VOCABULARY (its tool names, its `tool_input` key names) as a hidden
dependency; where the two runtimes disagree, the mapper is total by contract
(§The `provider.activity` capability) and disclaims silently, so every
checkpoint an operator can reach reports success while 100% of events are
dropped. The install state reads `installed`, the bridge exits 0, the ingest
answers `202`, and the map stays dark.

The digest is the surface that disagrees. It costs no new capture: the ingest
already computes the outcome that drives its observability log (§Ingest), and
this accumulates the same discriminator instead of letting it die with the log
line.

**What is recorded (normative)**. On every ingest whose outcome is NOT
`resolved`, the server MUST record one entry keyed by the event's SHAPE, and
MUST count it per Provider alongside the total received and the total resolved.
The shape is:

- `outcome`, the ingest outcome verbatim (`no-provider`, `no-signals`,
  `no-nodes`, `unresolved`).
- `hook`, the hook-type discriminator, resolved exactly as the ingest log
  resolves it.
- `tool`, the invoking tool name when the payload names one.
- `keys`, the KEY NAMES reachable in the payload, to a depth of two, as
  dotted paths (`tool_input.path`, `toolCall.args.AbsolutePath`).

Entries with an identical shape MUST collapse into one, carrying an occurrence
count and the last arrival timestamp. The store is boot-scoped and bounded (at
most 32 distinct shapes per server, oldest evicted); nothing persists, nothing
broadcasts, and a digest entry never lights a node or counts as an execution.

**Privacy (normative)**. The digest records SCHEMA, never CONTENT. No value of
any payload field may be recorded except the two vendor discriminators the
ingest log is already permitted to log (`hook` and `tool`), and those are
sanitized and length-capped as it caps them. Key names are recorded, values are
not; arrays are not descended into; the key count and each key's length are
capped so a payload that keys an object by user data cannot turn the digest into
a content channel. The digest is readable only over the loopback route below.

### `GET /api/activity/disclaimed`

Loopback-gated, no token (operator surface, same posture as the probe
readback). Optional `provider=<id>` narrows the report to one Provider; an
unknown id reports it with zero counters rather than erroring, because "this
Provider has received nothing" is the answer the caller asked for. Returns:

```json
{
  "providers": [
    {
      "id": "<provider-id>",
      "received": 47,
      "resolved": 0,
      "shapes": [
        {
          "outcome": "no-signals",
          "hook": "PreToolUse",
          "tool": "read",
          "keys": ["hook_event_name", "tool_name", "tool_input.path", "tool_input.offset"],
          "count": 31,
          "lastAt": 1755561600000
        }
      ]
    }
  ]
}
```

`tool` is omitted when the payload names none; `shapes` is ordered by `count`
descending. Read-only: reporting never clears the digest.

**What the digest proves**. That events ARE arriving from the runtime (the one
thing the self-test explicitly cannot establish, §Wiring self-test), and what
the adapter did with them. A Provider reporting `received > 0` with
`resolved: 0` has a live runtime and a broken mapper, and the recorded `keys`
name the vocabulary the adapter was handed, which is the vocabulary it must be
read against (§Per-provider signal notes carries the per-provider table to read
them against).

**What it does NOT prove**. That a disclaimed shape is a DEFECT. Disclaiming is
the contract for everything a Provider deliberately ignores: a non-`.md` read,
a path outside the scope root, an unmapped tool. A digest with entries next to a
non-zero `resolved` is a healthy adapter doing its filter-first job, which is
why the CLI surfaces it only in the unambiguous case (below) and leaves the full
report to `--json`.

## Install management over HTTP

The same install / uninstall operations the CLI verbs expose (`sm activity
install|uninstall <provider>`, [`cli-contract.md` §Activity](./cli-contract.md))
are served by the BFF so the SPA can wire a provider without leaving the
browser. All three routes are loopback-gated like every `/api/*` route; they do
NOT take the serve.json token (that token authenticates the bridge's ingest
path, not the operator's own UI).

The server resolves the provider against its FULL registry (built-ins plus
loaded drop-in plugins), a superset of the CLI verbs' built-ins-only set; a
drop-in provider declaring `activity` is therefore installable from the SPA.

### `GET /api/activity/install?provider=<id>`

Install status probe. Response `200`:

```json
{
  "provider": "claude",
  "supported": true,
  "installed": true,
  "configPath": ".claude/settings.json",
  "configWired": true,
  "bridgePresent": true,
  "events": 5,
  "shellOptIn": true
}
```

- `supported`: the provider declares `activity` with an implemented install
  kind (`json-hooks` today). When `false`, every other field degrades
  (`installed: false`, `configPath: null`, `events: 0`).
- `configWired`: the provider's hook config carries at least one skill-map
  bridge entry (detected by the bridge-path marker, §Bridge contract).
- `bridgePresent`: the bridge script exists on disk.
- `installed`: `configWired && bridgePresent`. A half-installed state (bridge
  deleted by hand, config hand-edited) reports `false`; a fresh install repairs
  both halves.
- `events`: how many hook events the descriptor wires.
- `shellOptIn`: the provider's descriptor carries the shell opt-in event
  (§Capture level rung 5), i.e. the `--shell` / `shellCapture` opt-in writers
  accept it. The UI conditions its shell-unlock affordances on this instead of
  hardcoding a provider list.
- Unknown provider id: `404`. Missing `provider` query param: `400`.

### `POST /api/activity/install` / `POST /api/activity/uninstall`

Body: `{ "provider": "<id>", "confirm": true }`.

- **Consent gate (normative)**: both verbs modify the operator's project files
  (the provider's own hook config plus `.skill-map/activity/`). Without
  `confirm: true` the server MUST refuse with `412` (`confirm-required`) and
  MUST NOT touch any file. The SPA surfaces the refusal as an explicit consent
  dialog and retries with `confirm: true`. This is the HTTP analogue of the CLI
  install prompt; note it is deliberately STRICTER than the CLI on uninstall
  (the CLI uninstall does not prompt).
- Semantics are identical to the CLI verbs: install refreshes the wiring
  (remove-then-merge, so a changed descriptor propagates) and (re)writes the
  bridge + its sibling `package.json`; uninstall removes exactly the marked
  entries (operator hooks untouched) and is idempotent (`removed: false` when
  nothing was wired). The bridge artifact under `.skill-map/activity/` is
  SHARED across `json-hooks` providers: uninstall deletes it only when no
  OTHER such provider's config remains wired (mirroring
  [`cli-contract.md` §Activity](./cli-contract.md): "delete the bridge
  artifact when no installed provider references it anymore"); a
  `plugin-file` uninstall never touches it.
- Response `200`: the refreshed status envelope (uninstall adds `removed`).
- Unknown provider id: `404`. Provider without `activity` or with an
  unimplemented install kind: `400`.

## WS event: `node.activity`

Broadcast over `/ws` in the common envelope of
[`job-events.md` §Common envelope](./job-events.md) (experimental non-job family):

```json
{
  "type": "node.activity",
  "timestamp": 1730000000000,
  "data": {
    "nodePath": ".claude/skills/deploy/SKILL.md",
    "phase": "start",
    "owner": "main"
  }
}
```

- `nodePath`: the resolved scanned node's stable id (its `path`).
- `phase`: `"start" | "end"`. Providers with no native end signal for a unit (a
  Claude skill has none) simply never emit `end` for it; the UI owns span decay.
- `owner`: opaque identifier of the executing context (a sessionized main key
  like `main:<session_id>`, an agent id, an agent type, a session/conversation
  id, provider-dependent; providers whose payloads carry no session id fall
  back to the bare `"main"` literal). Consumers treat it as an opaque grouping
  key and MUST NOT parse it; structural discriminators (like a missing
  `parentNodePath` on `agent.spawn` frames) carry the semantics instead.
- `detail` (optional): a finer-grained human-readable label for the frame beneath
  the node itself, e.g. the specific MCP tool invoked (`notion-create-pages`) on
  an `mcp://<server>` node. Metadata only, never used for resolution; the UI
  renders it as a transient label on the node's glow AND appends it to the node's
  recent history (§Execution stats, per-node `recent` ring, so the inspector
  stacks the tool call log). Absent when the provider mapped no finer detail.
  Emitted by the Provider's `mapEvent` as the optional `IActivitySignal.detail`
  and forwarded verbatim by the resolver. Beyond MCP invocations, providers MAY
  carry the literal invoking tool name on UNIT and resource `start` frames (the
  raw name from the hook payload, unnormalized: Claude `Skill` / `Read` /
  `Write` / `Edit` / `Agent`, Codex `spawn_agent`, Antigravity `view_file`,
  opencode `skill` / `read` / `write` / `edit`; opencode's `task` spawn emits
  the relation-only form, which lights
  no node and so carries no detail), so clients can label WHICH tool lit a
  node. Because
  `detail` presence no longer implies an MCP invocation, clients MUST gate
  invocation-edge rendering on the target node path's `mcp://` prefix (or the
  `access: "mcp"` classifier where available), never on `detail` presence
  alone; unit detail renders as a transient badge on the executing card that
  decays with the glow.
- `access` (optional): classifies a RESOURCE frame, `"mcp"` when the node is an
  `mcp://` server (a tool call), `"read"` when it is a file a unit read,
  `"write"` when the unit wrote / edited it (2026-08-17, the capture-level
  ladder's third rung), or `"shell"` for a HEURISTIC path sighting parsed
  out of a shell command (the ladder's fifth rung; folds as `reads` since
  2026-08-30). Absent on a UNIT's own execution (a skill / agent /
  command start). The resolver derives the resource-vs-unit split from the
  signal SHAPE, a PATH signal is a resource access, a NAME signal (`kind` +
  `name`) is a unit execution, so a unit reading another unit's file still
  classifies as a `read`, not an execution of it; the read-vs-write split
  comes from the ADAPTER, which may stamp `access: "write"` on a path
  signal for its vendor's write-shaped tools (Claude `Write` / `Edit`,
  opencode `write` / `edit`, Codex `apply_patch`, Antigravity
  `write_to_file` / `replace_file_content`, ...), the resolver
  defaulting anything unstamped and non-`mcp://` to `"read"`. It drives caller attribution and
  the typed recent log (below).
- `ownerScope` (optional, only on `phase: "end"`): `true` when the signal marks
  the END OF THE OWNER'S WHOLE EXECUTION CONTEXT (a subagent terminating), not
  just of the named node. Consumers then release EVERY claim held by that
  `owner`, so the units the context lit along the way (the skills it invoked,
  the markdowns it read) go dark with it instead of waiting out their decay.
  On the node-less OWNER-RELEASE form (a context end with no node to hang it
  on, e.g. an Antigravity conversation going idle) the envelope carries NO
  `nodePath` at all; `owner` + `ownerScope: true` + `phase: "end"` are then
  all REQUIRED.
- `session` (optional): the session id the frame's `owner` belongs to.
  Consumers build an `owner -> session` map from frames that carry both, so a
  later `sessionScope` end can release the whole session together. Absent when
  the runtime reports no session id.
- `sessionScope` (optional, only on `phase: "end"`): `true` on a node-less
  SESSION-RELEASE form (a runtime's turn ended): the envelope carries NO
  `nodePath` and NO `owner`, and consumers release EVERY owner grouped under
  `session` (which is then REQUIRED). It is the safety net for runtimes that
  DROP a subagent's own `ownerScope` end: Codex (live-verified 2026-07-24)
  never fires a subagent's `SubagentStop` when that subagent itself spawns a
  nested worker, so only the main-context `Stop` unwinds the leaked subagent,
  which it does by releasing the session. The sticky decay stays the ultimate
  backstop; the session release just heals the leak at turn end instead of
  minutes later.
- `terminal` (optional, only on the `ownerScope` end form): `true` when that end
  is UNAMBIGUOUSLY FINAL for the spawns the owner PARENTS, not only for those
  where it is the child. Stamped by the resolver from the Provider's declared
  `activity.spawnCustody` (§Spawn custody): a `blocking` runtime holds the
  parent inside the spawn call, so a parent that reports idle cannot have a
  child still running. Consumers then release both sides of every relation that
  owner participates in, INSTEAD of applying the pause-is-not-end rule. Absent
  on `napping` runtimes, where the same frame may mean the parent is merely
  awaiting its own spawn. It is what clears a relation whose completion never
  arrives: a REFUSED or crashed spawn call fires its start and no end, and
  without a terminal release it stays drawn until the decay sweep.
- `turnEnd` (optional, only on `phase: "end"`): `true` on a node-less
  TURN-END form: the envelope carries `owner` and NO `nodePath`, and marks
  that the owner's TURN completed (`napping` runtimes whose main context
  reports a real turn boundary, e.g. Claude's main-context `Stop`). A sync
  spawn call cannot outlive its caller's turn, so consumers release every
  relation that owner PARENTS whose child identity never materialized (no
  `childOwner`), the shape an INTERRUPTED or failed spawn call leaves behind
  (its completion hook never fires, so no `end` frame ever comes). Relations
  with a live `childOwner` (async children keep running past the turn) and
  the owner's node claims are deliberately untouched: this is a spawn-custody
  sweep, not an `ownerScope` release (node-claim clears keep their decay
  contract). Sibling of `terminal`, for runtimes where the parent CAN nap so
  a blanket terminal would lie.
- `sticky` (optional, only on `phase: "start"`): `true` for LIFECYCLE claims
  (an agent's own span, a parent held lit by a running child). Consumers give
  sticky claims a much longer decay window than momentary usage claims: they
  are meant to end via `ownerScope` ends, the long window is only a safety net
  against a crashed runtime that never sends one.
- `keepAlive` (optional, only on `phase: "start"`): `true` for CUSTODY claims
  (the parent-custody mechanism below). Keep-alive starts light and refresh
  nodes like any other start but are excluded from execution counting
  (§Execution stats), and SHOULD NOT trigger "executed" affordances.
- `stats` (optional, only on node-attributed frames): the node's current
  execution stats `{ count, lastStartAt, lastOwner?, distinctOwners,
  toolUses?, tokens?, summarizedRuns? }` as accumulated server-side
  (§Execution stats). The server is the single source
  of truth: clients MUST overwrite from this field (and from the summary
  snapshot), never accumulate counts themselves.

Consumers SHOULD also treat any owned signal as a HEARTBEAT: every arriving
signal with `owner` X refreshes the decay window of every claim X already
holds, so an actively-working context never times out mid-run.

**Pause is not end (parent custody).** Some runtimes emit their subagent-stop
event when an agent merely PAUSES awaiting a child (Claude fires `SubagentStop`
on pause and a fresh `SubagentStart` on resume; only the last stop is terminal
and nothing marks it as such). Adapters therefore keep the parent lit through
CUSTODY instead of trying to classify stops: the spawn tool-call emits a sticky
claim on the PARENT node owned first by a synthetic spawn key and then by the
CHILD's id, so as long as the child runs (and heartbeats), the parent stays
lit even while "stopped"; the child's terminal owner-scoped end releases the
parent claim, and the unwind proceeds bottom-up.

Custody MUST only pass to a child that is STILL RUNNING when the spawn's
completion event arrives (Claude: `tool_response.status === 'async_launched'`).
Runtimes also deliver the spawn's completion AFTER the child's terminal stop
(observed live: `status: 'completed'` arriving ~66ms after the child's
terminal `SubagentStop`); handing custody to an already-terminated child
creates a claim whose release cascade has ALREADY passed, an orphan that pins
the parent lit until the sticky window lapses. In the completed case,
releasing the synthetic spawn key IS the end of custody: the parent's own
lifecycle claim (its `SubagentStart`) carries it until its own terminal stop.

## WS event: `agent.spawn`

Broadcast over `/ws` in the same common envelope (experimental non-job family).
One frame per spawn relation reported by a provider signal (§capability,
`spawn` block). Frames are STATELESS and self-contained: the server keeps no
spawn registry, so parent fields repeat on every frame and consumers correlate
by `spawnId`.

```json
{
  "type": "agent.spawn",
  "timestamp": 1730000000000,
  "data": {
    "spawnId": "toolu_01MEQBSdHNo3B9pMjY8s7ZQK",
    "phase": "start",
    "parentOwner": "main:6cfe5636-2e56-4271-91a6-87fc3d4355be",
    "childKind": "agent",
    "childName": "demo-worker",
    "childNodePath": ".claude/agents/demo-worker.md"
  }
}
```

- `spawnId`: opaque per-spawn correlation id (the spawning tool call's id).
- `phase`: `"start"` at the spawn call; `"handoff"` when an async child's own
  owner id becomes known (`childOwner` present from then on); `"end"` when the
  spawn completed with no live child (sync spawns, or a completion arriving
  after the child already stopped).
- `parentOwner`: owner key of the spawning context. `parentNodePath`
  (optional): the scanned parent agent's node path; ABSENT when the spawner is
  a session running no scanned node. That absence is the structural
  discriminator for session parents; consumers never parse owner strings. When
  the signal itself names no parent, the server may still fill it, see
  §Spawn parent anchoring.
- `childKind` / `childName`: the child unit as the runtime named it.
  `childNodePath` is present when the name resolved against the scanned node
  set. An unresolved child (typically a runtime built-in sub-agent with no
  file on disk) is still emitted name-only: no scanned node exists to target,
  so instead of dropping the relation a consumer MAY materialize an
  **ephemeral agent capsule**, a presentation-only anchor labelled with
  `childName`, aggregated per (parent anchor, `childName`) with a live-run
  count. The capsule is never a graph node: it enters no layout, no
  persistence, and no pair accumulator (§Execution stats counts only
  resolved children); it appears with the first live relation that needs it
  and releases with the last, exactly like the session anchors. No advance
  catalog of vendor sub-agent names is required or wanted: the capsule is
  driven entirely by the name the runtime reported at spawn time, so a
  vendor adding or renaming built-ins needs no change anywhere.
- `childOwner`: the child context's own owner id, present from `"handoff"` on.
- `pairCount` (optional): the accumulated spawn count for this parent-child
  pair (§Execution stats), present on frames whose pair is counted. Clients
  overwrite, never accumulate.
- Conversation content (`prompt` / `response`) NEVER rides this event; it is
  served on demand under the capture gate (§Conversation capture).

Edge lifetime is UI-owned, mirroring custody: draw at `"start"`, consolidate
at `"handoff"`, release on the explicit `"end"` frame OR on the
`node.activity` owner-scoped end whose `owner` equals `childOwner`, OR (for
a relation whose child identity never materialized) on the parent's
`turnEnd` frame (§WS event: `node.activity`), with the sticky decay window
as the crash safety net. Liveness heartbeats (any activity signal from an
owner refreshing the decay of the relations it participates in) apply from
the CHILD side, and from the parent side only for relations with a known
live `childOwner`: while a sync spawn genuinely runs its parent is blocked
or napping and emits nothing, so a parent-side heartbeat on a
`childOwner`-less relation can only be post-mortem activity and MUST NOT
refresh it, else an interrupted spawn is kept alive by the very session
that abandoned it.

Session-anchor placement is presentation-owned too (informative): a consumer
SHOULD float the session anchor above the agents the session runs (the
centroid of its visible spawn targets), so the cluster reads next to the
work it drives; a session with only unresolved children (capsules, no
scanned targets) MAY hover above the visible graph instead. An earlier
revision docked session anchors beside the project-instructions card
(`AGENTS.md` / `CLAUDE.md`); that affinity was retired after live use, the
cluster parked away from the agents actually running. Placement is never a
wire relation: the runtime reports no signal for auto-loaded context, and
pair stats never key off any placement choice.

### Spawn custody

A Provider declares how its runtime holds custody while a child runs, through
the manifest field `activity.spawnCustody`
([`provider.schema.json`](./schemas/extensions/provider.schema.json#/properties/activity)):

- `napping` (the default, omit it): the parent MAY report idle while its child
  works, so an owner-scoped end from a parent is AMBIGUOUS. Consumers apply
  the pause-is-not-end rule: while that owner still parents a live relation the
  end counts as a liveness refresh, and the release waits for the terminal end
  that arrives once the whole descendant chain unwound. Claude's shape.
- `blocking`: the parent BLOCKS inside the spawn call and cannot report idle
  mid-spawn, so an owner-scoped end from it is final. The resolver stamps
  `terminal: true` on that owner-release frame (§WS event: `node.activity`) and
  consumers release both sides of every relation the owner participates in.
  OpenCode's shape.

The distinction is not cosmetic: on a `blocking` runtime it is the ONLY signal
that clears a relation whose completion never arrives. A spawn call the runtime
REFUSES (OpenCode caps delegation at one hop and rejects a `task` issued from
inside a subagent) fires its start hook and never its completion hook, so the
relation would otherwise stay drawn until the client's decay sweep, minutes
after everything went quiet.

### Spawn parent anchoring

Some runtimes report a spawn without naming its parent unit: OpenCode's `task`
event carries only the spawning session id. The relation then arrives in the
relation-only form and consumers anchor it on a synthetic session capsule, one
per spawning session, which reads as a floating edge while the parent agent
glows elsewhere on the map.

The server closes that gap with a boot-scoped `owner -> agent node` index, fed
by the two places the association is already reported: a NAME signal resolving
to an `agent`-kind node (the owner is running that agent) and a completed
relation's `childOwner` + resolved child node (that owner ran that agent). When
a spawn arrives with no parent of its own, the resolver stamps `parentNodePath`
from the index, so the edge hangs off the real agent node. The index holds one
path per owner, never content, is dropped when the owner's context ends, and is
bounded; the session capsule remains the fallback for an owner running no
scanned node (a runtime built-in with no file on disk, a bare main context).
Anchoring is a server-side ENRICHMENT of the same wire field: consumers see a
normal `parentNodePath` and need no new rule.

## Execution stats

The BFF accumulates per-node execution stats in memory as the hot path and CHECKPOINTS them into the project DB (`state_activity_stats` / `state_activity_pairs`, [`db-schema.md`](./db-schema.md) §state_activity_stats): every mutation marks its node / pair dirty and a short debounce upserts the dirty rows, best-effort (no DB, or a DB that predates the tables, means memory only, the previous behaviour). At boot the accumulator hydrates from those rows, so counts, the recent log, the aggregates and the pair counters survive `sm serve` restarts and a replay of an older recording still shows what executed (user decision 2026-08-29: the map must show everything that ran, not only what ran since the last boot). The sticky dedupe memory and the caller correlation stay in memory (a runtime resuming after a restart counts once more, like a fresh instance). The summary's `since` is the earliest first-sighting stamp among persisted nodes, the boot time while the store is empty. Counting semantics (normative):

- Only node-attributed `phase: "start"` signals count. Ends, owner releases
  and relation-only signals never mutate stats.
- `keepAlive: true` starts NEVER count: custody is not an execution.
- `sticky: true` starts count ONCE per `(nodePath, owner)` pair for the
  process lifetime. Runtimes re-emit lifecycle starts on pause/resume with the
  SAME owner id, and a resume is not a new execution; a fresh instance has a
  fresh owner id and counts again. The dedupe memory is append-only (owners
  are not forgotten on `ownerScope` ends, or every pause/resume cycle would
  recount).
- `access: "shell"` starts COUNT like any other resource access (user decision 2026-08-30, reversing the 2026-08-18 no-count rule): the execution pill on the node card is the only per-node counter the map shows, and a node named by a shell command that never counted stayed invisible there while the inspector listed the sighting, a split the operator read as a defect. The entry still lands in the typed recent log (below) tagged `kind: "shell"`, so the inspector tells a shell sighting apart from a read, and the frame rides WITH the node's updated `stats` like every counted start. The same decision admits the class as evidence in the observed-relations fold, where a sighting folds as `reads` (§Session journal, Consumption): the command named the file, and the analyzer gates absorb the heuristic noise. Custody `keepAlive` starts keep riding bare (they log nothing).
- All other starts (skill invocations, command expansions, markdown reads)
  count on every signal.

Per node the accumulator keeps `count`, `lastStartAt` (unix ms), `lastOwner`,
the distinct-owner count, and a short ring of recent executions
(`{ at, owner, detail?, caller?, target?, kind? }`, most recent first). A
RESOURCE access (a tool call or a file read, `access` set on the frame) is
written to BOTH ends: the resource node's entry carries `caller` (the unit that
accessed it) and the unit's own mirrored entry carries `target` (the accessed
node), both tagged with `kind` (`"mcp"` | `"read"` | `"write"` | `"shell"`)
and, for an mcp call, the `detail` tool (for a read or write, `detail` is the
provider's literal tool name when the adapter carries one, e.g. `Read` /
`view_file` / `Write`; for a shell sighting it is the shell tool, e.g. `Bash`). So the inspector
shows, from either side, who accessed what and of which type. A unit's own
execution carries none of these except an optional `detail` naming the literal
invoking tool (e.g. `Skill`, `spawn_agent`, `task`). All sets and rings are bounded; hitting a bound saturates or evicts
oldest entries, it never errors.

Per-node stats gain OPTIONAL execution aggregates when spawn completions
carry a summary (agent nodes, sync spawns): `toolUses` and `tokens` sum the
reported totals across summarized runs, and `summarizedRuns` says how many
runs contributed (so consumers can contextualize the sums). Nodes that never
received a summary (skills, markdowns, async-only agents) simply omit them.

The accumulator ALSO keeps per-PAIR spawn counters (metadata, independent of
the capture gate): every `agent.spawn` relation with `phase: "start"` and a
RESOLVED child increments the pair keyed by the parent identity
(`parentNodePath` for agent parents, `parentOwner` for session parents) and
`childNodePath`. Pair entries carry `{ count, lastStartAt }` and feed the edge
conversation-count labels; the pair map is bounded like everything else. The
current pair count rides every broadcast `agent.spawn` frame as `pairCount`
(overwrite semantics: the client never accumulates).

### `GET /api/activity/summary`

Snapshot for client hydration (connect, reconnect, re-enable). Loopback-gated,
no token (operator surface, like §Install management). Response `200`:

```json
{
  "since": 1730000000000,
  "nodes": {
    ".claude/skills/deploy/SKILL.md": {
      "count": 3,
      "lastStartAt": 1730000001234,
      "lastOwner": "main:6cfe5636-2e56-4271-91a6-87fc3d4355be",
      "distinctOwners": 2
    }
  },
  "runNodes": [".claude/agents/architect.md"]
}
```

The response also carries the per-pair spawn counters under `"pairs"`, keyed
`"<parent>>><childNodePath>"` (the same separator-free identities the
accumulator uses), each `{ "count": <n>, "lastStartAt": <ms> }`, so edge
labels hydrate together with the node counters.

It ALSO carries `"runNodes"`: the distinct node paths holding persistent
AI-run history (`state_executions` rows, any status). The boot-scoped
counters reset on every server restart but the DB history does not, so
without this list a client that derives Activity visibility from the
counters would hide a node's recorded runs until fresh runtime activity
happens to touch it. Read per request from the project DB; a missing DB
degrades to `[]` (the runtime half still answers).

Stats-only by design otherwise: the summary carries NO live claim or spawn
state. Live lighting and spawn edges rebuild from the WS stream as events
arrive; clients treat both this snapshot and the WS `stats` / `pairCount`
fields as overwrites from the single server-side source of truth.

### `GET /api/activity/node/<pathB64>`

Per-node detail for inspector surfaces. Response `200`: `{ "stats": { ... },
"recent": [{ "at": <ms>, "owner": "...", "detail"?: "<tool>", "caller"?: "<unit path>", "target"?: "<accessed path>", "kind"?: "mcp" | "read" | "write" | "shell" }], "spawns": [ ... ],
"captureEnabled": <bool>, "runs": [ ... ] }`, where `spawns` lists the RETAINED spawn records
touching the node (as parent or child). Records exist only while the capture
gate is on (§Conversation capture): with the gate off the list is always
empty, and live spawn metadata remains available only on the `agent.spawn` WS
stream. A scanned node with no recorded activity returns empty stats, not
`404`; an unknown path returns `404`.

`runs` is the OTHER provenance the inspector's Activity timeline interleaves
(user decision 2026-07-17): skill-map's own AI-run history for the node, read
from `state_executions` (persistent, unlike the ephemeral runtime stats
above). Newest-first, capped at 15, each entry
`{ "executionId", "extensionId", "status", "model": <string|null>,
"durationMs": <int|null>, "finishedAt": <ms|null>, "failureReason": <string|null> }`.
A missing DB degrades to `runs: []` without failing the runtime half. The UI
renders the two provenances visually distinguished behind a three-way filter
(all / runtime activity / AI runs) persisted at the INSPECTOR level, not
per node.

### `DELETE /api/activity/node/<pathB64>`

Clears every recorded activity item for one node (the inspector's Activity
clear-all): the persistent AI-run history (every `state_executions` row whose
node list contains the path, the same JSON1 containment the GET's `runs`
filter uses, so the delete removes exactly what the section lists; an
execution recorded against several nodes disappears from all of them), the
node's runtime stats + recent ring (memory AND the persisted `state_activity_stats` row), the pair counters touching the
node as parent or child (memory AND `state_activity_pairs`), and the retained spawn conversations touching the
node. Both halves are machine-generated, regenerable data
([`architecture.md`](./architecture.md) §Storage rule), so there is NO
consent gate and no sidecar touch, the same posture as the summaries /
findings deletes.

Success is `204 No Content`; the client re-fetches (an activity-less node
hides its Activity section). An unknown path or malformed `<pathB64>` answers
`404` `not-found`; a missing DB clears the runtime half anyway and still
answers `204` (mirror of the GET's degradation). The operation logs one
`activity.clear` line ([`cli-contract.md`](./cli-contract.md) §Operations
log). The sticky-dedupe memory is deliberately NOT cleared: a paused runtime
resuming after a clear re-emits its lifecycle start with the same owner id,
and a resume is not new activity, so it must not re-count.

## Conversation capture

The inter-agent conversation halves (the spawn `prompt`, the sync-completion
`response`) are CONTENT, not metadata; retaining them requires explicit
operator consent:

- **Gate**: off by default. The setting lives in the project-local config
  layer (never committed, never `$HOME`). Turning it off clears the store
  immediately.
- **Consent flow**: `POST /api/activity/capture` with body `{ "enabled":
  true|false, "confirm": true }`; without `confirm: true` the server MUST
  refuse with `412` (`confirm-required`) and change nothing, the same gate
  §Install management uses. `GET /api/activity/capture` reports
  `{ "enabled": <bool> }`.
- **Retention bounds**: an in-memory ring of at most 200 spawn records; each
  content field is capped (64 KiB) and truncated with an explicit marker.
  Nothing is persisted; the store dies with the process.
- **Custody (normative)**: the store is reachable ONLY from the BFF
  composition root and the activity routes. It MUST NOT be exposed through the
  kernel, the plugin runtime, any extension context, or the plugin KV API;
  plugins have no supported path to it. Content is excluded from error
  reporting, access logs and error messages (same posture as the ingest body)
  and NEVER rides the WS; it is served only on demand over the loopback-gated
  detail endpoints.
- **Response sources**: the response half arrives through two complementary
  paths, capped and gated identically. A SYNC spawn's completion carries it
  on the spawn relation itself (`response`, extracted from the completion
  payload as a plain string or joined text content blocks). An ASYNC spawn's
  completion carries no content, so the child's boundary-stop `report` (its
  final message, live-verified 2026-07-05: Claude's `SubagentStop` carries
  `last_assistant_message`) attaches to the record by matching `childOwner`.
  Pause stops overwrite harmlessly; the terminal message wins.

### `GET /api/activity/spawns/<spawnId>`

One RETAINED spawn record (the edge-click surface), with its `prompt` /
`response` halves; `captureEnabled` rides every `200` response. Records exist
only while the gate is on, so with the gate off (or after it cleared the
store) the route answers `404`, exactly like an unknown id.

## Session journal

The one durable output of the activity pipeline (decision 2026-08-16, the
carve-out from the ephemerality contract above): while `sm serve` runs, the
BFF groups the RESOLVED frames it broadcasts into runtime sessions and
persists each session as one JSON file under `<scopeRoot>/.skill-map/sessions/`,
shape [`schemas/session-recording.schema.json`](./schemas/session-recording.schema.json).
The journal is simultaneously the server-side activity memory (a session
survives a server restart or a closed page), the export/import format the
recording schema anchors, and the evidence base of the design-vs-reality
evaluation (`sm scan` folds it into observed relations, below). It exists to
evaluate the AUTHORED design, never as an observability log: frames record
WHICH nodes executed and who spawned whom, no latency, no tokens, no content.

- **Capture is a GESTURE, never ambient** (user decision 2026-08-16,
  superseding the always-on capture this section first shipped with):
  frames land in the journal ONLY while the operator is RECORDING. The
  recording state lives server-side (`POST
  /api/activity/sessions/recording`, body `{ "recording": true|false }`,
  response `{ "recording": <effective state> }`; the current state also
  rides the read-back envelope below), toggled by the UI's Record
  session / Stop control together with the client tape, and it SURVIVES
  page reloads: a reopened browser probes the state and resumes its own
  tape capture while the server keeps recording. Boot state is OFF;
  server shutdown finalizes and drops it. Stopping finalizes every
  still-open session (endedAt + operations line each). Honest
  consequence, accepted with the decision: the observed-relations
  evidence (§Consumption) covers only the windows the operator chose to
  record.
- **What is journaled**: exactly the wire payloads of the `node.activity` /
  `agent.spawn` WS events, captured at the SAME post-resolution seam the
  broadcast uses, minus the boot-scoped derived fields (`stats` on
  `node.activity`, `pairCount` on `agent.spawn`), which are regenerable and
  meaningless across boots. The raw provider event is still NEVER persisted,
  and the spawn frame is the metadata-only projection, so the journal is
  content-free by construction (the schema's frame shapes are closed:
  a prompt, argument, or file-content field cannot land on disk even by
  accident). Consent gates are untouched: `activity.captureConversations`
  governs the in-memory conversation store only and nothing content-shaped
  ever reaches a journal file.
- **Session grouping** mirrors the client session index's STRUCTURAL rules: a
  session root owner is the `parentOwner` of any spawn frame whose
  `parentNodePath` is absent (the wire's own session-context discriminator),
  or any activity `owner` never claimed as a `childOwner`; a `childOwner`
  claim attributes an owner to the spawning session, latest claim at or
  before the frame's time winning (the re-spawn rule). The `main:<session_id>`
  prefix and the `session` field are hints only, never parsed further. A
  frame that cannot be attributed lands in the most recent open session,
  else in a dedicated unattributed bucket file (`rootOwner: ""`); the
  journal never guesses. Because the fold is STREAMING (one pass, arrival
  order) while the client index folds the whole tape with lookback, a claim
  can arrive LATE: the parent's and child's hook processes race, so the
  child's first activity may precede the `"handoff"` frame carrying its
  `childOwner`. A late claim therefore ADOPTS any session wrongly rooted at
  the claimed owner: its frames merge into the claiming session in
  chronological order and its file, if one was already flushed, is removed.
  Without adoption every such race splits one conversation into two files.
- **Write cadence**: an in-memory buffer per session, flushed to its file on
  a short debounce (~2s) while frames arrive. **Finalization** stamps
  `endedAt`, appends one `activity.session-write` operations-log line
  ([`cli-contract.md`](./cli-contract.md) §Operations log), and prunes; it
  fires on session release (a `sessionScope` end naming the session, or a
  terminal `ownerScope` end of the session's root owner) and on server
  shutdown for every still-open session. A `turnEnd` does NOT finalize: a
  session spans many turns. Finalization is REOPENABLE within one recording
  window: several providers' release forms mean "everything is idle NOW",
  not "the conversation is over" (codex's per-turn main `Stop`, Antigravity's
  fully-idle `Stop`, opencode's `session.idle`; only Claude's `SessionEnd`
  is a true terminal), so a frame attributed to an already-finalized root
  REOPENS that session onto its same file: same name, frames keep
  appending, `endedAt` re-stamped at the next finalization (each
  finalization is a real write and logs its own operations line). Without
  reopen, every multi-turn conversation on those providers fragments into
  one file per turn. The reopen memory is bounded by the retention file
  count and dies with the recording window: stopping the recording,
  shutdown, and deletion all clear it.
- **Naming**: `<startedAt ISO-8601, colons stripped>-<suffix>.json`, where
  the suffix is the runtime session id when derivable (sanitized to
  `[A-Za-z0-9._-]`) and an 8-char hash of the root owner otherwise. Sortable
  by name, stable per session within a boot.
- **Retention**: bounded by file count and total size, oldest first by
  name, pruned at server boot and at each finalization. Both bounds are
  project-config keys beside the master switch (2026-08-17):
  `activity.journal.maxFiles` (default 50) and
  `activity.journal.maxTotalBytes` (default 20971520, 20 MiB), read once
  at serve boot. Because the journal IS the evidence the observed-*
  volume gates count against, retention defines their window: keep
  `maxFiles` at or above the largest `min-active-sessions` in use, or
  that gate can never be met. Deleting any or all files by hand is
  always safe.
- **Read-back**: `GET /api/activity/sessions` serves the journal for
  client hydration: `{ "schemaVersion": "1", "kind": "activity-sessions",
  "sessions": [<SessionRecording>...], "skipped": [<basename>...],
  "recording": <bool> }` (the live recording state, so a reloaded page
  restores its Record/Stop control),
  files read fresh per request in name order (chronological), each
  AJV-validated against the recording schema with off-shape files
  SKIPPED into `skipped` (the map-views dialect: a broken file never
  takes the list down). Pending in-memory buffers are flushed first, so
  a just-recorded session is visible without waiting out the debounce.
  Loopback-gated, no token (operator surface). This is what lets the
  SPA's Sessions tab list and replay sessions recorded before the page
  opened (or by another browser): the journal is the durable memory,
  the client tape only the current page's.
- **A recording is a session (SPA)**: every press of Record is a new session row, never a continuation of the previous one (user decision 2026-08-29). The journal already writes one file per recording; the SPA lists one row per file (identity: root owner + the file's `startedAt`), and the browser tape stamps every captured frame with its Record gesture so its own fold partitions the same runtime session into one row per gesture, hiding only the journal file of the window it narrates itself. A replay is scoped to that one window, and the deep link names it with `rec=<recording>`.
- **Addressable replay**: the SPA's replay is a deep link, `?replay=<rootOwner>[&rec=<recording>][&agent=<spawnId>][&at=<frame>]` (`rec` is the recording's identity, the journal file's `startedAt` or the tape's Record stamp; absent, the latest recording of that root), resolved once at boot against the client tape and then the journal (one best-effort `GET /api/activity/sessions`; a target neither knows, another machine's journal or a purged session, is ignored silently and the params drop). `at` is the 0-based frame index inside the scoped tape and lands the replay PAUSED on that frame. While a session-scoped replay is on screen the SPA writes the params back (`at` only while paused: a playing replay is a film that starts from the top), and the transport's Copy link hands out that URL. The whole-tape replay has no session identity and is never linkable. The journal is per machine (`.skill-map/` is not committed), so a link travels with the recording file it names.
- **Embedded replay**: `?embed=1` is a boot-only flag (read once with the replay link, never written back) under which the SPA renders the map canvas ALONE: no shell chrome (banners, topbar, view nav, dialogs), no files rail, no inspector, no toolbar, no palettes and no transport bar; the desktop-only viewport guard is skipped too, a bare canvas has nothing that breaks at phone widths. The canvas stays interactive (drag to pan, drag a card, pinch or `Ctrl`/`Cmd`+wheel to zoom) but a plain wheel is left to the page hosting the frame, and a click on a card opens the full SPA on that node (`?path=<node>`) in a new tab instead of an inspector. A replay entered under `embed` LOOPS at a slower beat (1.8 s per frame instead of the transport's 1 s; a framed hero is glanced at, not operated): on the last frame it rewinds and plays again instead of pausing, so the deep link `?embed=1&replay=<rootOwner>` is a self-running film. Under `embed` the lens shows the FULL map instead of the executing set: every card sits in its place from the first frame (the layout is forced to the balanced `network-simplex` arrangement, left to right, whatever the visitor's own layout preference says) and lights up in turn (glow, comets, spawn dash), and the camera stays on the boot fit instead of following the activity. `theme=<id>` (a base `light` / `dark` or an extra theme id) is honoured only together with `embed` and is never persisted: the embed keeps its own storage namespace for project state (positions, viewport) and writes no theme preference, so a framed visit leaves the visitor's own SPA settings untouched. The public site's hero frames `/demo/?embed=1&replay=…` this way.
- **Deletion**: `DELETE /api/activity/sessions` empties the journal in one
  gesture: every session file plus the serve process's open in-memory
  buffers (discarded without finalizing, so a pending debounce flush
  cannot resurrect a wiped file). Answers `204` always (an absent
  directory included) and logs ONE `activity.sessions-clear` operations
  line. Loopback-gated, no token (operator surface). Of the SPA's two
  delete affordances, only the Settings row calls it (together with
  clearing the client tape, behind a confirm that warns the operator the
  observed-relations EVIDENCE, every design-vs-reality analyzer's input,
  goes with it); the replay transport's trash acts on the BROWSER TAPE
  ONLY, journal files untouched (decision 2026-08-17, superseding the
  2026-08-16 erase-as-one: the journal is the accumulated evidence the
  volume gates count on, so the casual replay-cleanup gesture must not
  drain it), and is SCOPED to what the replay narrates: watching one
  tape-held session, it removes that session's frames alone (the row
  re-lists from its journal file, still replayable); an unscoped replay
  keeps the whole-tape clear; a journal-sourced replay shows no trash at
  all, nothing of it lives in the browser. Hand-deleting files stays
  equally safe.
- **Master switch**: `activity.journal.enabled`
  ([`schemas/project-config.schema.json`](./schemas/project-config.schema.json)),
  default `true`, read at serve boot. A NORMAL project-config key, committable
  in the shared `project` layer: the journal is content-free, so this is a
  team preference, not a consent gate (unlike `activity.captureConversations`).
  Off means the journal feature is unavailable for the boot: the recording
  toggle cannot engage (`POST …/recording` answers `recording: false`) and
  nothing is written; existing files are left untouched either way.
- **Failure posture**: fire-and-forget, like the operations log. A journal
  write failure never fails or delays ingest; without a `.skill-map/`
  directory the journal stays silent and writes nothing.
- **Consumption (design-vs-reality)**: at scan time the driving adapter reads
  every journal file (AJV-validating each against the recording schema and
  SKIPPING off-shape files silently, disposable machine data), folds the
  frames into **observed relations**, `(source node, target node)` pairs with
  `relation: invokes` (an MCP tool call correlated to its calling unit by
  owner), `relation: spawns` (a spawn frame carrying both resolved paths), or
  `relation: reads` (an `access: 'read'` frame, or since 2026-08-30 an `access: 'shell'` sighting, the command named the file, correlated to its reading unit
  by owner, the same correlation the invokes class uses; the read path never
  becomes the owner's current unit). The unit correlation is TURN-BOUNDED: a
  `turnEnd` frame clears its owner's current-unit claim, so an access in a
  later turn never attributes to a unit from an earlier one (the journal's
  discrete mirror of the live map's TTL decay; a subagent has no turn
  boundary, everything it touches is its own work for its whole span). The
  fold also produces **observed executions**: per-node
  unit-run counts (a `start` frame naming a node with NO resource access;
  `keepAlive` custody heartbeats do not count, a sticky agent span counts
  once per claim) plus the count of ACTIVE sessions, the distinct recorded
  sessions that produced at least one unit run (the honest denominator for
  "never ran": a recording where nothing executed proves nothing). Both
  products thread to analyzers as `IAnalyzerContext.observedRelations` /
  `IAnalyzerContext.observedExecutions` (absent when the journal is empty).
  Three deterministic analyzers consume them, covering the
  design-vs-reality diff:
  - `core/observed-link-missing` (reality the design lacks) emits one `info`
    issue per observed pair whose source and target both exist in the
    scanned set and that no declared `invokes` / `references` link covers
    (matching on the link's resolved target, falling back to the raw target;
    `mentions` / `points` do not count as declarations of execution). A
    `reads` pair is held to a stricter standard on BOTH sides, because
    reading is routine where executing is deliberate: it only flags past a
    REPETITION gate (at least 3 observed reads of the pair), and a `points`
    link ALSO covers it (a backtick path naming the file already declares
    that the file matters here; only `mentions`, name-only, never covers).
  - `core/observed-link-dead` (design reality never confirms, the
    dead-design detector) emits one `info` issue per declared `invokes` /
    `references` link that reality could have confirmed but never did. Three
    gates keep it honest: the link must be OBSERVABLE, meaning reality had
    an evidence class that could have confirmed it, for an `invokes` link a
    resolved target that is an `mcp://` node or an `agent`-kind node (the
    invokes / spawns classes), and for a `references` link ANY scanned
    target (every scanned node can be read, so the reads class makes all of
    them confirmable; an `invokes` link to a skill or command stays
    unjudged, unit-to-unit execution pairs are not folded); the source must
    have executed at least 3 times across recorded sessions (the VOLUME
    gate: absence of evidence means nothing until the source demonstrably
    ran); and the (source, resolved target) pair must appear in no recorded
    session under ANY relation. Both endpoints must exist in the scanned
    set, and self-links are skipped.
  - `core/observed-node-dead` (the node-level dead-design detector,
    2026-08-17) emits one `info` issue per RUNNABLE node (kind `skill`,
    `agent`, or `command`; docs and virtual nodes never flag, they do not
    execute) that never ran in any recorded session, gated on at least 20
    ACTIVE sessions of accumulated evidence (the volume gate at the node
    grain: "this node never runs" is only worth saying once plenty of
    recorded activity happened around it). `data.target` carries the
    node's own path as the suppression value.
  All three analyzers ship `stability: 'experimental'` (2026-08-17):
  disabled by default while the evidence gates prove themselves in real
  projects, opted into per extension via the Settings toggle or
  `sm plugins enable core/<analyzer>`. Every volume / repetition gate above
  is a per-extension SETTING with the stated value as its default (integer,
  minimum 1): `min-read-observations`
  on `core/observed-link-missing` (default 3), `min-source-runs` on
  `core/observed-link-dead` (default 3), and `min-active-sessions` on
  `core/observed-node-dead` (default 20), each tunable via
  `sm plugins config core/<analyzer> <setting> <n>` or the extension's
  Settings form. The operator fixes by editing the markdown (declaring the
  missing link, or removing / reworking the never-confirmed one, makes the
  issue disappear on the next scan) or dismisses durably via the standard
  issue-suppression sidecar affordance (the link analyzers stamp
  `data.target` with the resolved target, the node analyzer with the node's
  own path); there is deliberately NO auto-fixer for any direction.

## Capture level

The operator decides how much runtime activity skill-map sees, through ONE
cumulative ladder applied LIVE at ingest (2026-08-17; the earlier
install-time depth idea died once the bridge cost was measured at ~20 ms
per event, cheap enough that the hooks always install their full surface):

1. `executions`: unit runs (skills / agents / commands), spawns, custody
   and lifecycle claims, turn and session bounds. The mandatory floor:
   every other class correlates to the unit the executions establish.
2. `reads` (+ level 1): `access: "read"` frames.
3. `writes` (+ levels below): `access: "write"` frames.
4. `mcp` (+ levels below): `access: "mcp"` frames. THE DEFAULT, matching
   the full capture surface the hooks have always fed.
5. `shell` (+ levels below): paths parsed HEURISTICALLY out of shell
   commands (2026-08-17: a `PreToolUse` hook on the runtime's shell
   tool, declared by the providers whose payload carries the command
   line, claude from day one (`Bash`), codex since 2026-08-18 (0.147
   reports its shell tool as `Bash`, live-verified), antigravity the
   same day (`run_command`, whose args carry `CommandLine` plus an
   explicit `Cwd`), and opencode the same day in the `plugin-file`
   dialect: the generated plugin's `{{SHELL_ON}}` wiring filter, the
   analogue of a rendered opt-in event, keeps `bash` payloads inside
   the host process until the opt-in re-renders it; rendered ONLY when
   the operator opted in at install time,
   `sm activity install <provider> --shell`, persisted as the
   project-local `activity.shellCapture` key; `--no-shell` retires it, and so does
   `sm activity uninstall` of a provider whose descriptor carries the
   opt-in event: revoking the whole capture surface revokes the
   sensitive rung with it, so a later re-install starts relocked and
   only a fresh `--shell` re-opens it. Retiring the opt-in while the
   persisted `activity.captureLevel` is `shell` demotes that key to the
   default (`mcp`); a serving process self-heals the same way on its
   next session-journal read. The opt-in writers, the CLI flag pair and
   the HTTP install body's `shellCapture` field, are REFUSED for a
   provider whose descriptor carries no opt-in event: the key can only
   ever be persisted from a provider whose uninstall also retires it).
   Double opt-in
   by design: command lines are operator content, so the rung demands
   BOTH the install flag and the selector, and `POST
   /api/activity/capture-level` refuses `shell` while the install key is
   off (answering the unchanged level). The command text itself NEVER
   travels: the adapter extracts `.md` path tokens from the command
   (quotes stripped, URL-shaped tokens ignored, deduped, at most 5 per
   command), emits one PATH signal per token with `detail: "Bash"` and
   `access: "shell"`, and drops the rest. A shell frame is a HEURISTIC sighting (a command can name files it never touches and touch files it never names), admitted as evidence anyway by user decision 2026-08-30: it lights the map, lands in recordings, counts toward the node's execution stats (§Execution stats, the shell bullet) and folds as a `reads` relation (§Session journal, Consumption), leaning on the analyzer gates (repetition + points coverage) to absorb the noise.

The active level is a SERVER-side filter at the ingest seam, applied to
resolved frames BEFORE stats, run history, conversation capture, the
session journal and the WS broadcast: below the level, the event did not
happen for skill-map, so the live map (Real Time) and every recording see
the same truth. Classification of a resolved frame: `agent.spawn` and any
`node.activity` without `access` (custody, lifecycle, turn / session
bounds included) rank as `executions`; otherwise the frame ranks as its
`access` class (`shell` frames rank 5).

Persistence and control: the level lives in the `activity.captureLevel`
project-LOCAL config key (default `mcp`), read at serve boot;
`POST /api/activity/capture-level` (`{"level": "<name>"}`, loopback, no
token) updates the live filter AND persists the key, answering the
effective level. The level is LOCKED while journal capture is on (user
decision 2026-08-17: a mid-recording move reads as "did it change or
not?"): the POST refuses and answers the unchanged effective level, the
UI selectors disable, and the depth is chosen BEFORE pressing Record,
which also keeps each recording's `captureLevel` stamp single-valued in
practice (the MINIMUM rule below stays as defense); the `GET /api/activity/sessions` envelope reports it as
`captureLevel` so the UI selector (beside the Record control, mirrored in
Settings) hydrates. Each journal recording STAMPS the level it was
captured under (`captureLevel` on the recording envelope): evidence
recorded at a lower level lacks the filtered classes, and the observed-*
volume gates will read the stamp when their per-class refinement lands
(deferred with the trio's graduation; until then the stamp is honest
provenance).

## Transport shapes

Three shapes converge on the same ingest route; the provider's `install.kind`
declares which applies:

1. **Spawned-command push** (Claude Code, Codex, Antigravity): the provider spawns
   the bridge per event with the payload on stdin.
2. **In-process plugin push** (opencode): a plugin file registers the provider's
   plugin hooks and POSTs directly, no process spawn.
3. **SSE pull** (fallback, no v1 implementation): a skill-map-side subscriber
   consumes a provider's event stream and POSTs on its behalf.

## Privacy

- Everything is local: bridge, server, and browser speak over loopback only. The
  loopback gate is load-bearing; activity data never leaves the machine and is
  NEVER sent to telemetry (Sentry / PostHog), regardless of consent toggles.
- Ephemeral by contract: activity state (per-node execution stats, spawn
  metadata, and, ONLY under the explicit capture gate, inter-agent conversation
  content) is in-memory only and dies with the process; the raw event is
  dropped after mapping. Conversation retention is opt-in and off by default
  (§Conversation capture). The single durable carve-out is the session journal
  (§Session journal): RESOLVED, content-free frames only, persisted
  project-locally under `.skill-map/sessions/`, gitignored, operator-deletable,
  and excluded from telemetry like everything else here. Wider rich surfaces
  (a full tool log with arguments) remain future opt-in gates, and file
  CONTENTS stay excluded unless explicitly enabled.
- Installation is explicit: `sm activity install <provider>` is operator-invoked
  and consent-prompted, and the SPA equivalent (§Install management over HTTP)
  sits behind a server-enforced confirm gate on BOTH install and uninstall.
  Either surface writes ONLY project-local provider config (never `$HOME`,
  per [`cli-contract.md` §Scope is always project-local](./cli-contract.md)), merges
  non-destructively (pre-existing hooks are preserved), and `uninstall` reverses
  exactly what `install` added.

## Per-provider signal notes (informative)

Live-verified against real runs (2026-06-30). These inform each provider's
`mapEvent`; they are descriptive of vendor behavior, not normative.

### Payload vocabulary

The signal-by-signal table below is the deep reference; this one is the shape
of the payloads it reads, gathered in a single place. Nothing about it is
normative, but it is the fastest way to answer the question that produced the
defect the mapper digest exists for (§Mapper digest): **which of these cells
does my adapter assume?**

Note that no row is the same across all four providers, and no field name is
shared by all of them. An adapter cloned from another provider therefore
inherits this ENTIRE column as a hidden dependency, and because `mapEvent` is
total by contract, every cell that disagrees disclaims in silence rather than
failing. Read the key names the digest reports against this table.

| | `claude` | `codex` | `opencode` | `antigravity` |
|---|---|---|---|---|
| Event discriminator | `hook_event_name` | `hook_event_name` | `hook` | none, STRUCTURAL (a `toolCall` object means a tool event) |
| Tool name | `tool_name` | `tool_name` | `input.tool` | `toolCall.name` |
| Tool arguments | `tool_input` | `tool_input` | `input.args` | `toolCall.args` |
| Containment root | `cwd` | `cwd` | `directory` | `workspacePaths[*]` |
| Session / owner | `session_id` | `session_id` | `input.sessionID` | `conversationId` |
| Markdown tools | `Read` / `Write` / `Edit` | `apply_patch` (writes only; reads fire no hook, upstream open) | `read` / `write` / `edit` | `view_file` / `replace_file_content` |
| Path key | `tool_input.file_path` (absolute) | patch headers inside `tool_input.command` | `args.filePath` (absolute) | `args.AbsolutePath` / `args.TargetFile` (absolute) |
| Skill | tool `Skill`, name in `tool_input.skill` | `$name` tokens in `UserPromptSubmit.prompt` | tool `skill`, name in `args.name` | invisible (`/skill` injects a prompt, no tool event) |
| Spawn | tool `Agent`, `tool_input.subagent_type` + `prompt` | tool `spawn_agent`, `tool_input.agent_type` + `message` | tool `task`, `args.subagent_type` + `args.prompt` | none (subagents have no on-disk definition) |
| Shell (rung 5) | tool `Bash`, `tool_input.command` | tool `Bash`, `tool_input.command` | tool `bash`, `args.command` | tool `run_command`, `args.CommandLine` + `args.Cwd` |

Two traps the table cannot show. Case: a runtime whose tool names are
lower-cased will not match a case-SENSITIVE install matcher written for
another runtime's capitalisation, and the hook then never fires at all, which
looks identical to a disclaiming mapper from the outside. Path form: a payload
whose path key is RELATIVE to the event root cannot go straight into
`relativizeMarkdownPath` (its containment check is a string prefix), so it must
be absolutized against that root first; the shared
`scopeRelativeMarkdownPath` helper does both and is what an adapter should
reach for.

### Signal notes

| Provider | skill | agent | command | notes |
|---|---|---|---|---|
| `claude` | `PreToolUse` tool=`Skill` (`tool_input.skill`), slash form via `UserPromptExpansion.command_name` | `SubagentStart` (start) / `SubagentStop` (owner-scoped end, `ownerScope: true`) keyed by `agent_id`; `agent_id`/`agent_type` on inner tool events; deep nesting attributable. The spawning `Agent` `PreToolUse`/`PostToolUse` pair emits the parent-custody claims (`keepAlive: true`, excluded from execution counting) plus the `spawn` relation block (`prompt` on start, sync `response` on completion; main-context spawns use the relation-only signal form). It deliberately NEVER claims the CHILD node: that claim would outlive the child's own `SubagentStop` (TTL instead of native end) | `UserPromptExpansion.command_name` (shares the `/` namespace with skills; disambiguate by which node exists) | markdown usage: `PreToolUse` tool=`Read`, `Write` or `Edit` (all carry `tool_input.file_path`, relativized against the event's `cwd`) emits a PATH signal, with the literal tool name as `detail` so clients can label reads apart from writes; non-`.md` paths and paths outside the scope root are early-disclaimed either way. A `Write` creating a NEW file resolves to no scanned node and drops; the node lights on later touches once the watcher has scanned it. MCP usage: `PreToolUse` tool=`mcp__<server>__<tool>` (the bridge matcher is widened to `^(Skill|Agent|Read|Write|Edit|mcp__.+)$`) emits a PATH signal to the `mcp://<server>` node, the SAME node the static `core/mcp-tools` edge targets (and `mcpConfig` config-side discovery materialises), so a live tool call lights it deterministically, the runtime reports the exact tool name, no inference. Auto-loaded context (`CLAUDE.md` at session start) fires no tool event and stays invisible. Main-context owner is sessionized (`main:<session_id>`, bare `main` when the payload carries no `session_id`). Terminal `SubagentStop` carries `last_assistant_message` (the child's final report, the async response source) plus `agent_transcript_path`; sync completions carry the report as `tool_response.content` text blocks. Ignore `SubagentStop` orphans with empty `agent_type`. The main-context `Stop` (wired `*`, fires only when the MAIN response completes, never on a nap) maps to the node-less TURN-END form (`{ phase: "end", owner: main:<session_id>, turnEnd: true }`, §WS event: `node.activity`): `PostToolUse` only fires on a SUCCESSFUL tool call, so an interrupted or failed `Agent` call leaves a relation with no end frame, and the turn boundary is the moment it is provably dead (deliberately NOT an `ownerScope` release: main's node claims keep the v1 TTL-decay contract). The whole-session boundary `SessionEnd` (wired `*`, 2026-08-16) maps to the node-less SESSION-RELEASE form (`{ phase: "end", sessionScope: true, session: <session_id> }`, the codex main-`Stop` precedent): every owner grouped under the session releases, and the session journal gets its EXACT finalization boundary (§Session journal). `SessionStart` stays unwired on purpose: no session-start signal form exists in the wire vocabulary, and the journal derives identity + start time from the first frame |
| `codex` | weak: `$name` tokens inside `UserPromptSubmit.prompt` (the adapter scans with the SAME shared `$`-token grammar the `dollar-skill` extractor uses, so activity and link extraction agree; sigil stripped, resolver drops unknowns) | `SubagentStart` (sticky start) / `SubagentStop` (owner-scoped end) keyed by `agent_id`; a NAMED `agent_type` resolves to its `.codex/agents/<name>.toml` node, the default generic `worker` resolves to nothing and drops. Spawn relations ride the `spawn_agent` Pre/PostToolUse pair (matcher-scoped alongside the MCP tool calls below): `tool_input.agent_type` + `message` (the prompt) on start, the child's `agent_id` parsed from the JSON-string `tool_response` on handoff (live-verified 2026-07-05); the response half is the stop's `last_assistant_message` (generic report path), the wait / close tool responses repeat it and stay disclaimed; no execution totals exist anywhere in the payloads. NO parent custody needed: a Codex parent never pauses (it blocks inside the wait tool), so terminal stops unwind bottom-up natively; an agent-context spawn rides a keep-alive heartbeat on the parent only so the resolver stamps `parentNodePath`. The bottom-up assumption has ONE hole (live-verified 2026-07-24): when a NAMED subagent itself spawns a nested `default` worker, Codex fires the inner worker's `SubagentStop` but DROPS the named subagent's own, so its owner never releases and the node glows until the 5-minute sticky decay. The main-context `Stop` closes the hole: it is wired (matcher-less) and maps to a node-less SESSION-RELEASE (`{ phase: "end", sessionScope: true, session }`, §WS event: `node.activity`) that releases every owner of `session_id` at turn end. Every codex signal is stamped with its `session_id` so the UI can group owners under it | none (`/` is Codex's own built-in namespace) | hook config `.codex/hooks.json` uses the same `{ hooks: { <Event>: [...] } }` convention as claude, so the `json-hooks` engine applies verbatim; payload near-identical to claude's, including the sessionized main owner (`main:<session_id>`). MCP usage IS mapped: a `PreToolUse` for an `mcp__<server>__<tool>` call (the matcher is widened to `^(spawn_agent|apply_patch|mcp__.+)$`) emits a PATH signal to the `mcp://<server>` node via the shared `mapMcpInvocation`, the SAME node `core/mcp-tools` and `mcpConfig` config-side discovery draw. Codex force-prefixes the hook tool name with `mcp__` (`codex-rs/core/src/tools/handlers/mcp.rs`, `ensure_mcp_prefix`), so the claude grammar (`parseMcpToolName`) parses it verbatim, deterministic, no inference; there is no end signal (the UI decay owns the span, like a skill), so only `PreToolUse` is widened. Markdown WRITES map from `apply_patch` (upstream shipped its hook events in openai/codex#18391; live-verified 2026-08-18 against codex 0.147): the `PreToolUse` matcher includes `apply_patch`, the patch envelope rides in `tool_input.command`, and the adapter parses its `*** Add File:` / `*** Update File:` header lines (the patch grammar names its targets, no inference), resolves each against the event `cwd`, keeps `.md` targets inside the scope root, dedupes, caps at 5 per patch, and emits one PATH signal per survivor with `detail: "apply_patch"` and `access: "write"`; `*** Delete File:` is deliberately skipped (lighting a node the patch is about to remove is noise) and a `*** Move to:` rename lights only the old path (the new one resolves after the next scan). Markdown READS stay unmapped: hooks still do not fire for the internal `read_file` tool (openai/codex#18491, re-verified open 2026-08-18), so a model-initiated skill consultation (reading a SKILL.md) is invisible on this runtime; the explicit `$skill` prompt grammar remains the way a skill lights. The SHELL rung (§Capture level rung 5) applies: codex 0.147 reports its shell tool as `Bash` with the claude payload shape (live-verified 2026-08-18), so the descriptor carries the same `optIn: "shell"` `^Bash$` event and the shared shell mapper yields path sightings behind the same double opt-in (`sm activity install codex --shell`), which also gives `.md` files read via `cat` / `sed` a sighting even while `read_file` stays dark. Operational note (codex 0.147): hooks require explicit TRUST (the `/hooks` review flow in the codex TUI, recorded per hook hash); a freshly installed bridge fires nothing until the operator trusts it, which the wiring self-test (§Wiring self-test) surfaces |
| `antigravity` | invocation itself invisible (`/skill` injects the SKILL.md with no tool event, live-verified 2026-07-04), but a skill's `references/*.md` reads DO fire and light those resources | no on-disk agent files exist (subagents are runtime-only Prompt specs), so there is nothing to light; `conversationId` (present in EVERY payload) is the owner grouping key, and the conversation `Stop` (`terminationReason` present) maps to a node-less OWNER RELEASE only when the conversation is FULLY idle: live-verified 2026-07-05, an orchestrating conversation fires Stop with `fullyIdle: false` every time it naps while its subagents run (waking on their `send_message`), and those nap stops disclaim (a missing `fullyIdle` keeps releasing, older runtimes). Spawn relations are UNMAPPABLE on this runtime: `invoke_subagent` takes a `Subagents` array of runtime-only `{ Prompt, Role, TypeName, Workspace }` specs (types declared via `define_subagent`, no on-disk file), its completion returns NO child `conversationId`, and tool calls carry no ids, so there is nothing to correlate a spawn frame with; `send_message` carries full message text both directions keyed by `conversationId` (a future session-centric surface, unusable today without node anchors) | none; workflows (`.agent/workflows/*.md`) light when the agent FOLLOWS them (it `view_file`s the workflow file) | FIVE mapped signal families: `PreToolUse` tool `view_file` (`toolCall.args.AbsolutePath`, relativized against `workspacePaths[*]`) emitting PATH signals (markdown reads, skill resources, followed workflows all light through it); `PreToolUse` write tools `write_to_file` (new files) and `replace_file_content` (edits), both carrying an ABSOLUTE `toolCall.args.TargetFile` (live-verified 2026-08-18, agy 1.1.14; the July tool-catalog guesses `create_file` / `edit_file` never fire), relativized the same way and emitting PATH signals with `access: "write"` and the literal tool name as `detail`; the opt-in SHELL rung (§Capture level rung 5) via `PreToolUse` tool `run_command`, whose args carry `CommandLine` plus an explicit `Cwd`: `.md` tokens are extracted with the shared shell grammar, absolutized against `Cwd` (more precise than the session cwd claude / codex offer), contained against `workspacePaths[*]`, and emitted as `access: "shell"` sightings with `detail: "run_command"`; `PreToolUse` tool `call_mcp_tool` (the generic wrapper EVERY MCP invocation funnels through, live-verified 2026-07-11) emitting a PATH signal on the `mcp://<server>` node whose server is read from `toolCall.args.ServerName` (tool name in `.ToolName`, carried as `detail`), NOT parsed from the tool name as Claude / Codex do with `mcp__<server>__<tool>`; that is the SAME node `core/mcp-tools` draws from a skill's `tools:` frontmatter, and the ONLY way an Antigravity `mcp://` node lights (its MCP config is home-global, so there is no project-local config to materialise the node config-side); and `Stop` emitting the owner release. The base `PreToolUse` matcher is `^(view_file|call_mcp_tool|write_to_file|replace_file_content)$`, plus the opt-in `^run_command$` event rendered only under the shell key. Operational note (agy 1.1.x): workspace-local hooks load ONLY for a TRUSTED folder (`trustedWorkspaces` in the CLI's own settings; the print-mode `/hooks` slash answer inspects what loaded), so a fresh install fires nothing until the folder is trusted, the codex-trust analogue. Payloads carry NO `hook_event_name`; events are distinguished STRUCTURALLY (`toolCall` = tool event, `invocationNum` = invocation pulse, `terminationReason` = Stop). Hook config `.agents/hooks.json` uses the NAMED-GROUP shape (`install.group`) with the FLAT entry shape on lifecycle events (`events[].entryShape`); the runtime spawns hook commands at the config's directory (`install.commandCwd: "config-dir"`); hooks stay neutral via exit 0 + empty stdout, which the bridge invariants already guarantee |
| `agent-skills` via opencode | `tool.execute.before` tool `skill` (`args.name`), fires even for prose invocations (live-verified 2026-07-04, v1.17.11) | `chat.message` carries the NAMED `agent` + its own `sessionID` per subagent, and `chat.params` (REDUCED at the wiring level to `{ agent, sessionID }`, the user message it also carries never leaves the process) delivers the same identity BEFORE each model call, so the server's owner index learns the session's agent ahead of the turn's first `task` spawn (without it, `chat.message` fires only with the completed assistant message, after the whole delegation ran, and the first delegation anchored on a session capsule); `sessionID` is the owner key and `session.idle` maps to the node-less OWNER RELEASE (native end, fires only when a session truly finishes: the parent BLOCKS inside the `task` tool, no naps, live-verified 2026-07-05). Spawn relations ride the `task` tool pair: the before carries `input.callID` (the spawnId) + `args.subagent_type` / `args.prompt`, the after carries `output.metadata.sessionId` (the child's own owner) and the child's full final report inside `output.output`'s `<task_result>` wrapper (the response source). The task event never names the PARENT agent (only its sessionID), so every spawn emits the relation-only form and anchors on a session capsule, one per spawning session. **Delegation is one hop deep** (live-verified 2026-07-25): a `task` call issued from INSIDE a subagent session is refused by the runtime with a nesting limit, and a refused call fires the before but never the after, so that spawn gets a start frame and no end and lives out the client's TTL sweep. Every spawn whose parent is the main session completes normally. Consequence for the adapter: on this runtime an owner-scoped end is TERMINAL for the spawns that owner parents (the parent blocks inside `task`, so it cannot be idle while a child runs), unlike Claude, where the same frame can mean a nap. Per-message token usage exists on the bus (`message.updated`) but stays unaggregated (a high-frequency family) | dedicated `command.execute.before` hook (`{ command, sessionID }`, prose-invoked too) | in-process plugin (`plugin-file`, `.opencode/plugin/skill-map-activity.js`; BOTH `plugin/` and `plugins/` dirs load, install targets the singular). Markdown usage maps from tools `read`, `write` and `edit` (all carry `args.filePath`, relativized against the plugin context's `directory`; the tool name rides as `detail` so reads label apart from writes); `apply_patch` carries only `patchText` (no path argument) and stays unmapped until parsing the patch body is worth the weight. MCP tool calls map from `tool.execute.before` whose `input.tool` is a `<server>_<tool>` name (OpenCode's MCP naming, no explicit marker like Claude/Codex's `mcp__<server>__<tool>` or Antigravity's `call_mcp_tool` wrapper, live-verified 2026-07-11: a Notion call arrives as `notion_notion-create-pages`) to a PATH signal on `mcp://<server>` (the prefix before the first `_`, tool suffix as `detail`); since there is no explicit marker it fires for any underscore-bearing tool and leans on the resolver's node match to drop the misses (a built-in `read_mcp_resource` resolves to a non-existent `mcp://read` and is dropped). It lights the SAME node `core/mcp-tools` and the `mcpConfig` `opencode.json` discovery draw. The SHELL rung (§Capture level rung 5) applies in the `plugin-file` dialect (2026-08-18, live-verified on 1.18.9: the `bash` tool's before event carries `args.command`): the generated plugin's `tool.execute.before` handler carries a `{{SHELL_ON}}` wiring filter resolved at install render, so bash command lines never leave the host process until `sm activity install opencode --shell` re-renders the plugin; once opted in, `.md` tokens resolve and contain against the plugin context's `directory` via the shared shell grammar (`access: "shell"`, `detail: "bash"`). The placeholder's presence in the hook source is what marks the provider shell-capable (`providerOwnsShellOptIn`). The plugin registers ONLY the consumed hooks (with `tool.execute.after` wiring-filtered to `task`) and forwards `{ hook, directory, input, output? }` wrappers |

## Stability

This entire surface is **experimental** across spec v0.x: the capability shape
(`provider.activity`), `serve.json`, the ingest route, and the `node.activity`
event may tighten before a stable tag lands. The `agent.spawn` family, the
execution-stats fields and endpoints, the conversation-capture surface, and the
session journal (file layout, retention defaults, and the recording schema) are
experimental additions under the same policy. Once promoted (a minor bump), the
usual semantics apply: adding an optional manifest field, a new install kind, or a
new `data` field is a minor bump; removing or renaming any of them is a major
bump. The bridge invisibility invariants (§Bridge contract item 5) are normative
from day one and will not be relaxed.
