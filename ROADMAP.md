# skill-map

> Design document and execution plan for `skill-map`. Architecture, decisions, phases, deferred items, and open questions. Target: distributable product (not personal tool). Versioning policy, plugin security, i18n, onboarding docs, and compatibility matrix all apply.

**Last updated**: 2026-04-21

---

## Descripción del proyecto

### Qué es

**skill-map** (binario `sm`) es una herramienta para **mapear, inspeccionar y gestionar colecciones de archivos Markdown interrelacionados** — especialmente skills, agents, commands, hooks y documentos que componen ecosistemas de agentes de IA (Claude Code, Codex, Gemini, Copilot, etc.).

Funciona como un explorador de grafo: detecta qué archivo referencia a qué otro, qué triggers activan qué skill, qué dependencias externas existen, qué está obsoleto o duplicado, y permite ejecutar acciones sobre cualquier nodo seleccionado.

### Qué problema resuelve

Los desarrolladores que trabajan con agentes de IA acumulan decenas de skills, agents, commands y documentos sueltos. No hay visibilidad sobre:

- Qué existe y dónde vive.
- Quién invoca a quién (dependencias, referencias cruzadas).
- Qué triggers se solapan o pisan entre sí.
- Qué está vivo vs obsoleto.
- Qué se puede borrar sin romper nada.
- Cuándo fue la última vez que se optimizó o validó cada skill.

Ninguna herramienta oficial (Anthropic, Cursor, GitHub, skills.sh) cubre esto. Obsidian ofrece gestión de notas pero no entiende semánticamente que un archivo es un skill ejecutable. `skill-map` llena ese hueco.

### Para quién

- Usuarios avanzados de Claude Code (u otros agentes) que mantienen varios plugins / skills propios.
- Equipos que comparten colecciones de skills y necesitan auditoría.
- Autores de plugins / actions que quieren testear y validar sus creaciones.
- Desarrolladores que quieren construir herramientas encima del grafo (vía CLI, JSON o plugins).

### Cómo funciona (alto nivel)

1. **Scanner determinista** recorre archivos, parsea frontmatter, detecta referencias y produce datos estructurados del grafo (nodos, links, issues).
2. **Capa LLM opcional** consume esos datos y agrega inteligencia semántica: valida referencias ambiguas, clusteriza triggers equivalentes, compara nodos, responde preguntas.
3. **CLI `sm`** expone todas las operaciones. Es la superficie primaria.
4. **Web UI** (desde v0.1 como prototipo, integrada desde v1.0) consume el mismo kernel y ofrece navegación visual, inspector y ejecución.
5. **Sistema de plugins** (drop-in, kernel + extensiones) permite que terceros agreguen detectores, reglas, actions, adapters o renderers sin tocar el kernel.

### Filosofía

- **CLI-first**: todo lo que hace la UI se puede hacer en línea de comandos.
- **Determinista por default**: el LLM es opcional, nunca requerido. El producto funciona offline.
- **Kernel-first desde commit 1**: el núcleo no contiene conocimiento de ninguna plataforma ni detector específico. Todo vive como extensión.
- **Arquitectura hexagonal** (ports & adapters): el kernel es puro, los adapters (CLI, Server, Skill, SQLite, FS, Plugins) son intercambiables.
- **Tests desde commit 1**: pirámide completa (contract, unit, integration, self-scan, CLI, snapshot). Cada extensión trae su test o no bootea.
- **Agnóstico de plataforma**: aunque el primer adapter es Claude Code, la arquitectura soporta cualquier ecosistema de MDs.
- **Distribuible**: versionado semántico, docs, plugin security, marketplace — pensado para usuarios externos, no solo para el autor.
- **Estándar público**: el spec (JSON Schemas + conformance suite + contratos) vive en `spec/`. Cualquiera puede construir una UI alternativa, una implementación en otro lenguaje, o tooling complementario consumiendo solo el spec.
- **`sm` nunca toca un LLM**: el binario es puro template rendering + DB + filesystem. El LLM vive en el runner externo.

### Diferencias con Obsidian (competidor más cercano)

Obsidian mapea notas, no ejecutables. `skill-map`:

1. Entiende skills/agents como **unidades accionables** (ejecutables, con inputs/outputs/tools/triggers).
2. **CLI-first y headless** — corre en CI, pipelines, scripts shell. Obsidian es GUI-first.
3. **Layer AI-semántica** integrada al core (summarizers, verbos probabilísticos), no plugin de terceros.
4. **Actions ejecutables** — correr acciones sobre un nodo seleccionado (optimizar, validar, comparar) via jobs.
5. **Testkit oficial** para autores de plugins — algo que Obsidian no tiene.

Framing del posicionamiento: *"Obsidian for AI agents, not for notes"*. Las otras features candidatas (DataView, Templater, Graph View con filtros) ya están cubiertas por plugins de Obsidian — no competimos en eso.

### Estado

Pre-implementación. Diseño consolidado en este documento.

---

## Glosario de conceptos

> Vocabulario canónico del proyecto. El resto del roadmap usa estos términos sin ambigüedad.

### Dominio y grafo

| Concepto | Descripción |
|---|---|
| **Node** | Archivo markdown que representa una unidad (skill, agent, command, hook, note). Identificado por path relativo al scope root. |
| **Link** | Relación dirigida entre dos nodos (reemplaza al término "edge"). Tiene kind (invokes / references / mentions / supersedes), confidence (high / medium / low), sources (qué detectors la produjeron). |
| **Issue** | Problema emitido por una rule determinista al evaluar el grafo. Tiene severity (warn / error). |
| **Finding** | Hallazgo emitido por análisis probabilístico (summarizer, LLM verb), persistido en DB. Incluye injection detection, low confidence, stale summaries. |
| **Kind** | Categoría de un node: skill, agent, command, hook, note. |

### Extensiones (6 kinds)

| Concepto | Descripción |
|---|---|
| **Adapter** | Extension kind. Reconoce una plataforma (claude, codex, gemini, generic) y clasifica cada archivo en su kind. |
| **Detector** | Extension kind. Extrae links (referencias) del body de un nodo durante el scan. |
| **Rule** | Extension kind. Evalúa el grafo y emite issues deterministas. |
| **Action** | Extension kind. Operación ejecutable sobre uno o más nodos. Dos modos: local (código del plugin) o invocation-template (prompt renderizado para un LLM). |
| **Audit** | Extension kind. Workflow determinista que compone rules y actions. |
| **Renderer** | Extension kind. Serializa el grafo en ascii / mermaid / dot / json. |

### Arquitectura

| Concepto | Descripción |
|---|---|
| **Kernel** | Core de dominio. Lógica pura, no toca IO directamente. Expone use cases. |
| **Port** | Interfaz que el kernel declara. Permite inyección de adapters. |
| **Driving adapter** | Adapter primario — consume el kernel desde afuera. CLI, Server, Skill. |
| **Driven adapter** | Adapter secundario — implementa un puerto del kernel. SQLite storage, FS, Plugin loader, LLM runner. |
| **Hexagonal** | Patrón ports & adapters. Nombre canónico de la arquitectura del proyecto. |

### Runtime de jobs

| Concepto | Descripción |
|---|---|
| **Action (tipo)** | Definido por un plugin. Lo que el user puede invocar. |
| **Job** | Instancia de ejecución de una action sobre uno o más nodos (reemplaza al término "dispatch"). Vive en `state_jobs`. |
| **Job file** | MD generado por `sm` en `.skill-map/jobs/<id>.md`. Contiene prompt renderizado + instrucción de callback. Efímero. |
| **Runner** | Implementación de `RunnerPort` invocada por el kernel para ejecutar un job. En MVP solo existe el **CLI runner** (subprocess `claude -p`). |
| **Skill agent** | Driving adapter que corre dentro de una sesión de LLM y consume `sm job claim` + `sm record` como un cliente más. NO implementa `RunnerPort`; es peer de CLI / Server. |
| **Report** | JSON producido por un job, validado contra el schema declarado por el action. |
| **Callback** | Llamada a `sm record` que cierra el job: status, tokens, duration. |
| **Nonce** | Token único en frontmatter del job file. Requerido por `sm record` para evitar forgeo de callbacks. |
| **Content hash** | Hash identificador de un job para deduplicación: `sha256(actionId + actionVersion + bodyHash + frontmatterHash + promptTemplateHash)`. |
| **Atomic claim** | Operación `UPDATE ... RETURNING id` que permite a un runner tomar un job queued sin race condition. |
| **Reap** | Proceso automático al inicio de `sm job run` que detecta jobs running con TTL vencido y los marca como failed (abandoned). |

### Estados

| Concepto | Descripción |
|---|---|
| **queued** | Job creado, esperando runner. |
| **running** | Runner lo claimó, está ejecutando. |
| **completed** | Runner finalizó exitosamente, report validado. |
| **failed** | Runner reportó error o abandonado por TTL. |
| **abandoned** | Sub-estado de failed: runner murió sin callback. |
| **stale** | Datos computados sobre un body_hash viejo; el archivo cambió desde entonces. |
| **orphan** | Nodo con history en DB pero archivo ausente en FS. |

### Plugins y storage

| Concepto | Descripción |
|---|---|
| **Plugin** | Unidad distribuible que registra una o más extensiones. Drop-in en `<scope>/.skill-map/plugins/<id>/`. |
| **Extension** | Una de las 6 categorías (adapter, detector, rule, action, audit, renderer) que un plugin aporta. |
| **Drop-in** | Modo de instalación: dejar archivos en el folder correcto y ya aparece. Sin `sm plugins add`. |
| **Spec-compat** | Rango semver en el manifest del plugin contra la versión del spec. Checkeado al load. |
| **Storage mode KV** | Modo A. Plugin usa `ctx.store.{get,set,list,delete}`, persistido en tabla kernel `state_plugin_kv`. |
| **Storage mode Dedicated** | Modo B. Plugin declara tablas propias, kernel las provisiona con prefijo `plugin_<id>_`. Triple protección contra contaminación del kernel. |

### Refresh y análisis

