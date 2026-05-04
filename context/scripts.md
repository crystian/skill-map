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

## Deploy de Railway con filter de paths

El sitio público (`skill-map.dev`) corre en Railway via Docker. La integración GitHub ↔ Railway estándar deploya en cada push a `main`, lo cual genera deploys innecesarios cuando el commit no toca lo que el sitio expone (cambios en `src/`, `testkit/`, `e2e/`, etc. no alteran el output deployado).

La política: **deploy solo cuando cambia algo que el sitio efectivamente publica**. Implementado en `.github/workflows/deploy-web.yml` con un `paths:` filter de GitHub Actions. Si ningún archivo del filter cambia, el workflow no se dispara y Railway no recibe nada.

### Paths que disparan deploy

| Path | Razón |
|---|---|
| `web/**` | fuente de la landing |
| `ui/**` | Angular bundle servido bajo `/demo/` |
| `spec/**` | schemas servidos bajo `/spec/v0/` (URL canónica) |
| `fixtures/demo-scope/**` | input al build del demo dataset |
| `Dockerfile`, `Caddyfile` | config del deploy y del server |
| `package.json`, `package-lock.json` (raíz) | deps que el Docker build instala |

Cambios fuera de esa lista (`src/`, `testkit/`, `e2e/`, `examples/`, `context/`, `.claude/`, root docs, etc.) **no** disparan deploy.

### Casos edge aceptados

- Cambios in-flight a `spec/` que no son release igual disparan deploy. Es deliberado: el sitio es la URL canónica de los schemas y debe reflejar el branch `main`.
- Cambios al CLI (`src/`) que pueden afectar lo que `build-demo-dataset.js` emite no disparan deploy. Aceptamos que el `data.json` del demo se regenere en el siguiente deploy legítimo.

### Setup manual (una vez)

Todo en GitHub repo Settings → Secrets and variables → Actions:

1. **Secrets** tab → New repository secret `RAILWAY_TOKEN` con un token generado en Railway dashboard (Project → Settings → Tokens).
2. **Variables** tab → New repository variable `RAILWAY_SERVICE` con el nombre del servicio tal como aparece en Railway (lo que el `--service` espera).
3. En el dashboard de Railway, **desconectar la integración GitHub ↔ Railway** (sino queda doble path: el auto-deploy de Railway + el workflow). El workflow es la única vía oficial de deploy.

### Cómo modificar el filter

Cuando el deploy gana o pierde dependencia de un path nuevo, actualizar el bloque `paths:` en `.github/workflows/deploy-web.yml` y la tabla de arriba. Mantenerlos sincronizados.

### Versionado del sitio

`@skill-map/web` (private workspace) se versiona aparte del spec y del CLI. La versión es la etiqueta del deploy:

- **GitHub Actions** muestra el nombre del job dinámico (`v0.1.0`) leído de `web/package.json` runtime.
- **Changeset rule**: cualquier PR que toque `web/` debe declarar un changeset que bumpee `@skill-map/web` (igual que spec/cli/ui).

### Versiones en el footer de la landing

Tres tags en el footer, con dos políticas distintas según lo que cada versión representa:

| Tag | Fuente | Política | Razón |
|---|---|---|---|
| `spec v…` | `spec/package.json` | **build-time** (placeholder `{{SPEC_VERSION}}`) | El sitio sirve los schemas él mismo en `/spec/v0/`. La versión que muestra el footer DEBE coincidir con lo que el sitio entrega — sino sería engañoso. |
| `web v…` | `web/package.json` | **build-time** (placeholder `{{WEB_VERSION}}`) | Es la versión del propio sitio. Build-time es trivialmente correcto. |
| `cli v…` | `https://registry.npmjs.org/@skill-map/cli/latest` | **runtime fetch** (`web/app.js`) | El sitio NO sirve el CLI (se instala via `npm i -g @skill-map/cli`). El footer informa "lo último publicado en npm", no algo que el sitio entrega. Build-time quedaría desactualizado entre deploys. Si el fetch falla (offline, npm down), el placeholder `cli v—` queda en su lugar. |

**Para sumar una nueva versión build-time** (ej. `testkit`): agregar a `versions = {…}` en `web/scripts/build-site.js`, sumar el `replaceAll('{{X_VERSION}}', versions.x)`, y poner el span en el footer del HTML.

**Para sumar una nueva versión runtime** (ej. otro paquete de npm): copiar el snippet de `app.js` con otro selector `data-x-version`.

## Git hooks

`.githooks/pre-commit` corre el `validate` del workspace `@skill-map/spec` cuando el commit toca `spec/` (silencioso en otros casos). Atrapa el caso en que se modifica un archivo bajo `spec/` y se olvida regenerar `spec/index.json` — la integridad sha256 quedaría desfasada y CI fallaría en otra branch.

El hook se conecta automáticamente: el script `prepare` del root `package.json` corre `git config core.hooksPath .githooks` cada vez que alguien hace `npm install`. No hay que setearlo a mano por contributor.

Para sumar otros checks al hook (ej. cli-reference cuando se toca el CLI), agregar la rama correspondiente en `.githooks/pre-commit` siguiendo el patrón existente.

## Cuándo agregar / mover / eliminar

- **Agregar un script en raíz**: solo si es atajo diario `componente:acción` por un componente que ya tiene workspace, o si es un orquestador cross-workspace genuino. Si dudás, va al workspace.
- **Agregar un script en workspace**: libre, siguiendo convención npm (`build`, `dev`, `test`, `test:ci`, `lint`, `validate`).
- **Mover un script de raíz a workspace**: actualizar todas las referencias (CI, docs, otros scripts), correr `npm run validate` antes de commit.
- **Eliminar un script**: idem, y verificar que no rompe `release.yml` (los scripts de release se invocan por nombre desde la action de Changesets).
