# Skill-Map — Notebook LM Markdown

> Documento fuente para Notebook LM: contiene la definición, el alcance funcional, el estado del proyecto y la arquitectura de extensión de **skill-map**, listo para ser convertido en un episodio de podcast.

---

## ¿Qué es skill-map?

Skill-map es un **explorador visual de grafos** para tu colección de archivos Markdown — los *skills*, *agents*, *commands*, *hooks* y notas que arman un ecosistema de agentes de IA (Claude Code, Codex, Gemini, Copilot, y otros). Es CLI-first, funciona 100% offline, y opcionalmente puede consultar a un LLM cuando quieres análisis semántico.

La idea central es simple. Cuando trabajas con agentes de IA terminas acumulando decenas — a veces cientos — de archivos Markdown que se invocan entre sí. Y, llegado un punto, **nadie tiene visibilidad sobre qué referencia a qué, qué se solapa, qué quedó huérfano, o cuántos tokens estás gastando en cada uno**. Skill-map convierte ese desorden en un grafo navegable: lo abres en el navegador, ves la red completa, y entiendes en segundos lo que antes te costaba horas de leer carpetas a ciegas.

Si tuvieras que resumirlo en una frase: *"De ecosistema caótico a agentes predecibles."*

---

## El mapa es el corazón del producto

La visualización no es un agregado — es la propuesta principal. Skill-map renderiza tu colección como un **mapa interactivo en el navegador**:

- **Nodos coloreados por tipo** (skill, agent, command, hook, note) para que el cerebro los distinga sin leer.
- **Conexiones diferenciadas por relación**: `invokes` (un skill llama a otro), `references` (cita por nombre), `mentions` (aparece en el cuerpo), `supersedes` (esto reemplaza a aquello).
- **Layout automático** con Dagre, navegación con pan y zoom suave gracias a Foblex Flow.
- **Cards expandibles** dentro de cada nodo: ves el frontmatter, los stats (bytes, tokens, links entrantes y salientes), una vista previa del cuerpo, y los issues abiertos sin abandonar el grafo.

Skill-map te ofrece **tres vistas** sobre el mismo dataset:

1. **Lista** — tabla filtrable y ordenable, ideal cuando buscas algo específico por nombre.
2. **Grafo** — el mapa interactivo. Aquí pasas el tiempo cuando exploras relaciones.
3. **Inspector** — vista detalle por nodo: metadata, render Markdown del cuerpo, panel de nodos enlazados, refresh por card.

El grafo se actualiza **en vivo**: corres `sm watch`, editas un archivo en tu editor, y los cambios viajan por WebSocket al navegador y reflejan al instante. No hace falta refrescar.

Si quieres probarlo sin instalar nada, hay un **demo gratuito en `skill-map.dev/demo/`** que corre por completo en el navegador, sobre datos sintéticos.

---

## ¿Qué hace hoy?

- Detecta **colisiones de triggers** — dos skills disputando el mismo input.
- Lista **huérfanos** — archivos que nadie referencia y que probablemente puedes borrar.
- Mide **peso por nodo** en bytes y tokens, así ves de un vistazo dónde se va tu presupuesto del LLM.
- Mapea **referencias externas** — URLs, paquetes npm citados, dependencias afuera del repo.
- Detecta **superseded** — un skill nuevo que reemplaza a uno viejo que sigue activo, con heurística de auto-rename y propagación.
- Persiste todo en **SQLite**, con tablas separadas para historia (`state_*`) y snapshots regenerables (`scan_*`).
- Configurable por **capas** (defaults → global → proyecto → local → variables de entorno), con `.skillmapignore` para excluir y `sm init` para arrancar un proyecto desde cero.
- **Web UI integrada** (`sm serve`) con BFF Hono single-port, SPA Angular, dark-mode tri-state (auto / light / dark según preferencia del sistema), bundle inicial bajo 500 KB.
- **Watch mode**: `sm watch` o `sm serve` siguen los cambios en disco con chokidar y emiten eventos.
- **Mini-lenguaje de export** para `sm export` — filtros por tipo, por path, por estabilidad.
- **Tres paquetes públicos en npm**: `@skill-map/spec`, `@skill-map/cli`, `@skill-map/testkit`.