| Concepto | Descripción |
|---|---|
| **Deterministic refresh** | Re-scan de un nodo: recomputa bytes, tokens, hashes, links. Sync, sin LLM. `sm scan -n <id>`. |
| **Probabilistic refresh** | Enqueue de una action LLM-backed (summarizer, what, cluster). Async. `sm job submit <action> -n <id>`. |
| **Summarizer** | Action per-kind que genera un resumen semántico estructurado. Un summarizer por kind (skill / agent / command / hook / note). |
| **Meta-skill** | Skill conversacional (`/skill-map:explore`) que consume verbos `sm ... --json` y mantiene follow-ups con el user. |

### Seguridad y contenido

| Concepto | Descripción |
|---|---|
| **User-content delimiter** | Tags XML `<user-content id="...">...</user-content>` que envuelven contenido del user en job files. Kernel escapa literales `</user-content>` dentro. |
| **Prompt preamble** | Bloque canónico auto-prepended por el kernel a cada job MD. Instruye al modelo a tratar user-content como datos, no instrucciones. |
| **Safety object** | Bloque en reports probabilísticos (hermano de `confidence`): `injection_detected`, `injection_type`, `content_quality`, `injection_details`. |
| **Injection detection** | Detección (por el modelo) de intentos de prompt injection en el contenido del nodo. Categorizada en direct-override / role-swap / hidden-instruction / other. |

### Enrichment y provenance

| Concepto | Descripción |
|---|---|
| **Enrichment** | Obtención de datos externos (stars de GitHub, última actividad) para augmentar info de un nodo. Action con TTL de refresh. |
| **Provenance** | Sección del frontmatter: `metadata.source` (URL canónica) + `metadata.sourceVersion` (tag o SHA). |
| **Hash verification** | Comparación de body_hash local vs hash computado sobre raw GitHub para determinar `verified: true/false`. |

### Scope y persistencia

| Concepto | Descripción |
|---|---|
| **Scope project** | Ámbito default. Escanea el repo actual. DB en `./.skill-map/skill-map.db`. |
| **Scope global** | Ámbito opt-in con `-g`. Escanea `~/.claude/` y similares. DB en `~/.skill-map/skill-map.db`. |
| **Zone scan_** | Prefijo de tablas **regenerable**: `sm scan` las trunca y repobla. Ej: `scan_nodes`, `scan_links`. |
| **Zone state_** | Prefijo de tablas **persistente**: jobs, executions, summaries, plugin_kv. Backupable. |
| **Zone config_** | Prefijo de tablas user-owned: plugins enabled/disabled, preferences, schema versions. |
| **Migration** | Archivo `.sql` versionado (`NNN_snake_case.sql`) que evoluciona el schema. Up-only. |
| **user_version** | PRAGMA built-in de SQLite. Tracking rápido del schema del kernel. |
| **Auto-backup** | Copia automática del DB a `.skill-map/backups/...db` antes de aplicar migrations. |

### CLI y UI

| Concepto | Descripción |
|---|---|
| **Introspection** | Propiedad del CLI de emitir su propia estructura (`sm help --format json`) — consumido por docs, completion, UI, agentes. |
| **Graph view** | Vista principal de UI: nodos + links, interactivos. |
| **List view** | Vista tabular de nodos con filtros y sort. |
| **Inspector panel** | Sección de UI que muestra detalle del nodo seleccionado: metadata, weight, summary, links, issues, findings. |
| **Issues panel** | Sección de UI alimentada por `sm check` (deterministic). |
| **Findings panel** | Sección de UI alimentada por `sm findings` (probabilistic). |
| **WebSocket** | Protocolo bidireccional entre server y UI. Push de eventos (job lifecycle, scan updates) + commands del user (rescan, submit, cancel). |

---

## Visual roadmap

```text
═══════════════════════════════════════════════════════════════════════════
  PHASE A · DETERMINISTIC CORE (no LLM)
═══════════════════════════════════════════════════════════════════════════
✅ 0a  Spec bootstrap          schemas, conformance, @skill-map/spec published
✅ 0b  Implementation          workspace + kernel shell + CLI + CI green
  ────────────────────────────────────────────────────────────────────────
   ▶ YOU ARE HERE (2026-04-21) — complete through 0b · next: 0c
  ────────────────────────────────────────────────────────────────────────
   0c  UI prototype            Flavor A with mocked data (iteration checkpoint)
   1   Kernel skeleton         graph, orchestrator, SQLite, Clipanion CLI, migrations
   2   First extensions        1 adapter, 3 detectors, 3 rules, 1 renderer, 1 audit
   3   Scan end-to-end         sm scan / list / show / check
   4   History + callback      sm record, orphans, rename heuristic via body_hash
   5   Project config          .skill-map.json, .skill-mapignore, sm init
   6   Robustness              conflict resolution, perf, chokidar, GC
   7   Diff + export           sm scan --compare-with, sm export, sm graph
   8   Plugin author UX        drop-in workflow, testkit, docs
  ────────────────────────────────────────────────────────────────────────
   ▶ CUT 1 — v0.1.0 shippable (deterministic, offline, zero LLM)

═══════════════════════════════════════════════════════════════════════════
  PHASE B · JOB SUBSYSTEM + LLM VERBS (LLM optional, never required)
═══════════════════════════════════════════════════════════════════════════
   9   Job subsystem           dispatch → jobs, maildir-flat, claim atomic,
                               nonce, preamble, runners (CLI + Skill),
                               first summarizer (skill-summarizer)
  10   Remaining summarizers   agent / command / hook / note. First LLM verbs
                               (sm what, sm cluster-triggers). sm findings.
                               /skill-map:explore meta-skill.
  ────────────────────────────────────────────────────────────────────────
   ▶ CUT 2 — v0.5.0 with LLM shippable

═══════════════════════════════════════════════════════════════════════════
  PHASE C · UI + DISTRIBUTION
═══════════════════════════════════════════════════════════════════════════
  11  Extra renderers         mermaid, dot, subgraph export
  12  Web UI full              Flavor B vertical slice, graph + inspector,
                               WebSocket live events, command submit from UI
  13  Distribution polish      releases, docs site, marketplace, sm doctor,
                               telemetry opt-in, compatibility matrix
  ────────────────────────────────────────────────────────────────────────
   ▶ CUT 3 — v1.0.0 full distributable

═══════════════════════════════════════════════════════════════════════════
  PHASE D · DEFERRED (post v1.0, on-demand)
═══════════════════════════════════════════════════════════════════════════
  14+  Write-back              edit / create / refactor from UI
  15+  Test harness            dry-run / real / subprocess
  16+  Richer workflows        Node-pipe, JSON declarative, DAG
  17+  Additional lenses       Obsidian-vault, docs-site
  18+  More adapters           Codex, Gemini, Copilot, generic
  19+  URL liveness            optional plugin for broken-external-ref
  20+  Schema v2 + migration
═══════════════════════════════════════════════════════════════════════════

  Rule: the LLM is never required. Product is complete offline through step 8.
```

---

## Spec as a standard

`skill-map` is a reusable standard, not only a tool. The **spec** is separated from the **reference implementation** from day zero. Anyone can build a UI, a CLI, a VSCode extension, or an entirely new implementation (any language) using only `spec/`, without reading the reference source.

### Repo layout

```
skill-map/
├── spec/                        ← source of truth for the STANDARD
│   ├── README.md                ← human-readable spec
│   ├── CHANGELOG.md             ← spec history (independent from tool)
│   ├── versioning.md            ← evolution policy
│   ├── architecture.md          ← hexagonal ports & adapters
│   ├── cli-contract.md          ← verbs, flags, exit codes, JSON introspection
│   ├── job-events.md            ← canonical event stream schema
│   ├── prompt-preamble.md       ← canonical injection-mitigation preamble
│   ├── db-schema.md             ← table catalog (kernel-owned)
│   ├── plugin-kv-api.md         ← ctx.store contract for storage mode A
│   ├── job-lifecycle.md    ← queued → running → completed | failed
│   ├── schemas/
│   │   ├── node.schema.json
│   │   ├── link.schema.json
│   │   ├── issue.schema.json
│   │   ├── scan-result.schema.json
│   │   ├── execution-record.schema.json
│   │   ├── project-config.schema.json
│   │   ├── plugins-registry.schema.json
│   │   ├── job.schema.json
│   │   ├── report-base.schema.json
│   │   ├── frontmatter/
│   │   │   ├── base.schema.json
│   │   │   ├── skill.schema.json
│   │   │   ├── agent.schema.json
│   │   │   ├── command.schema.json
│   │   │   ├── hook.schema.json
│   │   │   └── note.schema.json
│   │   └── summaries/
│   │       ├── skill.schema.json
│   │       ├── agent.schema.json
│   │       ├── command.schema.json
│   │       ├── hook.schema.json
│   │       └── note.schema.json
│   ├── interfaces/
│   │   └── security-scanner.md  ← contract for third-party security plugins
│   └── conformance/
│       ├── fixtures/
│       └── cases/
└── src/                         ← reference implementation
```

### Properties

- **Machine-readable**: all schemas are JSON Schema; validate from any language.
- **Human-readable**: prose documents with examples.
- **Independently versioned**: spec `v1.0.0` implementable by CLI `v0.3.2`.
- **Platform-neutral**: no Claude Code required in any schema; it's one example adapter.
- **Conformance-tested**: any implementation passes or fails, binary.

### Distribution

- Publish schemas to JSON Schema Store.
- Canonical URLs (`https://skill-map.dev/spec/v1/...` if domain exists).
- npm package `@skill-map/spec` — schemas + conformance tests.
- Spec semver separate from CLI semver (`spec-v1.0.0` vs `cli-v0.3.2`).

---

## Architecture: Hexagonal (Ports & Adapters)

```
                    Driving adapters (primary)
                         │
   ┌─────────┐       ┌─────────┐       ┌──────┐
   │   CLI   │       │ Server  │       │Skill │
   └────┬────┘       └────┬────┘       └───┬──┘
        │                 │                │
        └─────────────────┼────────────────┘
                          ▼
                   ┌──────────────┐
                   │    Kernel    │  ← domain core (pure use cases)
                   └──┬───┬───┬───┘
                      │   │   │
        ┌─────────────┘   │   └──────────────┐
        ▼                 ▼                  ▼
   ┌────────┐        ┌─────────┐        ┌─────────┐
   │ SQLite │        │   FS    │        │ Plugins │
   └────────┘        └─────────┘        └─────────┘
                Driven adapters (secondary)
```

