# Operating model: routes, runs, shifts and crew

This document is the **single source of truth** for the operating-model refactor
that runs across four sessions. Session 1 ships the design plus the database
foundation; Sessions 2–4 build the service layer, the API surface and the
clients on top of exactly the schema and rules written here.

Where a decision was open, this document states the decision and the reason
rather than leaving it implicit — the same convention `docs/subscriptions.md`
follows.

---

## 1. Why the current model has to change

### 1.1 What is actually in the database today

Verified against the shipped schema (not from memory):

| Table | Key columns | What one row means |
| --- | --- | --- |
| `routes` | `school_id`, `name`, `code` | A named path through an ordered set of stops |
| `stops` | `school_id`, `route_id`, `sequence_number` | One pickup point on one route |
| `route_assignments` | `route_id`, `bus_id`, `user_id`, `role`, `effective_from`, `effective_to` | One *person* in one *role* rostered on a *route* for a *date range* |
| `students` | `school_id`, `home_stop_id` | A pupil, tied to transport only through their home stop |
| `trips` | `route_id`, `bus_id`, `driver_id`, `conductor_id`, `scheduled_start_at` | One concrete execution of a route |

The constraints that pin the shape:

- `uq_route_assignments_route_user_role` — unique on
  `(route_id, user_id, role, effective_from)` where `deleted_at IS NULL`.
- `uq_trips_route_scheduled_start` — unique on `(route_id, scheduled_start_at)`
  where `deleted_at IS NULL`.
- `effective_from` / `effective_to` are `DATEONLY`. There is **no time of day**
  anywhere in the roster.

### 1.2 The consequence: 1 route = 1 bus = 1 crew

The conflict engine in
`web/src/server/modules/assignments/assignment-conflicts.ts` decides what is
legal. Its overlap test is the whole story:

```ts
export function periodsOverlap(a, b): boolean {
  const aEnd = a.effective_to ?? '9999-12-31';
  const bEnd = b.effective_to ?? '9999-12-31';
  return a.effective_from <= bEnd && b.effective_from <= aEnd;
}
```

Two assignments overlap if their **date** ranges touch. Then, in precedence
order, `findAssignmentConflict` rejects:

1. `ROUTE_ROLE` — one route already has an active row for the same role;
2. `ROUTE_BUS` — one route cannot change buses during an overlap;
3. `BUS` — **one bus cannot serve two routes during an overlap**;
4. `CREW_ROUTE` — **one crew member cannot cover two routes during an overlap**.

Rules 3 and 4 are date-granular. A bus that drives the 07:00 morning loop and
the 13:00 afternoon return is, to this engine, "serving two routes on the same
day" and is **rejected**. Same for the driver. So the only legal configuration
is one route holding one bus and one crew pair for the whole effective period.

That is not a modelling preference — it is the arithmetic of comparing dates
that carry no time. **Tiering is impossible to express.**

### 1.3 What the industry standard does instead

Transfinder, Versatrans (Trapeze/RoutingWorks) and EDULOG all separate the
*path* from the *vehicle pass over that path*:

```
ROUTE  = the path: an ordered list of stops.        (geometry)
RUN    = one vehicle's timed pass over that route.  (resource + clock)
RUN    has: a bus, a driver, a conductor, a shift window.
A ROUTE has MANY RUNs.
A STUDENT is assigned to a RUN — so the parent sees an exact bus number.
A TRIP is one execution of a RUN on one calendar day.
SHIFT  = a bell window (07:00–11:00, 12:00–17:00) that groups runs.
```

Tiering falls out for free: bus `MH-31-1234` does route *North Loop* at 07:00
(shift "Morning") and route *East Corridor* at 13:00 (shift "Afternoon"). The
two runs do not overlap **in time**, so both are legal — and the system can now
*prove* it, because the comparison happens on shift windows rather than dates.

---

## 2. Target model

```
schools ─┬─ shifts      (bell windows)
         ├─ buses
         ├─ routes ── stops
         │     └─ runs ──┬─ run_crew  (driver / conductor per run)
         │               ├─ trips     (one per day per run)
         │               └─ students  (run_id: who rides which bus)
         └─ users ── run_crew
```

Read it as:

- **`routes`** stops owning vehicles and crew. It is geometry + stops.
- **`runs`** own the vehicle and the clock. A route with 3 runs is one path
  driven three times, by three different buses, at three different times.
- **`run_crew`** is the per-run roster. It replaces `route_assignments` as the
  authoritative crew record over time; `route_assignments` stays readable but
  stops being written (see §6.3).
- **`shifts`** are the reason two runs by the same bus are legal: they are
  disjoint by construction.
