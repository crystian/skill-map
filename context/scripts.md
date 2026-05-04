# context/scripts.md — scripts npm y workspaces

Convenciones para scripts npm en el monorepo skill-map. Mismo nivel de autoridad que `AGENTS.md`. Lectura obligada al tocar `package.json` (raíz o workspace) o cualquier `scripts/*` que se invoque desde un script npm.

## Patrón de naming

`componente:acción` para todo atajo en raíz: `bff:dev`, `cli:build`, `ui:dev`, `ui:build`, `e2e:dev`, `web:dev`, `web:build`, `demo:dev`, `demo:build`, `release:changeset`, `release:version`, `release:publish`. **Sin excepciones** para scripts nuevos en raíz.

## Qué va en raíz, qué va en workspace

**Raíz expone únicamente**:

- Atajos diarios `componente:dev` y `componente:build` por componente. "Diario" = lo que un dev usa varias veces por sesión. Si es esporádico (analyze, coverage, etc.), no entra.
- Orquestadores cross-workspace: `lint`, `lint:fix`, `validate`.
- Tooling de release: `release:changeset`, `release:version`, `release:publish`.
- Combos cross-workspace que ningún workspace solo cubre: `demo:build` (UI + scripts + fixtures), `demo:dev`.

**Todo lo demás vive en su workspace**: typecheck, test, test:ci, test:coverage, lint, build, dev modes secundarios, bundle-analyze, watch builds, clean. Se invoca con `npm run X --workspace=Y` o entrando al workspace.

## El contrato `validate`

Cada workspace expone su propio `validate` autocontenido — ejecuta lo que tenga sentido validar para ese componente, sin depender de pasos previos del raíz.

| Workspace | `validate` |
|---|---|
| `@skill-map/spec` | `spec:check` (índice + coverage) + `pin:check` |
| `@skill-map/cli` | `typecheck` + `lint` + `build` + `test:ci` + `reference:check` |
| `ui` | `test:ci` + `build` |
| `@skill-map/testkit` | `typecheck` + `build` + `test:ci` |
| `skill-map-e2e` | `test:ci` (con `prevalidate` que prepara demo + browsers) |
| `@skill-map/example-hello-world` | `test:ci` |
| `@skill-map/web` | `build` |

Raíz orquesta con `npm run validate --workspaces --if-present`. CI corre solo este comando — los pasos individuales del job `validate` se eliminan a medida que cada workspace adopta su `validate`.

### Workspaces consumer y `prevalidate`

Cuando un workspace depende de artefactos externos para validarse (ej. e2e necesita `web/demo/` construido + browsers de Playwright), usa el hook `prevalidate` de npm para autoprepararse. Ejemplo en `e2e/package.json`:

```json
"prevalidate": "npm run install:browsers && npm --prefix .. run demo:build",
"validate": "npm run test:ci"
```

El orquestador raíz no sabe ni necesita saber del orden — cada workspace declara sus prerrequisitos vía `prevalidate`.

## Casos especiales (asimetrías intencionales)

- **BFF** no es workspace (vive embebido en `src/server/` y se publica como parte del CLI). Pero `bff:dev` existe en raíz porque iterar el BFF tiene identidad mental propia.
- **Demo** es un artefacto cross-workspace (UI buildeada + scripts + fixtures), no un workspace. Sus atajos en raíz reflejan la realidad del artefacto.
- **`start`** queda en raíz pero pendiente de rediseño: el target final es levantar BFF + UI en paralelo.

## Anti-patrones

- ❌ **Scripts en raíz que delegan a un solo workspace específico**. Sesga al monorepo y rompe la simetría. Si solo aplica a un workspace, vive en el workspace. Excepción: combos cross-workspace genuinos como `demo:build`.
- ❌ **Scripts duplicados con el orquestador**. `validate` raíz cubre lint + test + build + typecheck por workspace; un `lint` raíz redundante con `validate` es ruido. Mantener `lint`/`lint:fix` en raíz se justifica solo como atajo de iteración rápida (no orquestación).
- ❌ **Scripts npm raíz que invocan `.js` propios de un workspace**. Si el `.js` es del workspace, el script npm que lo invoca vive en el workspace. Raíz solo invoca via `npm run X --workspace=Y` (no via `node workspace/scripts/foo.js`).
- ❌ **Aliases que rompen `componente:acción`**. `start`, `web` (sin acción), `site:build` (componente "site" inventado), `smoke:demo` (acción primero) — todos eliminados o renombrados. No volver a introducirlos.

## Política para scripts en `scripts/` raíz

Un `.js` en `scripts/` raíz se justifica solo si **es genuinamente cross-workspace** (lo invoca CI directo, o lo usan ≥2 workspaces). Si pertenece a un workspace, mudarlo adentro y exponerlo via npm script del workspace.

**Estado actual** (pendiente de migrar):

| Script | Hogar natural |
|---|---|
| `build-spec-index.js`, `sync-spec-pin.js`, `check-coverage.js` | `spec/` |
| `build-cli-reference.js`, `dev-serve.js` | `src/` (CLI) |
| `dev-server.js`, `build-site.js`, `build-demo-dataset.js`, `patch-demo-mode.js`, `serve-demo.js` | `web/` (sitio + demo) |
| `open-sqlite-browser.js` | desaparece cuando `sqlite` migre a sub-comando del CLI |
| `check-changeset.js` | utility cross-cutting (CI-only); queda en raíz |

`check-coverage.js` además depende del cwd (usa `resolve('spec/...')` sin anchor) — al migrarlo se arregla.

## Cuándo agregar / mover / eliminar

- **Agregar un script en raíz**: solo si es atajo diario `componente:acción` por un componente que ya tiene workspace, o si es un orquestador cross-workspace genuino. Si dudás, va al workspace.
- **Agregar un script en workspace**: libre, siguiendo convención npm (`build`, `dev`, `test`, `test:ci`, `lint`, `validate`).
- **Mover un script de raíz a workspace**: actualizar todas las referencias (CI, docs, otros scripts), correr `npm run validate` antes de commit.
- **Eliminar un script**: idem, y verificar que no rompe `release.yml` (los scripts de release se invocan por nombre desde la action de Changesets).