- Kernel accepts **ports** (interfaces) for `StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`.
- Kernel never imports SQLite, fs, or subprocess directly.
- Each adapter swappable: `InMemoryStorageAdapter` for tests, real `SqliteStorageAdapter` in production; `MockRunner` for tests, real `ClaudeCliRunner` in production.
- Test pyramid collapses cleanly: unit tests inject mocks into kernel; integration tests wire real adapters.
- CLI-first principle reinterpreted: CLI and UI are **peers** consuming the same kernel API — neither depends on the other.

### Package layout

Single npm package, internal modules, multiple `exports` entries — no workspace ceremony:

```
skill-map/
├── src/
│   ├── kernel/              Registry, Orchestrator, domain types, use cases
│   ├── cli/                 Clipanion commands, thin wrappers over kernel
│   ├── server/              (Step 12) Hono + WebSocket, thin wrapper over kernel
│   ├── testkit/             (Step 8) Kernel mocks for plugin authors
│   └── adapters/            (Step 1+) port implementations
│       ├── sqlite/          node:sqlite + Kysely + CamelCasePlugin
│       ├── filesystem/      real fs
│       ├── plugin-loader/   drop-in discovery
│       └── runner/          claude -p subprocess
├── bin/sm.mjs               CLI entry, imports from dist/cli
└── package.json
    {
      "engines": { "node": ">=24.0" },
      "main": "./dist/index.js",
      "bin": { "sm": "./bin/sm.mjs", "skill-map": "./bin/sm.mjs" },
      "exports": {
        ".":         "./dist/index.js",
        "./kernel":  "./dist/kernel/index.js",
        "./server":  "./dist/server/index.js",
        "./testkit": "./dist/testkit/index.js"
      }
    }
```

Folders marked with a step tag (`src/server/`, `src/testkit/`, `src/adapters/*`) are part of the target layout and land at the step indicated; they are not yet on disk as of Step 0b.

Plugin authors: `import { registerDetector } from 'skill-map/kernel'`. Split to real `@skill-map/*` workspaces deferred until a concrete external consumer justifies it.

---

## Persistence

### Two scopes, symmetric

| Scope | Scans | DB location |
|---|---|---|
| **project** (default) | current repo (skills, agents, CLAUDE.md under cwd) | `./.skill-map/skill-map.db` |
| **global** (`-g`) | `~/.claude/` and similar | `~/.skill-map/skill-map.db` |

Project DB may be committed by teams for shared audit history (not gitignored by default? — actually gitignored by default, team opts in via config).

### Three zones per scope

| Zone | Nature | Regenerable | Examples |
|---|---|---|---|
| `scan_*` | last scan result | yes — `sm scan` truncates and repopulates | `scan_nodes`, `scan_links`, `scan_issues` |
| `state_*` | persistent operational data | no — must back up | `state_jobs`, `state_executions`, `state_summaries`, `state_enrichment`, `state_plugin_kv` |
| `config_*` | user-owned configuration | no | `config_plugins`, `config_preferences`, `config_schema_versions` |

Backups preserve `state_*` + `config_*`. `scan_*` regenerated on demand.

### Naming conventions

- Tables: `snake_case`, **plural** (`scan_nodes`, `state_jobs`). Zone prefix required.
- Plugin tables: `plugin_<normalized_id>_<table>` where normalization = lowercase + `[^a-z0-9]` → `_` + collapse runs + strip leading/trailing. Collisions after normalization = load-time error.
- Columns: `snake_case`. PK = `id`. FK = `<referenced_table_singular>_id`.
- Timestamps: suffix `_at`, type **INTEGER** (Unix milliseconds).
- Durations: suffix `_seconds` or `_ms`.
- Booleans: prefix `is_` or `has_`.
- Hashes: suffix `_hash`, TEXT (hex).
- JSON blobs: suffix `_json`, TEXT.
- Counts: suffix `_count`, INTEGER.
- Enums: plain column + CHECK constraint, values kebab-case lowercase. No lookup tables.
- Indexes: `ix_<table>_<cols>`. Constraints: `fk_`, `uq_`, `ck_` prefixes.
- SQL keywords UPPERCASE, identifiers lowercase.

### Data-access layer

- **Kysely + CamelCasePlugin** inside the SQLite adapter.
- Kernel / CLI / Server / Skill consume typed repos exposing `camelCase` domain types. Never see SQL.
- Mapping `snake_case ↔ camelCase` is handled automatically inside the adapter.
- Full ORMs (Prisma, Drizzle, TypeORM) rejected — incompatible with hand-written `.sql` migrations.

### Migrations

- Format: `.sql` files only. Naming: `NNN_snake_case.sql` (3-digit sequential padded).
- Version tracking: `PRAGMA user_version` (fast check) + `config_schema_versions(scope, version, description, applied_at)` multi-scope.
- Direction: up-only. Rollback via `sm db restore <backup>`.
- Kernel auto-wraps each migration in `BEGIN` / `COMMIT`. Files contain only DDL.
- Strict versioning — no idempotency required.
- Location: `src/migrations/` (kernel), `<plugin-dir>/migrations/` (plugins).
- Auto-apply on startup with auto-backup (`.skill-map/backups/skill-map-pre-migrate-v<N>.db`). Config flag `autoMigrate: true` default.

### DB management commands

- `sm db reset` — drop `scan_*` + `state_*`, keep `config_*`.
- `sm db reset --hard` — delete DB file, keep plugins folder.
- `sm db backup [--out <path>]` — WAL checkpoint + copy.
- `sm db restore <path>` — swap DB.
- `sm db shell` — interactive sqlite3.
- `sm db dump [--tables ...]` — SQL dump.
- `sm db migrate [--dry-run | --status | --to <n> | --kernel-only | --plugin <id> | --no-backup]`.

---

## Job system

### Core model

- **Job** = runtime instance of an Action applied to one or more Nodes. Lives in `state_jobs`.
- **Job file** = MD at `.skill-map/jobs/<id>.md` with rendered prompt + callback instruction. Kernel-generated. Ephemeral (pruned after retention).
- **Job ID format**: `d-YYYYMMDD-HHMMSS-XXXX` (timestamp + 4 hex chars). Human-readable, sortable, collision-resistant for single-writer.
- **No maildir**. State lives in DB (`state_jobs.status`); file is content only. Flat folder.

### Lifecycle

```
             submit
                │
                ▼
        ┌──────────┐   atomic claim   ┌──────────┐
        │  queued  │ ───────────────▶ │ running  │
        └──────────┘                  └─────┬────┘
                                      │     │
                              callback │     │  TTL expires
                              success  │     │  (auto-reap)
                                       ▼     ▼
                                  ┌──────┐ ┌──────┐
                                  │ done │ │failed│
                                  └──────┘ └──────┘
```

- Atomic claim: `UPDATE state_jobs SET status='running' WHERE id=(SELECT id FROM state_jobs WHERE status='queued' ORDER BY priority DESC, created_at ASC LIMIT 1) AND status='queued' RETURNING id`.
- Auto-reap at start of every `sm job run`: marks `running` rows with `claimed_at + ttl_seconds * 1000 < now` as failed (reason `abandoned`).

### TTL per action

- Action manifest declares optional `expectedDurationSeconds`.
- Kernel computes: `ttlSeconds = max(expectedDurationSeconds × graceMultiplier, minimumTtlSeconds)` at submit time.
- Defaults: `graceMultiplier: 3`, `minimumTtlSeconds: 60`.
- Override precedence: global default → action manifest → user config (`jobs.perActionTtl`) → `sm job submit --ttl`.
- Resolved TTL frozen into `state_jobs.ttl_seconds` (determinism).

### Duplicate prevention

- On submit, check for active `(actionId, actionVersion, nodeId, contentHash)` in status `queued|running`. If exists: refuse with exit code 3 and display existing job-id.
- `--force` override bypasses the check.
- `contentHash = sha256(actionId + actionVersion + bodyHash + frontmatterHash + promptTemplateHash)`.
- Post-completion: no check; re-submit always allowed.

### Runners

Two execution paths:

| Path | Implements `RunnerPort`? | Execution engine | Isolation | Use case |
|---|---|---|---|---|
| **CLI runner** (`sm job run`) | Yes — driven adapter | `claude -p < jobfile.md` subprocess per item | Context-free (clean) | CI, cron, batch |
| **Skill agent** (`/skill-map:run-queue`) | **No** — driving adapter that consumes `sm job claim` + `sm record` from inside an LLM session | Agent executes in-session using its own LLM + tools | Context bleeds between items | Interactive |

Only the **CLI runner** is a `RunnerPort` implementation (i.e. something the kernel invokes). The **Skill agent** is a peer driving adapter to CLI / Server: it calls the CLI verbs `sm job claim` and `sm record` as if it were any other user of the binary. The name "runner" applied to the skill path is purely descriptive — the kernel does not own its execution.

Skill agent flow:
```
loop:
  1. bash: sm job claim         → <id> or exit 1 (queue empty)
  2. Read: .skill-map/jobs/<id>.md
  3. [agent reasons in-session]
  4. Write: <report-path>
  5. bash: sm record --id <id> --nonce <n> --status completed ...
```

### Nonce + callback auth

- Each job MD has unique `nonce` in frontmatter.
- `sm record` requires `--id <job-id> --nonce <nonce>` — mismatch rejects.
- Prevents forged callback closing someone else's pending dispatch.

### Prompt injection mitigation

Two kernel-enforced layers:

1. **User-content delimiters**: all interpolated node content wrapped in `<user-content id="<node-id>">...</user-content>`. Kernel escapes any literal `</user-content>` in content.
2. **Canonical preamble**: kernel auto-prepends `spec/prompt-preamble.md` text before any action template. Action templates cannot modify, omit, or precede it. The preamble instructs the model: user-content is data, never instructions; detected injections must be noted in `safety` field of the report.