- **`students.run_id`** is what makes the parent-facing promise ("your child is
  on bus B-02, driver Ramesh") exact instead of inferred from a stop.

---

## 3. Schema

Every table below follows the house conventions, which are load-bearing and
are **not** repeated per table:

- UUIDv4 primary key `id`, plus `created_at`, `updated_at`, `deleted_at`
  (`BaseModel`, `paranoid: true` — soft delete everywhere).
- A plain `school_id` foreign key to `schools(id)`, **and** a non-partial
  `UNIQUE (school_id, id)` index named `uq_<table>_school_id`. That index is
  what makes tenant-pinned composite foreign keys possible: a primary key on
  `id` alone is not a valid composite-FK target.
- Every reference to another tenant-owned row is a **composite** foreign key on
  `(school_id, <entity>_id) → <table>(school_id, id)`. A row can therefore
  never combine resources from two schools, no matter what a client posts.
- Composite FKs are written as explicit `ALTER TABLE … ADD CONSTRAINT` SQL in
  the migrations, because Sequelize v6's *types* describe `addConstraint`
  references as a single column while the runtime supports a list. The SQL is
  exactly what `addConstraint` would emit.
- Every query in the service layer pins `school_id` from the verified JWT. It
  is never a request body field.

### 3.1 `shifts`

A bell window. Immutable-ish reference data per school.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | PK |
| `school_id` | `uuid` | no | FK → `schools(id)`, `ON DELETE CASCADE` |
| `name` | `varchar(80)` | no | "Morning", "Afternoon", "Late Bus" |
| `start_time` | `time` | no | Window opens (tenant local wall clock) |
| `end_time` | `time` | no | Window closes |
| `is_active` | `boolean` | no | default `true` |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | — | standard |

Constraints and indexes:

| Name | Definition | Why |
| --- | --- | --- |
| `ck_shifts_window` | `CHECK (end_time > start_time)` | A window must have positive length. Overnight windows are not a school-transport concept; if they ever are, this is the line to change. |
| `uq_shifts_school_id` | `UNIQUE (school_id, id)` | Composite-FK target for `runs.shift_id`. Must be non-partial. |
| `uq_shifts_school_name` | `UNIQUE (school_id, name) WHERE deleted_at IS NULL` | Two live "Morning" shifts in one school is a data-entry error. Soft-deleted names are reusable. |
| `idx_shifts_school_active` | `(school_id, is_active)` | Picker lists. |
| `idx_shifts_school_window` | `(school_id, start_time, end_time)` | "Which shifts overlap 09:00?" — the tiering query. |

`start_time`/`end_time` are `time`, deliberately **not** `timestamptz`. A bell
window is a wall-clock rule that repeats every day; storing an instant would
force the DST/timezone question into reference data. The instant a *trip*
happens stays `timestamptz` on `trips.scheduled_start_at`, unchanged.

There is no `description` column: nothing consumes one and `routes` already
carries the prose. Add it if the Session 3 UI needs it.

### 3.2 `runs`

One vehicle's timed pass over one route.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | PK |
| `school_id` | `uuid` | no | FK → `schools(id)`, `ON DELETE CASCADE` |
| `route_id` | `uuid` | no | composite FK → `routes(school_id, id)`, `ON DELETE CASCADE` |
| `shift_id` | `uuid` | **yes** | composite FK → `shifts(school_id, id)`, `ON DELETE SET NULL`. Nullable in Session 1 — see below. |
| `bus_id` | `uuid` | **yes** | composite FK → `buses(school_id, id)`, `ON DELETE SET NULL`. Null while the fleet is undecided, mirroring `route_assignments.bus_id`. |
| `code` | `varchar(32)` | no | Parent-facing short code shown on the bus sign and in messages, e.g. `R-01` or `R-01-2`. |
| `is_default` | `boolean` | no | default `false`. Marks the auto-provisioned back-compat run (§6.1). |
| `is_active` | `boolean` | no | default `true` |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | — | standard |

Constraints and indexes:

| Name | Definition | Why |
| --- | --- | --- |
| `uq_runs_school_id` | `UNIQUE (school_id, id)` | Composite-FK target for `run_crew`, `trips`, `students`. Must be non-partial. |
| `uq_runs_school_code` | `UNIQUE (school_id, code) WHERE deleted_at IS NULL` | A parent must never be told "bus R-01" when two live runs share the code. |
| `uq_runs_route_default` | `UNIQUE (route_id) WHERE deleted_at IS NULL AND is_default` | **The back-compat invariant, enforced by the database**: at most one default run per route. Session 2's "create run" path must never set `is_default`. |
| `idx_runs_school_route` | `(school_id, route_id)` | "All runs of this route". |
| `idx_runs_school_shift` | `(school_id, shift_id)` | "Everything in the morning shift". |
| `idx_runs_school_bus` | `(school_id, bus_id)` | "What is this bus doing today?" — the tiering query. |
| `idx_runs_school_active` | `(school_id, is_active)` | Plan-limit usage counts active rows only. |

**Why `shift_id` is nullable in Session 1.** The backfill (§6.1) creates one
default run per *existing* route. Those schools have not defined a single
shift yet, so there is nothing honest to point at. Inventing a synthetic
"Default" shift inside a data migration would write reference data the operator
never chose. Session 2 adds the rule at the right layer: **the API requires
`shift_id` on every run created after shifts exist**, and a run may stay
`NULL`-shift only if it is the pre-existing default run. If Session 3 wants the
column hard-`NOT NULL`, the path is: provision shifts for every school, backfill
`shift_id`, then `ALTER COLUMN … SET NOT NULL` in its own migration.

**Why `runs` has no `start_time`/`end_time` of its own.** The clock lives on the
shift. Putting times on both the run and the shift creates two sources of truth
that will disagree. A run's times *are* its shift's window. Phase 3 revisits
this only if a school needs per-run offsets from the bell window, and even then
the answer should be `offset_minutes`, not a second pair of timestamps.

### 3.3 `run_crew`

One person, one role, one run, one effective period. Structurally the same
shape as `route_assignments` — the difference is *what it points at*.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | PK |
| `school_id` | `uuid` | no | FK → `schools(id)`, `ON DELETE CASCADE` |
| `run_id` | `uuid` | no | composite FK → `runs(school_id, id)`, `ON DELETE CASCADE` |
| `user_id` | `uuid` | no | composite FK → `users(school_id, id)`, `ON DELETE CASCADE` |
| `role` | `enum_run_crew_role` | no | `'DRIVER'` \| `'CONDUCTOR'` |
| `effective_from` | `date` | no | First day inclusive (tenant local date) |
| `effective_to` | `date` | yes | Last day inclusive; `NULL` = open-ended |
| `is_active` | `boolean` | no | default `true` |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | — | standard |

Constraints and indexes:

| Name | Definition | Why |
| --- | --- | --- |
| `ck_run_crew_effective_range` | `CHECK (effective_to IS NULL OR effective_to >= effective_from)` | Same guard `route_assignments` has. |
| `uq_run_crew_run_user_role` | `UNIQUE (run_id, user_id, role, effective_from) WHERE deleted_at IS NULL` | One person cannot start the same role on the same run twice on one day. |
| `idx_run_crew_run_role` | `(run_id, role)` | "Who drives run X?" |
| `idx_run_crew_school_run` | `(school_id, run_id)` | Composite-FK support + tenant scoping. |
| `idx_run_crew_school_user` | `(school_id, user_id)` | "Which runs is this driver on?" — the driver's day view. |

**Why a new `enum_run_crew_role` type instead of reusing
`enum_route_assignments_role`.** The values are identical today. A separate
type costs one `CREATE TYPE` and buys independent evolution: `run_crew` is the
roster that will grow (a bus attendant / escort is a real requirement in
several Indian states) while `route_assignments` is frozen and on its way out.
Sharing the type would make adding a value to one silently legal in the other.
The values stay declared in `web/src/server/database/models/enums.ts` as the
single source of truth; the migration repeats the literals on purpose, because
a migration is an immutable record of a released schema.

**Note on `effective_from`/`effective_to` staying `DATEONLY`.** These columns
answer *"who is rostered on this run this term?"*, not *"when does the run
depart?"*. Crew rotation is a term/week-scale fact. The **intra-day** question
that unlocks tiering is answered by `runs.shift_id → shifts.start_time/end_time`,
not by these columns. See §4.

### 3.4 `students.run_id`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `run_id` | `uuid` | **yes** | composite FK → `runs(school_id, id)`, `ON DELETE SET NULL` |

Index: `idx_students_school_run (school_id, run_id)`.

Nullable because a pupil can be enrolled before transport is allocated — the
same reasoning that keeps `home_stop_id` nullable. `ON DELETE SET NULL` means
retiring a run unassigns its riders instead of deleting or blocking them, which
is the only behaviour that is safe to run unattended.

`home_stop_id` is **not** dropped and is **not** deprecated in Session 1: the
stop is still where the child is physically picked up, and the ETA/geofence
machinery is built on it. `run_id` answers a different question — *which
vehicle*. Session 2 must add the cross-check that the assigned run's route
actually serves the student's home stop.

### 3.5 `trips.run_id`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `run_id` | `uuid` | **yes** | composite FK → `runs(school_id, id)`, `ON DELETE SET NULL` |

Indexes:

| Name | Definition |
| --- | --- |
| `uq_trips_run_scheduled_start` | `UNIQUE (run_id, scheduled_start_at) WHERE deleted_at IS NULL AND run_id IS NOT NULL` |
| `idx_trips_school_run` | `(school_id, run_id)` |

`uq_trips_run_scheduled_start` is the run-level successor to
`uq_trips_route_scheduled_start`: one open trip per run per scheduled
departure. The `run_id IS NOT NULL` predicate keeps the index small during the
transition; rows with a `NULL` run are already never in conflict, because
`NULL`s are distinct in a unique index.

**`uq_trips_route_scheduled_start` is kept, not dropped.** It is still true and
still useful: two runs of the same route should not depart at the same instant,
because the stops are shared and the manifest would be ambiguous. Dropping it
in Session 1 would remove a guarantee before Session 2 has written the rule
that replaces it. Session 2 decides whether it survives; if it is dropped, that
is its own migration with its own `down()`.

### 3.6 What the two trip indexes actually do together — measured, not assumed

A run belongs to exactly one route, so a `(run_id, scheduled_start_at)` clash is
*always* also a `(route_id, scheduled_start_at)` clash. While both indexes
exist the route-level one is therefore strictly stronger, and PostgreSQL
reports whichever it reaches first (observed: it is not deterministic — the
route-level index fired in one data state and the run-level one in another).

Verified against PostgreSQL 17.10 by dropping `uq_trips_route_scheduled_start`
and re-testing:

- `uq_trips_run_scheduled_start` **on its own** rejects a second trip for the
  same run at the same instant — the constraint is correctly defined;
- with it gone, two *different* runs of the same route at the same instant is
  accepted.

So the run-level index adds no protection today and becomes load-bearing the
moment Session 2 retires the route-level one. It is shipped now because the
schema change and the index are cheap, and adding it later would mean a
second migration and a second review of the same table.

---

### 3.7 A hazard this schema has to respect: composite `ON DELETE SET NULL`

Found while verifying the seeders against a real database, and worth stating
explicitly because it constrains every future delete path.

PostgreSQL's `ON DELETE SET NULL` on a **multi-column** foreign key nulls
*every* referencing column, not just the nullable one. Reproduced minimally:

```
parent(school_id, id) UNIQUE(school_id, id)
child (school_id NOT NULL, parent_id)
  FOREIGN KEY (school_id, parent_id) REFERENCES parent(school_id, id) ON DELETE SET NULL

DELETE FROM parent;
ERROR: null value in column "school_id" of relation "child" violates not-null constraint
```

The tenant-pinned composite keys this codebase relies on are exactly this
shape, so a hard delete of a referenced row tries to null `school_id` too. Two
consequences:

1. **It is fail-safe, not corrupting.** Because `school_id` is `NOT NULL` on
   every tenant table, the delete is *refused* rather than silently orphaning a
   row from its tenant. The outcome is an ugly error, not data loss.
2. **It only fires on hard deletes**, which normal operation never performs —
   every model is `paranoid`, so `destroy()` writes `deleted_at` and fires no
   FK action at all. Hard deletes happen in seeders, in `db:migrate:undo`, and
   in manual DBA work.

This is **pre-existing**, not introduced here. It already applies to 11
shipped constraints (`fk_students_home_stop`, `fk_trips_bus`,
`fk_route_assignments_bus`, `fk_emergency_events_*`, …); deleting a stop that a
pupil still references fails on `main` today. The reason it has gone unnoticed
is that `purgeSchool()` in the seeders deletes `students` *before* `stops`, so
the action never fires.

Session 1 adds four more constraints of the same shape — `fk_students_run`,
`fk_trips_run`, `fk_runs_shift`, `fk_runs_bus` — and keeps them composite on
purpose: cross-tenant pinning is a security property here, and the alternative
(a single-column `run_id → runs(id)`, as
`20260903120200-relax-import-jobs-actor-fk.ts` did) would let a buggy or
malicious write point one school's students at another school's run.

**The rule that follows, and that both seeders now encode:** when hard
deleting, remove referrers before referees. `run_crew`, `trips` and `students`
are all deleted before `runs`; `runs` before `routes` / `shifts` / `buses`.

**Recommended follow-up (not in this programme):** convert the composite
`ON DELETE SET NULL` constraints to `ON DELETE NO ACTION` (or `RESTRICT`), so
the refusal is explicit and the error names the constraint instead of a
not-null violation. That is one migration over 15 constraints, reversible, and
changes no behaviour that currently succeeds.

---

## 4. Conflict rules: time windows, not dates

This section is the reason the refactor exists. It is **specified here and
implemented in Session 2** — Session 1 ships the schema that makes it
expressible.

### 4.1 The core change

Today:

```
overlap(A, B) = A.effective_from <= B.effective_to AND B.effective_from <= A.effective_to
                ^^^^^^^^^^^^^^^^ date-granular
```

Target — a pair of runs conflicts only when **both** their rosters overlap
**and** their shift windows overlap:

```
conflicts(A, B) = rostersOverlap(A, B) AND windowsOverlap(A, B)

windowsOverlap(A, B) = A.shift.start_time < B.shift.end_time
                    AND B.shift.start_time < A.shift.end_time
```

Two comparisons, both required. That single `AND` is what unlocks tiering:
`07:00–11:00` and `12:00–17:00` do not overlap, so the same bus and the same
driver may hold both runs.

### 4.2 The rewritten rule table

| Kind | Today | Target | Change |
| --- | --- | --- | --- |
| `ROUTE_ROLE` | one route, one role, overlapping dates | **removed** — replaced by `RUN_ROLE` | A route legitimately has 3 runs, each with its own driver. |
| `RUN_ROLE` | — | one **run**, one role, overlapping roster windows | New. Mirrors the old rule at the right granularity. |
| `ROUTE_BUS` | one route cannot change bus mid-overlap | **removed** | Different runs of one route *should* use different buses. That is the point. |
| `BUS` | one bus, two routes, overlapping **dates** | one bus, two **runs**, overlapping **shift windows** | Date test → window test. **This is tiering.** |
| `CREW_ROUTE` | one person, two routes, overlapping **dates** | one person, two **runs**, overlapping **shift windows** | Date test → window test. **This is tiering.** |

`CREW_ROUTE` should be renamed `CREW_RUN` when it moves; the message constants
in `web/src/server/modules/assignments/assignments.constants.ts` move with it.

### 4.3 Rules for `NULL` shift

A `NULL` `shift_id` (a legacy default run) has no window, so it cannot be
compared. Decision:

> **A run with a `NULL` shift is treated as occupying the whole day.**

It therefore conflicts with *every* other run of that bus/crew member, which
reproduces exactly today's behaviour for every pre-existing route. This is the
safe default: the refactor cannot silently legalise a clash it cannot see. It
is also the migration incentive — assigning a shift to a default run is what
unlocks tiering for that school.

### 4.4 Enforcement layers

1. **Database** — the uniqueness and check constraints in §3. They catch the
   structural mistakes (duplicate role on a run, zero-length window) and hold
   under concurrency.
2. **Service layer** — the window-overlap rules. This is where `BUS` and
   `CREW_RUN` live, because they are cross-row queries, not row constraints.
   The existing transactional pattern (advisory lock + count inside the same
   transaction, as `PlanLimitsService.runWithinLimit` does) is the model to
   copy for the same reason: a check-then-act pair of queries is a race.
3. **Import path** — `web/src/server/modules/data-transfer/import` reuses the
   same pure functions. The rules must live in one importable module with no
   HTTP dependencies, exactly like `assignment-conflicts.ts` does today.

---

## 5. Migration and file inventory (Session 1)

All under `web/src/server/database/migrations/`. Every `down()` is reversible
and the whole set rolls back to an empty schema — which
`web/test/integration/migrations.integration.spec.ts` asserts by running
`db:migrate:undo:all` and requiring that no table but `SequelizeMeta` remains.

| File | What it does | `down()` |
| --- | --- | --- |
| `20260906120000-create-shifts.ts` | `shifts` + check + 4 indexes | `dropTable` |
| `20260906120100-create-runs.ts` | `runs` + 3 composite FKs + 7 indexes | `dropTable` |
| `20260906120200-create-run-crew.ts` | `run_crew` + `enum_run_crew_role` + check + 4 indexes | `dropTable` + `DROP TYPE IF EXISTS "enum_run_crew_role"` |
| `20260906120300-link-students-and-trips-to-runs.ts` | adds `run_id` to `students` and `trips`, both composite FKs, both indexes, plus `uq_trips_run_scheduled_start` | removes indexes, columns and constraints |
| `20260906120400-backfill-default-runs.ts` | the data backfill (§6.1) | deletes exactly the rows it inserted |

Ordering is forced: `runs` needs `shifts` and `routes`; `run_crew` needs `runs`;
the `run_id` columns need `runs`; the backfill needs all four. Down runs in
reverse, so `runs` is dropped before `shifts` — no dangling reference.

Models added/changed in `web/src/server/database/models/`:

- new: `shift.model.ts`, `run.model.ts`, `run-crew.model.ts`
- new enum export in `enums.ts`: `RUN_CREW_ROLE_VALUES`. The column is typed
  with the existing `RouteAssignmentRole` — the value set is identical, and a
  bare `type RunCrewRole = RouteAssignmentRole` alias is rejected by
  `isolatedModules` + `emitDecoratorMetadata` in exactly the decorated
  signature where it would be used. A distinct `RunCrewRole` in
  `@school-bus-tracking/shared-types` is a Session 2 contract change.
- changed: `student.model.ts` (`run_id` + `BelongsTo(Run)`),
  `trip.model.ts` (`run_id` + `BelongsTo(Run)`), `route.model.ts`
  (`HasMany(Run)`), `bus.model.ts` (`HasMany(Run)`), `user.model.ts`
  (`HasMany(RunCrew)`)
- `index.ts`: the three new models are exported and registered in the `models`
  registry, which is the single source of truth the `DatabaseModule` initialises
  from.

The physical schema stays migration-driven. `sequelize.sync()` is never called.

### 5.1 How this was verified

Everything above was executed, not just written. The project's own suites:

| Check | Result |
| --- | --- |
| `npm run build:packages` | exit 0 |
| `npm run typecheck` (all workspaces) | exit 0 |
| `npm test` | 1681 pass / 0 fail (server 1320, mobile 149, web 212) — unchanged from the baseline before this change |
| `npm run test:integration` (real PostgreSQL) | 88 pass / 0 fail — 65 pre-existing plus 23 added by this change; includes the migration suite that migrates an empty database, re-runs the migrator, and rolls **all** the way back down and up again |
| `npm run test:e2e` | 95 pass / 5 fail — **identical on the base commit**; the five are CORS/CSRF/rate-limit transport tests that need a browser origin this environment does not provide |

`npm test` and `npm run typecheck` do not touch a database, so the migrations
were additionally exercised against a real PostgreSQL — **both 16.14** (the
deployment target: `infrastructure/docker-compose.yml` pins
`postgis/postgis:16-3.4`) **and 17.10** — using the project's own
`scripts/sequelize-cli.js`:

- **schema** — every index, partial-index predicate, CHECK and composite
  foreign key read back out of `pg_catalog` and compared with §3.
- **backfill** — a fixture set built to be awkward: a route whose roster names
  one bus, one whose roster names two, one with no roster at all, a
  soft-deleted route, an inactive route, two soft-deleted assignments sharing a
  natural key, and a code collision between a live and a soft-deleted route
  across two tenants. 27 assertions, all passing: correct bus inference,
  ambiguous buses left `NULL`, soft-delete and `is_active` carried over, roster
  copied 1:1 (9 `route_assignments` → 9 `run_crew`, columns compared
  individually), every trip and every allocated pupil re-attached, and
  re-running the statements creating nothing.
- **reversibility** — `db:migrate:undo` on that populated database removes
  exactly the backfilled rows and leaves `route_assignments`, `trips` and
  `students` intact; `up → down → up` reproduces the same 27 assertions.
- **models** — all 28 registry models initialised against the migrated schema,
  every new association loaded, and each constraint proven to fire: a second
  default run, a duplicate live run code, an inverted shift window, a duplicate
  roster row, two cross-tenant writes, and a duplicate trip departure.
- **seeders** — `db:setup` then `db:seed:undo:all` on an empty database: the
  default-run invariant holds for all 14 seeded routes and the undo leaves the
  tenant empty.

**That verification is now committed**, not throwaway — 23 tests across three
specs in `web/test/integration/`, all running the real migration files through
the project's own sequelize-cli runner:

- `runs-backfill.integration.spec.ts` (11 tests) — the awkward fixture, the
  pre-backfill state, every assertion above, idempotency, and the exact
  reversal. Uses a new `undoLastMigration()` helper in `test/support/database.ts`
  so a suite can migrate → seed → revert one migration → migrate again.
- `constraints.integration.spec.ts` (+10 tests) — every new CHECK, unique index
  and composite foreign key, proven to fire.
- `migrations.integration.spec.ts` (+2 tests) — the new tables in the expected
  set, the new indexes and constraints present, every new foreign key asserted
  to be composite on `(school_id, …)`, and the two role enum types asserted to
  be distinct.

The suite has teeth: mutating the backfill's `HAVING COUNT(DISTINCT bus_id) = 1`
to `>= 1` fails exactly one test ("takes the bus only when the roster is
unambiguous"), and adding `ra.deleted_at IS NULL` to the roster copy fails three
("copies the roster … with no loss", "is idempotent", "reproduces the same
result"). Both mutations were reverted.

The harness found three real defects that are now fixed: a missing `Op` import,
`MIN(uuid)` not existing in PostgreSQL (§6.1), and the seeder purge order that
trips the composite `ON DELETE SET NULL` behaviour in §3.7.

---

## 6. Back-compatibility

The rule for this refactor: **an operator who does nothing must see no
difference.** Every existing route keeps working, every parent keeps seeing the
same bus, and nothing is deleted.

### 6.1 The default run

`20260906120400-backfill-default-runs.ts` creates **exactly one run per
existing route row**, marked `is_default = true`. That preserves the identity
`1 route = 1 run = today's behaviour`, so every code path that reads
`route → assignment` still has a run to read.

How each field is chosen:

| Field | Value | Reason |
| --- | --- | --- |
| `school_id`, `route_id` | copied from the route | tenant pinning |
| `code` | `routes.code`, verbatim | Parent-facing continuity. "Bus R-01" means the same thing before and after. It is also collision-free by construction: `uq_routes_school_code` already makes live route codes unique per school. |
| `shift_id` | `NULL` | No shifts exist yet — see §3.2. Per §4.3 this makes the run occupy the whole day, i.e. today's conflict behaviour exactly. |
| `bus_id` | the route's bus **iff** every non-deleted assignment on that route agrees on exactly one bus; otherwise `NULL` | Copying an ambiguous bus would invent a dispatch decision. The SQL computes `MIN(bus_id)` and `COUNT(DISTINCT bus_id)` per route and only takes the value when the count is 1. |
| `is_default` | `true` | Marks the row for the invariant index and for `down()`. |
| `is_active` | copied from `routes.is_active` | An inactive route should not hand out an active run. |
| `deleted_at` | copied from `routes.deleted_at` | Soft-deleted routes are backfilled too, so their trips and roster rows still resolve. Nothing is orphaned. |
| `id` | `gen_random_uuid()` | PostgreSQL 13+ built-in v4. The deployment target is PostgreSQL 16 (`infrastructure/docker-compose.yml` pins `postgis/postgis:16-3.4`). |

The insert is guarded with `WHERE NOT EXISTS (SELECT 1 FROM runs …)`, so a
re-run creates nothing. Migrations are recorded once in `SequelizeMeta` anyway;
the guard is belt and braces for a manually replayed statement.

### 6.2 Mapping what already exists

Two follow-up statements, in the same migration and the same transaction:

**Trips** — every trip is pointed at its route's default run:

```sql
UPDATE trips t SET run_id = r.id, updated_at = now()
  FROM runs r
 WHERE r.is_default AND r.route_id = t.route_id AND r.school_id = t.school_id
   AND t.run_id IS NULL;
```

The join is 1:1 because §6.1 creates exactly one default run per route. The
`t.run_id IS NULL` predicate makes the statement idempotent.

**Roster** — every `route_assignments` row is copied onto `run_crew`, attached
to that route's default run. Columns are copied 1:1 — `user_id`, `role`,
`effective_from`, `effective_to`, `is_active`, `created_at`, `updated_at` **and
`deleted_at`** — so the copy is a faithful snapshot, including soft-deleted
history. The anti-join that makes it idempotent matches on
`(run_id, user_id, role, effective_from, deleted_at, updated_at)`; matching
`updated_at` too is what lets two soft-deleted rows with the same natural key
both survive, so nothing is silently swallowed.

`route_assignments` is **not** modified or deleted by the backfill. It stays as
the audit record of what the roster was.

**Zero data loss** is therefore: no row deleted, no column dropped, every trip
and every roster entry resolvable through a run, and the whole backfill
reversible (§6.4).

### 6.3 `route_assignments`: deprecated, writes retired (Phase 4)

| Stage | Session | `route_assignments` | `run_crew` |
| --- | --- | --- | --- |
| Today | — | read **and** written | does not exist |
| After Session 1 | 1 | read and written (unchanged) | populated by backfill, read-only |
| Dual write | 2 | written (mirror) | **authoritative** — API writes here |
| Read-only | 3 | read-only, API responses stop using it | authoritative |
| Writes retired | 4 | table kept, **GET still serves the mirror**, POST/PATCH/DELETE → `410 Gone` | authoritative |
| Fully retired | future | table kept, all reads gone | authoritative |

Session 2 owns the dual write and the conflict-engine swap. Session 1
deliberately does **not** touch `AssignmentsService`, because writing to both
tables before the conflict rules move would put the two rosters out of step.

**Phase 4 mechanism.** Rather than deleting the legacy controllers, every
legacy assignment endpoint carries a `deprecation` declaration consumed by the
route runtime, which emits, on *every* response (read and write):

- `Deprecation: true` ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594));
- `Sunset: Wed, 31 Mar 2027 00:00:00 GMT`
  ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594));
