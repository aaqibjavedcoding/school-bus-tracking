# Security

## Overview

This document describes the security measures implemented in the School Bus Tracking platform.

**No paid service/provider is included in this phase.**

## Authentication

### JWT-Based Authentication

- Access tokens: Short-lived (configurable, default 15 minutes)
- Refresh tokens: Long-lived (configurable, default 7 days), stored in httpOnly cookies
- CSRF protection: Double-submit cookie pattern
- Token rotation: Refresh tokens are rotated on each use

### Password Security

- Bcrypt hashing with configurable rounds
- Password complexity requirements enforced
- Account lockout after failed attempts (rate limiting)

## Authorization

### Role-Based Access Control

- **SUPER_ADMIN**: Platform-level operations (school management, plans, subscriptions)
- **SCHOOL_ADMIN**: School-level operations (students, staff, buses, routes, trips)
- **DRIVER**: Trip-specific operations (attendance, GPS tracking)
- **CONDUCTOR**: Trip-specific operations (attendance, GPS tracking)
- **PARENT**: Read-only access to own children's data

### Tenant Isolation

Every database query is pinned with `school_id` from the verified JWT:

- Cross-tenant data access is impossible
- Cross-tenant mutation is impossible
- All failures return generic 404 (no information leakage)

## Multi-School Security Tests

Comprehensive E2E tests verify:

- Students, guardians, staff, buses, routes, stops, assignments, trips, attendance, documents, notifications, emergencies
- Arbitrary `school_id` in request body is ignored
- Arbitrary `school_id` query parameter is ignored
- Arbitrary resource IDs from another school are rejected
- Parent cannot access another parent's child
- Driver cannot access another driver's trip
- Conductor cannot access another conductor's trip
- Inactive school JWT is rejected
- Deactivated user JWT is rejected

## CORS

- Explicit allowlist (no wildcards in production)
- Credentials support
- Origin validation at startup

## Security Headers

- Helmet (X-Content-Type-Options, X-Frame-Options, etc.)
- HSTS (configurable, production only)
- CSP (configurable)
- Permissions-Policy
- Referrer-Policy

## Rate Limiting

- Per-endpoint rate limits
- Per-user rate limits
- Configurable via environment variables
- PostgreSQL-backed (no Redis required)

## Audit Logging

All security-relevant operations are logged:

- Actor (user ID)
- Action
- Entity type and ID
- Timestamp
- Request ID
- IP address
- Safe metadata (no passwords, tokens, or medical data)

## Data Protection

### Sensitive Data

- Passwords: Never stored in plain text, never logged
- JWTs: Never stored in audit logs
- CSRF tokens: Never stored in audit logs
- Medical information: Not stored unnecessarily

### Data Retention

- GPS locations: Configurable (default 90 days)
- Notifications: Configurable (default 180 days)
- Refresh tokens: Configurable (default 30 days)
- Audit logs: Configurable (default 365 days)
- Emergency records: Configurable (default 730 days)

## WebSocket Security

- Handshake authentication (JWT verification)
- Room authorization (per-socket, per-trip)
- Session revalidation (periodic check for user/school deactivation)
- Payload validation (Zod schemas)

## Document Security

- File type allowlist (PDF, JPG, PNG, DOC, DOCX, XLS, XLSX)
- File size limits (10 MB)
- Filename sanitization
- Tenant authorization
- Secure access checks

## Emergency/SOS Security

- Immutable event history
- Actor tracking
- Server-side timestamps
- Location snapshots
- Status transition enforcement
- Audit log integration
