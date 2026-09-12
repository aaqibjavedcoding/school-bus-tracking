# Infrastructure & Local Development Environment

This directory houses container definitions and infrastructure scripts for the School Bus Tracking platform.

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
