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

Road geometry reaches the cache three ways (full table in
`docs/live-tracking-map.md` → "Road routing"):

- **A. Lazy** — the first read of a route with no cached geometry computes
  it, if `ROUTING_SERVICE_URL` points at a reachable engine. No credential.
- **B. Per-school backfill** — one SCHOOL_ADMIN sign-in fills one school's
  routes (workflow `mode = school`, or `ADMIN_MODE=school` locally).
- **C. Platform backfill (recommended)** — one **SUPER_ADMIN** sign-in fills
  **every school's** routes in one run and prints a per-school summary
  (workflow `mode = platform`, the default, or `ADMIN_MODE=platform`
  locally). Paths B and C compute on the runner, so the app's own engine can
  stay off.

**Install the workflow (once, through the GitHub web UI).** The file lives at
`infrastructure/github-workflows/osrm-backfill.yml`; the installed copy is
`.github/workflows/osrm-backfill.yml` on `main`. Copy the first into the
second, the way `infrastructure/github-workflows/README.md` describes:

1. Open `infrastructure/github-workflows/osrm-backfill.yml` on `main` →
   **Raw** → copy everything.
2. Open `.github/workflows/osrm-backfill.yml` on `main` → pencil (**Edit this
   file**) → select all → paste → commit to `main`.
3. **Settings → Secrets and variables → Actions → New repository secret**, twice:
   - `OSRM_PLATFORM_EMAIL` and `OSRM_PLATFORM_PASSWORD` — the SUPER_ADMIN
     account (for `mode = platform`);
   - or `OSRM_SCHOOL_EMAIL` and `OSRM_SCHOOL_PASSWORD` — one school's
     SCHOOL_ADMIN account (for `mode = school`, together with the
     `school_code` input).

**Run it.** **Actions → "OSRM route-geometry backfill" → Run workflow**, with
`mode = platform` and `api_base = https://kidbus.onrender.com/api/v1`. The
workflow signs in right before the backfill, masks the access token, and
never prints it; a missing secret stops the run in seconds with an
`::error::`. Read the per-school table (missing / filled / no road route /
failed / left) in the run's step summary. `no road route` means the extract
does not cover those stops, or a stop is far from any road, and the map keeps
the dashed line for them — it is not a failure. `failed` is worth a re-run.

**New routes later = re-run platform mode; only missing routes are filled.**
Routes already cached are not touched.

The same platform run works from a terminal (for example against a local
API). It needs Node 22+ (the repo’s `engines`) and the OSRM engine from step 1 on `OSRM_BASE`:

```bash
OSRM_BASE=http://localhost:5000 \
API_BASE=https://<host>/api/v1 \
ADMIN_MODE=platform \
ADMIN_TOKEN=<SUPER_ADMIN access token> \
node scripts/osrm-backfill.mjs
```

Without `ADMIN_MODE` (or with `ADMIN_MODE=school`) the script runs the
per-school backfill with a SCHOOL_ADMIN token, as before.

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
