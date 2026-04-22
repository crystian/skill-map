[🇬🇧 English](./README.md) · **🇦🇷 Español**

# skill-map

> Mapear, inspeccionar y gestionar colecciones de archivos Markdown interrelacionados — en particular skills, agents, commands, hooks y notas que componen ecosistemas de agentes de IA.

**Estado**: los Steps **0a** (spec bootstrap) y **0b** (implementation bootstrap) están **completos**. El paquete npm `@skill-map/spec` está publicado (versión en [`spec/package.json`](./spec/package.json) y [`spec/CHANGELOG.md`](./spec/CHANGELOG.md)); el CLI `skill-map` shipea un `scan` stub y bootea limpio. Próximo: **Step 0c — UI prototype**. Ver [ROADMAP.md](./ROADMAP.md) para el marcador de completitud y el plan de ejecución completo.

## En una frase

Un explorador de grafo para ecosistemas de agentes de IA basados en Markdown (Claude Code, Codex, Gemini, Copilot y otros). Detecta referencias cruzadas entre archivos, colisiones de triggers, huérfanos, dependencias externas y peso en tokens/bytes. CLI-first, totalmente determinista offline, con capa LLM opcional para análisis semántico.

## El problema que resuelve

Los desarrolladores que trabajan con agentes de IA acumulan decenas de skills, agents, commands y documentos sueltos. No hay visibilidad sobre:

- Qué existe y dónde vive.
- Quién invoca a quién (dependencias, referencias cruzadas).
- Qué triggers se solapan o pisan entre sí.
- Qué está vivo vs obsoleto.
- Qué se puede borrar sin romper nada.
- Cuándo fue la última vez que se optimizó o validó cada skill.

Ninguna herramienta oficial (Anthropic, Cursor, GitHub, skills.sh) cubre esto. Obsidian ofrece gestión de notas pero no entiende semánticamente que un archivo es un skill ejecutable. `skill-map` llena ese hueco.

## Para quién

- Usuarios avanzados de Claude Code (u otros agentes) que mantienen varios plugins / skills propios.
- Equipos que comparten colecciones de skills y necesitan auditoría.
- Autores de plugins / actions que quieren testear y validar sus creaciones.
- Desarrolladores que quieren construir herramientas encima del grafo (vía CLI, JSON o plugins).

## Cómo funciona (alto nivel)

1. **Scanner determinista** recorre archivos, parsea frontmatter, detecta referencias y produce datos estructurados del grafo (nodos, links, issues).
2. **Capa LLM opcional** consume esos datos y agrega inteligencia semántica: valida referencias ambiguas, clusteriza triggers equivalentes, compara nodos, responde preguntas.
3. **CLI `sm`** expone todas las operaciones. Es la superficie primaria.
4. **Web UI** (prototipo pre-CUT-1 en Step 0c con datos mockeados; integración completa en `v1.0`) consume el mismo kernel y ofrece navegación visual, inspector y ejecución. El prototipo **no** se shipea en CUT 1 (`v0.5.0`).
5. **Sistema de plugins** (drop-in, kernel + extensiones) permite que terceros agreguen detectores, reglas, actions, adapters o renderers sin tocar el kernel.

## Filosofía

- **CLI-first**: todo lo que hace la UI se puede hacer en línea de comandos.
- **Determinista por default**: el LLM es opcional, nunca requerido. El producto funciona offline.
- **Kernel-first desde commit 1**: el núcleo no contiene conocimiento de ninguna plataforma ni detector específico. Todo vive como extensión.
- **Arquitectura hexagonal** (ports & adapters): el kernel es puro, los adapters (CLI, Server, Skill, SQLite, FS, Plugins, Runner) son intercambiables.
- **Tests desde commit 1**: pirámide completa (contract, unit, integration, self-scan, CLI, snapshot). Cada extensión trae su test o no bootea.
- **Agnóstico de plataforma**: aunque el primer adapter es Claude Code, la arquitectura soporta cualquier ecosistema de Markdown.
- **Distribuible**: versionado semántico, docs, plugin security, marketplace — pensado para usuarios externos, no solo para el autor.
- **Estándar público**: el spec (JSON Schemas + conformance suite + contratos) vive en `spec/`. Cualquiera puede construir una UI alternativa, una implementación en otro lenguaje, o tooling complementario consumiendo solo el spec.
- **`sm` nunca toca un LLM**: el binario es puro template rendering + DB + filesystem. El LLM vive en el proceso runner externo.

## Diferencias con Obsidian (competidor más cercano)

Obsidian mapea notas, no ejecutables. `skill-map`:

1. Entiende skills / agents como **unidades accionables** (ejecutables, con inputs, outputs, tools, triggers).
2. **CLI-first y headless** — corre en CI, pipelines, scripts shell. Obsidian es GUI-first.
3. **Capa AI-semántica** integrada al core (summarizers, verbos probabilísticos), no plugin de terceros.
4. **Actions ejecutables** — correr acciones sobre un nodo seleccionado (optimizar, validar, comparar) vía jobs.
5. **Testkit oficial** para autores de plugins — algo que Obsidian no tiene.

