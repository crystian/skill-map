# syntax=docker/dockerfile:1.7

# ------------ ui build stage ------------
# Builds the Angular prototype that ships under /demo/ on skill-map.dev.
# --base-href=/demo/ makes Angular emit <base href="/demo/"> and prefix
# every asset URL with /demo/, so the SPA works correctly when served
# from a sub-path. The mock-collection (~132 KB of placeholder skills /
# agents / hooks / notes) is bundled in via the asset glob in
# angular.json, so the published demo is fully self-contained — no
# backend, no localStorage seed, just an Angular bundle that fetches
# its own static fixtures.
#
# This is an npm workspace setup: the lockfile lives at the repo root
# and the root `workspaces` array enumerates every package. `npm ci`
# refuses to proceed unless every declared workspace's `package.json`
# is present, so the Dockerfile copies the full set of manifests
# (even for workspaces this stage never builds — testkit, e2e,
# examples/hello-world) before installing. Source for ui/ lands later
# so a code-only change doesn't bust the dependency cache.
FROM node:24-alpine AS ui-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY spec/package.json ./spec/
COPY src/package.json ./src/
COPY ui/package.json ./ui/
COPY testkit/package.json ./testkit/
COPY e2e/package.json ./e2e/
COPY web/package.json ./web/
COPY examples/hello-world/package.json ./examples/hello-world/
RUN npm ci
COPY ui/ ./ui/
RUN npm run build -w ui -- --base-href=/demo/
# Patch the built index.html to flip <meta name="skill-map-mode"> from
# `live` (Angular default) to `demo`. Without this the SPA boots in
# live mode at skill-map.dev/demo/, hits /api/scan against the static
# host, and 404s. The script is shared with `npm run demo:build` so the
# Docker deploy and the local snapshot stay in lockstep.
COPY web/scripts/patch-demo-mode.js ./web/scripts/patch-demo-mode.js
RUN node web/scripts/patch-demo-mode.js ui/dist/ui/browser/index.html

# Generate the demo snapshot the StaticDataSource fetches at runtime
# (`<base>/data.json` + `<base>/data.meta.json`). Without these the SPA
# falls through Caddy's SPA fallback to index.html and trips a
# JSON.parse on `<!DOCTYPE...`. The dataset script spawns `sm scan`
# over `fixtures/demo-scope/`; with no built CLI in this stage it
# falls back to its tsx-driven source-entry path, so we need spec/ +
# src/ + the fixture + web/scripts/ in scope.
COPY spec/ ./spec/
COPY src/ ./src/
COPY fixtures/demo-scope/ ./fixtures/demo-scope/
COPY web/scripts/build-demo-dataset.js ./web/scripts/build-demo-dataset.js
RUN node web/scripts/build-demo-dataset.js

# ------------ landing build stage ------------
FROM node:24-alpine AS build
WORKDIR /app

# Only what the build script needs. Keeps the build cache tight.
COPY spec/ ./spec/
COPY web/ ./web/

RUN node web/scripts/build-site.js

# ------------ serve stage ------------
FROM caddy:2-alpine
COPY --from=build /app/.tmp/site /usr/share/caddy
# Mount the Angular bundle under /demo/. The browser/ subdir is the
# default output of @angular/build:application; we promote it so the
# demo lives at /usr/share/caddy/demo/index.html.
COPY --from=ui-build /app/ui/dist/ui/browser /usr/share/caddy/demo
# Drop the generated demo dataset alongside the bundle. Two files:
# `data.json` (raw ScanResult) + `data.meta.json` (pre-derived
# envelopes). StaticDataSource fetches both relative to <base href>.
COPY --from=ui-build /app/web/demo/data.json /usr/share/caddy/demo/data.json
COPY --from=ui-build /app/web/demo/data.meta.json /usr/share/caddy/demo/data.meta.json
COPY Caddyfile /etc/caddy/Caddyfile

# Railway supplies $PORT at runtime; Caddyfile uses it.
EXPOSE 8080

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
