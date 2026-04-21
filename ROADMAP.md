# skill-map

> Design document and execution plan for `skill-map`. Architecture, decisions, phases, deferred items, and open questions. Target: distributable product (not personal tool). Versioning policy, plugin security, i18n, onboarding docs, and compatibility matrix all apply.

**Last updated**: 2026-04-22. Changes land via `.changeset/*.md` and `spec/CHANGELOG.md` — this header stops paraphrasing them.

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
4. **Web UI** (prototipo pre-CUT-1 en Step 0c con datos mockeados, UI integrada en `v1.0`) consume el mismo kernel y ofrece navegación visual, inspector y ejecución. El prototipo **no** se shipea en CUT 1 (`v0.5.0`).
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

Steps **0a** (spec bootstrap) y **0b** (implementation bootstrap) completos. `@skill-map/spec` publicado en npm (versión en `spec/package.json` y `spec/CHANGELOG.md`); kernel shell + CLI skeleton bootean y pasan CI. Próximo: **Step 0c — UI prototype**. El marcador de completitud canónico vive en §Execution plan.

---

## Glosario de conceptos

> Vocabulario canónico del proyecto. El resto del roadmap usa estos términos sin ambigüedad.

### Dominio y grafo

| Concepto | Descripción |
|---|---|
| **Node** | Archivo markdown que representa una unidad (skill, agent, command, hook, note). Identificado por path relativo al scope root. |
| **Link** | Relación dirigida entre dos nodos (reemplaza al término "edge"). Tiene `kind` (invokes / references / mentions / supersedes), confidence (high / medium / low), sources (qué detectors la produjeron). |
| **Issue** | Problema emitido por una rule determinista al evaluar el grafo. Tiene severity (warn / error). |
| **Finding** | Hallazgo emitido por análisis probabilístico (summarizer, LLM verb), persistido en DB. Incluye injection detection, low confidence, stale summaries. |
| **Node kind** | Categoría de un node: skill / agent / command / hook / note. Campo `node.kind` en el spec. Disambigua del **link kind** (valor del campo `link.kind`) y del **extension kind** (categoría de plugin, ver próxima tabla). Las tres son polisémicas del término genérico "kind"; el prefijo se usa cuando el contexto no queda claro. |

### Extensiones (6 extension kinds)

"Extension kind" es la categoría de una pieza de plugin, distinta del **node kind** del glosario anterior. El ecosistema expone seis y son el contrato estable del kernel.

| Concepto | Descripción |
|---|---|
| **Adapter** | Extension kind. Reconoce una plataforma (claude, codex, gemini, generic) y clasifica cada archivo en su node kind. |
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
| **Runner** | Implementación de `RunnerPort` invocada por el kernel para ejecutar un job. En el bundle default el único impl es el **CLI runner** (subprocess `claude -p`). Llega en Step 9 / CUT 2, junto con el job subsystem. |
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
| **Safety object** | Bloque en reports probabilísticos (hermano de `confidence`): `injectionDetected`, `injectionType`, `contentQuality`, `injectionDetails`. |
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
   ▶ YOU ARE HERE (2026-04-22) — complete through 0b · next: 0c
  ────────────────────────────────────────────────────────────────────────
   0c  UI prototype            Flavor A with mocked data (iteration checkpoint)
   1a  Storage + migrations    SQLite adapter, kernel migrations, auto-backup, sm db *
   1b  Registry + loader       6 kinds, drop-in plugin discovery, sm plugins list/show/doctor
   1c  Orchestrator + CLI      scan skeleton, Clipanion dispatcher, cli-reference.md autogen, self-boot green
   2   First extensions        1 adapter, 3 detectors, 3 rules, 1 renderer, 1 audit
   3   Scan end-to-end         sm scan / list / show / check
   4   History + callback      sm record, orphans, rename heuristic via body_hash
   5   Project config          .skill-map.json, .skill-mapignore, sm init
   6   Robustness              conflict resolution, perf, chokidar, GC
   7   Diff + export           sm scan --compare-with, sm export, sm graph
   8   Plugin author UX        drop-in workflow, testkit, docs
  ────────────────────────────────────────────────────────────────────────
   ▶ CUT 1 — v0.5.0 shippable (deterministic, offline, zero LLM)

═══════════════════════════════════════════════════════════════════════════
  PHASE B · JOB SUBSYSTEM + LLM VERBS (LLM optional, never required)
═══════════════════════════════════════════════════════════════════════════
   9   Job subsystem           state_jobs, flat-folder job files, atomic
                               claim, nonce, preamble, runners (CLI + Skill),
                               first summarizer (skill-summarizer)
  10   Remaining summarizers   agent / command / hook / note. First LLM verbs
                               (sm what, sm cluster-triggers). sm findings.
                               /skill-map:explore meta-skill.
  ────────────────────────────────────────────────────────────────────────
   ▶ CUT 2 — v0.8.0 with LLM shippable

═══════════════════════════════════════════════════════════════════════════
  PHASE C · SURFACE & DISTRIBUTION (renderers, UI, docs, marketplace)
═══════════════════════════════════════════════════════════════════════════
  11  Extra renderers          mermaid, dot, subgraph export
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
├── spec/                          ← source of truth for the STANDARD (29 schemas + 7 prose contracts)
│   ├── README.md                  ← human-readable spec
│   ├── CHANGELOG.md               ← spec history (independent from tool)
│   ├── versioning.md              ← evolution policy
│   ├── architecture.md            ← hexagonal ports & adapters
│   ├── cli-contract.md            ← verbs, flags, exit codes, JSON introspection
│   ├── job-events.md              ← canonical event stream schema
│   ├── prompt-preamble.md         ← canonical injection-mitigation preamble
│   ├── db-schema.md               ← table catalog (kernel-owned)
│   ├── plugin-kv-api.md           ← ctx.store contract for storage mode A
│   ├── job-lifecycle.md           ← queued → running → completed | failed
│   ├── index.json                 ← machine-readable manifest + per-file sha256
│   ├── package.json               ← published as @skill-map/spec
│   ├── schemas/                   ← 29 JSON Schemas, draft 2020-12, camelCase keys
│   │   ├── node.schema.json                 ┐
│   │   ├── link.schema.json                 │
│   │   ├── issue.schema.json                │
│   │   ├── scan-result.schema.json          │
│   │   ├── execution-record.schema.json     │ 11 top-level
│   │   ├── project-config.schema.json       │
│   │   ├── plugins-registry.schema.json     │
│   │   ├── job.schema.json                  │
│   │   ├── report-base.schema.json          │
│   │   ├── conformance-case.schema.json     │
│   │   ├── history-stats.schema.json        ┘
│   │   ├── extensions/                      ← one per extension kind (loaded at plugin load)
│   │   │   ├── base.schema.json             ┐
│   │   │   ├── adapter.schema.json          │
│   │   │   ├── detector.schema.json         │ 7 extension schemas
│   │   │   ├── rule.schema.json             │ (base + 6 kinds)
│   │   │   ├── action.schema.json           │
│   │   │   ├── audit.schema.json            │
│   │   │   └── renderer.schema.json         ┘
│   │   ├── frontmatter/                     ← user-authored; additionalProperties: true
│   │   │   ├── base.schema.json             ┐
│   │   │   ├── skill.schema.json            │
│   │   │   ├── agent.schema.json            │ 6 frontmatter (base + 5 kinds,
│   │   │   ├── command.schema.json          │ kinds extend base via allOf)
│   │   │   ├── hook.schema.json             │
│   │   │   └── note.schema.json             ┘
│   │   └── summaries/                       ← kernel-controlled; additionalProperties: false
│   │       ├── skill.schema.json            ┐
│   │       ├── agent.schema.json            │ 5 summaries (extend
│   │       ├── command.schema.json          │ report-base via allOf)
│   │       ├── hook.schema.json             │
│   │       └── note.schema.json             ┘
│   ├── interfaces/
│   │   └── security-scanner.md              ← convention over the Action kind (NOT a 7th kind)
│   └── conformance/
│       ├── fixtures/                        ← controlled MD corpora + preamble-v1.txt
│       └── cases/                           ← basic-scan, kernel-empty-boot (preamble-bitwise-match deferred to Step 9)
└── src/                           ← reference implementation (published as skill-map)
```

### Properties

- **Machine-readable**: all schemas are JSON Schema; validate from any language.
- **Human-readable**: prose documents with examples.
- **Independently versioned**: spec `v1.0.0` implementable by CLI `v0.3.2`.
- **Platform-neutral**: no Claude Code required in any schema; it's one example adapter.
- **Conformance-tested**: any implementation passes or fails, binary.

### Distribution

- Publish schemas to JSON Schema Store (deferred until the `v0 → v1` cut; current `v0` URLs are live but pre-stable).
- Canonical URLs: `https://skill-map.dev/spec/v0/<path>.schema.json` (live today via Railway-deployed Caddy; DNS at Vercel). Scheme bumps to `v1` at the first stable cut.
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