- `Link: </api/v1/runs>; rel="success-version"`
  ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745)).

`POST`/`PATCH`/`DELETE` are answered with **`410 Gone`** *before* the auth
guards run, so no legacy write path can ever create a row the run-crew service
does not know about; `GET` keeps serving so existing screens and exports keep
working against the mirror. The assignment services stay in the tree as the
mirror reader. The tenant surface (`/route-assignments`, `/assignments`) and
the assisted-management equivalents behave identically. The `run_crew`
service remains the only writer — every run-crew create/update/delete still
updates the mirror row, so the retired table is and remains a faithful
read-only copy.

Nothing is dropped in this programme without its own migration with a working
`down()`. "Deprecated" here means "stop writing", never "delete".

### 6.4 Reversibility

The backfill's `down()` removes exactly what its `up()` added, in dependency
order: `trips.run_id` and `students.run_id` are nulled where they point at a
default run, the `run_crew` rows that mirror a `route_assignments` row on the
same route are deleted, and finally the default runs themselves. It does not
touch hand-created runs (Session 2+), and it does not touch
`route_assignments` at all.

---

## 7. Seeders

The backfill only covers routes that already exist. Both seeders run *after*
the migrations, so `npm run db:setup` would otherwise produce 14 routes with no
runs at all and break the "every route has exactly one default run" invariant
on a fresh database. Both were updated.

