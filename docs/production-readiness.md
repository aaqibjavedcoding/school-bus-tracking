# Production Readiness — Phase 2

## Overview

This document describes the production-readiness improvements implemented in Phase 2.

**No paid service/provider is included in this phase.**

## Implemented Features

### 1. Audit Logging

- **Status**: Implemented
- **Location**: `web/src/server/modules/audit/`
- **Description**: Durable audit trail for security-relevant and operational mutations
- **Coverage**: School lifecycle, student/guardian/staff/bus/route/trip/document/emergency operations, auth events
- **Storage**: PostgreSQL `audit_logs` table (append-only)
- **UI**: Super Admin audit log screen at `/admin/audit-logs`

### 2. Request ID + Structured Logging

- **Status**: Implemented
- **Location**: `web/src/server/common/middleware/request-id.middleware.ts`, `web/src/server/common/interceptors/structured-logging.interceptor.ts`
- **Description**: Every API request gets a correlation ID (client-supplied or server-generated)
- **Production**: JSON structured logs with request_id, method, path, status, duration, user_id, school_id
- **Development**: Human-readable one-line summaries
- **Redaction**: Authorization, cookies, passwords, tokens are never logged

### 3. Health / Readiness

- **Status**: Implemented
- **Location**: `web/src/server/modules/health/`
- **Endpoints**:
  - `GET /health` — Liveness (always 200 if process alive)
  - `GET /health/ready` — Readiness (503 when not ready)
- **Checks**: PostgreSQL connection, Sequelize usability, schema/migration readiness

### 4. Idempotency for Critical Operations

- **Status**: Implemented
- **Location**: `web/src/server/common/idempotency/`
- **Operations**: Boarding, drop, SOS, trip status transitions
- **Mechanism**: Client-generated `x-idempotency-key` header
- **Storage**: PostgreSQL `idempotency_keys` table with TTL
- **Scope**: Tenant/user/endpoint isolated

### 5. Notification Provider Architecture

- **Status**: Implemented (abstractions + no-op providers)
- **Location**: `web/src/server/modules/notifications/providers/`
- **Providers**:
  - `PushNotificationProvider` — No-op for development
  - `EmailNotificationProvider` — No-op for development
  - `SmsNotificationProvider` — No-op for development
- **Note**: External push provider integration is intentionally deferred because paid services are prohibited in the current phase.

### 6. Document Storage Abstraction

- **Status**: Implemented (abstraction + local filesystem provider)
- **Location**: `web/src/server/modules/documents/storage/`
- **Provider**: `LocalStorageProvider` for development
- **Validation**: File type allowlist, file size limits, filename sanitization
- **Note**: Local filesystem is NOT a production storage solution.

### 7. Data Retention

- **Status**: Implemented
- **Location**: `web/src/server/workers/retention.worker.ts`
- **Configuration**:
  - `LOCATION_RETENTION_DAYS` (default: 90)
  - `NOTIFICATION_RETENTION_DAYS` (default: 180)
  - `REFRESH_TOKEN_RETENTION_DAYS` (default: 30)
  - `AUDIT_LOG_RETENTION_DAYS` (default: 365)
  - `EMERGENCY_RETENTION_DAYS` (default: 730)
  - `IDEMPOTENCY_KEY_RETENTION_DAYS` (default: 7)
- **Mechanism**: PostgreSQL-backed worker with advisory locks

### 8. WebSocket Session Revalidation

- **Status**: Implemented
- **Location**: `web/src/server/common/websocket/websocket-session-revalidation.ts`
- **Checks**: User deactivation, school deactivation
- **Interval**: Configurable (default: 5 minutes)
- **Note**: Single-instance deployment. Ready for future open-source Redis for multi-instance.

### 9. CI with PostgreSQL

- **Status**: Implemented
- **Location**: `.github/workflows/ci.yml`
- **Services**: PostgreSQL 16 container
- **Steps**: npm ci, build:packages, test, typecheck, lint, build, integration tests, E2E tests

### 10. Multi-School E2E Security Tests

- **Status**: Implemented
- **Location**: `web/test/e2e/multi-school-security.e2e.spec.ts`
- **Coverage**: All resource types, cross-tenant access, role restrictions, inactive school, deactivated user

### 11. Subscription Edge-Case Tests

- **Status**: Implemented
- **Location**: `web/test/integration/subscription-edge-cases.integration.spec.ts`
- **Coverage**: Active, trialing, expired, past_due, grace period, cancelled, no subscription, limits, concurrent creation

### 12. Mobile Offline Attendance

- **Status**: Implemented
- **Location**: `mobile/src/features/crew/offline/`
- **Features**: Durable local queue, idempotency keys, exponential backoff, 409 conflict handling, sync state display

### 13. Mobile GPS Permission Recovery

- **Status**: Implemented
- **Location**: `mobile/src/features/crew/GpsPermissionRecovery.tsx`
- **Features**: Permission denied, permanently denied, location services disabled, background permission, settings link

### 14. Web Error/Session UX

- **Status**: Implemented
- **Location**: `web/src/components/ui/ErrorBoundary.tsx`, `web/src/components/ui/ApiErrorDisplay.tsx`
- **Handles**: 401, 403, 404, 409, 422, 429, 500, network failure

### 15. Web Audit Log UI

- **Status**: Implemented
- **Location**: `web/src/app/(authenticated)/admin/audit-logs/page.tsx`
- **Features**: Action/entity filters, pagination, actor names, timestamps

### 16. Backup/Restore Workflow

- **Status**: Implemented (local development)
- **Location**: `scripts/backup-restore.sh`
- **Commands**: backup, restore, verify, list
- **Note**: Local Docker volume is NOT a backup. Production requires encrypted offsite backups.

## Development-Only Features

- Local filesystem document storage
- No-op notification providers
- Local backup/restore script

## Requires Future External Provider

- Push notifications (Firebase, APNs, etc.)
- Email notifications (SendGrid, SES, etc.)
- SMS notifications (Twilio, etc.)
- Object storage (S3, GCS, Azure Blob, etc.)
- Production backup infrastructure

## Production Deployment Requirements

1. Configure all environment variables (see `.env.example`)
2. Set up encrypted offsite backups
3. Configure a proper object storage provider for documents
4. Configure push/email/SMS providers when available
5. Set up monitoring and alerting
6. Review and adjust retention policies
7. Configure CORS allowlist for production domains
8. Set strong JWT secrets
9. Enable SSL for database connections