npm workspaces. Two today (`spec/`, `src/`); `ui/` joins at Step 0c. Changesets manage each package's semver independently (see Decision #5 and the note at the end of this section).

The marker `[Step N]` in the tree below means the folder is part of the target layout and lands at that step — it is NOT yet on disk as of Step 0b. The remaining folders already exist.

```
skill-map/                        ← private root workspace (not published)
├── package.json                  ← { "name": "skill-map-monorepo", "private": true,
│                                     "workspaces": ["spec", "src"],  // "ui" added at Step 0c
│                                     "engines": { "node": ">=24.0" } }
├── .changeset/                   ← changesets config + pending release notes
├── scripts/                      ← build-site.mjs · build-spec-index.mjs · check-changeset.mjs · check-coverage.mjs
├── site/                         ← generated public site (Caddy on Railway)
│
├── spec/                         ← workspace #1, published as @skill-map/spec
│   └── (see previous §Repo layout tree)
│
├── src/                          ← workspace #2, published as skill-map
│   ├── package.json              ← { "name": "skill-map",
│   │                                  "bin": { "sm": "bin/sm.mjs", "skill-map": "bin/sm.mjs" },
│   │                                  "exports": { ".", "./kernel", "./conformance" } }
│   ├── kernel/                   Registry, Orchestrator, domain types, ports, use cases
│   ├── cli/                      Clipanion commands, thin wrappers over kernel
│   ├── conformance/              Contract runner (loads a spec case, asserts against binary)
│   ├── extensions/               Built-in extensions (empty until Step 2; populated on drop-in)
│   ├── test/                     node:test + tsx loader (*.test.ts)
│   ├── bin/sm.mjs                CLI entry, imports from ../dist/cli
│   ├── index.ts                  Package entry (re-exports)
│   ├── server/         [Step 12] Hono + WebSocket, thin wrapper over kernel
│   ├── testkit/        [Step 8]  Kernel mocks for plugin authors
│   ├── migrations/     [Step 1a] Kernel .sql migrations, up-only
│   └── adapters/       [Step 1a+] port implementations
│       ├── sqlite/               node:sqlite + Kysely + CamelCasePlugin
│       ├── filesystem/           real fs
│       ├── plugin-loader/        drop-in discovery
│       └── runner/               claude -p subprocess (ClaudeCliRunner) + MockRunner
│
└── ui/                 [Step 0c] workspace #3 — Angular SPA (standalone) + Foblex Flow + PrimeNG
    └── (scaffolded when Step 0c starts; isolation rule: no import from ../src/)
```

Two independently published packages (`@skill-map/spec`, `skill-map`) — plus `ui/` staying private at least through v1.0.0. Plugin authors reach the kernel via `import { registerDetector } from 'skill-map/kernel'` (subpath export). Splitting into more `@skill-map/*` packages is deferred until a concrete external consumer justifies it.

The kernel never imports Angular; `ui/` never imports `src/` internals. The sole cross-workspace contract is `spec/` (JSON Schemas + typed DTOs). At Step 12 the Hono BFF inside `src/server/` exposes kernel operations over HTTP/WS, and `sm serve` serves the built Angular SPA from the same listener (single-port mandate).

---

## Persistence

### Two scopes, symmetric

| Scope | Scans | DB location |
|---|---|---|
| **project** (default) | current repo (skills, agents, CLAUDE.md under cwd) | `./.skill-map/skill-map.db` |
| **global** (`-g`) | `~/.claude/` and similar | `~/.skill-map/skill-map.db` |

Project DB is **gitignored by default**. A team that wants to share audit history across contributors opts in explicitly via the `history.share` config flag (`spec/schemas/project-config.schema.json`, marked `Stability: experimental`); when set to `true`, the project is expected to remove `./.skill-map/skill-map.db` from its `.gitignore`. The default stays conservative because the DB carries per-developer state (job runs, summaries, plugin KV) that most teams do not want to diff in PRs.

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

- `sm db reset` — drop `scan_*` only. Keeps `state_*` (history, jobs, summaries, enrichment) and `config_*`. Non-destructive; equivalent to asking for a fresh scan. No prompt.
- `sm db reset --state` — also drop `state_*` and every `plugin_<normalized_id>_*` table (mode B) and `state_plugin_kv` (mode A). Keeps `config_*`. Destructive to operational history; requires interactive confirmation unless `--yes`.
- `sm db reset --hard` — delete the DB file entirely. Keeps the plugins folder on disk so the next boot re-discovers them. Destructive; requires interactive confirmation unless `--yes`.
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
- **ID formats**: base shape `<prefix>-YYYYMMDD-HHMMSS-XXXX` (UTC timestamp + 4 lowercase hex chars), with one optional `<mode>` segment on runs. Prefixes: `d-` for jobs, `e-` for execution records, and `r-[<mode>-]` for runs — carried in `runId` on progress events so parallel per-runner streams stay demuxable. Canonical `<mode>` values today: `ext` (external Skill claims), `scan` (scan runs), `check` (standalone issue recomputations). Without `<mode>`, runs are the CLI runner's own loop. Human-readable, sortable, collision-resistant for single-writer. Full rule in Decision #88.
- **No maildir**. State lives in DB (`state_jobs.status`); file is content only. Flat folder.

### Lifecycle

```
             submit
                │
                ▼
        ┌──────────┐   atomic claim   ┌──────────┐
        │  queued  │ ───────────────▶ │ running  │
        └────┬─────┘                  └─────┬────┘
             │                              │
             │ cancel                       │ callback success
             │                              │ callback failure
             │                              │ TTL expires (auto-reap)
             │                              │ runner-error / report-invalid
             ▼                              ▼
        ┌────────┐                    ┌──────────────────┐
        │ failed │                    │ completed/failed │
        └────────┘                    └──────────────────┘
```

Terminal states: `completed`, `failed`. `queued → failed` is only reachable via `sm job cancel` (reason `user-cancelled`). Full transition table in `spec/job-lifecycle.md`.

- Atomic claim: `UPDATE state_jobs SET status='running' WHERE id=(SELECT id FROM state_jobs WHERE status='queued' ORDER BY priority DESC, created_at ASC LIMIT 1) AND status='queued' RETURNING id`.
- Auto-reap at start of every `sm job run`: marks `running` rows with `claimed_at + ttl_seconds * 1000 < now` as failed (reason `abandoned`).

### TTL per action

Resolved at submit time in three steps; the outcome is frozen on `state_jobs.ttlSeconds` and never changes for the life of the job.

1. **Base duration** (seconds):
   - `action.expectedDurationSeconds` from the manifest, if declared.
   - Else `config.jobs.ttlSeconds` (default `3600`). Used for `mode: local` actions and any manifest that omits the hint.
2. **Computed TTL**:
   - `computed = max(base × config.jobs.graceMultiplier, config.jobs.minimumTtlSeconds)`.
   - Defaults: `graceMultiplier = 3`, `minimumTtlSeconds = 60` (acts as a floor, never a default).
