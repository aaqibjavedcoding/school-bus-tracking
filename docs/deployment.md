# Deployment

## Overview

This document describes how to deploy the School Bus Tracking platform.

**No paid service/provider is included in this phase.**

## Prerequisites

- Node.js >= 22.0.0
- PostgreSQL 16+
- npm or yarn

## Environment Variables

### Required

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your-secure-password
DB_NAME=school_bus_tracking

# JWT
JWT_SECRET=your-very-long-random-secret-at-least-32-chars

# CORS
CORS_ORIGIN=https://your-domain.com
```

### Optional

```bash
# Application
NODE_ENV=production
PORT=3001
API_PREFIX=api/v1

# Database
DB_SSL=true
DB_POOL_MAX=20
DB_POOL_MIN=2
DB_LOGGING=false

# Security
SECURITY_IS_PRODUCTION=true
SECURITY_HEADERS_ENABLED=true
SECURITY_HSTS_MAX_AGE=15552000
# CSRF is on by default; these are the names `security.config.ts` actually reads.
CSRF_ENABLED=true
CSRF_COOKIE_NAME=csrf_token
CSRF_HEADER_NAME=x-csrf-token
# Browser origins allowed to send credentialed requests (no wildcard in production).
CORS_ORIGIN=https://app.example.com

# Rate Limiting
RATE_LIMIT_AUTH_LOGIN_LIMIT=5
RATE_LIMIT_AUTH_REFRESH_LIMIT=10
RATE_LIMIT_READ_HEAVY_LIMIT=100

# Retention
LOCATION_RETENTION_DAYS=90
NOTIFICATION_RETENTION_DAYS=180
REFRESH_TOKEN_RETENTION_DAYS=30
AUDIT_LOG_RETENTION_DAYS=365
EMERGENCY_RETENTION_DAYS=730
IDEMPOTENCY_KEY_RETENTION_DAYS=7

# Subscription
SUBSCRIPTION_GRACE_PERIOD_DAYS=7
```

## Build

```bash
# Install dependencies
npm ci

# Build packages
npm run build:packages

# Build apps
npm run build
```

## Database Setup

```bash
# Run migrations
cd web
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

## Start

```bash
# Production (serves the web UI and the /api/v1 API from one process, PORT default 3001)
cd web
npm run start

# Development
npm run dev
```

Both run the same custom server entrypoint (`web/server.js`), which bootstraps the
database, mounts the API and Socket.IO under `/api/v1`, and hands everything else
to Next.js. Build first with `npm run build` (compiles the server API into
`web/dist` and the App Router bundle into `web/.next`).

## Docker Compose (Development)

```bash
cd infrastructure
docker compose up -d
```

## Health Checks

- Liveness: `GET /api/v1/health`
- Readiness: `GET /api/v1/health/ready`

## Production Checklist

- [ ] Strong JWT secret configured
- [ ] CORS allowlist configured for production domains
- [ ] Database SSL enabled
- [ ] Security headers enabled
- [ ] HSTS enabled
- [ ] CSRF protection enabled
- [ ] Rate limiting configured
- [ ] Retention policies configured
- [ ] Backup strategy in place
- [ ] Monitoring configured
- [ ] Logging configured
- [ ] Health checks configured
- [ ] Environment variables secured
- [ ] No secrets in code or version control

## Monitoring

### Health Endpoints

- `GET /api/v1/health` — Process liveness
- `GET /api/v1/health/ready` — Service readiness

### Logs

Production logs are JSON structured:

```json
{
  "timestamp": "2026-09-01T12:00:00.000Z",
  "level": "info",
  "request_id": "uuid",
  "method": "GET",
  "path": "/api/v1/students",
  "status": 200,
  "duration_ms": 45,
  "user_id": "uuid",
  "school_id": "uuid"
}
```

### Key Metrics

- Request latency (p50, p95, p99)
- Error rate (4xx, 5xx)
- Database connection pool usage
- Active WebSocket connections
- GPS location updates/second
- Notification delivery rate
