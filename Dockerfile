# syntax=docker/dockerfile:1.7

# ------------ build stage ------------
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
COPY Caddyfile /etc/caddy/Caddyfile

# Railway supplies $PORT at runtime; Caddyfile uses it.
EXPOSE 8080

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