**`20260905120000-four-dummy-schools.ts`** — per school (4 schools):

- 3 shifts (Morning 07:00–11:00 / Afternoon 12:00–16:00 / Late Bus
  16:30–19:00), disjoint so one bus could legally hold a run in each —
  new type code `23`;
- 1 default run per route, `code = route.code`, `is_default = true`,
  `shift_id` set to the shift matching that route's template — type code `24`;
- `run_crew` rows mirroring each route's driver + conductor assignment —
  type code `25`;
- `trips.run_id` and `students.run_id` pointing at the route's default run.

**`20260827120800-demo-core-domain-data.ts`** — 2 shifts, 1 default run per
route (2), 2 `run_crew` rows, and `run_id` on its students and its trip, using
the same fixed-UUID convention as the rest of that seeder.

`purgeSchool()` and the demo seeder's `down()` delete `run_crew`, `runs` and
`shifts` **after** `trips` and `students` and before `routes` / `buses` /
`schools` — the ordering constraint §3.7 explains. The new type codes go
through the existing `makeUuid(school, type, item)` helper, so
`seed-uuids.spec.ts` keeps proving they are valid RFC 4122 v4 ids.

Unlike the backfill, the seeders *do* set `shift_id`: a fresh demo school
should show the tiering model working, not the legacy `NULL`-shift state.

