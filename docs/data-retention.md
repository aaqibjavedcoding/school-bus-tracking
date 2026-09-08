# Data Retention

## Overview

Configurable data retention prevents unbounded database growth, especially for GPS location data.

**No paid service/provider is included in this phase.**

## Retention Policies

| Data Type          | Default  | Environment Variable             |
| ------------------ | -------- | -------------------------------- |
| GPS Trip Locations | 90 days  | `LOCATION_RETENTION_DAYS`        |
| Notifications      | 180 days | `NOTIFICATION_RETENTION_DAYS`    |
| Refresh Tokens     | 30 days  | `REFRESH_TOKEN_RETENTION_DAYS`   |
| Audit Logs         | 365 days | `AUDIT_LOG_RETENTION_DAYS`       |
| Emergency Records  | 730 days | `EMERGENCY_RETENTION_DAYS`       |
| Idempotency Keys   | 7 days   | `IDEMPOTENCY_KEY_RETENTION_DAYS` |

## Implementation

### Where the worker runs (wired, not just written)

`RetentionWorker` (`web/src/server/workers/retention.worker.ts`) is scheduled
**inside the API server process** by `RetentionScheduler`
(`web/src/server/workers/retention.scheduler.ts`). The custom server
(`web/server.js`) starts the scheduler once after the database bootstrap and
stops it during graceful shutdown (SIGTERM/SIGINT) — there is no separate
worker deployment and no external queue.

- **One scheduler per process.** A `globalThis` guard plus an instance flag
  make double starts (dev hot-reload, double bootstrap) impossible; a second
  `start()` is ignored and logged.
- **Cadence.** The first pass runs `RETENTION_INITIAL_DELAY_MS` (default 30 s)
  after boot, then every `RETENTION_INTERVAL_MS` (default 6 h). Set
  `RETENTION_ENABLED=false` to disable scheduling entirely.
- **Failures never crash the server.** A failing pass is logged and retried on
  the next tick; an in-flight pass is awaited during shutdown, never
  abandoned mid-run.
- **Cross-process safety.** Every pass takes a PostgreSQL
  **transaction-scoped advisory lock** (`pg_try_advisory_xact_lock`), so with
  multiple API instances the first worker cleans up and the others skip —
  the lock lives on the transaction's own connection and is released by the
  commit/rollback. (The previous session-level lock/unlock pair could leak a
  lock across pool connections; the transaction-scoped lock cannot.)
- **Tenant isolation is age-based by design.** The worker deletes rows older
  than the policy age regardless of tenant (every tenant's 400-day-old GPS
  fix is equally past retention). It never scopes by tenant and never touches
  live rows; open/acknowledged emergencies are never deleted, only
  RESOLVED/CANCELLED ones past the retention age.

### Configuration

Set environment variables to customize retention:

```bash
LOCATION_RETENTION_DAYS=90
NOTIFICATION_RETENTION_DAYS=180
REFRESH_TOKEN_RETENTION_DAYS=30
AUDIT_LOG_RETENTION_DAYS=365
EMERGENCY_RETENTION_DAYS=730
IDEMPOTENCY_KEY_RETENTION_DAYS=7

# Scheduling (in-process worker)
RETENTION_ENABLED=true
RETENTION_INTERVAL_MS=21600000        # 6 hours
RETENTION_INITIAL_DELAY_MS=30000      # first pass 30 s after boot
```

### Running Cleanup

The worker runs automatically inside the API server. To run a pass manually
today, execute the same one-off SQL the worker issues (or start a short-lived
replica of the server with `RETENTION_INITIAL_DELAY_MS=0`); a dedicated CLI
entry point and a Super Admin trigger endpoint are **not implemented** in
this phase.

## GPS Data Growth

GPS location data is the fastest-growing dataset. With:

- 100 buses
- 10 trips/day/bus
- 1 location/10 seconds
- 8 hours/trip

That's approximately:

- 100 × 10 × 2880 = 2,880,000 locations/day
- ~86 million locations/month

With 90-day retention, the steady state is ~260 million rows.

### Optimization

- Index on `recorded_at` for efficient cleanup
- Partitioning by month (future optimization)
- Consider archiving old data to cold storage

## Emergency Records

Resolved and cancelled emergency events are retained for 730 days (2 years) by default. Open and acknowledged events are never automatically deleted.

## Audit Logs

Audit logs are retained for 365 days (1 year) by default. They are append-only and never modified.

## Idempotency Keys

Expired idempotency keys are cleaned up after 7 days by default. The TTL is set when the key is created.

## Production Considerations

- Monitor database size growth
- Adjust retention policies based on storage capacity
- Consider archiving old data before deletion
- Test cleanup performance with production-like data volumes
- The default cadence (every 6 h) already lands most passes in low-traffic
  windows; tune `RETENTION_INITIAL_DELAY_MS` so the first pass of a deployment
  does not coincide with a busy dispatch period
- A very large backlog (e.g. enabling retention on a database that already
  holds years of GPS history) deletes inside one transaction; run such a
  first pass off-peak or batch manually (partitioning/archival are future
  optimizations)

## Verification

- **Unit**: `web/src/server/workers/retention.worker.spec.ts` (transaction-
  scoped lock, cutoffs, rollback) and `retention.scheduler.spec.ts`
  (single-start guarantee, failure isolation, graceful stop).
- **Integration**: `web/test/integration/retention.integration.spec.ts` runs
  the worker against real PostgreSQL — proves old rows are deleted, recent
  rows and open emergencies survive, passes are idempotent, and a second
  worker holding the advisory lock elsewhere causes a skip.