### Atomicity edge cases

| Scenario | Handling |
|---|---|
| DB `queued`/`running` but MD file missing | Mark `failed` with `error: job-file-missing`. `sm doctor` reports proactively. |
| MD file with no DB row | Reported by `sm doctor`. User runs `sm job prune --orphan-files`. Never auto-deleted. |
| User edited MD file before run | By design: runner uses current content. User owns the consequences. |
| `completed` + file present | Normal. Retention policy (`sm job prune`) eventually cleans. |
| Runner crash between claim and read | Covered by auto-reap; TTL expires → `failed` with `abandoned`. |

### Concurrency

MVP runs jobs **sequentially within a single runner** — one claim / spawn / record cycle at a time. There is no pool or scheduler.

Multiple runners MAY coexist (e.g. a cron `sm job run --all` in parallel with an interactive Skill agent draining via `sm job claim`). The atomic-claim semantics exist precisely for this case: the `UPDATE ... WHERE status='queued' RETURNING id` guarantees that no two runners ever claim the same row, even when they race.

The event schema carries `runId` + `jobId` so parallel per-runner sequences can be interleaved without losing order per `jobId`. True in-runner parallelism (a pool inside `sm job run`) is a non-breaking post-MVP extension.

### Progress events

Canonical event stream (`spec/job-events.md`):

`run.started`, `run.reap.started`, `run.reap.completed`, `job.claimed`, `job.skipped`, `job.spawning`, `model.delta`, `job.callback.received`, `job.completed`, `job.failed`, `run.summary`.

Emitted via `ProgressEmitterPort`. Three output adapters:
- **pretty** (default TTY): line progress, colored.
- **`--stream-output`**: pretty + model tokens inline (debug).
- **`--json`**: ndjson canonical.

Server re-emits same events via **WebSocket**. Task UI integration (Claude Code TaskCreate, Cursor equivalent) lives as a host-specific skill (`sm-cli-run-queue`), not as CLI output mode.

### `sm job` CLI surface

| Command | Purpose |
|---|---|
| `sm job submit <action> -n <id>` | Enqueue (or run inline for local mode). |
| `sm job submit <action> -n <id> --run` | Submit + spawn subprocess immediately. |
| `sm job submit <action> --all` | Apply to every node matching action's precondition. |
| `sm job submit ... --force` | Bypass duplicate check. |
| `sm job submit ... --ttl <seconds>` | Override computed TTL. |
| `sm job list [--status ...]` | List jobs. |
| `sm job show <id>` | Detail (includes TTL remaining for running). |
| `sm job preview <id>` | Render the MD (no execution). |
| `sm job claim [--filter <action>]` | Atomic primitive. Returns next queued id. |
| `sm job run` | CLI runner: claim + spawn + record. One job. |
| `sm job run --all \| --max N` | Drain the queue. |
| `sm job status [<id>]` | Counts or single-job status. |
| `sm job cancel <id>` | Force to `failed`. |
| `sm job prune` | Retention GC. |
| `sm job prune --orphan-files` | Clean orphan MD files. |

---

## Plugin system

### Drop-in installation

No `add` / `remove` verbs. User drops files in:
- `<scope>/.skill-map/plugins/<plugin-id>/` (project)
- `~/.skill-map/plugins/<plugin-id>/` (global)

Layout:
```
<plugin-id>/
├── plugin.json              ← manifest
├── extensions/
│   ├── foo.action.mjs
│   ├── foo.detector.mjs
│   └── ...
└── migrations/              ← only if storage mode dedicated
    └── 001_initial.sql
```

Manifest:
```json
{
  "id": "my-cluster-plugin",
  "version": "1.0.0",
  "specCompat": ">=1.0.0 <2.0.0",
  "extensions": [
    "extensions/foo.action.mjs",
    "extensions/foo.detector.mjs"
  ],
  "storage": {
    "mode": "kv"
  }
}
```

### Loading

On boot or `sm plugins list`:
1. Walk `<scope>/.skill-map/plugins/*` and `~/.skill-map/plugins/*`.
2. Read `plugin.json`.
3. Run `semver.satisfies(specVersion, plugin.specCompat)`.
4. If compat fails: `disabled` with reason `incompatible-spec`. Skip.
5. Dynamic-import each extension. Validate against kind schema. Register in kernel.
6. If plugin has storage mode dedicated: kernel provisions tables (prefix-enforced) and runs migrations.

### Storage modes

Plugin declares in manifest:

| Mode | Declaration | API | Backing |
|---|---|---|---|
| **A — KV** | `"storage": { "mode": "kv" }` | `ctx.store.{get,set,list,delete}` scoped by `plugin_id` | Kernel table `state_plugin_kv(plugin_id, node_id, key, value, updated_at)` |
| **B — Dedicated** | `"storage": { "mode": "dedicated", "tables": [...], "migrations": [...] }` | Scoped `Database` wrapper | Kernel-provisioned tables `plugin_<normalized_id>_<table>` |

### Triple protection (mode B)

1. **Prefix enforcement**: kernel injects `plugin_<id>_` into every DDL. Plugin cannot create un-prefixed tables.
2. **DDL validation**: reject FK to kernel tables, triggers on kernel tables, `DROP`/`ALTER` of kernel tables, `ATTACH`, global PRAGMAs.
3. **Scoped connection**: plugin receives a `Database` wrapper, not raw handle. Wrapper rejects cross-namespace queries at runtime.

Honest note: drop-in plugins are user-placed code; protection guards accidents, not hostile plugins. Post-v1.0 evaluates signing.

### Plugin commands

| Command | Purpose |
|---|---|
| `sm plugins list` | Auto-discovered from folders. |
| `sm plugins show <id>` | Manifest + compat status. |
| `sm plugins enable <id>` | Toggle on (persisted in `config_plugins`). |
| `sm plugins disable <id>` | Toggle off without deleting. |
| `sm plugins doctor` | Revalidate specCompat. |

### Default plugin pack

Pattern confirmed. Contents TBD during implementation. Only firm commitment: **`github-enrichment`** bundled (needed for hash verify property). Other candidates: `minimal-security-rules`, more detectors. Third-party plugins (Snyk, Socket) install post-MVP against `spec/interfaces/security-scanner.md`.

---

## Summarizer pattern

Each node-kind has a default Action that generates a semantic summary. Registered by the adapter:
- `skill-summarizer` → `kind: skill` (MVP ambitious: all five ship)
- `agent-summarizer` → `kind: agent`
- `command-summarizer` → `kind: command`
- `hook-summarizer` → `kind: hook`
- `note-summarizer` → `kind: note`

### Schemas

Each summarizer declares a report schema in `spec/schemas/summaries/<kind>.schema.json`, extending `spec/schemas/report-base.schema.json`.

Example — skill:
```json
{
  "confidence": 0.85,
  "safety": { "injection_detected": false, "content_quality": "clean" },
  "what_it_does": "One-sentence summary",
  "recipe": [ { "step": 1, "description": "..." } ],
  "preconditions": ["..."],
  "outputs": ["..."],
  "side_effects": ["..."],
  "related_nodes": ["..."],
  "quality_notes": "..."
}
```

### Storage

Dedicated kernel table `state_summaries`:
```sql
CREATE TABLE state_summaries (
  node_id                  TEXT NOT NULL,
  kind                     TEXT NOT NULL,
  summarizer_action_id     TEXT NOT NULL,
  summarizer_version       TEXT NOT NULL,
  body_hash_at_generation  TEXT NOT NULL,
  generated_at             INTEGER NOT NULL,
  summary_json             TEXT NOT NULL,
  PRIMARY KEY (node_id, summarizer_action_id)
);
```

`sm show <node>` renders the summary if present; marks `(stale)` if current `body_hash ≠ body_hash_at_generation`.

### Probabilistic refresh

UI exposes two buttons per node:
- **🔄 det** → `sm scan -n <id>`: recomputes bytes, tokens, hashes, links. Sync.
- **🧠 prob** → `sm job submit <defaultRefreshAction-for-kind> -n <id>`: async, queued. The default refresh action per kind is the summarizer for that kind.

### Report base schema

All probabilistic reports (summarizers, LLM verbs) extend `report-base.schema.json`:

```json
{
  "confidence": 0.0,
  "safety": {
    "injection_detected": false,
    "injection_details": null,
    "injection_type": null,
    "content_quality": "clean"
  }
}
```

- `confidence` (0.0–1.0): model's metacognition about its own output.
- `safety.injection_detected`: boolean; input contains injection attempt.
- `safety.injection_type`: enum (`direct-override`, `role-swap`, `hidden-instruction`, `other`).
- `safety.content_quality`: enum (`clean`, `suspicious`, `malformed`).

---

## Frontmatter standard

All fields optional except `name` and `description`. Spec artifacts: `spec/schemas/frontmatter/base.schema.json` + `frontmatter/<kind>.schema.json` (5 kinds).

### Base (all kinds)

**Identity**: `name`, `description`, `type`.

**Authorship**: `author`, `authors[]`, `license` (SPDX), `metadata.github`, `metadata.homepage`, `metadata.linkedin`, `metadata.twitter`.

**Versioning**: `metadata.version` (semver), `metadata.specCompat` (semver range), `metadata.stability` (`experimental` | `stable` | `deprecated`), `metadata.supersedes[]`, `metadata.supersededBy`.

**Provenance**: `metadata.source` (URL to canonical origin, e.g., GitHub blob), `metadata.sourceVersion` (tag or SHA; branch name allowed but dynamically resolved).

**Taxonomy**: `metadata.tags[]`, `metadata.category`, `metadata.keywords[]`.

**Lifecycle**: `metadata.created`, `metadata.updated`, `metadata.released` (ISO 8601).

**Integration**: `metadata.requires[]`, `metadata.conflicts_with[]`, `metadata.provides[]`, `metadata.related[]`.

**Display**: `metadata.icon`, `metadata.color`, `metadata.priority`, `metadata.hidden`.

**Documentation**: `metadata.docs_url`, `metadata.readme`, `metadata.examples_url`.

### Kind-specific