3. **User overrides** (later wins):
   - `config.jobs.perActionTtl.<actionId>` — replaces steps 1+2 entirely.
   - `sm job submit --ttl <seconds>` — replaces everything.

Normative contract lives in `spec/job-lifecycle.md §TTL resolution`.

### Duplicate prevention

- On submit, check for active `(actionId, actionVersion, nodeId, contentHash)` in status `queued|running`. If exists: refuse with exit code 3 and display existing job-id.
- `--force` override bypasses the check.
- `contentHash = sha256(actionId + actionVersion + bodyHash + frontmatterHash + promptTemplateHash)`.
- Post-completion: no check; re-submit always allowed.

### Runners

Three execution paths, matching the three values the `runner` field in `job.schema.json` can take (`cli` / `skill` / `in-process`):

| Path | Role | `RunnerPort` impl | Execution engine | Isolation | Use case |
|---|---|---|---|---|---|
| **CLI runner loop** (`sm job run`, `runner: cli`) | Driving command that claims, invokes a `RunnerPort` impl, and records | `ClaudeCliRunner` (the driven adapter the loop uses in prod; `MockRunner` in tests) | `claude -p < jobfile.md` subprocess per item | Context-free (clean) | CI, cron, batch |
| **Skill agent** (`/skill-map:run-queue`, `runner: skill`) | Driving adapter that consumes `sm job claim` + `sm record` from inside an LLM session | **None** — the agent IS the execution; it does not cross `RunnerPort` | Agent executes in-session using its own LLM + tools | Context bleeds between items | Interactive |
| **In-process** (`mode: local` actions, `runner: in-process`) | Kernel-internal path for actions that do not need an LLM at all | **None** — the action's own code produces the report; no job file, no subprocess | Action function executes in the submitting process; kernel validates the returned report against `reportSchemaRef` and transitions the job straight to `completed` or `failed` | Same process as the submitter | Deterministic enrichment (`github-enrichment`), cheap aggregations, rule-like actions |

The `RunnerPort` interface is implemented by `ClaudeCliRunner` (plus `MockRunner` for tests). `sm job run` is the command loop that uses it — not the port impl itself. The **Skill agent** is a peer driving adapter to CLI / Server: it calls `sm job claim` + `sm record` as any other user of the binary would, and never crosses `RunnerPort`. The name "runner" applied to the skill path is descriptive, not structural. The **in-process** path skips the job file entirely: `sm job submit <local-action>` computes the report synchronously, writes the execution record, and returns. `sm job submit --run` and `sm job run` are no-ops for `mode: local` actions — they already ran.

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

1. **User-content delimiters**: all interpolated node content wrapped in `<user-content id="<node.path>">...</user-content>`. Kernel escapes any literal occurrence of the closing tag inside the content by inserting a zero-width space before the `>`: `</user-content>` → `</user-content&#x200B;>` (U+200B). The substitution is reversed **only for display** — never when computing `bodyHash`, `frontmatterHash`, `contentHash`, or the `promptTemplateHash` fed into the job's content hash. Nesting of `<user-content>` blocks is forbidden; an action template that needs multiple nodes emits one top-level block per node. An action template that interpolates user text outside a `<user-content>` block is rejected at registration time. Full contract in `spec/prompt-preamble.md`.
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

The job subsystem runs jobs **sequentially within a single runner** — one claim / spawn / record cycle at a time. There is no pool or scheduler through `v1.0`.

Multiple runners MAY coexist (e.g. a cron `sm job run --all` in parallel with an interactive Skill agent draining via `sm job claim`). The atomic-claim semantics exist precisely for this case: the `UPDATE ... WHERE status='queued' RETURNING id` guarantees that no two runners ever claim the same row, even when they race.

The event schema carries `runId` + `jobId` so parallel per-runner sequences can be interleaved without losing order per `jobId`. True in-runner parallelism (a pool inside `sm job run`) is a non-breaking post-`v1.0` extension.

### Progress events

Canonical event stream (`spec/job-events.md`):

- **Job family (stable)**: `run.started`, `run.reap.started`, `run.reap.completed`, `job.claimed`, `job.skipped`, `job.spawning`, `model.delta`, `job.callback.received`, `job.completed`, `job.failed`, `run.summary`, plus the synthetic `emitter.error`.
- **Non-job families (experimental, v0.x)**: `scan.*` (`scan.started`, `scan.progress`, `scan.completed`) and `issue.*` (`issue.added`, `issue.resolved`). Shipped at Step 12 with the WebSocket broadcaster; shapes lock when promoted to `stable` in a later minor bump.

All events share the envelope `{ type, timestamp, runId, jobId, data }`. Non-job events use synthetic runs: scans run under `r-scan-…`, standalone issue recomputations under `r-check-…` (same `r-<mode>-…` pattern as `r-ext-…` for external Skill claims).

Emitted via `ProgressEmitterPort`. Three output adapters:
- **pretty** (default TTY): line progress, colored.
- **`--stream-output`**: pretty + model tokens inline (debug).
- **`--json`**: ndjson canonical.