Todo lo anterior funciona **sin LLM**. El LLM entra como capa opcional en la siguiente fase.

---

## Estado: beta activa

Skill-map está en **beta** — pre-1.0, en desarrollo muy activo. La trayectoria se divide en tres fases públicas:

- **Fase A (✅ cerrada)** — Núcleo determinístico + CLI + Web UI baseline. Es lo que hoy es real, instalable y útil. Cierra la versión `v0.6.0`.
- **Fase B (próxima)** — La capa LLM como opt-in. Subsistema de jobs con *atomic claim* y *nonce*, primera extensión probabilística (un *summarizer* que convierte un skill en un brief estructurado), summarizers por tipo, y verbos semánticos como `sm what` (qué hace este skill), `sm dedupe` (encuentra duplicados semánticos), `sm cluster-triggers` (agrupa triggers que se solapan), `sm impact-of` (si toco esto, qué se mueve), `sm recommend-optimization` (ideas para reducir tokens o redundancia). La UI gana cards read-only para *summaries*, *enrichments* y *findings*. Apunta a `v0.8.0`.
- **Fase C (objetivo 1.0)** — Formatters adicionales (Mermaid para README, DOT/Graphviz para CI), providers multi-host (Codex, Gemini, Copilot, genérico), UI más profunda con los verbos LLM convertidos en flujos interactivos, queue inspector, dashboard de costos, y distribución final como single npm package con la UI empaquetada adentro. Apunta a `v1.0.0`.

Más de **117 decisiones arquitectónicas** quedaron documentadas en el roadmap antes del primer commit. La spec pública incluye 29 JSON Schemas, contratos en prosa, y una suite de conformance en el paquete `@skill-map/spec`. Pre-1.0 significa que las versiones se mueven, pero el comportamiento y la spec están comprometidos hacia una `1.0.0` deliberada y estabilizadora — no un accidente.

---

## Diseñado para extenderse: seis tipos de plugins

El kernel de skill-map es **deliberadamente ignorante**. No sabe qué es un skill de Claude, ni cómo se invoca un command, ni qué regla validar. Todo ese conocimiento vive en **extensiones** que se cargan como plugins drop-in: dejas una carpeta bajo `.skill-map/plugins/<id>/` y el kernel la levanta.

Hay **seis tipos de extensión**, ni uno más:

### 1. Provider

Reconoce una plataforma. Sabe la *layout on-disk* de un host concreto y cómo clasificar archivos en los seis tipos de nodo.

Hoy existe un Provider para **Claude Code** que entiende que los skills viven en `~/.claude/skills/`, los agents en `~/.claude/agents/`, los commands en `~/.claude/commands/`. Próximos en la fase C: **Codex**, **Gemini**, **Copilot**, y un **Provider genérico** guiado por frontmatter para casos no oficiales. Un Provider es siempre determinístico — la clasificación de archivos no admite ambigüedad.

### 2. Extractor

Lee un archivo Markdown y extrae los **links** que produce el grafo. Cada Extractor mira una superficie distinta del archivo:

- Un extractor de **frontmatter** lee campos como `uses`, `triggers`, `requires`.
- Un extractor de **slash-commands** detecta menciones tipo `/skill-name` en el cuerpo.
- Un extractor de **at-directives** detecta `@agent-name`.
- Un extractor de **URLs externas** cuenta cuántas referencias salen del repositorio (útil para auditar dependencias).

Pueden ser determinísticos (regex y parsing) o probabilísticos (un LLM identifica menciones implícitas que un regex no captura). Cada Extractor declara su modo.

### 3. Rule

Produce **issues determinísticos** sobre el grafo. Algunas que vienen incluidas:

- `trigger-collision` — dos skills disputando el mismo input.
- `broken-ref` — un link a un nodo que no existe.
- `superseded` — un skill que dice reemplazar a otro y el otro sigue activo.
- `link-conflict` — dos Extractors discrepando sobre un mismo link.