---

## 8. API surface (sketch — built in Sessions 2 and 3)

Nothing below exists after Session 1. It is recorded here so Sessions 2–4 build
the surface this design implies instead of rediscovering it.

All routes are `/api/v1`, tenant-scoped from the JWT, soft-delete aware, and
paginated like the existing collections.

### 8.1 Shifts — Session 2

```
GET    /api/v1/shifts
POST   /api/v1/shifts
GET    /api/v1/shifts/:id
PATCH  /api/v1/shifts/:id
DELETE /api/v1/shifts/:id
```

`DELETE` must refuse (409) while the shift still has runs. Retiring a shift
that dispatches depend on is an operator error, not a cascade.

### 8.2 Runs — Session 2

```
GET    /api/v1/runs                    ?route_id=&shift_id=&bus_id=&is_active=
POST   /api/v1/runs
GET    /api/v1/runs/:id
PATCH  /api/v1/runs/:id
DELETE /api/v1/runs/:id
GET    /api/v1/routes/:id/runs         nested read
POST   /api/v1/routes/:id/runs         nested create
GET    /api/v1/runs/:id/crew
GET    /api/v1/runs/:id/students
GET    /api/v1/runs/:id/trips          ?from=&to=
GET    /api/v1/buses/:busId/runs       the tiering / day-view query
```

