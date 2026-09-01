#!/usr/bin/env bash
#
# Backup and restore workflow for the School Bus Tracking database.
#
# Uses PostgreSQL tools (pg_dump / pg_restore) for local development
# and testing. This is NOT a production backup solution — production
# deployments must use encrypted, offsite backup infrastructure.
#
# Usage:
#   ./scripts/backup-restore.sh backup [output_file]
#   ./scripts/backup-restore.sh restore <backup_file>
#   ./scripts/backup-restore.sh verify <backup_file>
#   ./scripts/backup-restore.sh list
#
# Environment variables:
#   DB_HOST (default: localhost)
#   DB_PORT (default: 5432)
#   DB_USERNAME (default: postgres)
#   DB_PASSWORD (default: postgres)
#   DB_NAME (default: school_bus_tracking)
#   BACKUP_DIR (default: ./backups)

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USERNAME="${DB_USERNAME:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-school_bus_tracking}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Ensure backup directory exists
ensure_backup_dir() {
  mkdir -p "$BACKUP_DIR"
}

# Get the PostgreSQL connection string
get_connection_string() {
  echo "postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
}

# Backup the database
do_backup() {
  local output_file="${1:-${BACKUP_DIR}/backup_$(date +%Y%m%d_%H%M%S).sql.gz}"
  local conn_string
  conn_string=$(get_connection_string)

  ensure_backup_dir

  log_info "Starting backup of database '${DB_NAME}'..."
  log_info "Output: ${output_file}"

  PGPASSWORD="$DB_PASSWORD" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USERNAME" \
    -d "$DB_NAME" \
    --format=custom \
    --compress=9 \
    --verbose \
    --no-owner \
    --no-privileges \
    -f "$output_file" 2>&1

  if [ $? -eq 0 ]; then
    local size
    size=$(du -h "$output_file" | cut -f1)
    log_info "Backup complete: ${output_file} (${size})"
  else
    log_error "Backup failed!"
    exit 1
  fi
}

# Restore the database
do_restore() {
  local backup_file="$1"
  local conn_string
  conn_string=$(get_connection_string)

  if [ ! -f "$backup_file" ]; then
    log_error "Backup file not found: ${backup_file}"
    exit 1
  fi

  log_warn "WARNING: This will DROP and recreate the database '${DB_NAME}'."
  log_warn "All existing data will be lost!"
  read -p "Continue? (yes/no): " confirm

  if [ "$confirm" != "yes" ]; then
    log_info "Restore cancelled."
    exit 0
  fi

  log_info "Dropping existing database..."
  PGPASSWORD="$DB_PASSWORD" dropdb \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USERNAME" \
    --if-exists \
    "$DB_NAME" 2>&1 || true

  log_info "Creating fresh database..."
  PGPASSWORD="$DB_PASSWORD" createdb \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USERNAME" \
    "$DB_NAME" 2>&1

  log_info "Restoring from ${backup_file}..."
  PGPASSWORD="$DB_PASSWORD" pg_restore \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USERNAME" \
    -d "$DB_NAME" \
    --verbose \
    --no-owner \
    --no-privileges \
    "$backup_file" 2>&1

  if [ $? -eq 0 ]; then
    log_info "Restore complete!"
  else
    log_warn "Restore completed with warnings (some errors may be expected for existing objects)."
  fi
}

# Verify a backup file
do_verify() {
  local backup_file="$1"

  if [ ! -f "$backup_file" ]; then
    log_error "Backup file not found: ${backup_file}"
    exit 1
  fi

  log_info "Verifying backup file: ${backup_file}"

  # Check if it's a valid pg_dump file
  PGPASSWORD="$DB_PASSWORD" pg_restore \
    --list \
    "$backup_file" > /dev/null 2>&1

  if [ $? -eq 0 ]; then
    local size
    size=$(du -h "$backup_file" | cut -f1)
    log_info "Backup file is valid (${size})"

    # Show table list
    log_info "Tables in backup:"
    PGPASSWORD="$DB_PASSWORD" pg_restore \
      --list \
      "$backup_file" 2>/dev/null | grep "TABLE" | head -30
  else
    log_error "Backup file is invalid or corrupted!"
    exit 1
  fi
}

# List available backups
do_list() {
  ensure_backup_dir

  log_info "Available backups in ${BACKUP_DIR}:"
  echo ""

  if [ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
    echo "  No backups found."
  else
    ls -lh "$BACKUP_DIR"/*.sql* 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}'
  fi
}

# Main
case "${1:-help}" in
  backup)
    do_backup "${2:-}"
    ;;
  restore)
    if [ -z "${2:-}" ]; then
      log_error "Usage: $0 restore <backup_file>"
      exit 1
    fi
    do_restore "$2"
    ;;
  verify)
    if [ -z "${2:-}" ]; then
      log_error "Usage: $0 verify <backup_file>"
      exit 1
    fi
    do_verify "$2"
    ;;
  list)
    do_list
    ;;
  help|*)
    echo "School Bus Tracking — Database Backup/Restore"
    echo ""
    echo "Usage:"
    echo "  $0 backup [output_file]    Create a backup"
    echo "  $0 restore <backup_file>   Restore from a backup"
    echo "  $0 verify <backup_file>    Verify a backup file"
    echo "  $0 list                    List available backups"
    echo ""
    echo "Environment variables:"
    echo "  DB_HOST (default: localhost)"
    echo "  DB_PORT (default: 5432)"
    echo "  DB_USERNAME (default: postgres)"
    echo "  DB_PASSWORD (default: postgres)"
    echo "  DB_NAME (default: school_bus_tracking)"
    echo "  BACKUP_DIR (default: ./backups)"
    echo ""
    echo "NOTE: This is a local development workflow."
    echo "Production deployments must use encrypted, offsite backup infrastructure."
    ;;
esac