| Kind | Extra fields |
|---|---|
| `skill` | `inputs`, `outputs` (optional structured) |
| `agent` | `model`, `tools[]`, `color` |
| `command` | `args[]` (name, type, required), `shortcut` |
| `hook` | `event`, `condition`, `blocking: boolean`, `idempotent: boolean` |
| `note` | (no extras) |

### Validation

Default: **warn** on unknown or missing recommended fields. Emits issues `invalid-frontmatter`, `missing-recommended-field`, `unknown-field`. `--strict` flag promotes to error (for CI).

### DB denormalization

High-query fields stored as columns on `scan_nodes`: `stability`, `version`, `author`. Everything else lives in `frontmatter_json`.

---

## Enrichment

### Scope

- **GitHub** only for MVP. Nodes with `metadata.source` pointing to a GitHub URL.
- **Dropped from MVP**: skills.sh (no public API after investigation), npm, other registries.
- Post-MVP: other providers via new plugins against stable contract.

### Hash verification (idempotency)

Three layers:

1. **SHA pin**: if `metadata.sourceVersion` is a SHA or tag, plugin resolves to immutable raw URL `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`. Deterministic.
2. **Branch resolution**: if `sourceVersion` is a branch or absent, plugin queries GitHub API for current SHA of the branch. Stores `resolvedSha` in `state_enrichment.data_json`. Next refresh compares SHA; only re-fetches if changed.
3. **ETag / `If-None-Match`** (post-MVP): saves bandwidth within rate limit.

### State storage

```sql
CREATE TABLE state_enrichment (
  node_id      TEXT NOT NULL,
  provider_id  TEXT NOT NULL,
  data_json    TEXT NOT NULL,
  verified     BOOLEAN,
  fetched_at   INTEGER NOT NULL,
  stale_after  INTEGER,
  PRIMARY KEY (node_id, provider_id)
);
```

`verified: true` if local `body_hash` matches hash computed over remote raw content. `false` with implicit `locallyModified: true` on mismatch.

### Invocation

No dedicated verb. Uses `sm job submit github-enrichment [-n <id>] [--all]`. `--all` promoted as universal flag: applies action to every node matching its `precondition`.

---

## Reference counts

Three denormalized integer columns on `scan_nodes`:

| Column | Meaning |
|---|---|
| `links_out_count` | outgoing links to other graph nodes |
| `links_in_count` | incoming links from other graph nodes |
| `external_refs_count` | http/https URLs in body (dedup exact match, normalized) |

Computed at scan time. No separate table for URL list — user cares about count, not identity. Reads the file if details needed. No liveness check (optional post-MVP plugin).

Surfaces:
- `sm show`: "N in · M out · K external".
- `sm list --sort-by external-refs`: sort order.

---

## Configuration

Three-level precedence (low → high):

1. **Library defaults** (`src/config/defaults.json` bundled in library).
2. **User config** (`.skill-map.json` in project or `~/.skill-map/config.json` global).
3. **Env vars / CLI flags** (point-in-time overrides).

Deep merge at load. User config can be partial. Validated by `spec/schemas/project-config.schema.json`.

### Commands

| Command | Purpose |
|---|---|
| `sm config list` | Effective config. |
| `sm config get <key>` | Single value. |
| `sm config set <key> <value>` | Write to user config (scope-aware). |
| `sm config reset <key>` | Remove override. |
| `sm config show <key> --source` | Reveals origin (default / project / global / env / flag). |

### Notable config keys

- `autoMigrate: true` — apply pending migrations at startup.
- `tokenizer: "cl100k_base"` — offline token estimator.
- `jobs.ttlSeconds: 3600` — global fallback TTL.
- `jobs.graceMultiplier: 3` — TTL grace on top of expected duration.
- `jobs.minimumTtlSeconds: 60` — TTL floor.
- `jobs.perActionTtl: { <actionId>: <seconds> }` — per-action override.
- `jobs.retention.completed: 2592000` — 30 days default.
- `jobs.retention.failed: null` — never auto-purge.
- `scan.ignorePatterns: [...]` — default `.skill-mapignore` contents.
- `scan.maxFileSizeBytes: 1048576`.

---

## CLI surface (MVP)

Global flags: `-g` scope · `--json` output · `-v`/`-q` · `--no-color` · `-h`/`--help` · `--db <path>` (escape hatch).

### Setup & state

| Command | Purpose |
|---|---|
| `sm init [--no-scan] [--force]` | Bootstrap scope (creates `.skill-map/`, DB, runs first scan). `--no-scan` skips the initial scan. `--force` rewrites an existing config. |
| `sm version` | CLI / kernel / spec / DB schema versions. |
| `sm doctor` | DB integrity, pending migrations, orphan files, plugins in error, LLM runner availability. |
| `sm help [<verb>] [--format human\|md\|json]` | Self-describing introspection. |

### Config

