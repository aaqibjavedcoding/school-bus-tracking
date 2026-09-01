# Backup and Restore

## Overview

This document describes the local backup/restore workflow using PostgreSQL tools.

**Local Docker volume is NOT a backup.** Production deployments must use encrypted, offsite backup infrastructure.

## Local Development Workflow

### Prerequisites

- PostgreSQL client tools (`pg_dump`, `pg_restore`, `createdb`, `dropdb`)
- Access to the PostgreSQL server

### Backup

```bash
# Using default settings
./scripts/backup-restore.sh backup

# Custom output file
./scripts/backup-restore.sh backup ./my-backup.sql.gz

# Custom database
DB_NAME=my_database ./scripts/backup-restore.sh backup
```

### Restore

```bash
# Restore from a backup file
./scripts/backup-restore.sh restore ./backups/backup_20260901_120000.sql.gz
```

**WARNING**: This will DROP and recreate the database. All existing data will be lost.

### Verify

```bash
# Verify a backup file is valid
./scripts/backup-restore.sh verify ./backups/backup_20260901_120000.sql.gz
```

### List Backups

```bash
# List available backups
./scripts/backup-restore.sh list
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USERNAME` | `postgres` | PostgreSQL username |
| `DB_PASSWORD` | `postgres` | PostgreSQL password |
| `DB_NAME` | `school_bus_tracking` | Database name |
| `BACKUP_DIR` | `./backups` | Backup directory |

## Backup Before Migration

Always backup before running migrations:

```bash
# 1. Backup
./scripts/backup-restore.sh backup

# 2. Run migrations
npm run db:migrate

# 3. Verify
./scripts/backup-restore.sh verify ./backups/backup_*.sql.gz
```

## Migration Compatibility

Backups are compatible with:

- Same PostgreSQL major version
- Same or newer minor version
- Same schema version (migrations must be applied after restore)

## Production Requirements

Production deployments MUST:

1. Use encrypted backups
2. Store backups offsite (different region/provider)
3. Test restore procedures regularly
4. Automate backup scheduling
5. Monitor backup success/failure
6. Document recovery time objectives (RTO)
7. Document recovery point objectives (RPO)

### Recommended Tools

- **AWS**: RDS automated backups, S3 with encryption
- **GCP**: Cloud SQL automated backups, GCS with encryption
- **Azure**: Azure Database automated backups, Blob Storage with encryption
- **Self-hosted**: pgBackRest, Barman, WAL-G

## Verification Checklist

After restore:

1. [ ] Database connects successfully
2. [ ] All tables exist
3. [ ] Migrations are up to date
4. [ ] Application starts successfully
5. [ ] Health check passes
6. [ ] Sample data is accessible
7. [ ] No data corruption
