[![lang: EN](https://img.shields.io/badge/lang-English-lightgrey)](./README.md)
[![lang: ES](https://img.shields.io/badge/lang-Espa%C3%B1ol-blue)](./README.es.md)

# skill-map

> Un explorador de grafos para los archivos Markdown que mueven tus agentes de IA.

[![npm](https://img.shields.io/npm/v/@skill-map/spec?color=cb3837&logo=npm&label=%40skill-map%2Fspec)](https://www.npmjs.com/package/@skill-map/spec)
[![CI](https://img.shields.io/github/actions/workflow/status/crystian/skill-map/ci.yml?branch=main&logo=github&label=CI)](https://github.com/crystian/skill-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

## En una frase

De ecosistema caótico a agentes predecibles — un explorador de grafos para ecosistemas de agentes de IA basados en Markdown (Claude Code, Codex, Gemini, Copilot y otros). Detecta colisiones, huérfanos, duplicados semánticos y skills obesas sobre un mismo grafo, con análisis estático y semántico (LLM) opcional.

![Interfaz de skill-map](https://skill-map.dev/img/screenshot-1.png)

## El problema que resuelve

Los desarrolladores que trabajan con agentes de IA acumulan decenas de skills, agents, commands y documentos sueltos. No hay visibilidad sobre:

- Cuántos tokens cuesta cada archivo Markdown — invisible si no lo medís, caro a escala.
- Qué existe y dónde vive.
- Quién invoca a quién (dependencias, referencias cruzadas).
- Qué triggers se solapan o pisan entre sí.
- Qué está vivo vs obsoleto.
- Qué se puede borrar sin romper nada.
- Cuándo fue la última vez que se optimizó o validó cada skill.

Ninguna herramienta oficial (Anthropic, Cursor, GitHub, skills.sh) cubre esto. `skill-map` llena ese hueco.

## Para quién

- **Equipos y arquitectos de plataforma** — múltiples proyectos, múltiples agentes, copias divergentes del mismo skill. Un solo scan pone toda la colmena en el mismo grafo.
- **Autores** — quienes crean skills, agents o commands y quieren detectar duplicados, redundancias y oportunidades de optimización antes de publicar.
- **Quienes depuran agentes** — cuando el agente eligió la invocación equivocada, rastreá el camino desde la frase trigger hasta el skill que ganó el match, en tiempo real.
- **Constructores de herramientas** — cualquiera que arme CLI, salida JSON o plugins encima del grafo.

## Cómo funciona (alto nivel)

1. **Scanner determinista** recorre archivos, parsea frontmatter, detecta referencias y produce datos estructurados del grafo (nodos, links, issues).
2. **Capa LLM opcional** consume esos datos y agrega inteligencia semántica: valida referencias ambiguas, clusteriza triggers equivalentes, compara nodos, responde preguntas.
3. **CLI `sm`** es la superficie primaria — todas las operaciones se hacen desde la línea de comandos. `sm` solo (sin args) abre la Web UI directo.
4. **Web UI** — incluida en el CLI, se lanza con un solo comando. El grafo se actualiza en vivo mientras editás cualquier `.md`. Una [demo](https://skill-map.dev/demo/) standalone corre en el navegador sin instalar nada.
5. **Sistema de plugins** (drop-in, kernel + extensiones) permite que terceros agreguen Providers, Extractors, Rules, Actions, Formatters o Hooks sin tocar el kernel.

## Dos modos de ejecución

Cada extensión analítica declara uno de dos modos: **`deterministic`** (código puro, rápido, gratis, corre dentro de `sm scan` / `sm check`, apto para CI) o **`probabilistic`** (invoca un LLM a través del kernel, corre como job en cola — nunca durante el scan). Mismo modelo de plugins, dos perfiles de costo. El determinista corre en pre-commit; el probabilístico se pone al día on-demand o de noche.

Contrato completo: [`spec/architecture.md`](./spec/architecture.md) §Execution modes.

## Filosofía

- **CLI-first**: todo lo que hace la UI se puede hacer en línea de comandos.
- **Determinista por default**: el LLM es opcional, nunca requerido. El producto funciona offline.
- **Estándar público**: el spec (JSON Schemas + conformance suite + contratos) vive en `spec/`. Cualquiera puede construir una UI alternativa, una implementación en otro lenguaje o tooling complementario consumiendo solo el spec.
- **Agnóstico de plataforma**: el primer adapter es Claude Code, pero la arquitectura soporta cualquier ecosistema de Markdown.

Detalles de arquitectura (kernel hexagonal, ports & adapters) en [`spec/architecture.md`](./spec/architecture.md).

## Inicio rápido

```bash
npm i -g @skill-map/cli
cd tu/proyecto
sm init
sm
```

Ese último `sm` abre la Web UI en `http://127.0.0.1:4242` con el watcher corriendo. Editás cualquier `.md` del proyecto y el grafo se actualiza en vivo en el navegador.

¿Querés probarlo sin instalar nada? Abrí la [demo en vivo](https://skill-map.dev/demo/).

## Tutorial interactivo (recomendado)

Si usás [Claude Code](https://claude.ai/code), la forma más rápida de evaluar skill-map es el tutorial interactivo que viene incluido — aprox. **7 minutos** para la demo, con un opcional de 30 min más para profundizar.

```bash
mkdir prueba-skill-map && cd prueba-skill-map
sm tutorial             # deja sm-tutorial.md en el directorio vacío
claude                  # abrí Claude Code en ese mismo directorio
# Después, dentro de Claude:
ejecutá @sm-tutorial.md
```

Claude se hace cargo desde ahí: arma una fixture, te guía por `sm init`, abre la Web UI, edita archivos delante tuyo y te muestra al watcher reaccionando en vivo (incluso cómo `.skillmapignore` esconde archivos en tiempo real). Ves el flujo completo antes de apuntarlo a tu proyecto real — sin compromiso, totalmente reversible.

## Glosario

- **Node** — archivo Markdown que el scanner trackea (skill, agent, command, hook, note).
- **Link** — relación dirigida entre dos nodos (`invokes` / `references` / `mentions` / `supersedes`).
- **Issue** — problema determinista emitido por una rule (link roto, colisión de triggers, huérfano).
- **Plugin** — bundle drop-in que agrega extensiones sin tocar el kernel.

Vocabulario completo (en inglés) en [ROADMAP §Glossary](./ROADMAP.md#glossary).

## Especificación

El spec es la fuente de verdad y vive en [`spec/`](./spec/) — separado de la implementación de referencia desde day zero, para que terceros puedan construir implementaciones alternativas consumiendo solo `spec/`.

- URL canónica: **[skill-map.dev](https://skill-map.dev)** (schemas en `https://skill-map.dev/spec/v0/<path>.schema.json`).
- Paquete npm: [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec).
- Contenido: JSON Schemas (draft 2020-12) + contratos prose + conformance suite. Inventario completo en [`spec/README.md`](./spec/README.md).

## Estructura del repo

```
skill-map/                     raíz de npm workspaces (privada)
├── spec/                      spec — publicado como @skill-map/spec
├── src/                       implementación de referencia — publicada como @skill-map/cli (binarios: sm, skill-map)
├── ui/                        SPA Angular (grafo, lista, inspector) — incluido en @skill-map/cli
├── web/                       sitio público (skill-map.dev) — aloja la demo bundle
├── scripts/                   scripts de build y validación (spec index, CLI reference, demo dataset, …)
├── ...
├── AGENTS.md                  manual operativo para agentes
└── ROADMAP.md                 narrativa de diseño (decisiones, fases, diferidos)
```

El workspace `ui/` shipea el SPA Angular con [Foblex Flow](https://flow.foblex.com) para la vista de grafo y componentes PrimeNG. `@skill-map/testkit` se sumó como tercer peer publicado, junto a `spec` y `src`.

## Enlaces

- Diseño completo y roadmap: [ROADMAP.md](./ROADMAP.md)
- Glosario completo: [ROADMAP §Glossary](./ROADMAP.md#glossary)
- Guía de contribución: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Overview del spec: [spec/README.md](./spec/README.md)
- Arquitectura (ports & adapters): [spec/architecture.md](./spec/architecture.md)
- Contrato CLI: [spec/cli-contract.md](./spec/cli-contract.md)
- Referencia CLI (auto-generada): [context/cli-reference.md](./context/cli-reference.md)
- Implementación de referencia: [src/README.md](./src/README.md)
- Versión en inglés de este README: [README.md](./README.md)
- Licencia: [MIT](./LICENSE)

## Historial de stars

[![Star History Chart](https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left)](https://www.star-history.com/?repos=crystian%2Fskill-map&type=timeline&legend=top-left)

## Licencia

MIT © Crystian
