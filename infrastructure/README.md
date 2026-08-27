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