`POST /runs` is where the §4 conflict rules run, and where the plan limit is
reserved inside the same transaction. `is_default` is never accepted from a
client — it is server-only, set once by the backfill.

### 8.3 Run crew — Session 2

```
POST   /api/v1/runs/:id/crew
PATCH  /api/v1/run-crew/:id
DELETE /api/v1/run-crew/:id
GET    /api/v1/users/:id/run-crew      "this driver's roster"
```

### 8.4 Changed existing endpoints

| Endpoint | Change | Session |
| --- | --- | --- |
| `POST/PATCH /students/:id` | accepts `run_id`; validates the run's route serves the student's home stop | 2 |
| `POST/PATCH /trips` | accepts `run_id`; derives `bus_id`/`driver_id`/`conductor_id` from the run's crew | 2 |
| `GET /parent/children/:id` | adds the exact `bus_number`, `run_code`, driver name | 3 |
| `GET /reports/*` | run-level utilisation and tiering reports | 4 |
| `GET/POST /route-assignments` | deprecated in responses; writes mirrored to `run_crew` | 2 |

### 8.5 Contracts

New DTOs and response shapes go in `packages/shared-types`, their zod schemas
in `packages/validation`, and the typed methods in `packages/api-client` —
Session 2, never Session 1. Adding a `PlanLimitResource` member is one of those
Session 2 steps (§9).

