# Testing

## Overview

This document describes the testing strategy and how to run tests.

## Test Types

### 1. Unit Tests

- **Location**: `web/src/server/**/*.spec.ts`, `web/src/**/*.spec.ts`, `mobile/src/**/*.spec.ts`
- **Purpose**: Test individual functions, services, and components in isolation
- **Run**: `npm test`

### 2. Integration Tests (Real PostgreSQL)

- **Location**: `web/test/integration/`
- **Purpose**: Test services against a real PostgreSQL database
- **Run**: `npm run test:integration` (from `web`)
- **Requirements**: PostgreSQL server running

### 3. E2E Tests (Real HTTP + PostgreSQL)

- **Location**: `web/test/e2e/`
- **Purpose**: Test the full request pipeline (guards, middleware, services, SQL)
- **Run**: `npm run test:e2e` (from `web`)
- **Requirements**: PostgreSQL server running

### 4. All Database Tests

- **Run**: `npm run test:db` (from `web`)
- **Runs**: Integration tests + E2E tests

## Setting Up PostgreSQL for Tests

### Option 1: Docker Compose

```bash
cd infrastructure
docker compose up -d postgres
```

### Option 2: Local PostgreSQL

```bash
# Create test database
createdb school_bus_tracking_test
```

### Environment Variables

```bash
# Option A: Single URL
TEST_DATABASE_URL=postgres://user:pass@host:port/dbname

# Option B: Discrete variables
TEST_DB_HOST=localhost
TEST_DB_PORT=5432
TEST_DB_USERNAME=postgres
TEST_DB_PASSWORD=postgres
TEST_DB_NAME=school_bus_tracking_test
```

Default: `postgres://postgres:postgres@localhost:5432/school_bus_tracking_test`

## CI

GitHub Actions runs all tests against a PostgreSQL service container:

```yaml
# .github/workflows/ci.yml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_DB: school_bus_tracking_test
```

## Test Coverage

### API

- Unit tests for all services, controllers, DTOs
- Integration tests for database operations, tenant isolation, plan limits, subscriptions
- E2E tests for cross-tenant security, rate limiting, CORS/CSRF

### Web

- Unit tests for utilities, helpers, hooks
- Component tests (where applicable)

### Mobile

- Unit tests for utilities, helpers, state management
- Component tests (where applicable)

## Writing Tests

### Integration Tests

```typescript
import '../support/env';
import { before, beforeEach, after, describe, it } from 'node:test';
import { prepareDatabase, truncateAll } from '../support/database';

describe('my feature (real PostgreSQL)', () => {
  let sequelize: Sequelize;

  before(async () => {
    sequelize = await prepareDatabase();
  });

  beforeEach(async () => {
    await truncateAll(sequelize);
  });

  after(async () => {
    await sequelize?.close();
  });

  it('does something', async () => {
    // Test against real database
  });
});
```

### E2E Tests

```typescript
import '../support/env';
import { before, after, describe, it } from 'node:test';
import { prepareDatabase, truncateAll } from '../support/database';
import { startTestApp, TestApp } from '../support/app';
import { login, TestSession } from '../support/auth';
import { httpRequest } from '../support/http';

describe('my feature (real HTTP + PostgreSQL)', () => {
  let sequelize: Sequelize;
  let app: TestApp;
  let session: TestSession;

  before(async () => {
    sequelize = await prepareDatabase();
    await truncateAll(sequelize);
    // Create fixtures...
    app = await startTestApp();
    session = await login(app.baseUrl, schoolCode, email);
  });

  after(async () => {
    await app?.close();
    await sequelize?.close();
  });

  it('handles a request', async () => {
    const response = await httpRequest(app.baseUrl, '/my-endpoint', {
      method: 'GET',
      token: session.accessToken,
    });
    assert.equal(response.status, 200);
  });
});
```