Posicionamiento: *"Obsidian for AI agents, not for notes"*. Las otras features candidatas (DataView, Templater, Graph View con filtros) ya están cubiertas por plugins de Obsidian — no competimos en eso.

## Glosario (esencial)

Vocabulario completo (en inglés) en [ROADMAP §Glossary](./ROADMAP.md#glossary).

- **Node** — archivo Markdown que el scanner trackea (skill, agent, command, hook, note); identificado por path relativo al scope root.
- **Link** — relación dirigida entre dos nodos (`invokes` / `references` / `mentions` / `supersedes`).
- **Issue** — problema determinista emitido por una rule.
- **Finding** — resultado de análisis probabilístico (detección de injection, low confidence, summary stale).
- **Extension kinds** (seis, estables) — **Adapter** (reconoce plataforma), **Detector** (extrae links), **Rule** (emite issues), **Action** (operación ejecutable), **Audit** (workflow determinista), **Renderer** (serializa el grafo).
- **Kernel** — core de dominio puro; no importa conocimiento de plataforma.
- **Port** — interfaz que declara el kernel (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`).
- **Job** — instancia de ejecución de un Action sobre uno o más nodos; vive en `state_jobs`.
- **Plugin** — bundle drop-in que registra extensiones en `<scope>/.skill-map/plugins/<id>/`.
- **Scope** — `project` (default, escanea el repo actual; DB en `./.skill-map/skill-map.db`) o `global` (opt-in con `-g`; DB en `~/.skill-map/skill-map.db`).

## Especificación

El spec vive en [`spec/`](./spec/) y es la fuente de verdad. Está separado de la implementación de referencia desde day zero, para que terceros puedan construir implementaciones alternativas consumiendo solo `spec/`.

- URL canónica: **[skill-map.dev](https://skill-map.dev)** (schemas en `https://skill-map.dev/spec/v0/<path>.schema.json`).
- Paquete npm: [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec) (publicado; versión en `spec/package.json` y `spec/CHANGELOG.md`).
- Contenido:
  - 29 JSON Schemas (draft 2020-12): 11 top-level (`node`, `link`, `issue`, `scan-result`, `execution-record`, `project-config`, `plugins-registry`, `job`, `report-base`, `conformance-case`, `history-stats`) + 7 extension schemas (`base` + uno por extension kind) + 6 frontmatter (`base` + 5 node kinds) + 5 summaries.
  - 7 contratos prose: `architecture`, `cli-contract`, `job-lifecycle`, `job-events`, `prompt-preamble`, `db-schema`, `plugin-kv-api`.
  - 1 interface: `security-scanner` (convención sobre el Action kind, NO un 7° extension kind).
  - Conformance suite: fixtures (`minimal-claude`, `preamble-v1.txt`) + 2 casos (`basic-scan`, `kernel-empty-boot`); `preamble-bitwise-match` diferido a Step 9.

## Estructura del repo

```
skill-map/                     raíz de npm workspaces (privada)
├── spec/                      spec — publicado como @skill-map/spec
├── src/                       implementación de referencia — publicada como skill-map (binarios: sm, skill-map)
├── scripts/                   build-site.mjs · build-spec-index.mjs · check-changeset.mjs · check-coverage.mjs
├── site/                      sitio público generado (servido por Caddy en Railway)
├── .changeset/                config de changesets + release notes pendientes (un archivo por cambio)
├── .github/workflows/         ci.yml (spec validate + build-test) · release.yml
├── Dockerfile                 imagen Caddy deployada a Railway
├── Caddyfile                  sirve los schemas en las URLs canónicas
├── AGENTS.md                  convenciones para agentes + estado del bootstrap
├── CLAUDE.md                  activación de persona (pointer a AGENTS.md)
├── CONTRIBUTING.md            workflow de PRs + reglas de changesets
├── README.md                  landing en inglés (default)
├── README.es.md               este archivo (espejo en español)
└── ROADMAP.md                 narrativa de diseño (decisiones, fases, diferidos)
```

El workspace `ui/` se une como tercer peer en Step 0c (Angular SPA + Foblex Flow + PrimeNG).

## Enlaces

- Diseño completo y roadmap: [ROADMAP.md](./ROADMAP.md)
- Glosario completo: [ROADMAP §Glossary](./ROADMAP.md#glossary)
- Superficie del spec y reglas de mantenimiento: [AGENTS.md](./AGENTS.md) (sección "Spec bootstrap status")
- Spec changelog: [spec/CHANGELOG.md](./spec/CHANGELOG.md) (versionado independiente de este repo)
- Versión en inglés de este README: [README.md](./README.md)
- Licencia: [MIT](./LICENSE)

## Licencia

MIT © Crystian
