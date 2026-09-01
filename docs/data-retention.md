# Data Retention

## Overview

Configurable data retention prevents unbounded database growth, especially for GPS location data.

**No paid service/provider is included in this phase.**

## Retention Policies

| Data Type | Default | Environment Variable |
|-----------|---------|---------------------|
| GPS Trip Locations | 90 days | `LOCATION_RETENTION_DAYS` |
| Notifications | 180 days | `NOTIFICATION_RETENTION_DAYS` |
| Refresh Tokens | 30 days | `REFRESH_TOKEN_RETENTION_DAYS` |
| Audit Logs | 365 days | `AUDIT_LOG_RETENTION_DAYS` |
| Emergency Records | 730 days | `EMERGENCY_RETENTION_DAYS` |
| Idempotency Keys | 7 days | `IDEMPOTENCY_KEY_RETENTION_DAYS` |

## Implementation

### PostgreSQL-Backed Worker

The retention worker runs as a background job:

- Uses PostgreSQL advisory locks to prevent concurrent execution
- Deletes old data in batches
- Logs cleanup results

### Configuration

Set environment variables to customize retention:

```bash
LOCATION_RETENTION_DAYS=90
NOTIFICATION_RETENTION_DAYS=180
REFRESH_TOKEN_RETENTION_DAYS=30
AUDIT_LOG_RETENTION_DAYS=365
EMERGENCY_RETENTION_DAYS=730
IDEMPOTENCY_KEY_RETENTION_DAYS=7
```

### Running Cleanup

The retention worker can be triggered:

1. **Scheduled**: Via cron or Docker restart policy
2. **Manual**: Via API endpoint (Super Admin only)
3. **CLI**: Via worker script

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
- Schedule cleanup during low-traffic periods
