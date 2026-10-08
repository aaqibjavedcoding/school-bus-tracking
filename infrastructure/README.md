# Infrastructure & Local Development Environment

This directory houses container definitions and infrastructure scripts for the KidBus platform.

## PostgreSQL + PostGIS

To start the PostgreSQL database with spatial extensions enabled:

```bash
docker compose up -d
```

### Services

- **Database**: PostgreSQL 16 with PostGIS (`5432`)
- **Default Database**: `school_bus_tracking`
- **Default User**: `postgres`
- **Default Password**: `postgres`

## OSRM routing engine (optional, profile-gated)

The `osrm` service in [`docker-compose.yml`](./docker-compose.yml) is the
self-hosted routing engine behind the road-following route geometry — the
line the maps draw instead of the dashed stop-to-stop flight path. It is
**profile-gated** (`profiles: ['routing']`), so plain `docker compose up -d`
still starts Postgres alone:

```bash
docker compose --profile routing up -d osrm
```

The engine is [OSRM](https://github.com/Project-OSRM/osrm-backend) (BSD-2)
in its official image `ghcr.io/project-osrm/osrm-backend:v26.10.0-debian`
(multi-arch manifest; `v26.10.0-amd64-debian` / `v26.10.0-arm64-debian` are
the arch-specific tags). It is 100% free and keyless — no account, no API
key, no card — the same product rule as the map tiles. It serves
`osrm-routed --algorithm mld` on port `5000` (`OSRM_PORT` to change) from a
**prebuilt graph** in `./osrm-data` (mounted read-only, git-ignored).

### 1. Build the graph (once, then monthly)

```bash
./scripts/osrm-graph.sh
```

downloads a free Geofabrik OpenStreetMap extract (default: India western
zone), optionally cuts it to a bounding box (default: the Nagpur region
`78.60,20.70,79.60,21.60`) with the free osmium-tool image, then runs
`osrm-extract -p /opt/car.lua` → `osrm-partition` → `osrm-customize` inside
the OSRM image. Artefacts land in `infrastructure/osrm-data/`; the script
fails loudly if one is missing. **The extract must cover every place the
buses drive** — outside it OSRM answers `NoRoute` and the app falls back to
the dashed line. Re-run monthly (Geofabrik refreshes daily). All inputs are
environment variables (`EXTRACT_URL`, `BBOX`, `REGION`, `OSRM_IMAGE`,
`OSMIUM_IMAGE`) — see the script header.

### 2. Point the app at the engine

```bash
ROUTING_SERVICE_URL=http://localhost:5000   # in web/.env (or the host env)
```

Blank/unset keeps road routing **disabled**: `GET /api/v1/routes/:id/geometry`
answers `{ status: 'unavailable' }` and the maps draw the honest dashed
stop-to-stop line — exactly the behaviour before this phase. The geometry
is cached forever per stops-hash (`route_geometries`), so **the engine does
not need to run 24/7**: it is only needed to compute a route whose stop list
changed (a save/reorder schedules a fire-and-forget recompute) or during a
backfill. A 512 MB Render free instance **cannot** host OSRM (the graph
loads into RAM; the compose service caps at `mem_limit: 2g`) — run the
engine on a small VM and point `ROUTING_SERVICE_URL` at it, or compute on
the free GitHub runner and keep only the cache in the app.

### 3. Backfill existing routes (free GitHub runner)

GitHub → Actions → **"OSRM route-geometry backfill"** → Run workflow. The
workflow (`.github/workflows/osrm-backfill.yml`, manual dispatch only) builds
the graph on the free `ubuntu-latest` runner, starts `osrm-routed`, and for
every route of the token's school missing geometry: fetches the stops, calls
OSRM `/route/v1/driving/…?overview=full&geometries=geojson&steps=true`,
`PUT`s the result to `/api/v1/routes/:id/geometry`, and verifies the next
`GET` is a cache hit. It needs a SCHOOL_ADMIN access token (dispatch input
or the `OSRM_BACKFILL_ADMIN_TOKEN` secret). The same backfill runs locally:

```bash
OSRM_BASE=http://localhost:5000 \
API_BASE=https://<host>/api/v1 \
ADMIN_TOKEN=<SCHOOL_ADMIN access token> \
node scripts/osrm-backfill.mjs
```

### Healthcheck

Stock `osrm-routed` has no dedicated `/health` route and the runtime image
ships no curl/wget, so the compose healthcheck speaks raw HTTP over bash's
`/dev/tcp` and requires any HTTP status line back: `osrm-routed` binds its
port only after the graph is fully loaded, so a successful connect is also a
readiness signal.

## Production (single instance)

The production configuration for the supported single-instance topology (one
app process + one PostgreSQL container) is prepared but **not deployed** by
this repository:

- [`Dockerfile`](./Dockerfile) — multi-stage production image for the web/server app
- [`docker-compose.prod.yml`](./docker-compose.prod.yml) — app, one-shot migrations and database
- [`.env.production.example`](./.env.production.example) — required environment values (placeholders only; copy to `.env.production`)

See [`docs/deployment.md`](../docs/deployment.md) →
"Production container deployment (single instance)" for the full procedure.
The real `.env.production` is git-ignored and must never be committed.
