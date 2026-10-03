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

The harness (`web/test/support/app.ts` → `src/server/http/test-server.ts`)
mounts **the exact `/api/*` middleware chain the production custom server
mounts** — the chain lives once in `src/server/http/api-middleware-chain.ts`
and is consumed by both `web/server.js` and the harness, so the suites cannot
drift from production. E2E requests therefore carry and assert the real
CORS behaviour (allowlist echo, preflight, credentials), gzip compression,
security headers (`nosniff`, CSP, Referrer-Policy, Permissions-Policy,
X-Frame-Options), request-id stamping/echo, cookie parsing and the
unauthenticated health/readiness probes — on top of the guard chain
(CSRF → rate limit → JWT → roles) the route runtime applies. Next.js itself
is not started; the suites cover `/api/v1/*`, which is where the server-side
behaviour lives.

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

Continuous integration runs on GitHub Actions (`.github/workflows/ci.yml`) on
every push and pull request targeting `main`. Each gate is a separate job so
it can be enabled as an individual required status check:

| Job                  | Command (run from the repository root)            | Notes                                                              |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Lint                 | `npm run lint`                                    | ESLint, zero warnings allowed                                      |
| Typecheck            | `npm run typecheck`                               | Builds shared packages, typechecks packages, web client and mobile |
| Server typecheck     | `npm --prefix web run typecheck:server`           | `tsc -p web/tsconfig.server.json`                                  |
| Server tests         | `npm --prefix web run test:server`                | Server-side unit suites                                            |
| Web tests            | `npm --prefix web run test:web`                   | Client/utility unit suites                                         |
| Mobile tests         | `npm --prefix mobile test`                        | Mobile unit suites                                                 |
| Mobile simulations   | `npm --prefix mobile run test:sim`                | Offline-queue and push-lifecycle simulations                       |
| DB integration + E2E | `npm --prefix web run test:db`                    | Real PostgreSQL service container (below)                          |
| Web production build | `npm --prefix web run build`                      | `web/dist` server build + `web/.next` production bundle            |
| Android Expo export  | `cd mobile && npx expo export --platform android` | Metro bundles every route; no device needed                        |
| Production image     | `docker build -f infrastructure/Dockerfile .`     | Also validates `infrastructure/docker-compose.prod.yml`            |

### Running a slice instead of everything

Test files are **discovered**, not listed: `scripts/run-specs.mjs` walks the
source tree and every `*.spec.ts(x)` it finds is a test. That means a new spec
runs the moment it exists — there is no list to remember — and it means the
same discovery can be narrowed, which is the difference between a 4-minute
feedback loop and a 12-second one.

| Want | Command | Typical time |
| --- | --- | --- |
| Everything for one surface | `npm --prefix web run test:server` | ~3m45s |
| | `npm --prefix web run test:web` | ~6s |
| | `npm --prefix mobile test` | ~16s |
| Only the specs whose path matches a word | `npm --prefix web run test:scope -- routing` | seconds |
| | `npm --prefix mobile run test:scope -- map` | ~3s |
| Only what your branch touched | `npm run test:changed` | seconds |
| See what would run, run nothing | `npm run test:list` | instant |

`--filter` can be repeated (`-- eta -- routes`), and matches anywhere in the
path, so a word like `map`, `crew` or `marketing` is usually enough.
`--changed` compares against the merge base with `origin/main` and selects the
changed specs, each changed file's sibling spec, and the other specs in the
same directory.

### Whole-codebase guards

Feature-scoped runs cannot see specs that assert invariants across the whole
codebase, such as model-registry, i18n, map-provider, migration and security
policies. Run `npm run test:guards` (about 20 specs, ~13s) before every push.
Whenever a new whole-codebase invariant gets a spec, add its path fragment to
the appropriate suite in `GUARD_FRAGMENTS` in `scripts/run-specs.mjs`.

**Rule of thumb while developing (and the rule agent sessions must follow):**
run the scoped command for the area you are changing, and let CI run the rest.
`npm --prefix web run test:server` spawns 183 ts-node processes and is the one
command that genuinely takes minutes — it belongs in CI, not in a dev loop.

### Why discovery replaced the hardcoded lists

The `test` scripts used to enumerate every spec path inline — 183 paths in
`test:server`, 46 in `test:web`, 114 in mobile's `test`. Besides being
unscopeable, the lists were quietly wrong:

- `mobile/src/features/crew/arrived-stop-announcer.spec.ts` existed, passed,
  and was never executed by CI, because nobody added it to the list;
- `test:web` contained `src/lib/nav-routes.spec.tssrc/features/admin/subscriptions/helpers.spec.ts`
  — two paths joined by a missing space, so Node silently skipped both specs.

Discovery found all three on the first run. A spec that exists now runs.

### What discovery deliberately skips

- `*.sim.spec.ts` — the simulation suites need their own node flags and module
  loaders, so they keep their dedicated scripts (`test:sim` and friends).
- `web/test/integration/**` and `web/test/e2e/**` — these need a live
  PostgreSQL and run through `test:integration` / `test:e2e` / `test:db`.

`--isolation=none` exists in the runner for experiments, but the server suites
are **not** isolation-safe today (they share module state and fail en masse in
a single process). Do not use it in CI.

Node is pinned via `.nvmrc` (the project's supported production version,
Node 22), dependencies install deterministically with `npm ci` from
`package-lock.json`, and the npm download cache is enabled.

### CI database service

The DB job runs a **PostgreSQL 16 with PostGIS 3.4** service container, using
the same image as `infrastructure/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: school_bus_tracking_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U postgres -d school_bus_tracking_test"
```

The service container does not execute `infrastructure/postgres/init.sql`, so
`scripts/ci-enable-postgis.mjs` installs the same `postgis` and `uuid-ossp`
extensions into `template1` (from which the test harness's
`CREATE DATABASE` copies) and the test database itself, giving CI exact
database parity with local development. The suites then connect with:

```bash
TEST_DB_HOST=localhost
TEST_DB_PORT=5432
TEST_DB_USERNAME=postgres
TEST_DB_PASSWORD=postgres
TEST_DB_NAME=school_bus_tracking_test
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
