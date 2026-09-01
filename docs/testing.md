# Testing

The repository has three layers of tests. The first runs anywhere; the other
two need a real PostgreSQL server, because the behaviour they verify (locking,
constraints, transactions, HTTP semantics) cannot be faked.

| Layer | Command | Needs a database |
| --- | --- | --- |
| Unit | `npm test` (root) | no |
| Integration | `npm --prefix apps/api run test:integration` | **yes** |
| End-to-end (HTTP) | `npm --prefix apps/api run test:e2e` | **yes** |

## 0. Clean checkout

The apps import `@school-bus-tracking/*` from each package's `dist/` output, so
the workspace packages must be built before any suite runs. The root `test` and
`typecheck` scripts do it for you:

```bash
npm ci
npm test          # builds packages first, then runs api + web + mobile
```

When running a single workspace directly (`npm --prefix apps/api test`), build
the packages once yourself: `npm run build:packages`.

## 1. Unit tests

```bash
npm test                       # api + web + mobile
npm --prefix apps/api test     # api only
```

Node's built-in runner (`node --test`) is used everywhere; there is no Jest.
New API unit specs must be appended to the explicit file list in
`apps/api/package.json` → `scripts.test`.

## 2. Start a test database

The integration and E2E suites talk to a real PostgreSQL instance. Anything
that speaks the wire protocol works; the repository ships a Compose service:

```bash
cd infrastructure
docker compose up -d postgres      # postgis/postgis:16-3.4 on ${DB_PORT:-5432}
```

The suites create the database `school_bus_tracking_test` themselves (through
the maintenance `postgres` database), run every migration from empty, and
truncate between tests. **They never touch your development database** unless
you point them at it.

Connection settings come from the environment:

```bash
# one URL …
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/school_bus_tracking_test

# … or discrete variables
export TEST_DB_HOST=localhost
export TEST_DB_PORT=5432
export TEST_DB_USERNAME=postgres
export TEST_DB_PASSWORD=postgres
export TEST_DB_NAME=school_bus_tracking_test
```

Defaults match the Compose service (`localhost:5432`, `postgres`/`postgres`).
When no server is reachable the suites fail loudly with a hint instead of
silently skipping.

## 3. Run the database-backed suites

```bash
npm --prefix apps/api run test:integration   # migrations, constraints, isolation, limits
npm --prefix apps/api run test:e2e           # real HTTP: cross-tenant, CSRF/CORS, rate limits
npm --prefix apps/api run test:db            # both
```

Both scripts run with `--test-concurrency=1`: the suites share one database and
several of them assert on exact row counts.

### What each suite proves

`apps/api/test/integration/`

| File | Verifies |
| --- | --- |
| `migrations.integration.spec.ts` | every migration applies to an empty database, is idempotent, and reverses cleanly (`down` then `up` again) |
| `constraints.integration.spec.ts` | foreign keys, per-tenant unique indexes, composite cross-tenant FKs, soft-delete semantics, cascade behaviour |
| `tenant-isolation.integration.spec.ts` | the real services over two real tenants: no cross-tenant read, write, delete or usage count |
| `subscriptions.integration.spec.ts` | one live subscription per school (partial unique index), CHECK constraints, time-aware entitlement, lazy expiry repair, timezone independence |
| `attendance.integration.spec.ts` | one attendance row per (trip, student), concurrent board/drop resolves to exactly one winner |
| `plan-limits.integration.spec.ts` | quota enforcement and the **race**: 99 rows, limit 100, two concurrent creates → one success, one `PLAN_LIMIT_REACHED`, final count 100 |

`apps/api/test/e2e/`

| File | Verifies |
| --- | --- |
| `cross-tenant.e2e.spec.ts` | the full cross-tenant matrix over real HTTP (students, parents, buses, routes, assignments, trips, documents, notifications, emergencies), forged `school_id` payloads, parent→other child, driver→other trip, conductor→foreign trip, inactive school, deactivated user, SUPER_ADMIN scope, and the generic 404 that discloses nothing |
| `security.e2e.spec.ts` | CORS allowlist and preflight, security headers, CSRF double submit, refresh rotation/replay, logout cookie clearing |
| `rate-limit.e2e.spec.ts` | login throttling and automatic recovery, per-identity counters, SOS/attendance/location/list policies, useful 429 payloads |

Test helpers live in `apps/api/test/support/` (`env`, `database`, `fixtures`,
`app`, `http`, `auth`). Fixtures write through the real Sequelize models, so a
fixture that violates a constraint fails instead of drifting from production.

## 4. Typecheck, lint, build

```bash
npm run typecheck
npm run lint            # eslint . --max-warnings 0
npm run build
```

## Known environment limitations

* There is no CI job wired for the database-backed suites yet; they are opt-in
  locally and should be added to the pipeline together with a Postgres service
  container.
* `test:e2e` boots the real Nest application per spec file. Each file listens on
  an ephemeral port on `127.0.0.1`.
