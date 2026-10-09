# Idle memory (Bun API)

Measured 2026-10-08 on this branch after a cold start of `bun src/index.ts` with an empty migrated SQLite file, port 0, no requests.

- Process: `/root/.bun/bin/bun src/index.ts` (Bun 1.4.2)
- VmRSS: 65900 kB (~64.4 MiB)
- VmHWM: 67072 kB (~65.5 MiB)
- VmSize: 6562836 kB (virtual; not resident)

The story does not require this to be under 50MB. The Go image was not rebuilt for a side-by-side RSS comparison in this sandbox.

`Dockerfile`, `Dockerfile.rootless`, and `Dockerfile.hardened` have no `golang` stage and do not invoke `go build`. One Bun process serves the Expo web export at `/app/web` and `/api/v1`.

## Explicit gaps (not in the required Vue contract set)

- `POST /api/v1/telemetry` is not mounted. `/api/v1/status` reports `telemetry.enabled: false`, so the Vue client does not send spans.
- `POST /api/v1/notifiers/test` validates the URL with the same scheme and bogon/metadata rules as the Go validator and returns 200. It does not deliver through Shoutrrr.
- `?print=true` on label routes returns the PNG instead of invoking a host print command. The Vue label maker loads the image URL.
