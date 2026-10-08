# Expo web export. The Nuxt app is not copied into this image.
FROM public.ecr.aws/docker/library/node:22-alpine AS web-dependencies
WORKDIR /app

RUN npm install -g pnpm@10

COPY mobile/package.json mobile/pnpm-lock.yaml mobile/.npmrc ./
RUN pnpm install --frozen-lockfile

FROM public.ecr.aws/docker/library/node:22-alpine AS web-builder
WORKDIR /app

RUN npm install -g pnpm@10

COPY mobile .
COPY --from=web-dependencies /app/node_modules ./node_modules
ENV CI=1
ENV EXPO_NO_TELEMETRY=1
# Same-origin /api/v1 on the Bun server. Inlined into the web bundle only.
ENV EXPO_PUBLIC_HOMEBOX_API_ORIGIN=same
RUN pnpm run export:web

# Bun server dependencies. The production image does not compile a Go API.
FROM oven/bun:1-alpine AS server-dependencies
WORKDIR /app
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

# Production stage — Expo web export plus the Bun server.
FROM oven/bun:1-alpine
ENV HBOX_MODE=production
ENV HBOX_STORAGE_CONN_STRING=file:///?no_tmp_dir=true
ENV HBOX_STORAGE_PREFIX_PATH=data
ENV HBOX_DATABASE_SQLITE_PATH=/data/homebox.db?_pragma=busy_timeout=2000&_pragma=journal_mode=WAL&_fk=1&_time_format=sqlite
ENV HBOX_MIGRATIONS_DIR=/app/migrations/sqlite3
ENV HBOX_STATIC_DIR=/app/web

USER root
RUN apk --no-cache add ca-certificates && mkdir -p /data /app

WORKDIR /app
COPY --from=server-dependencies /app/node_modules ./node_modules
COPY server/package.json server/bun.lock ./
COPY server/src ./src
COPY server/healthcheck.ts ./healthcheck.ts
COPY backend/internal/data/migrations/sqlite3 ./migrations/sqlite3
COPY backend/internal/core/currencies/currencies.json ./currencies.json
COPY --from=web-builder /app/dist ./web

LABEL Name=homebox Version=0.0.1
LABEL org.opencontainers.image.source="https://github.com/sysadminsmedia/homebox"

EXPOSE 7745

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/usr/local/bin/bun", "/app/healthcheck.ts", "http://127.0.0.1:7745/api/v1/status"]

VOLUME [ "/data" ]

ENTRYPOINT [ "/usr/local/bin/bun", "/app/src/index.ts" ]
CMD [ "/data/config.yml" ]