Server re-emits the same events via **WebSocket**. Task UI integration (Claude Code's `TaskCreate` and any future host primitive) lives as a host-specific skill (`sm-cli-run-queue`), not as a CLI output mode. Cursor is explicitly out of scope (see §Discarded).

### `sm job` CLI surface

| Command | Purpose |
|---|---|
| `sm job submit <action> -n <id>` | Enqueue (or run inline for local mode). |
| `sm job submit <action> -n <id> --run` | Submit + spawn subprocess immediately. |
| `sm job submit <action> --all` | Apply to every node matching action's precondition. |
| `sm job submit ... --force` | Bypass duplicate check. |
| `sm job submit ... --ttl <seconds>` | Override computed TTL. |
| `sm job submit ... --priority <n>` | Override job priority (Decision #40a). Integer; higher runs first; default `0`; negatives permitted. Frozen on `state_jobs.priority` at submit. |
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
| **A — KV** | `"storage": { "mode": "kv" }` | `ctx.store.{get,set,list,delete}` scoped by `plugin_id` | Kernel table `state_plugin_kv(plugin_id, node_id, key, value, updated_at)`. `value` is TEXT (opaque to the kernel — may be raw string or serialized JSON, owned by the plugin); kept unsuffixed intentionally because the shape is not kernel-visible. |
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

Pattern confirmed. Contents TBD during implementation. Only firm commitment: **`github-enrichment`** bundled (needed for hash verify property). Other candidates: `minimal-security-rules`, more detectors. Third-party plugins (Snyk, Socket) install post-`v1.0` against `spec/interfaces/security-scanner.md`.

---

## Summarizer pattern

Each node-kind has a default Action that generates a semantic summary. Registered by the adapter:
- `skill-summarizer` → `kind: skill` (Cut 2 ambitious: all five ship by v0.8.0 — `skill-summarizer` lands at Step 9, the other four at Step 10; v0.5.0 / CUT 1 ships none)
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
  "safety": { "injectionDetected": false, "contentQuality": "clean" },
  "whatItDoes": "One-sentence summary",
  "recipe": [ { "step": 1, "description": "..." } ],
  "preconditions": ["..."],
  "outputs": ["..."],
  "sideEffects": ["..."],
  "relatedNodes": ["..."],
  "qualityNotes": "..."
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
    "injectionDetected": false,
    "injectionDetails": null,
    "injectionType": null,
    "contentQuality": "clean"
  }
}
```

- `confidence` (0.0–1.0): model's metacognition about its own output.
- `safety.injectionDetected`: boolean; input contains injection attempt.
- `safety.injectionType`: enum (`direct-override`, `role-swap`, `hidden-instruction`, `other`).
- `safety.contentQuality`: enum (`clean`, `suspicious`, `malformed`).

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

**Integration**: `metadata.requires[]`, `metadata.conflictsWith[]`, `metadata.provides[]`, `metadata.related[]`.

**Tooling** (decision #55, top-level on purpose — mirrors Claude Code's own frontmatter shape):
- `tools[]` — **allowlist**. If present, the host MUST restrict the node to exactly these tools. Matches the Claude Code subagent `tools` frontmatter. Agents use it to lock down the spawned subagent; other kinds use it as a declarative hint.
- `allowedTools[]` — **pre-approval**. Tools the host MAY use without per-use permission prompts while this node is active. Every other tool remains callable under normal permission rules. Matches the Claude Code skill `allowed-tools` frontmatter. Accepts argument-scoped patterns where the host supports them (`Bash(git add *)`).

**Display**: `metadata.icon`, `metadata.color`, `metadata.priority`, `metadata.hidden`.

**Documentation**: `metadata.docsUrl`, `metadata.readme`, `metadata.examplesUrl`.

### Kind-specific

| Kind | Extra fields |
|---|---|
| `skill` | `inputs`, `outputs` (optional structured) |
| `agent` | `model` |
| `command` | `args[]` (name, type, required), `shortcut` |
| `hook` | `event`, `condition`, `blocking: boolean`, `idempotent: boolean` |
| `note` | (no extras) |

`tools[]` and `allowedTools[]` live on `base` (see §Tooling above) and therefore apply to every kind. They are not repeated in the kind-specific list.

### Validation

Default: **warn** on unknown or missing recommended fields. Emits issues `invalid-frontmatter`, `missing-recommended-field`, `unknown-field`. `--strict` flag promotes to error (for CI).

### DB denormalization

High-query fields stored as columns on `scan_nodes`: `stability`, `version`, `author`. Everything else lives in `frontmatter_json`.

---

## Enrichment

### Scope

- **GitHub** only through `v1.0`. Nodes with `metadata.source` pointing to a GitHub URL.
- **Dropped from the bundle**: skills.sh (no public API after investigation), npm, other registries.
- Post-`v1.0`: other providers via new plugins against stable contract.

### Hash verification (idempotency)

Three layers:

1. **SHA pin**: if `metadata.sourceVersion` is a SHA or tag, plugin resolves to immutable raw URL `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`. Deterministic.
2. **Branch resolution**: if `sourceVersion` is a branch or absent, plugin queries GitHub API for current SHA of the branch. Stores `resolvedSha` in `state_enrichment.data_json`. Next refresh compares SHA; only re-fetches if changed.
3. **ETag / `If-None-Match`** (post-`v1.0`): saves bandwidth within rate limit.

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

Computed at scan time. No separate table for URL list — user cares about count, not identity. Reads the file if details needed. No liveness check (optional post-`v1.0` plugin).

Surfaces:
- `sm show`: "N in · M out · K external".
- `sm list --sort-by external-refs`: sort order.

---

## Trigger normalization

Detectors that extract invocation-style links (slashes, at-directives, command names) emit a `link.trigger` block with two fields. Field shape in `spec/schemas/link.schema.json`; normative pipeline in `spec/architecture.md §Detector · trigger normalization`.

- `originalTrigger` — the exact text the detector saw in the source, byte-for-byte. Used for display in `sm show` and the UI.
- `normalizedTrigger` — the output of the pipeline below. Used for equality and collision detection (the `trigger-collision` rule keys on this field).

Both are always present on every trigger-bearing link. Never mutate one without the other.

### Pipeline (Decision #21, normative)

Applied at detector output time, in exactly this order:

1. **Unicode NFD** — decompose into canonical form so combining marks separate from their base characters.
2. **Strip diacritics** — remove every combining mark in the Unicode category `Mn` (Nonspacing_Mark).
3. **Lowercase** — ASCII and Unicode lowercase via locale-independent mapping.
4. **Separator unification** — map every hyphen (`-`), underscore (`_`), and run of whitespace to a single space.
5. **Collapse whitespace** — runs of two or more spaces become one.
6. **Trim** — remove leading and trailing whitespace.

Non-letter/non-digit characters outside the separator set (e.g. `/`, `@`, `:`, `.`) are **preserved** — they are often part of the invocation syntax (`/skill-map:explore`, `@frontmatter-detector`). Stripping them is the detector's responsibility, not the normalizer's: the normalizer acts on what the detector considers "the trigger text".

### Worked examples

| `originalTrigger` | `normalizedTrigger` |
|---|---|
| `Hacer Review` | `hacer review` |
| `hacer-review` | `hacer review` |
| `hacer_review` | `hacer review` |
| `  hacer   review  ` | `hacer review` |
| `Clúster` | `cluster` |
| `/MyCommand` | `/mycommand` |
| `@FooDetector` | `@foodetector` |
| `skill-map:explore` | `skill-map:explore` → `skill map:explore` *(hyphen maps to space, colon preserved)* |

Note the last row: colons and slashes pass through untouched. Plugin authors that want stricter normalization (e.g. stripping the `/` prefix on slash commands) apply it inside their detector before emitting the link, not afterwards.

### Stability

The pipeline ordering is **stable** as of the next spec release. Adding a new step at the end is a minor bump; reordering, removing, or changing any existing step (including the character classes in step 4) is a major bump. Implementations MUST produce byte-identical `normalizedTrigger` output for byte-identical input.

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

All declared in `spec/schemas/project-config.schema.json`. Defaults shown.

- `autoMigrate: true` — apply pending kernel + plugin migrations at startup (after auto-backup). `false` → startup fails with exit 2 if migrations are pending.
- `tokenizer: "cl100k_base"` — offline token estimator. Stored alongside counts so consumers know which encoder produced them.
- `ignore: [...]` — top-level glob patterns excluded from scan, in addition to `.skill-mapignore`.
- `scan.tokenize: true`, `scan.strict: false`, `scan.followSymlinks: false`.
- `scan.maxFileSizeBytes: 1048576` — 1 MiB floor; oversized files are skipped with an `info` log.
- `history.share: false` — experimental. When `true`, `./.skill-map/skill-map.db` is expected to be committed (team removes it from `.gitignore`). No GC policy for `state_executions` in `v0.1` — the table is append-only (see §Step 6). When demand appears, a `history.retention.*` block lands in a later minor bump with concrete defaults and enforcement semantics.
- `jobs.ttlSeconds: 3600` — base duration used when an action manifest omits `expectedDurationSeconds`. Fed into the formula `computed = max(base × graceMultiplier, minimumTtlSeconds)`. Typical for `mode: local` actions where the duration hint is advisory.
- `jobs.graceMultiplier: 3` — multiplier applied to the base duration before the floor check.
- `jobs.minimumTtlSeconds: 60` — TTL floor (never a default). Guarantees no job is claimed with a sub-minute deadline.
- `jobs.perActionTtl: { <actionId>: <seconds> }` — per-action TTL override. Replaces the computed TTL entirely; skips the formula.
- `jobs.perActionPriority: { <actionId>: <integer> }` — per-action priority override (decision #40a). Higher runs first; ties break by `createdAt ASC`. Frozen at submit.
- `jobs.retention.completed: 2592000` — 30 days default; `null` → never auto-prune.
- `jobs.retention.failed: null` — never auto-prune; failed jobs kept for post-mortem.
- `i18n.locale: "en"` — experimental.

The default contents of a fresh `.skill-mapignore` file (used by `sm init`) live in the reference impl under `src/config/defaults/` and are **not** a user-visible config key — editing the generated file is the supported override.

---

## CLI surface

Global flags: `-g` scope · `--json` output · `-v`/`-q` · `--no-color` · `-h`/`--help` · `--db <path>` (escape hatch).

Env-var equivalents (Decision #38 + `spec/cli-contract.md §Global flags`): `SKILL_MAP_SCOPE`, `SKILL_MAP_JSON`, `SKILL_MAP_DB`, `NO_COLOR`. Precedence: flag > env > config > default.

### Exit codes

Normative across every verb (Decision #38; `spec/cli-contract.md §Exit codes`):

| Code | Meaning |
|---|---|
| `0` | Success, no issues. |
| `1` | Success with issues (rules emitted warnings/errors; pipelines use this to gate). |
| `2` | Generic operational error (bad input, runtime failure, missing binary). |
| `3` | Duplicate job — refused by the content-hash check; existing id reported. |
| `4` | Nonce mismatch on `sm record` — authentication failure, no state mutation. |
| `5` | Not found — node, job, or execution id did not resolve. |
| `6–15` | Reserved for future spec use. MUST NOT be taken by verb-specific codes. |
| `≥16` | Free for implementations to use on a per-verb basis (documented in `sm help <verb>`). |

### Elapsed time

**Elapsed-time reporting is normative** (see `spec/cli-contract.md §Elapsed time`). Every verb that walks the filesystem, hits the DB, spawns a subprocess, or renders a report MUST report its own wall-clock duration: `done in <N>ms | <N.N>s | <M>m <S>s` on stderr (suppressed by `--quiet`); and, when the verb's `--json` payload is a top-level object, an `elapsedMs` integer field. Sub-millisecond informational verbs (`--version`, `--help`, `sm version`, `sm help`, `sm config get/list/show`) are exempt. The grammar and field contract are **stable** from spec v1.0.0 — changing them is a major bump.

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
| `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N]` | Tabular. |
| `sm show <id>` | Detail: weight (bytes + tokens triple-split), frontmatter, links in/out, issues, findings, summary. |
| `sm check` | All current issues (deterministic). |
| `sm findings [--kind ...] [--since ...] [--threshold <n>]` | Probabilistic findings (injection, stale summaries, low confidence). |
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
| `skill-optimizer` | Dual-surface action + skill | Claude Code (skill) + any runner (action) | Pre-CUT-1 (skill exists); action wrapper Step 9 | Canonical dual-mode example: exists as a Claude Code skill AND is wrapped as a `skill-map` Action in `invocation-template` mode. Serves as the reference pattern for "same capability, two surfaces". |

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

Build order inversion: UI prototype **before** kernel implementation. Mocked JSON fixtures derived from a real on-disk collection of skills / agents / commands / hooks / notes. Iterates design cheaply before committing to kernel API.

Scope:
- Graph view (Foblex Flow) — card-style nodes with title, kind badge, version, triggers, link counts.
- List view with frontmatter-driven columns.
- Inspector panel: weight, summary (mocked), links, issues, findings, 🔄 det + 🧠 prob buttons.
- Filters by kind / stability / issue.
- Simulated event flow: fake run-queue emitting canonical events.

Tech picks locked at Step 0c start:
- Frontend framework: **Angular ≥ 21** (standalone components). Pin major to `21` at scaffold; `^21.0.0` in `ui/package.json`. Revisit at the first major that lands after the Step 0c freeze.
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
- Server pushes the canonical event stream from `spec/job-events.md`: job family (stable) + `scan.*` + `issue.*` families (experimental in v0.x).
- UI sends commands (rescan, submit, cancel) on the same channel.
- REST HTTP reserved for discrete CRUD (config, exports).

Inspector panel renders:
```
External (github-enrichment, if applicable):
  stars, last commit, verified ✓/✗