Las Rules corren dentro de `sm scan` y `sm check`. También pueden ser probabilísticas: por ejemplo, una Rule que evalúa la calidad de la prosa o detecta redundancia semántica entre dos skills.

### 4. Action

Es el **único** tipo de plugin que toca disco. Una Action ejecuta una operación sobre uno o más nodos:

- En modo **determinístico**, es código directo: renombrar un trigger, ajustar un campo del frontmatter, mover un archivo entre carpetas.
- En modo **probabilístico**, es un prompt que un LLM ejecuta a través del *job subsystem* — con *atomic claim* (dos workers no pueden tomar el mismo job), *nonce* (cada job verifica su autoridad antes de escribir), y un *preamble* forzado por el kernel para garantizar contexto y formato.

Las Actions son lo que convierte a skill-map en una herramienta de **gestión**, no sólo de observación.

### 5. Formatter

Serializa el grafo a un formato externo. Hoy hay un Formatter **ASCII** para imprimir el grafo en la terminal. Próximos en la fase C: **Mermaid** (para incrustar diagramas en `README.md` y docs), **DOT / Graphviz** (para integrarlo en CI o herramientas externas), y exportación de **subgrafos con filtros**. Los Formatters son siempre determinísticos — la representación del grafo tiene que ser reproducible.

### 6. Hook

Reacciona a **eventos del ciclo de vida del kernel**. Hay un set curado de eventos a los que un Hook puede suscribirse: `scan.started`, `scan.completed`, `issue.added`, `issue.resolved`, `job.started`, `job.completed`.

Un Hook puede, por ejemplo, **notificar a Slack** cuando aparece un issue de severidad alta, **escribir un audit log** después de cada scan, o **sincronizar metadata** con un sistema externo de tickets. Pueden ser determinísticos o probabilísticos (un LLM evaluando la relevancia del evento antes de decidir si notificar).

---

## El testkit oficial

Junto al CLI se publica `@skill-map/testkit`, un paquete dedicado para que **cualquier autor de plugins** escriba pruebas contra un contrato estable. Trae fixtures drop-in, helpers para construir un `ScanResult` esperado, y mock runners para tests determinísticos.

La premisa es simple: **si tu plugin no pasa los tests del testkit, el kernel no lo carga**. Esto evita que un plugin roto contamine el grafo del usuario y mantiene la promesa de "drop-in" sin riesgo.

---

## ¿Por qué importa?

Skill-map mira un problema que crece silenciosamente. Las colecciones de archivos Markdown que controlan a los agentes de IA empiezan ordenadas, y a los seis meses son una madeja. Tres tipos de usuario sienten ese dolor primero:

- **Equipos y arquitectos de plataforma** que mantienen colecciones compartidas de skills entre múltiples proyectos. Necesitan auditoría, deduplicación, y onboarding de nuevos miembros sin tener que leer 200 archivos.
- **Autores de skills, agents y plugins** que quieren detectar duplicados, redundancias y oportunidades de optimización antes de publicar.
- **Quienes debuggean** una invocación que salió mal — rastrear desde el trigger que dijo el usuario hasta el skill que ganó el match, en tiempo real.

Y como la spec es **pública y separable** de la implementación de referencia, cualquiera puede construir una segunda implementación, una UI alternativa, o tooling complementario consumiendo solo `@skill-map/spec`. Eso le da al estándar una vida más larga que la del proyecto que lo originó.

---

## Recursos

- Sitio oficial: <https://skill-map.dev>
- Demo en vivo en el navegador, sin instalar: <https://skill-map.dev/demo/>
- Repositorio en GitHub: <https://github.com/crystian/skill-map>
- Paquetes en npm: `@skill-map/spec`, `@skill-map/cli`, `@skill-map/testkit`
- Licencia: MIT (con Apache aceptado en contribuciones de skills)

Para empezar:

```bash
npm i -g @skill-map/cli
cd tu/proyecto
sm
```

Ese último `sm` abre la Web UI en `http://127.0.0.1:4242` con el watcher corriendo. Editas cualquier `.md` del proyecto y el grafo se actualiza en vivo en el navegador.