---

## 9. Plan limits: `runs` — deferred to Session 2

Runs are a billable resource: a school on the Basic plan should not get
unlimited tiering. The design is settled; the **implementation is deliberately
deferred** and lands in Session 2.

The reason is a hard constraint collision, stated rather than worked around
silently: registering the resource means adding `RUNS = 'runs'` to
`PlanLimitResource` in `packages/shared-types`, and that enum is consumed by an
exhaustive `Record<PlanLimitResource, number>` in
`web/src/features/admin/metrics.ts:235`. Adding the member breaks
`npm run typecheck` in that UI file, which Session 1 is not allowed to touch.
Both facts were verified by running the compiler.

Session 2 must do all four, in one commit:

1. `packages/shared-types/src/index.ts` — add `RUNS = 'runs'` to
   `PlanLimitResource`, plus `PLAN_LIMIT_RESOURCE_LABELS[RUNS] = 'Runs'`.
2. `web/src/server/common/plan-limits/plan-limit-reached.exception.ts` — add the
   `runs` entry to its exhaustive message map (also a `Record` over the enum).
3. `web/src/server/common/plan-limits/plan-limits.service.ts` — accept a `Run`
   repository (as the 9th constructor argument, before `sequelize`) and add a
   `PlanLimitResource.RUNS` case to `countUsage` counting
   `{ school_id, is_active: true }`, matching how `routes` is counted. Then
   update all seven `new PlanLimitsService(...)` call sites: `container.ts`,
   `plan-limits.service.spec.ts`, `plan-limits.subscription.spec.ts`, and the
   four integration specs.
4. `web/src/features/admin/metrics.ts` — add the `runs` key to
   `usageByResource`, and (optionally) `run_count` to `AdminSchoolStats` so the
   School 360 view shows real usage instead of `0`.

Nothing in Session 1 depends on this: the `runs` table is fully functional
without a quota, and the seeder does not exercise plan limits.

---

## 10. Phase plan

### Phase 1 — Session 1 (this change)

Design doc. `shifts`, `runs`, `run_crew` tables with paranoid soft delete,
tenant-pinned composite FKs and the indexes above. `run_id` on `students` and
`trips`. `uq_trips_run_scheduled_start`. Default-run backfill with zero data
loss and a reversible `down()`. Sequelize models, associations and registry.
Seeders updated so a fresh database satisfies the default-run invariant.

No service, API, UI, mobile or `packages/*` change.

### Phase 2 — Session 2 (service layer + conflicts)

- `ShiftsService`, `RunsService`, `RunCrewService` — CRUD, tenant-pinned,
  soft-delete aware.
- The §4 conflict engine as one pure, importable module: `RUN_ROLE`, `BUS`,
  `CREW_RUN` on shift windows; `NULL` shift = whole day.
- Dual write `run_crew` ⇄ `route_assignments`; `route_assignments` stops being
  authoritative.
- `runs` registered as a plan-limit resource (all four edits in §9).
- `POST /runs` reserves the quota inside the same transaction (advisory lock
  pattern), so two concurrent creates cannot both pass.
