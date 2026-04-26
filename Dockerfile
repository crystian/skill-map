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
# and rules every workspace (spec / src / ui). The Dockerfile copies
# the root manifest + each workspace's package.json first so `npm ci`
# can resolve the full graph, then layers the actual ui/ source on top
# so a code-only change doesn't bust the dependency cache.
FROM node:24-alpine AS ui-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY spec/package.json ./spec/
COPY src/package.json ./src/
COPY ui/package.json ./ui/
RUN npm ci
COPY ui/ ./ui/
RUN npm run build -w ui -- --base-href=/demo/

# ------------ landing build stage ------------
FROM node:24-alpine AS build
WORKDIR /app

# Only what the build script needs. Keeps the build cache tight.
COPY scripts/ ./scripts/
COPY spec/ ./spec/
COPY web/ ./web/

RUN node scripts/build-site.mjs

# ------------ serve stage ------------
FROM caddy:2-alpine
COPY --from=build /app/.tmp/site /usr/share/caddy
# Mount the Angular bundle under /demo/. The browser/ subdir is the
# default output of @angular/build:application; we promote it so the
# demo lives at /usr/share/caddy/demo/index.html.
COPY --from=ui-build /app/ui/dist/ui/browser /usr/share/caddy/demo
COPY Caddyfile /etc/caddy/Caddyfile

# Railway supplies $PORT at runtime; Caddyfile uses it.
EXPOSE 8080

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
