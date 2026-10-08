# Node dependencies stage
FROM public.ecr.aws/docker/library/node:22-alpine AS frontend-dependencies
WORKDIR /app

# Install pnpm 10 (latest stable, works reliably in Alpine)
RUN npm install -g pnpm@10

# Copy package.json and lockfile to leverage caching
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build Nuxt (frontend) stage
FROM public.ecr.aws/docker/library/node:22-alpine AS frontend-builder
WORKDIR /app

# Install pnpm 10 (latest stable)
RUN npm install -g pnpm@10

# Copy over source files and node_modules from dependencies stage
COPY frontend .
COPY --from=frontend-dependencies /app/node_modules ./node_modules
RUN pnpm build

# Bun server dependencies. The production image does not compile the Go API.
FROM oven/bun:1-alpine AS server-dependencies
WORKDIR /app
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

# Production stage — Bun runtime only. No Go toolchain and no compiled API binary.
FROM oven/bun:1-alpine
ENV HBOX_MODE=production
ENV HBOX_STORAGE_CONN_STRING=file:///?no_tmp_dir=true
ENV HBOX_STORAGE_PREFIX_PATH=data
ENV HBOX_DATABASE_SQLITE_PATH=/data/homebox.db?_pragma=busy_timeout=2000&_pragma=journal_mode=WAL&_fk=1&_time_format=sqlite
ENV HBOX_MIGRATIONS_DIR=/app/migrations/sqlite3

USER root
RUN apk --no-cache add ca-certificates && mkdir -p /data /app

WORKDIR /app
COPY --from=server-dependencies /app/node_modules ./node_modules
COPY server/package.json server/bun.lock ./
COPY server/src ./src
COPY server/healthcheck.ts ./healthcheck.ts
COPY backend/internal/data/migrations/sqlite3 ./migrations/sqlite3
COPY backend/internal/core/currencies/currencies.json ./currencies.json
# Already-built Vue assets. The Vue source is not rewritten.
COPY --from=frontend-builder /app/.output/public ./frontend/.output/public

LABEL Name=homebox Version=0.0.1
LABEL org.opencontainers.image.source="https://github.com/sysadminsmedia/homebox"

EXPOSE 7745

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/usr/local/bin/bun", "/app/healthcheck.ts", "http://127.0.0.1:7745/api/v1/status"]

VOLUME [ "/data" ]

ENTRYPOINT [ "/usr/local/bin/bun", "/app/src/index.ts" ]
CMD [ "/data/config.yml" ]