- DTOs in `packages/validation`, response types in `packages/shared-types`.
- Integration tests: tiering is legal, same-window double-booking is not,
  `NULL`-shift runs still conflict with everything.

### Phase 3 — Session 3 (API + clients)

- Endpoints in §8.1–§8.3, plus the changed endpoints in §8.4.
- `packages/api-client` methods.
- Web UI: shift picker, route → runs list, run detail (crew, riders, trips),
  bus day view showing tiering.
- Mobile: driver sees the run they are rostered on, not "a route".
- Parent view: exact bus number and driver for the child's run.

### Phase 4 — Session 4 (reports, retirement, hardening) — shipped

- **Reports.** Four new report types follow the existing
  schema → service → page-card pattern:
  - *Run utilisation* — active riders (students with an active `run_id`) per
    run against bus seat capacity, with fill %, trip count and crew
    completeness;
  - *Bus-day tiering* — per active bus: its runs and the distinct shift
    windows they occupy (a `NULL` shift is its own whole-day window, matching
    §4.3), so an operator sees how much of the day each bus covers;
  - *Crew load* — active roster rows effective today per staff member and
    role (`effective_from <= today` and `effective_to` NULL or in the future);
  - *Deadhead* — active runs that carry a bus but zero riders (paid fleet
    movement with no children on board).
  All four accept the shared filter set (`route_id`, `bus_id`, `shift_id`,
  `status`, `date_from`, `date_to`) and the `shift_id` report filter shipped
  with them.
- **`route_assignments` writes retired** — see §6.3: `410 Gone` on writes,
  `Deprecation` / `Sunset` / `Link` headers on every response, GET unchanged.
- **Data transfer.** `ExportDataset.SHIFTS` and `ExportDataset.RUNS` are
  registered and wired to `ListActions` on `/shifts` and the Runs panel. The
  runs export resolves route, shift window, bus registration, driver,
  conductor and active-rider count; a `driver_id` filter resolves the
  driver's runs through `run_crew`; runs without a shift export as
  "Whole day (legacy)". **Bulk import for shifts/runs is deliberately not
  added:** the existing import pipeline still funnels rosters through the
  legacy date-based `route_assignments` write path (now `410`), and roster
  imports must instead run the window-conflict engine — bolting a new importer
  onto the retired dual-write would resurrect writes the retirement closed.
  Runs and shifts continue to arrive via the API and seeders; a dedicated
  importer driving the run-crew service is a future piece.
- **Assisted management.** The SUPER_ADMIN managed surface now covers shifts,
  runs and run-crew 1:1 across every place the assisted model requires:
  capabilities + audit-entity mapping (`shifts`/`runs`/`run_crew`), 15 managed
  endpoints (shifts CRUD, runs CRUD, `runs/:id/crew` GET+POST,
  `run-crew/:id` GET/PATCH/DELETE — no new nested shapes beyond what the
  tenant surface already has), the api-client `MANAGED_TENANT_PATH_RULES`
  remapping `/shifts`, `/runs[/:id/crew]` and `/run-crew/:id`, and the managed
  sidebar "Shifts & runs" entry.
- **`NULL`-shift cleanup / `SET NOT NULL` — deliberately *not* shipped.** The
  precondition for tightening `runs.shift_id` was "only if the data and the
  seeders allow". They do not: the back-compat design of §6.1 auto-provisions
  a default run with `shift_id = NULL` on every new route (`provisionDefaultRun`),
  and the §4.3 whole-day semantics are load-bearing across the conflict
  engine, the reports and their unit suites (a `NULL` shift *is* the express
  representation of "no shift defined yet", not dirty data to clean up).
  Forcing `NOT NULL` would require inventing a synthetic per-school shift
  inside a data migration — the exact thing the `create-runs` migration
  comment ruled out ("would write reference data no operator chose") — or
  re-architecting the default-run provisioning path. The column stays
  nullable; the reports, exports and conflict rules already treat `NULL`
  explicitly and consistently.
- **Integration coverage.** The CI-only `run-conflicts` integration spec
  (real PostgreSQL; the sandbox has no database) gained, without rewriting
  existing cases: a shift-lifecycle case (409 while a live run references the
  shift, delete succeeds once the run is soft-deleted, the partial unique
  index releases the name) and a run-crew case proving a crew write still
  creates, and a delete still soft-deletes, the `route_assignments` mirror.
- Load/concurrency verification of the conflict checks remains a CI/ops
  exercise: the advisory-lock serialization is unit-covered and exercised in
  the CI integration spec, but load testing needs a deployed PostgreSQL.

---

## 11. Open questions (decided in later sessions, not here)

1. **Per-run time offsets.** If a school needs a run to start 10 minutes off
   its bell window, add `offset_minutes` to `runs` — not a second pair of
   timestamps. Decide in Phase 3, driven by a real requirement.
2. **Direction — decided "won't do" in Phase 4.** Many districts model AM/PM
   as separate runs on one path; this design expresses that as two runs. The
   Phase 4 reports (§Phase 4) pair runs per bus per day via their **shift
   windows**, not via a direction tag — morning/afternoon pairing falls out of
   the shifts the runs already reference, and a `NULL` shift is its own
   whole-day window. An explicit `direction` column would duplicate that
   grouping as a second, denormalised source of truth, so it is not added.
   Revisit only if a future report needs AM/PM pairing *across* shifts (e.g.
   matching a morning run to its afternoon return regardless of window).
3. **Multi-stop students.** A child who rides in the morning and leaves by a
   different run in the afternoon needs a join table, not a `run_id`. Session 1
   ships the single `run_id` because it covers the overwhelmingly common case;
   the join table is additive and does not invalidate it.
4. **Calendar exceptions.** Holidays and half-days are a `service_calendar`
   concern, orthogonal to runs. Not in this programme.