Summary (per-kind summarizer, if run):
  whatItDoes, recipe, preconditions, outputs, related
  (stale) flag if bodyHash diverged

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

**Performance budget**: `sm scan` on 500 MDs completes in ≤ 2s on a modern laptop, enforced by a CI benchmark (lands with Step 3 when the scanner goes end-to-end).

**Conformance cases deferred**: `preamble-bitwise-match` lands in Step 9 alongside `sm job preview` (needs a rendered job file for byte-exact comparison against `spec/conformance/fixtures/preamble-v1.txt`). The case is mandatory before Cut 2.

Plugin author testkit: `skill-map/testkit` exports helpers + mock kernel for third-party plugin tests.

---

## Stack conventions

- **Naming**: two rules, both normative and enforced spec-wide (see `spec/README.md` §Naming conventions).
  - **Filesystem artefacts in kebab-case**: every file, directory, enum value, and `issue.ruleId` value — `scan-result.schema.json`, `job-lifecycle.md`, `auto-rename-medium`, `direct-override`. So a value can be echoed into a URL, a filename, or a log key without escaping.
  - **JSON content in camelCase**: every key in a schema, frontmatter block, config file, plugin/action manifest, job record, report, event payload, or API response — `whatItDoes`, `injectionDetected`, `expectedTools`, `conflictsWith`, `docsUrl`, `ttlSeconds`, `runId`. The SQL layer is the sole exception (`snake_case` tables/columns, bridged by Kysely's `CamelCasePlugin`); nothing crosses the kernel boundary as `snake_case`.
- **Runtime**: Node 24+ (required — active LTS since Oct 2025; `node:sqlite` stable; WebSocket built-in; modern ESM loader).
- **Language**: TypeScript strict + ESM.
- **Build**: `tsup` / `esbuild`.
- **CLI framework**: **Clipanion** (pragmatic pick — introspection built-in, used by Yarn Berry).
- **HTTP server**: **Hono** (lightweight, ESM-native). Acts as the BFF for the Angular UI and any future client.
- **WebSocket**: server side uses `hono/ws` + `@hono/node-ws` (co-located with the Hono router so REST and WS share a single listener — single-port mandate). Client side uses the browser-native `WebSocket` (browser) or the Node 24 global `WebSocket` (Node-side tests and consumers — no extra dep). The standalone `ws` library is rejected: it duplicates glue for the HTTP/WS multiplex.
- **Single-port mandate**: `sm serve` exposes SPA + BFF + WS under one listener. Dev uses Angular dev server + proxy; prod uses Hono + `serveStatic`.
- **UI framework**: **Angular ≥ 21** (standalone components). Scaffolded at `^21.0.0`.
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
- **Package layout**: npm workspaces — `spec/` (`@skill-map/spec`), `src/` (`skill-map`, with subpath `exports` for `./kernel` and `./conformance`), and `ui/` (private, joins at Step 0c). Further `@skill-map/*` splits deferred until a concrete external consumer justifies them.

### Tech picks deferred (resolve at the step that first needs them)

YAML parser (`yaml` vs `js-yaml`) · MD parsing strategy (regex vs `remark`/`unified`) · template engine for job MDs (template literals vs `mustache` vs `handlebars`) · pretty CLI output (`chalk` + `cli-table3` + `ora`) · path globbing (`glob` vs `fast-glob` vs `picomatch`) · diff lib (hand-written vs `deep-diff` vs `microdiff`).

Lock-in-abstract rejected during Step 0b: each pick lands with the step that first requires it, so the decision is made against a concrete use case rather than in the void.

---

## Execution plan

Sequential build path. Each step ships green tests before the next begins.

> ▶ **Completeness marker (2026-04-22)**: Steps **0a** and **0b** are **complete**. Next step: **0c — UI prototype**. Explicitly postponed by design: `preamble-bitwise-match` conformance case (deferred to Step 9, needs `sm job preview`) and remaining tech-stack picks (YAML parser, MD parser, templating, pretty CLI, globbing, diff — each lands with the step that first needs it).

> ▶ **Cut version scheme**: `v0.1.0` was spent on the Step 0b bootstrap (already published). CUT 1 therefore targets `v0.5.0`, CUT 2 targets `v0.8.0`, CUT 3 is `v1.0.0`. Intermediate `v0.2.0`–`v0.4.x` cover Steps 0c through 8, `v0.5.x`–`v0.7.x` cover Steps 9–10, `v0.8.x`–`v0.9.x` cover Steps 11–13 — each minor is driven by a changeset, never by a hand bump.

### Step 0a — Spec bootstrap — ✅ complete

- `spec/` scaffolded and public from commit 1.
- `spec/README.md`, `spec/CHANGELOG.md`, `spec/versioning.md`.
- First draft of JSON Schemas (node, link, scan-result, issue, execution-record, project-config, job, report-base, frontmatter/*, summaries/*).
- `spec/architecture.md`, `cli-contract.md`, `job-events.md`, `prompt-preamble.md`, `db-schema.md`, `plugin-kv-api.md`, `job-lifecycle.md` (this file shipped as `dispatch-lifecycle.md` through spec v0.1.2; renamed in spec v0.2.0 to match decision #30).
- Conformance test suite stub.
- npm package `@skill-map/spec` published via changesets. Current version lives in `spec/package.json` and `spec/CHANGELOG.md` — do not duplicate it in this narrative.

### Step 0b — Implementation bootstrap — ✅ complete

- Repo scaffolding: `package.json`, Node ESM, `node:test` wired.
- Package layout: npm workspaces (`spec/`, `src/`) with subpath `exports` on `skill-map`. `ui/` joins as a third workspace at Step 0c.
- Hexagonal skeleton: port interfaces, adapter stubs, kernel shell.
- Clipanion CLI binary prints version.
- Contract test infrastructure runs conformance suite against impl.
- CI green with 0 real features.
- Remaining tech stack picks (YAML parser, MD parsing, templating, pretty CLI, globbing, diff) are deferred to the step that first needs them — lock-in-abstract rejected.

### Step 0c — UI prototype (Flavor A) — ▶ next

- **Stack locked here**: Angular 21 (standalone) + Foblex Flow (node-based UI) + PrimeNG (components) + SCSS scoped (no utility CSS).
- `ui/` npm workspace created as peer of `spec/` and `src/`.
- No backend. No BFF. Data mocked in-memory from a real on-disk collection spanning all five node kinds (skills, agents, commands, hooks, notes) — the specific path is an implementation detail of the prototype run.
- Graph view (Foblex cards), list view, inspector, filters, simulated event flow.
- Roadmap review pass after completion.

### Step 1 — Kernel skeleton (split into three sub-steps)

The original "Step 1" bundled seven independent deliverables. Splitting keeps each sub-step testable on its own; the boundary between them is a green CI plus the specific acceptance criterion named below. All three must land before Step 2 starts.

#### Step 1a — Storage + migrations

- SQLite (`node:sqlite`) wired behind `StoragePort` via `SqliteStorageAdapter` (Kysely + `CamelCasePlugin`).
- Kernel migrations in `src/migrations/` (`NNN_snake_case.sql`, up-only, transaction-wrapped).
- `config_schema_versions` ledger populated; `PRAGMA user_version` kept in sync.
- Auto-apply on startup with auto-backup to `.skill-map/backups/skill-map-pre-migrate-v<N>.db`.
- `sm db backup / restore / reset / reset --state / reset --hard / shell / dump / migrate` operational.

Acceptance: spin a fresh scope, run `sm db migrate --dry-run`, apply, corrupt a row, restore from backup — round-trip green. No kernel logic yet beyond storage.

#### Step 1b — Registry + plugin loader

- `Registry` enforcing the 6 kinds + duplicate-id rejection within a kind (already stubbed in Step 0b; wire it to real validation).
- `PluginLoaderPort` implementation: drop-in discovery in `<scope>/.skill-map/plugins/*` and `~/.skill-map/plugins/*`, `plugin.json` parse, `semver.satisfies(specVersion, plugin.specCompat)` check (where `specVersion` is the installed `@skill-map/spec` package version), dynamic import of each extension, schema validation against `extensions/<kind>.schema.json`.
- `sm plugins list / show / doctor` operational (enable/disable arrive in Step 5 with `config_plugins`).
- Failure modes surface with clear statuses: `incompatible-spec`, `invalid-manifest`, `load-error`.

Acceptance: drop a bogus plugin (bad manifest, wrong specCompat, invalid extension) — each case produces a precise diagnostic; the kernel still boots.

#### Step 1c — Orchestrator + CLI dispatcher + introspection

- Scan orchestrator skeleton running the (still-empty) registry pipeline end-to-end; emits `ProgressEmitterPort` events in the canonical order.
- Full Clipanion verb registration (every verb from `cli-contract.md` stubs out and prints "not-implemented" with exit `2` until its Step fills it in).
- `sm help --format json|md|human` fully operational.
- `docs/cli-reference.md` auto-generated from `sm help --format md`; CI blocks drift.
- Self-boot test green: with zero extensions installed, `sm scan` returns a zero-filled valid `ScanResult`.

Acceptance: `sm help` covers every verb in the spec, and `docs/cli-reference.md` is byte-equal to `sm help --format md` output in CI. The kernel-empty-boot conformance case passes end-to-end via the real orchestrator (not the stub from Step 0b).

### Step 2 — First extension instances

- Adapter: `claude`.
- Detectors: `frontmatter`, `slash`, `at-directive` (3 detectors; `external-url-counter` lands in Step 3 as the drop-in proof).
- Rules: `trigger-collision`, `broken-ref`, `superseded`.
- Renderer: `ascii`.
- Audit: `validate-all`.
- Actions: 0 shipped (contract available).

Acceptance: adding a 4th detector is a pure drop-in. Zero kernel touches. Step 3's `external-url-counter` is the live proof.

### Step 3 — Scan end-to-end

- `sm scan` full + `-n` + `--changed`.
- `sm list`, `sm show`, `sm check`.
- Triple-split bytes + tokens per node (`js-tiktoken`).
- **New detector**: `external-url-counter` — drops in as the 4th detector; no kernel touch (validates Step 2's litmus test). Emits one pseudo-link per distinct http/https URL in body (normalized, deduped) so the orchestrator's count pass can populate `scan_nodes.external_refs_count`.
- `links_out_count`, `links_in_count`, `external_refs_count` denormalized on `scan_nodes`.
- Self-scan test green (mandatory).

### Step 4 — History + orphan reconciliation

- Execution table `state_executions`.
- `sm history` + filters + `stats`.
- Orphan detection.
- **Automatic rename heuristic**: on scan, when a deleted `node.path` and a newly-seen `node.path` share the same `body_hash`, the scan migrates `state_*` FK rows (executions, jobs, summaries, enrichment) from the old path to the new one at **high** confidence without prompt. `frontmatter_hash`-only match against a **single** candidate → **medium** confidence → emits an `auto-rename-medium` issue (with `data_json.from` + `data_json.to` for machine readback) so the user can inspect / revert. `frontmatter_hash` match against **multiple** candidates → no migration; emits an `auto-rename-ambiguous` issue with `data_json.to` + `data_json.candidates: [...]` so the user can pick via `sm orphans undo-rename --from <old.path>`. Any residual unmatched deletion → `orphan` issue.
- `sm orphans reconcile <orphan.path> --to <new.path>` — forward manual override for semantic-only matches or history repair.
- `sm orphans undo-rename <new.path> [--force]` — reverse a medium-confidence auto-rename. Reads the original path from the issue's `data_json`, migrates `state_*` FKs back, resolves the issue; the prior path becomes an `orphan`. For `auto-rename-ambiguous` issues, requires `--from <old.path>` to disambiguate.

### Step 5 — Config + onboarding

- `.skill-map.json` + `.skill-mapignore`.
- `sm init` scaffolding.
- `sm plugins list / enable / disable / show / doctor`.
- Frontmatter schemas enforced (warn by default, `--strict` promotes to error).

### Step 6 — Robustness

- Detector conflict resolution.
- Incremental scan via `chokidar` (prepares live validation).
- Trigger normalization pipeline wired into every detector that emits `link.trigger` (see §Trigger normalization for the full 6-step spec and worked examples).
- Job retention policy enforced via `sm job prune` (drives `jobs.retention.completed` / `jobs.retention.failed`). `state_executions` remains append-only — no GC for history rows in `v0.1` (if demand appears post-`v1.0`, a dedicated `history.retention.*` block will be added).

### Step 7 — Diff + export

- `sm scan --compare-with`, `sm export`, `sm graph`.

### Step 8 — Plugin author UX

- Drop-in plugin discovery (already scaffolded).
- `skill-map/testkit` module exported.
- Plugin API docs.
- Error mode: broken plugin shows clear diagnostic.

### ▶ CUT 1 — v0.5.0 (deterministic, offline, zero LLM)

---

### Step 9 — Job subsystem + first summarizer

- `state_jobs` table + atomic claim via `UPDATE ... RETURNING id`.
- Job file rendering with kernel-enforced preamble + `<user-content>` delimiters.
- `sm job submit / list / show / preview / claim / run / run --all / status / cancel / prune`.
- `sm record` with nonce authentication.
- CLI runner loop (`sm job run`) + `ClaudeCliRunner` (`claude -p` subprocess) as the default `RunnerPort` impl. Submission and claim MUST succeed even when `claude` is absent; only `sm job run` requires it, and MUST fail fast with a clear error (exit 2) pointing the user at installation docs when the binary is missing.
- `sm doctor` learns to probe LLM runner availability here (lands with the first runner, even though verbs that use it arrive progressively through Step 10).
- Skill agent (`/skill-map:run-queue` + `sm-cli-run-queue` skill package).
- `skill-summarizer` built-in (first summarizer).
- Duplicate detection via `contentHash` + `--force`.
- Per-action TTL + auto-reap.
- Progress events (pretty / `--stream-output` / `--json`).
- `github-enrichment` bundled plugin (hash verification).
- Close conformance case `preamble-bitwise-match` (deferred from Step 0a — needs `sm job preview` to render a job file for byte-exact comparison against `spec/conformance/fixtures/preamble-v1.txt`).

### Step 10 — Remaining summarizers + LLM verbs + findings

- `agent-summarizer`, `command-summarizer`, `hook-summarizer`, `note-summarizer`.
- `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization`.
- `sm findings` CLI verb.
- `/skill-map:explore` meta-skill.
- `state_summaries` is exercised by all five per-kind summarizers (the table lands in Step 9 with `skill-summarizer`; Step 10 fills out the remaining four kinds). `state_enrichment` accepts additional providers beyond `github-enrichment` when they ship, against the stable contract.

### ▶ CUT 2 — v0.8.0 (LLM optional layer)

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
- Wire the `chokidar` watcher introduced in Step 6 into the WS broadcaster so file changes stream to the UI live.

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
- **Launch polish on `skill-map.dev`**: the domain is already live (Railway-deployed Caddy + DNS at Vercel, serving `/spec/v0/**` schemas); Step 13 adds the marketing landing page, redirects, SEO, Astro Starlight docs, and registration on JSON Schema Store once `v0 → v1` cuts.

### ▶ CUT 3 — v1.0.0 (full distributable)

---

## Decision log

Canonical index of every locked-in decision. Each row carries a stable number so the rest of the repo — `spec/`, `AGENTS.md`, commits, PR descriptions, changesets — can cite a single anchor (e.g. *"per Decision #74d"*) instead of paraphrasing the rationale.

Conventions:

- **Numbering is sparse on purpose**. Sub-items (`74a`…`74e`) land where they belong thematically rather than at the end of the list; gaps are reserved for future rows on the same topic.
- **Thematic groups, not chronology**. Rows are grouped by domain (Architecture, Persistence, Jobs, Plugins, UI, etc.). Reading a single group gives you every decision on that surface.
- **Most entries have a narrative counterpart** elsewhere in this `ROADMAP.md` or in `spec/` — the table row is the one-liner, the narrative section is the rationale. If an entry is table-only, its row states the "why" in full.
- **Source of truth for AI agents**. `AGENTS.md §Decisions already locked` carries the short-list version for operating rules; whenever that list and this table disagree, this table wins (and `AGENTS.md` is updated in the same PR).
- **Immutability**. Rows are not edited away once locked — a changed decision gets a new row and the old row flips to "superseded by #N" with a date. That keeps history auditable instead of rewriting it.

Decisions from working sessions 2026-04-19 / 20 / 21 plus pre-session carry-over.

### Architecture

| # | Item | Resolution |
|---|---|---|
| 1 | Target runtime | Node 24+ required (active LTS). **Enforcement**: (a) runtime guard in `bin/sm.mjs` fails fast with a human message and exit code 2 before any import — guarantees clear UX on Node 20 / 22; (b) `engines.node: ">=24.0"` in `package.json` gives npm an `EBADENGINE` warning (non-blocking unless the user sets `engine-strict=true`); (c) `sm version` and `sm doctor` both report the detected Node; (d) `tsup.target: "node24"` matches the runtime floor at build time. |
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
| 21 | Trigger normalization | 6-step pipeline: NFD → strip diacritics → lowercase → unify hyphen/underscore/space → collapse whitespace → trim. `link.trigger` carries both `originalTrigger` (display) and `normalizedTrigger` (equality / collision key). Full contract and worked examples in §Trigger normalization. |
| 22 | External URL handling | **Count only** on `scan_nodes.external_refs_count`. No separate table. No liveness check through `v1.0`. |
| 23 | Reference counts | Denormalized columns: `links_out_count`, `links_in_count`, `external_refs_count`. |
| 24 | Orphan reconciliation | `body_hash` match → high confidence auto-rename (no issue, no prompt). `frontmatter_hash` match → medium, emits `auto-rename-medium` issue with `data_json.from/to`. No match → `orphan` issue. Manual verbs: `sm orphans reconcile <orphan> --to <new>` (forward, attach orphan to live node) and `sm orphans undo-rename <new> [--force]` (reverse a medium/ambiguous auto-rename; needs `--from` for ambiguous). |
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
| 35 | Sequential execution | Jobs run sequentially within a single runner (no pool, no scheduler) through `v1.0`. Event schema carries `runId` + `jobId` so true in-runner parallelism lands as a non-breaking post-`v1.0` extension. |
| 36 | Prompt injection mitigation | User-content delimiters + auto-prepended preamble (kernel-enforced). |
| 37 | Job concurrency (same action, same node) | Refuse duplicate with `--force` override. Content hash over action+version+node hashes+template hash. |
| 38 | Exit codes | `0` ok · `1` issues · `2` error · `3` duplicate · `4` nonce-mismatch · `5` not-found. `6–15` reserved for future spec use. `≥16` free for verb-specific use. |
| 39 | TTL resolution (three steps) | Normative in `spec/job-lifecycle.md §TTL resolution`. (1) **Base duration** = action manifest `expectedDurationSeconds` OR config `jobs.ttlSeconds` (default `3600`). (2) **Computed** = `max(base × graceMultiplier, minimumTtlSeconds)` (defaults `3` and `60`; the floor is a floor, never a default). (3) **Overrides** (later wins, skips the formula): `jobs.perActionTtl.<actionId>`, then `sm job submit --ttl <n>`. Frozen on `state_jobs.ttlSeconds` at submit. Negative or zero overrides rejected with exit `2`. |
| 40 | TTL override precedence | Applies after the computed TTL (see #39). `jobs.perActionTtl.<actionId>` replaces the computed value entirely; CLI `--ttl <n>` replaces everything above it. |
| 40a | Job priority | `state_jobs.priority` (INTEGER, default `0`). Higher runs first; ties broken by `createdAt ASC`. Negatives allowed. Set via manifest `defaultPriority`, user config `jobs.perActionPriority.<id>`, or CLI `--priority <n>` (later wins). Frozen at submit. |
| 41 | Auto-reap | At start of every `sm job run`. Rows in `running` with expired TTL (`claimedAt + ttlSeconds × 1000 < now`) transition to `failed` with `failureReason = abandoned`. Rowcount reported as `run.reap.completed.reapedCount`. |
| 42 | Atomicity edge cases | Per-scenario policy: missing file → failed(job-file-missing); orphan file → reported by doctor, user prunes; edited file → by design. |

### Actions and summarizers

| # | Item | Resolution |
|---|---|---|
| 43 | Action execution modes | `local` (code in plugin) + `invocation-template` (prompt for LLM runner). |
| 44 | Summarizer pattern | Action per node-kind. `skill-summarizer`, `agent-summarizer`, `command-summarizer`, `hook-summarizer`, `note-summarizer`. 5 schemas in spec. CUT 2 (`v0.8.0`) ships all 5: `skill-summarizer` at Step 9, the remaining four at Step 10. CUT 1 (`v0.5.0`) ships none — the LLM layer is entirely post-CUT-1. |
| 45 | Default prob-refresh | Adapter declares `defaultRefreshAction` per kind. UI "🧠 prob" button submits this. |
| 46 | Report base schema | All probabilistic reports extend `report-base.schema.json`. Contains `confidence` (metacognition) + `safety` (input assessment). |
| 47 | Safety object | Sibling of confidence: `injectionDetected`, `injectionType` (direct-override / role-swap / hidden-instruction / other), `contentQuality` (clean / suspicious / malformed). |
| 48 | Conversational verbs | One-shot CLI + `/skill-map:explore` meta-skill. No multi-turn jobs in kernel. |
| 49 | LLM verbs (CUT 2) | Ambitious set shipped at Step 10: `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization`. All single-turn. CUT 1 (`v0.5.0`) ships none — deterministic verbs only. |
| 50 | `sm findings` verb | New. Separate from `sm check` (deterministic). Queries probabilistic findings stored in DB. |

### Plugins

| # | Item | Resolution |
|---|---|---|
| 51 | Drop-in | Default. No `add`/`remove` verbs. User drops files. `enable`/`disable` persisted. |
| 52 | specCompat | `semver.satisfies(specVersion, plugin.specCompat)`. Fail → `disabled` with reason `incompatible-spec`. |
| 53 | Storage dual mode | Mode A (KV via `ctx.store`) and Mode B (dedicated tables, plugin declares). **A plugin MUST declare exactly one storage mode.** Mixing is forbidden; a plugin that needs KV-like and relational access uses mode B and implements KV rows as a dedicated table. |
| 54 | Mode B triple protection | Prefix enforcement + DDL validation + scoped connection wrapper. Guards accidents, not hostile plugins. |
| 55 | Tool permissions per node | Frontmatter carries two top-level arrays (mirroring Claude Code conventions): `tools[]` — **allowlist**, the host MUST restrict the node to exactly these tools when present (matches Claude subagent `tools`); `allowedTools[]` — **pre-approval**, tools that don't require a per-use permission prompt while the node is active (matches Claude skill `allowed-tools`). Both live on `base` so every kind inherits them. Kind-specific interpretation: agents use the allowlist to lock spawned subagents; skills typically populate `allowedTools[]` to opt into silent execution; other kinds use them as declarative hints. `expectedTools` on action manifests (not frontmatter) is a separate field with distinct semantics (hint from the action template to the runner). |
| 56 | Default plugin pack | Pattern confirmed. Contents TBD. Only `github-enrichment` firm commitment. Security scanner as spec'd interface for third-parties. |

### Enrichment

| # | Item | Resolution |
|---|---|---|
| 57 | Enrichment scope | GitHub only through `v1.0.0`. Skills.sh dropped (no public API). npm dropped. `github-enrichment` is the only bundled enrichment action — it ships at Step 9 (CUT 2). Other providers land post-`v1.0` against the same stable contract. |
| 58 | Hash verification | Explicit declaration + compare. No reverse-lookup (no API). |
| 59 | GitHub idempotency | SHA pin + branch resolution cache + optional ETag. |
| 60 | Enrichment invocation | No dedicated verb. Uses `sm job submit <action> --all`. **`--all` is a universal flag**: any verb that takes a target identifier (`-n <node.path>`, `<job.id>`, `<plugin.id>`, etc.) MUST accept `--all` as "apply to every eligible target matching the verb's preconditions" (e.g. `sm plugins disable --all` = every plugin; `sm job cancel --all` = every running job). Verbs that inherently target everything (`sm scan` without `-n`, `sm list`, `sm check`, `sm doctor`) ignore `--all` — the flag is accepted for script-composition uniformity but is a no-op. |
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
| 72 | Frontend framework | **Angular ≥ 21** (standalone components). Locked at Step 0c; `ui/package.json` pins `^21.0.0`. Replaces original SolidJS pick — driven by Foblex Flow being the only Angular-native node-based UI library in the market. Major bumps revisited case-by-case, not automatic. |
| 73 | Node-based UI library | **Foblex Flow** — chosen for card-style nodes with arbitrary HTML, active maintenance, and Angular-native design. Replaces Cytoscape.js (which was dot/graph-oriented, not card-oriented). |
| 74 | Component library | **PrimeNG** for tables, forms, dialogs, menus, overlays. |
| 74a | UI styling | **SCSS scoped per component**. No utility CSS framework (no Tailwind, no PrimeFlex) — PrimeFlex is in maintenance mode, Tailwind overlaps with PrimeNG theming. Utilities come back later only if real friction appears. |
| 74b | UI workspace layout | `ui/` is an npm workspace peer of `spec/` and `src/`. Kernel stays Angular-agnostic; UI imports only typed contracts from `spec/`. No cross-import from `src/` into `ui/` or vice versa. |
| 74c | BFF mandate | Single-port: `sm serve` exposes SPA + REST + WS under one listener. Dev uses Angular dev server with `proxy.conf.json` → Hono for `/api` and `/ws`; prod uses Hono + `serveStatic`. |
| 74d | BFF framework | **Hono**, thin proxy over the kernel. No domain logic, no second DI. NestJS considered and rejected as over-engineered for a single-client BFF. |
| 74e | WebSocket library | Server: `hono/ws` + `@hono/node-ws` — co-located with the Hono router, same listener as REST (single-port). Client: browser-native `WebSocket` or Node 24 global `WebSocket` — no extra dep. `ws` rejected (duplicates multiplex glue). |
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
| 87 | Domain | `skill-map.dev` — live today (Railway + Caddy, DNS via Vercel). `$id` scheme `https://skill-map.dev/spec/v0/<path>.schema.json`; bumps to `v1` at the first stable cut. Landing page + SEO + Starlight docs deferred to Step 13. |
| 88 | ID format family | Base shape `<prefix>-YYYYMMDD-HHMMSS-XXXX` (UTC timestamp + 4 lowercase hex chars), with one optional `<mode>` segment on runs. Prefixes: `d-` jobs (`state_jobs.id`), `e-` execution records (`state_executions.id`), `r-[<mode>-]` runs (`runId` on progress events). Canonical `<mode>` values: `ext` (external Skill claims), `scan` (scan runs), `check` (standalone issue recomputations). Without `<mode>`, `r-YYYYMMDD-HHMMSS-XXXX` denotes the CLI runner's own loop. New `<mode>` values are additive-minor; removing or repurposing one is a major spec bump. Human-readable, sortable, collision-safe for single-writer. |

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
- **Remaining tech stack picks** (YAML parser, MD parsing, templating, pretty CLI libs, globbing, diff) — each lands with the step that first requires it (see §Tech picks deferred).
- **`## Stability` section missing in 7 prose docs** — the AGENTS.md rule "each prose doc ends with a `## Stability` section" is satisfied today only by `CHANGELOG.md`, `versioning.md`, `job-events.md`, `interfaces/security-scanner.md`, and (since the TTL audit) `job-lifecycle.md`. Still missing in `README.md`, `architecture.md`, `cli-contract.md`, `prompt-preamble.md`, `db-schema.md`, `plugin-kv-api.md`. Explicitly deferred to the pre-`spec-v1.0.0` freeze pass (same work window as reviewing every `Stability: experimental` tag); not a blocker for Phase A or B.

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
- **Skills.sh enrichment** — see §Enrichment (dropped; no public API after investigation).
- **URL liveness in the core product** — post-`v1.0` plugin if demand appears.
- **Multi-turn jobs in the kernel** — kernel stays single-turn; conversation lives in agent skill.
- **`skill-manager` / `skillctl` naming** — `skill-map` preserved.
- **Per-verb `explore-*` skills** — single `/skill-map:explore` meta-skill.