See [Configuration](#configuration).

### Scan

| Command | Purpose |
|---|---|
| `sm scan` | Full scan. |
| `sm scan -n <id>` | Partial (one node). Replaces `sm rescan`. |
| `sm scan --changed` | Incremental (mtime-based). |
| `sm scan --compare-with <path>` | Delta report. |

### Browse

| Command | Purpose |
|---|---|
| `sm list [--type <kind>] [--issue] [--sort-by ...] [--limit N]` | Tabular. |
| `sm show <id>` | Detail: weight (bytes + tokens triple-split), frontmatter, links in/out, issues, findings, summary. |
| `sm check` | All current issues (deterministic). |
| `sm findings [--type ...] [--since ...] [--threshold <n>]` | Probabilistic findings (injection, stale summaries, low confidence). |
| `sm graph [--format ascii\|mermaid\|dot]` | Graph render. |
| `sm export <query> --format json\|md\|mermaid` | Filtered export. |
| `sm orphans` | History rows whose node is missing. |
| `sm orphans reconcile <orphan-id> --to <new-id>` | Migrate history after rename. |

### Actions

| Command | Purpose |
|---|---|
| `sm actions list` | Registered action types. |
| `sm actions show <id>` | Manifest detail. |

### Jobs

See [Job system](#job-system).

### Record (callback)

| Command | Purpose |
|---|---|
| `sm record --id <id> --nonce <n> --status completed --report <path> --tokens-in N --tokens-out N --duration-ms N --model <name>` | Success close. |
| `sm record --id <id> --nonce <n> --status failed --error "..."` | Failure close. |

### History

| Command | Purpose |
|---|---|
| `sm history [-n <id>] [--action <id>] [--status ...] [--since <date>]` | Executions log. |
| `sm history stats` | Aggregates (tokens per action, per month, top nodes). |

### Plugins

See [Plugin system](#plugin-system).

### Audits

| Command | Purpose |
|---|---|
| `sm audit list` | Registered audits. |
| `sm audit run <id>` | Execute, print report. |

### Database

See [Persistence](#persistence).

### Server

| Command | Purpose |
|---|---|
| `sm serve [--port N] [--host ...] [--no-open]` | Hono + WebSocket for Web UI. |

### Introspection

- `sm help --format json` — structured surface dump.
- `sm help --format md` — canonical markdown for `docs/cli-reference.md` (CI-enforced sync).
- Consumers: docs generator, shell completion, Web UI form generation, IDE extensions, test harness, the `sm-cli` skill (agent integration).

---

## Skills catalog

Single source of truth for every skill-shaped artifact shipped alongside `skill-map`. All use the `/skill-map:` namespace inside host agents (Claude Code today; future hosts register under the same namespace).

| Id | Type | Host | Ships at | Purpose |
|---|---|---|---|---|
| `/skill-map:explore` | Meta-skill (conversational) | Claude Code | Step 10 | Wraps every `sm … --json` verb into a single slash-command. Maintains follow-ups with the user, feeds CLI introspection to the agent, orchestrates multi-step exploration. Replaces the earlier per-verb `explore-*` idea. |
| `/skill-map:run-queue` | Skill agent (driving adapter) | Claude Code | Step 9 | Drains the job queue in-session: loops `sm job claim` → Read → [agent reasons] → Write report → `sm record`. Does NOT implement `RunnerPort`; peer of CLI runner. |
| `sm-cli-run-queue` | npm package (skill bundle) | Claude Code (installable) | Step 9 | Distributable package that a user drops into their Claude Code plugin folder to get `/skill-map:run-queue`. Wraps the skill manifest + any host-specific glue (e.g. `TaskCreate` integration for progress). |
| `sm-cli` | Agent integration package | Claude Code (installable) | Step 13 | Feeds `sm help --format json` to the agent so it can compose CLI invocations without hand-maintained knowledge. Mentioned in Decision #65; ships at distribution polish. |
| `skill-optimizer` | Dual-surface action + skill | Claude Code (skill) + any runner (action) | Pre-MVP (skill exists); action wrapper Step 9 | Canonical dual-mode example: exists as a Claude Code skill AND is wrapped as a `skill-map` Action in `invocation-template` mode. Serves as the reference pattern for "same capability, two surfaces". |

Naming rules:

- **Slash-command ids** (`/skill-map:<verb>`) are what the user types inside the host.
- **Package ids** (`sm-cli`, `sm-cli-run-queue`) are what the user installs. One package MAY register multiple slash-commands; one slash-command is registered by exactly one package.
- **Host-specific** skills live under `sm-cli-*` namespace. When a second host (Codex, Gemini) lands as an adapter, its skill packages get their own prefix (`sm-codex-*`, `sm-gemini-*`) — the namespace is owned by the host, not by the skill.

Non-skills shipped for context (listed here to prevent confusion, do NOT register as skills):

- **CLI runner** — the `sm job run` command itself. Driven adapter. Not a skill.
- **Default plugin pack** — `github-enrichment`, plus TBD detectors/rules. Not skills, but installable via drop-in.

---

## UI (Step 0c prototype → Step 12 full)

### Step 0c — Prototype (Flavor A)

Build order inversion: UI prototype **before** kernel implementation. Mocked JSON fixtures from real skills in `_plugins/`. Iterates design cheaply before committing to kernel API.

Scope:
- Graph view (Foblex Flow) — card-style nodes with title, kind badge, version, triggers, link counts.
- List view with frontmatter-driven columns.
- Inspector panel: weight, summary (mocked), links, issues, findings, 🔄 det + 🧠 prob buttons.
- Filters by kind / stability / issue.
- Simulated event flow: fake run-queue emitting canonical events.

Tech picks locked at Step 0c start:
- Frontend framework: **Angular** (latest stable, standalone components).
- Node-based UI library: **Foblex Flow** (Angular-native). Cards as Angular components with arbitrary HTML.
- Component library: **PrimeNG** (tables, forms, dialogs, menus, overlays).
- Styling: **SCSS scoped per component**. No utility CSS framework (no Tailwind, no PrimeFlex) — avoided overlap with PrimeNG's own theming.
- Workspace: `ui/` as an npm workspace peer of `spec/` and `src/`. The kernel never imports Angular; the UI never imports kernel internals (only typed DTOs from `spec/`).

After Step 0c: roadmap review pass. Adjust decisions; surface new gaps if any.

### Step 12 — Full UI (Flavor B)

Vertical slice with real kernel. Same prototype upgraded to consume the actual Hono server.

**Single-port mandate (non-negotiable)**: `sm serve` exposes the SPA, the BFF and the WebSocket under **one listener**. Consumers never need to know two ports exist.

```
sm serve --port 7777
│
├── GET  /api/*     → BFF endpoints (thin wrappers over kernel)
├── WS   /ws        → canonical job / scan / issue events
├── GET  /assets/*  → Angular bundles (JS/CSS/fonts)
└── GET  /*         → fallback to ui/dist/index.html (SPA routing)
```

- **Production**: Hono serves the Angular build via `serveStatic` alongside the API and WS. One process, one port, one command.
- **Development**: Angular dev server with HMR (its own port) proxies `/api` and `/ws` to Hono via `proxy.conf.json`. The SPA still sees a single origin.
- BFF role: **thin proxy** over the kernel. No domain logic. No second DI. Keep it minimal — that is why Hono was chosen over NestJS / Express.

WebSocket `/ws` endpoint:
- Server pushes canonical job events + scan updates + issue changes.
- UI sends commands (rescan, submit, cancel) on same channel.
- REST HTTP reserved for discrete CRUD (config, exports).

Inspector panel renders:
```
External (github-enrichment, if applicable):
  stars, last commit, verified ✓/✗

Summary (per-kind summarizer, if run):
  what_it_does, recipe, preconditions, outputs, related
  (stale) flag if body_hash diverged

Links:
  incoming (N) and outgoing (M) with kinds

Issues: N     Findings: M
```

---

## Testing strategy

From commit 1. Same rigor as kernel-first.

| Layer | What it tests | When |
|---|---|---|
| Contract | Every registered extension conforms to its kind's schema | Each startup + CI |
| Unit | Each detector / rule / adapter / etc. in isolation | CI + dev |
| Integration | Scanner end-to-end over fixtures | CI |
| Self-scan | `sm scan` on skill-map's own repo | CI (mandatory) |
| CLI | Spawn binary, assert stdout / stderr / exit codes | CI |
| Snapshot | Renderers produce byte-exact output | CI |

Framework: **`node:test`** (built-in, zero deps, Node 24+).

Every extension in `src/extensions/` ships a sibling `*.test.ts`. Missing test → contract check fails → tool does not boot.

Plugin author testkit: `skill-map/testkit` exports helpers + mock kernel for third-party plugin tests.

---

## Stack conventions

- **Runtime**: Node 24+ (required — active LTS since Oct 2025; `node:sqlite` stable; WebSocket built-in; modern ESM loader).
- **Language**: TypeScript strict + ESM.
- **Build**: `tsup` / `esbuild`.
- **CLI framework**: **Clipanion** (pragmatic pick — introspection built-in, used by Yarn Berry).
- **HTTP server**: **Hono** (lightweight, ESM-native). Acts as the BFF for the Angular UI and any future client.
- **WebSocket**: `ws` or Hono's built-in (TBD at Step 12).
- **Single-port mandate**: `sm serve` exposes SPA + BFF + WS under one listener. Dev uses Angular dev server + proxy; prod uses Hono + `serveStatic`.
- **UI framework**: **Angular** (latest stable, standalone components).
- **Node-based UI library**: **Foblex Flow**.
- **Component library**: **PrimeNG**.
- **UI styling**: **SCSS scoped per component**. No utility CSS (no Tailwind, no PrimeFlex).
- **UI workspace**: `ui/` as npm workspace peer of `spec/` and `src/`. Kernel is Angular-agnostic; UI imports only typed contracts from `spec/`.
- **DB**: SQLite via `node:sqlite` (zero native deps).
- **Data-access**: **Kysely + CamelCasePlugin** (typed query builder, not an ORM).
- **Logger**: `pino` (JSON lines).
- **Tokenizer**: `js-tiktoken` (cl100k_base).
- **Semver**: `semver` npm package.
- **File watcher** (Step 6): `chokidar`.
- **Package layout**: single npm package with internal modules + multiple `exports`. Workspace split deferred.

### Tech picks pending (resolve during Step 0b)

YAML parser (`yaml` vs `js-yaml`) · MD parsing strategy (regex vs `remark`/`unified`) · template engine for job MDs (template literals vs `mustache` vs `handlebars`) · pretty CLI output (`chalk` + `cli-table3` + `ora`) · path globbing (`glob` vs `fast-glob` vs `picomatch`) · diff lib (hand-written vs `deep-diff` vs `microdiff`).

---

## Execution plan

Sequential build path. Each step ships green tests before the next begins.

> ▶ **Completeness marker (2026-04-21)**: Steps **0a** and **0b** are **complete**. Next step: **0c — UI prototype**. Explicitly postponed by design: `preamble-bitwise-match` conformance case (deferred to Step 9, needs `sm job preview`) and remaining tech-stack picks (YAML parser, MD parser, templating, pretty CLI, globbing, diff — each lands with the step that first needs it).

### Step 0a — Spec bootstrap — ✅ complete

- `spec/` scaffolded and public from commit 1.
- `spec/README.md`, `spec/CHANGELOG.md`, `spec/versioning.md`.
- First draft of JSON Schemas (node, link, scan-result, issue, execution-record, project-config, job, report-base, frontmatter/*, summaries/*).
- `spec/architecture.md`, `cli-contract.md`, `job-events.md`, `prompt-preamble.md`, `db-schema.md`, `plugin-kv-api.md`, `job-lifecycle.md`.
- Conformance test suite stub.
- npm package `@skill-map/spec` published via changesets (currently `0.1.1`).

### Step 0b — Implementation bootstrap — ✅ complete

- Repo scaffolding: `package.json`, Node ESM, `node:test` wired.
- Package layout (single npm with `exports`).
- Hexagonal skeleton: port interfaces, adapter stubs, kernel shell.
- Clipanion CLI binary prints version.
- Contract test infrastructure runs conformance suite against impl.
- CI green with 0 real features.
- Remaining tech stack picks (YAML parser, MD parsing, templating, pretty CLI, globbing, diff) are deferred to the step that first needs them — lock-in-abstract rejected.

### Step 0c — UI prototype (Flavor A) — ▶ next

- **Stack locked here**: Angular (latest stable, standalone) + Foblex Flow (node-based UI) + PrimeNG (components) + SCSS scoped (no utility CSS).
- `ui/` npm workspace created as peer of `spec/` and `src/`.
- No backend. No BFF. Data mocked in-memory from skills/agents/commands/hooks in `_plugins/`.
- Graph view (Foblex cards), list view, inspector, filters, simulated event flow.
- Roadmap review pass after completion.

### Step 1 — Kernel skeleton

- SQLite (node:sqlite) wired behind `StoragePort`.
- Migrations system (`.sql` files, `config_schema_versions`, auto-apply + auto-backup).
- Registry + Loader (6 kinds, validates, isolates).
- Orchestrator running extension pipelines.
- CLI dispatcher with Clipanion (verbs exist, do nothing yet).
- `docs/cli-reference.md` auto-generated from `sm help --format md`, CI-enforced.
- Self-boot test: empty kernel boots, runs empty scan, zero errors.

### Step 2 — First extension instances

- Adapter: `claude`.
- Detectors: `frontmatter`, `slash`, `at-directive`, `external-url-counter` (updates `external_refs_count`).
- Rules: `trigger-collision`, `broken-ref`, `superseded`.
- Renderer: `ascii`.
- Audit: `validate-all`.
- Actions: 0 shipped (contract available).

Acceptance: adding a 4th detector is a pure drop-in. Zero kernel touches.

### Step 3 — Scan end-to-end

- `sm scan` full + `-n` + `--changed`.
- `sm list`, `sm show`, `sm check`.
- Triple-split bytes + tokens per node (`js-tiktoken`).
- `links_out_count`, `links_in_count`, `external_refs_count` denormalized.
- Self-scan test green (mandatory).

### Step 4 — History + orphan reconciliation

- Execution table `state_executions`.
- `sm history` + filters + `stats`.
- Orphan detection.
- **Automatic rename heuristic**: on scan, when a deleted `node.path` and a newly-seen `node.path` share the same `body_hash`, the scan migrates `state_*` FK rows (executions, jobs, summaries, enrichment) from the old path to the new one at **high** confidence without prompt. `frontmatter_hash`-only match → **medium** confidence → emits an `auto-rename-medium` issue so the user can inspect / revert via `sm orphans reconcile`. Any residual unmatched deletion → `orphan` issue.
- `sm orphans reconcile <orphan.path> --to <new.path>` remains as the manual override for semantic-only matches or history repair.

### Step 5 — Config + onboarding

- `.skill-map.json` + `.skill-mapignore`.
- `sm init` scaffolding.
- `sm plugins list / enable / disable / show / doctor`.
- Frontmatter schemas enforced (warn by default, `--strict` promotes to error).

### Step 6 — Robustness

- Detector conflict resolution.
- Incremental scan via `chokidar` (prepares live validation).
- Trigger normalization pipeline (NFD + strip diacritics + lowercase + hyphen/underscore/space → space + collapse + trim).
- History GC / retention policy.

### Step 7 — Diff + export

- `sm scan --compare-with`, `sm export`, `sm graph`.

### Step 8 — Plugin author UX

- Drop-in plugin discovery (already scaffolded).
- `skill-map/testkit` module exported.
- Plugin API docs.
- Error mode: broken plugin shows clear diagnostic.

### ▶ CUT 1 — v0.1.0 (deterministic, offline, zero LLM)

---

### Step 9 — Job subsystem + first summarizer

- `state_jobs` table + atomic claim via `UPDATE ... RETURNING id`.
- Job file rendering with kernel-enforced preamble + `<user-content>` delimiters.
- `sm job submit / list / show / preview / claim / run / run --all / status / cancel / prune`.
- `sm record` with nonce authentication.
- CLI runner (`claude -p` subprocess).
- Skill agent (`/skill-map:run-queue` + `sm-cli-run-queue` skill package).
- `skill-summarizer` built-in (first summarizer).
- Duplicate detection via `contentHash` + `--force`.
- Per-action TTL + auto-reap.
- Progress events (pretty / `--stream-output` / `--json`).
- `github-enrichment` bundled plugin (hash verification).

### Step 10 — Remaining summarizers + LLM verbs + findings

- `agent-summarizer`, `command-summarizer`, `hook-summarizer`, `note-summarizer`.
- `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization`.
- `sm findings` CLI verb.
- `/skill-map:explore` meta-skill.
- `sm doctor` reports LLM runner availability.
- `state_summaries`, `state_enrichment` tables fully populated.

### ▶ CUT 2 — v0.5.0 (LLM optional layer)

---

### Step 11 — Additional renderers

- Mermaid, DOT / Graphviz.
- Subgraph export with filters.

### Step 12 — Full Web UI

- **Hono** BFF with WebSocket `/ws` — thin proxy over the kernel, no domain logic.
- **Single-port mandate**: Hono serves the Angular SPA (`serveStatic` over `ui/dist/browser/`), the REST endpoints, and the WS under one listener. Dev uses Angular dev server + `proxy.conf.json` pointing to Hono for `/api` and `/ws`.
- `sm serve --port N` is the single entry point: one process, one port, one command.
- UI consumes real kernel (Flavor B vertical slice, upgrading Step 0c prototype).
- Inspector panel with enrichment + summary + findings.
- Command submit from UI via WS.
- Live validation via `chokidar` → WS broadcast.

### Step 13 — Distribution polish

- **Publishing workflow**: GitHub Actions for release automation + changelog generation + conventional commits.
- **Documentation site**: **Astro Starlight** (static, minimal infra, good DX).
- **Plugin API reference**: JSDoc → Starlight auto-generated.
- `mia-marketplace` entry.
- Claude Code plugin wrapper — a skill that invokes `sm` from inside Claude Code (`skill-optimizer` is the canonical dual-surface example: exists as a Claude Code skill AND as a skill-map Action via invocation-template mode).
- Telemetry opt-in.
- Compatibility matrix (kernel ↔ plugin API ↔ spec).
- Breaking-changes / deprecation policy.
- `sm doctor` diagnostics for user installs.
- **Domain**: `skill-map.dev` (deferred to launch).

### ▶ CUT 3 — v1.0.0 (full distributable)

---

## Decision log

Canonical log. Decisions from sessions 2026-04-19/20/21 plus pre-session. Presented in thematic groups. The numbering is sparse on purpose (sub-items like `74a–74d` land where they belong thematically).

### Architecture

| # | Item | Resolution |
|---|---|---|
| 1 | Target runtime | Node 24+ required (active LTS). |
| 2 | Kernel-first principle | Non-negotiable from commit 1. All 6 extension kinds wired. |
| 3 | Architecture pattern | **Hexagonal (ports & adapters)** — named explicitly. |
| 4 | Kernel-as-library | CLI, Server, Skill are peer wrappers over the same kernel lib. |
| 5 | Package layout | npm workspaces: `spec/` (published as `@skill-map/spec`) and `src/` (published as `skill-map`). `ui/` joins as a third workspace at Step 0c. Changesets manage the bumps. |
| 6 | `sm` LLM dependency | **Zero**. `sm` never makes LLM calls. LLM lives in runner process. |

### Data and persistence

| # | Item | Resolution |
|---|---|---|
| 7 | DB engine | SQLite via **`node:sqlite`** (zero native deps). |
| 8 | Data-access layer | **Kysely + CamelCasePlugin**. Typed query builder, not ORM. |
| 9 | Two scopes | Project (`./.skill-map/skill-map.db`) and global (`~/.skill-map/skill-map.db`). `-g` toggles scan scope; DB follows. |
| 10 | Three zones | `scan_*` regenerable, `state_*` persistent, `config_*` user-owned. |
| 11 | Table naming | Plural, `snake_case`, zone prefix required. Plugin: `plugin_<normalized_id>_<table>`. |
| 12 | Column conventions | PK `id`, FK `<singular>_id`, timestamps INTEGER ms suffix `_at`, hashes `_hash`, JSON `_json`, counts `_count`, booleans `is_`/`has_`. |
| 13 | Enum values | Plain column + CHECK, kebab-case lowercase values. |
| 14 | Migration format | `.sql` files, `NNN_snake_case.sql`, up-only, auto-wrapped in transaction. |
| 15 | Version tracking | `PRAGMA user_version` + `config_schema_versions` multi-scope. |
| 16 | Auto-apply + auto-backup | At startup. Backup to `.skill-map/backups/` before any migration. |
| 17 | DB naming boundary | Conventions are invisible to kernel/CLI/server — only adapter knows. |

### Nodes and graph

| # | Item | Resolution |
|---|---|---|
| 18 | Node ID | Relative file path (not injected UUID). sm never writes user files. |
| 19 | Link (ex-edge) | Identity = `(from, to)` tuple. Sources preserved in `sources[]`. Merge by strength. |
| 20 | Confidence | 3 levels (high/medium/low). Each detector declares explicitly. |
| 21 | Trigger normalization | NFD + strip diacritics + lowercase + hyphen/underscore/space unification + collapse + trim. `originalTrigger` preserved for display. |
| 22 | External URL handling | **Count only** on `scan_nodes.external_refs_count`. No separate table. No liveness in MVP. |
| 23 | Reference counts | Denormalized columns: `links_out_count`, `links_in_count`, `external_refs_count`. |
| 24 | Orphan reconciliation | `body_hash` match → high confidence rename. `frontmatter_hash` → medium. Semantic → deferred. `sm orphans reconcile`. |
| 25 | Tokens + bytes | Triple-split per node (frontmatter / body / total). Tokenizer column. |

### Frontmatter

| # | Item | Resolution |
|---|---|---|
| 26 | Frontmatter catalog | Full field catalog across identity / authorship / versioning / provenance / taxonomy / lifecycle / integration / display / documentation / kind-specific. |
| 27 | Validation default | Warn (permissive). `--strict` flag promotes to error. |
| 28 | Provenance fields | `metadata.source` (canonical URL) + `metadata.sourceVersion` (tag or SHA). Consumed by `github-enrichment`. |
| 29 | Per-surface visibility | Rendering-config decision, resolved during Step 0c prototype. Not a blocker. |

### Jobs and runners

| # | Item | Resolution |
|---|---|---|
| 30 | Job (ex-dispatch) | Renamed. Tables `state_jobs`. Artifact "job file". |
| 31 | Job file | Single flat folder `.skill-map/jobs/<id>.md`. No maildir. State in DB. |
| 32 | Atomic claim | `UPDATE ... RETURNING id` via SQLite ≥3.35. Zero-row return = another runner won; retry. |
| 33 | Nonce | In job file frontmatter. Required by `sm record` for callback auth. Never in user files. |
| 34 | CLI runner + Skill agent | **CLI runner** = `claude -p` subprocess per item, implements `RunnerPort` (driven adapter). **Skill agent** = in-session via `sm job claim` + Read + agent + Write + `sm record`, driving adapter (peer of CLI / Server), does NOT implement `RunnerPort`. Both share the kernel primitives `claim` + `record`. |
| 35 | Sequential MVP | MVP runs jobs sequentially. Event schema supports parallel post-MVP. |
| 36 | Prompt injection mitigation | User-content delimiters + auto-prepended preamble (kernel-enforced). |
| 37 | Job concurrency (same action, same node) | Refuse duplicate with `--force` override. Content hash over action+version+node hashes+template hash. |
| 38 | Exit codes | `0` ok · `1` issues · `2` error · `3` duplicate · `4` nonce-mismatch · `5` not-found. `6–15` reserved for future spec use. `≥16` free for verb-specific use. |
| 39 | TTL per action | `expectedDurationSeconds` in manifest. `ttl = max(expected × graceMultiplier, minimumTtl)`. Frozen at submit. |
| 40 | TTL override precedence | Global default → manifest → user `jobs.perActionTtl` → CLI `--ttl`. |
| 41 | Auto-reap | At start of `sm job run`. `running` with vencido TTL → failed(abandoned). |
| 42 | Atomicity edge cases | Per-scenario policy: missing file → failed(job-file-missing); orphan file → reported by doctor, user prunes; edited file → by design. |

### Actions and summarizers

| # | Item | Resolution |
|---|---|---|
| 43 | Action execution modes | `local` (code in plugin) + `invocation-template` (prompt for LLM runner). |
| 44 | Summarizer pattern | Action per node-kind. `skill-summarizer`, `agent-summarizer`, `command-summarizer`, `hook-summarizer`, `note-summarizer`. 5 schemas in spec. MVP ships all 5. |
| 45 | Default prob-refresh | Adapter declares `defaultRefreshAction` per kind. UI "🧠 prob" button submits this. |
| 46 | Report base schema | All probabilistic reports extend `report-base.schema.json`. Contains `confidence` (metacognition) + `safety` (input assessment). |
| 47 | Safety object | Sibling of confidence: `injection_detected`, `injection_type` (direct-override / role-swap / hidden-instruction / other), `content_quality` (clean / suspicious / malformed). |
| 48 | Conversational verbs | One-shot CLI + `/skill-map:explore` meta-skill. No multi-turn jobs in kernel. |
| 49 | LLM verbs in MVP | Ambitious: `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization`. All single-turn. |
| 50 | `sm findings` verb | New. Separate from `sm check` (deterministic). Queries probabilistic findings stored in DB. |

### Plugins

| # | Item | Resolution |
|---|---|---|
| 51 | Drop-in | Default. No `add`/`remove` verbs. User drops files. `enable`/`disable` persisted. |
| 52 | specCompat | `semver.satisfies(specVersion, plugin.specCompat)`. Fail → `disabled` with reason `incompatible-spec`. |
| 53 | Storage dual mode | Mode A (KV via `ctx.store`) and Mode B (dedicated tables, plugin declares). **A plugin MUST declare exactly one storage mode.** Mixing is forbidden; a plugin that needs KV-like and relational access uses mode B and implements KV rows as a dedicated table. |
| 54 | Mode B triple protection | Prefix enforcement + DDL validation + scoped connection wrapper. Guards accidents, not hostile plugins. |
| 55 | Tool permissions per job | Frontmatter `expected-tools: []`. Host filters/warns. |
| 56 | Default plugin pack | Pattern confirmed. Contents TBD. Only `github-enrichment` firm commitment. Security scanner as spec'd interface for third-parties. |

### Enrichment

| # | Item | Resolution |
|---|---|---|
| 57 | Enrichment scope | GitHub only for MVP. Skills.sh dropped (no API). npm dropped. |
| 58 | Hash verification | Explicit declaration + compare. No reverse-lookup (no API). |
| 59 | GitHub idempotency | SHA pin + branch resolution cache + optional ETag. |
| 60 | Enrichment invocation | No dedicated verb. Uses `sm job submit <action> --all`. **`--all` is a universal flag**: any verb that takes a target identifier (`-n <node.path>`, `<job.id>`, `<plugin.id>`, etc.) MUST accept `--all` as "apply to every eligible target matching the verb's preconditions" (e.g. `sm scan --all` = every root; `sm plugins disable --all` = every plugin; `sm job cancel --all` = every running job). Verbs that inherently target everything (`sm list`, `sm check`, `sm doctor`) ignore `--all`. |
| 61 | `state_enrichment` table | Dedicated. `node_id + provider_id` PK. |

### CLI and introspection

| # | Item | Resolution |
|---|---|---|
| 62 | CLI framework | **Clipanion** (pragmatic, introspection built-in). |
| 63 | Introspection | `sm help --format json \| md`. Consumers: docs, completion, UI, agents. |
| 64 | CLI reference doc | Auto-generated at `docs/cli-reference.md`, CI-enforced sync. |
| 65 | `sm-cli` skill | Ships with tool. Feeds introspection JSON to agent. |
| 66 | Scan unification | Single `sm scan` with `-n`, `--changed`, `--compare-with`. No `sm rescan`. |
| 67 | Progress events | 3 output modes (pretty / `--stream-output` / `--json`). Canonical event list in `spec/job-events.md`. |
| 68 | Task UI integration | Host-specific skill, not CLI output mode. Ships `sm-cli-run-queue` for Claude Code. |
| 69 | `sm doctor` | Checks DB, migrations, LLM runner availability, job-file consistency. |

### UI

| # | Item | Resolution |
|---|---|---|
| 70 | Build order inversion | Step 0c UI prototype before kernel implementation. Flavor A mocked, Flavor B in Step 12. |
| 71 | Live sync protocol | **WebSocket** (bidirectional). REST HTTP for discrete CRUD only. |
| 72 | Frontend framework | **Angular** (latest stable, standalone components). Locked at Step 0c. Replaces original SolidJS pick — driven by Foblex Flow being the only Angular-native node-based UI library in the market. |
| 73 | Node-based UI library | **Foblex Flow** — chosen for card-style nodes with arbitrary HTML, active maintenance, and Angular-native design. Replaces Cytoscape.js (which was dot/graph-oriented, not card-oriented). |
| 74 | Component library | **PrimeNG** for tables, forms, dialogs, menus, overlays. |
| 74a | UI styling | **SCSS scoped per component**. No utility CSS framework (no Tailwind, no PrimeFlex) — PrimeFlex is in maintenance mode, Tailwind overlaps with PrimeNG theming. Utilities come back later only if real friction appears. |
| 74b | UI workspace layout | `ui/` is an npm workspace peer of `spec/` and `src/`. Kernel stays Angular-agnostic; UI imports only typed contracts from `spec/`. No cross-import from `src/` into `ui/` or vice versa. |
| 74c | BFF mandate | Single-port: `sm serve` exposes SPA + REST + WS under one listener. Dev uses Angular dev server with `proxy.conf.json` → Hono for `/api` and `/ws`; prod uses Hono + `serveStatic`. |
| 74d | BFF framework | **Hono**, thin proxy over the kernel. No domain logic, no second DI. NestJS considered and rejected as over-engineered for a single-client BFF. |
| 75 | Det vs prob refresh | Two buttons per node in UI, two verbs in CLI, two distinct pipes. |

### Spec

| # | Item | Resolution |
|---|---|---|
| 76 | Spec as standard | Public from commit 1. JSON Schemas + conformance suite + prose contracts. |
| 77 | Spec versioning | Independent from CLI (`spec-v1.0.0` vs `cli-v0.3.2`). Stability tags per field. |
| 78 | `@skill-map/spec` npm pkg | Publishable independently. |

### Tooling

| # | Item | Resolution |
|---|---|---|
| 79 | Logger | `pino` JSON lines. |
| 80 | Tokenizer | `js-tiktoken` with `cl100k_base`. ~90% accurate for Claude. Column stores tokenizer name. |
| 81 | Test framework | `node:test` (built-in). Migration to Vitest only if pain emerges. |
| 82 | Build | `tsup` / `esbuild`. |
| 83 | HTTP server | Hono. |
| 84 | License | **MIT**. |
| 85 | Documentation site | **Astro Starlight** at Step 13. |
| 86 | `skill-optimizer` coexistence | Kept as a Claude Code skill AND wrapped as a skill-map Action (invocation-template mode). Dual surface. Canonical example of the dual-mode action pattern. |
| 87 | Domain | `skill-map.dev` (deferred to public launch). |
| 88 | Job ID format | `d-YYYYMMDD-HHMMSS-XXXX` (timestamp + 4 hex chars). Readable, sortable, collision-safe for single-writer. |

### LLM participation summary

| Steps | LLM usage |
|---|---|
| 0a–8 | **None**. Fully deterministic. Tool works end-to-end without any LLM. |
| 9–10 | **Optional**. Adds semantic intelligence via jobs + summarizers. Graceful offline degradation when no runner available. |
| 11–13 | **Optional**, consumed by renderers and UI. |
| 14+ (post-v1) | Likely expanded (write-back suggestions, auto-fix). |

**Invariant**: the LLM is **never required**. Users who can't or don't want to use an LLM still get a complete, useful tool through step 8.

### Gaps still open

- **Per-surface frontmatter visibility** — resolves during Step 0c prototype.
- **Remaining tech stack picks** (YAML parser, MD parsing, templating, pretty CLI libs, globbing, diff) — resolve during Step 0b.

---

## Deferred beyond v1.0

- **Step 14+ — Write-back**. Edit / create / refactor from UI. Git-based undo. Detectors become bidirectional.
- **Step 15+ — Test harness**. Dry-run / real execution / subprocess — scope TBD.
- **Step 16+ — Richer workflows**. Node-pipe API, JSON declarative workflows, visual DAG.
- **Step 17+ — Additional lenses**. Obsidian-vault, docs-site.
- **Step 18+ — More adapters**. Codex, Gemini, Copilot, generic.
- **Step 19+ — URL liveness plugin**. Network HEAD checks, `broken-external-ref` rule.
- **Step 20+ — Schema v2 + migration tooling**. When breaking changes on the JSON output become necessary.
- **npm + other registry enrichment plugins**. When registries publish documented APIs.
- **ETag / conditional GET** for GitHub enrichment. Bandwidth optimization.
- **Governance / RFC process**. When external contributors appear.
- **Claude Code hook auto-record**. A PostToolUse hook that auto-calls `sm record` after an action completes. Partial coverage already via the Skill agent; full auto-record hook deferred.
- **Adversarial testing suite** for prompt injection. Fixtures with known payloads.
- **Parallel job execution**. Event schema already supports demuxing by id.
- **Multi-turn conversational jobs in DB**. If a strong case appears.
- **Plugin signing / hash verification**. Post v1.0 distribution hardening.
- **Telemetry (opt-in)**. Know which detectors / audits are used in the wild.
- **`.ts` migrations** (escape hatch for SQL-impossible data transforms).

---

## Discarded (explicitly rejected)

- **Cursor support** — excluded by user.
- **Remote scope** (scanning GitHub repos as a source) — local only.
- **Diff / history** of graph across commits.
- **Sync with live systems** — detecting what is enabled vs on disk.
- **Query language** — arbitrary queries over the graph.
- **MCP server as the primary interface** — excessive infra for a local tool.
- **Hook-based activation** — this is manual inspection, not automatic.
- **Python** — Node ESM preferred for unification with future web server.
- **`br` / beads task tracking** — experimental project, no formal tracking.
- **Custom snapshot system for undo** — use Git directly when write-back lands.
- **Full ORMs** (Prisma, Drizzle, TypeORM) — incompatible with hand-written `.sql` migrations.
- **Soft deletes** (`deleted_at` columns) — real deletes + backups.
- **Audit columns** (`created_by`, `updated_by`) — irrelevant in single-user; git audit covers team case.
- **Lookup tables for enums** — CHECK constraints sufficient.
- **`sm db reset --nuke`** — too destructive given drop-in plugins are user-placed code.
- **`sm job reap` as explicit verb** — auto-reap on `sm job run` is sufficient.
- **Skills.sh enrichment** — no public API after investigation.
- **URL liveness in MVP** — post-MVP plugin if demand appears.
- **Multi-turn jobs in MVP** — kernel stays single-turn; conversation lives in agent skill.
- **`skill-manager` / `skillctl` naming** — `skill-map` preserved.
- **Per-verb `explore-*` skills** — single `/skill-map:explore` meta-skill.
