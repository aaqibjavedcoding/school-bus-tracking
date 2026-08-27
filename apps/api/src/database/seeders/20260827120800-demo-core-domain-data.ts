'use strict';

import type { QueryInterface, QueryOptions } from 'sequelize';

/**
 * DEMO DATA ONLY — development / local smoke testing.
 *
 * Seeds one throwaway tenant ("Demo School") with the minimum graph needed to
 * exercise the Phase 2 Task 2/3 schema end to end:
 * school → users (one per role) → buses → routes → stops → students →
 * route assignments → one scheduled trip.
 *
 * Guarantees:
 * - **Idempotent**: every row uses a fixed UUID and `ON CONFLICT DO NOTHING`
 *   (`ignoreDuplicates`), so re-running the seeder never duplicates or fails.
 * - **No credentials**: `users` has no password/token columns at all (see the
 *   model), so nothing secret can be seeded here.
 * - **Refuses to run in production** (see the guard below).
 * - **Reversible**: `down` deletes exactly what `up` inserted.
 *
 * All ids share the `00000000-…` prefix and are UUIDv4-shaped so the demo rows
 * are trivially recognisable and never collide with generated data.
 */

const DEMO_SCHOOL_ID = '00000000-0000-4000-8000-000000000001';

const USERS = {
  ADMIN: '00000000-0000-4000-8000-000000000101',
  DRIVER: '00000000-0000-4000-8000-000000000102',
  CONDUCTOR: '00000000-0000-4000-8000-000000000103',
  PARENT: '00000000-0000-4000-8000-000000000104',
};

const BUSES = {
  ONE: '00000000-0000-4000-8000-000000000201',
  TWO: '00000000-0000-4000-8000-000000000202',
};

const ROUTES = {
  MORNING: '00000000-0000-4000-8000-000000000301',
  AFTERNOON: '00000000-0000-4000-8000-000000000302',
};

const STOPS = {
  FIRST: '00000000-0000-4000-8000-000000000401',
  SECOND: '00000000-0000-4000-8000-000000000402',
  THIRD: '00000000-0000-4000-8000-000000000403',
  SCHOOL_GATE: '00000000-0000-4000-8000-000000000404',
};

const STUDENTS = {
  ONE: '00000000-0000-4000-8000-000000000501',
  TWO: '00000000-0000-4000-8000-000000000502',
  THREE: '00000000-0000-4000-8000-000000000503',
  FOUR: '00000000-0000-4000-8000-000000000504',
};

const ASSIGNMENTS = {
  DRIVER: '00000000-0000-4000-8000-000000000601',
  CONDUCTOR: '00000000-0000-4000-8000-000000000602',
};

const TRIP = '00000000-0000-4000-8000-000000000701';

// Fixed values keep the seed deterministic across environments.
const TIMESTAMP = new Date('2026-01-05T00:00:00.000Z');
const timestamps = { created_at: TIMESTAMP, updated_at: TIMESTAMP };

/**
 * `ignoreDuplicates` appends `ON CONFLICT DO NOTHING` (PostgreSQL), which is
 * what makes the seeder safely re-runnable. It is not part of the published
 * `QueryOptions` type, so the option is widened here.
 */
const options: QueryOptions & { ignoreDuplicates?: boolean } = { ignoreDuplicates: true };

export async function up(queryInterface: QueryInterface): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to insert demo seed data into a production database.');
  }

  await queryInterface.bulkInsert(
    'schools',
    [
      {
        id: DEMO_SCHOOL_ID,
        name: 'Demo School (sample data)',
        code: 'demo-school',
        subdomain: 'demo',
        email: 'office@demo-school.test',
        phone: '+1-555-0100',
        address_line1: '1 Demo Way',
        city: 'Springfield',
        state: 'IL',
        postal_code: '62701',
        country: 'US',
        timezone: 'America/Chicago',
        latitude: 39.7817,
        longitude: -89.6501,
        is_active: true,
        ...timestamps,
      },
    ],
    options,
  );

  await queryInterface.bulkInsert(
    'users',
    [
      {
        id: USERS.ADMIN,
        school_id: DEMO_SCHOOL_ID,
        role: 'SCHOOL_ADMIN',
        first_name: 'Demo',
        last_name: 'Administrator',
        email: 'admin@demo-school.test',
        is_active: true,
        ...timestamps,
      },
      {
        id: USERS.DRIVER,
        school_id: DEMO_SCHOOL_ID,
        role: 'DRIVER',
        first_name: 'Demo',
        last_name: 'Driver',
        email: 'driver@demo-school.test',
        is_active: true,
        ...timestamps,
      },
      {
        id: USERS.CONDUCTOR,
        school_id: DEMO_SCHOOL_ID,
        role: 'CONDUCTOR',
        first_name: 'Demo',
        last_name: 'Conductor',
        email: 'conductor@demo-school.test',
        is_active: true,
        ...timestamps,
      },
      {
        id: USERS.PARENT,
        school_id: DEMO_SCHOOL_ID,
        role: 'PARENT',
        first_name: 'Demo',
        last_name: 'Guardian',
        email: 'guardian@demo-school.test',
        is_active: true,
        ...timestamps,
      },
    ],
    options,
  );

  await queryInterface.bulkInsert(
    'buses',
    [
      {
        id: BUSES.ONE,
        school_id: DEMO_SCHOOL_ID,
        registration_number: 'DEMO-1001',
        bus_number: 'B-01',
        capacity: 40,
        is_active: true,
        ...timestamps,
      },
      {
        id: BUSES.TWO,
        school_id: DEMO_SCHOOL_ID,
        registration_number: 'DEMO-1002',
        bus_number: 'B-02',
        capacity: 24,
        is_active: true,
        ...timestamps,
      },
    ],
    options,
  );

  await queryInterface.bulkInsert(
    'routes',
    [
      {
        id: ROUTES.MORNING,
        school_id: DEMO_SCHOOL_ID,
        name: 'Demo North Loop — Morning',
        code: 'DEMO-N1',
        description: 'Sample morning pickup route (demo data).',
        is_active: true,
        ...timestamps,
      },
      {
        id: ROUTES.AFTERNOON,
        school_id: DEMO_SCHOOL_ID,
        name: 'Demo North Loop — Afternoon',
        code: 'DEMO-N2',
        description: 'Sample afternoon drop-off route (demo data).',
        is_active: true,
        ...timestamps,
      },
    ],
    options,
  );

  await queryInterface.bulkInsert(
    'stops',
    [
      {
        id: STOPS.FIRST,
        school_id: DEMO_SCHOOL_ID,
        route_id: ROUTES.MORNING,
        name: 'Maple St & 5th Ave',
        address: '500 Maple St, Springfield',
        latitude: 39.79,
        longitude: -89.66,
        geofence_radius_meters: 120,
        sequence_number: 1,
        estimated_arrival_time: '07:15:00',
        is_active: true,
        ...timestamps,
      },
      {
        id: STOPS.SECOND,
        school_id: DEMO_SCHOOL_ID,
        route_id: ROUTES.MORNING,
        name: 'Oak Rd Bus Bay',
        address: '12 Oak Rd, Springfield',
        latitude: 39.785,
        longitude: -89.655,
        geofence_radius_meters: 100,
        sequence_number: 2,
        estimated_arrival_time: '07:25:00',
        is_active: true,
        ...timestamps,
      },
      {
        id: STOPS.THIRD,
        school_id: DEMO_SCHOOL_ID,
        route_id: ROUTES.AFTERNOON,
        name: 'Pine Crescent',
        address: '88 Pine Cres, Springfield',
        latitude: 39.778,
        longitude: -89.648,
        geofence_radius_meters: 100,
        sequence_number: 1,
        estimated_arrival_time: '15:10:00',
        is_active: true,
        ...timestamps,
      },
      {
        id: STOPS.SCHOOL_GATE,
        school_id: DEMO_SCHOOL_ID,
        route_id: ROUTES.MORNING,
        name: 'Demo School Main Gate',
        address: '1 Demo Way, Springfield',
        latitude: 39.7817,
        longitude: -89.6501,
        geofence_radius_meters: 150,
        sequence_number: 3,
        estimated_arrival_time: '07:45:00',
        is_active: true,
        ...timestamps,
      },
    ],
    options,
  );

  await queryInterface.bulkInsert(
    'students',
    [
      {
        id: STUDENTS.ONE,
        school_id: DEMO_SCHOOL_ID,
        home_stop_id: STOPS.FIRST,
        admission_number: 'DEMO-0001',
        first_name: 'Alex',
        last_name: 'Demo',
        date_of_birth: '2016-04-12',
        gender: 'MALE',
        grade_level: 'Grade 4',
        emergency_contact_name: 'Demo Guardian',
        emergency_contact_phone: '+1-555-0111',
        is_active: true,
        ...timestamps,
      },
      {
        id: STUDENTS.TWO,
        school_id: DEMO_SCHOOL_ID,
        home_stop_id: STOPS.FIRST,
        admission_number: 'DEMO-0002',
        first_name: 'Bella',
        last_name: 'Demo',
        date_of_birth: '2015-09-03',
        gender: 'FEMALE',
        grade_level: 'Grade 5',
        emergency_contact_name: 'Demo Guardian',
        emergency_contact_phone: '+1-555-0111',
        is_active: true,
        ...timestamps,
      },
      {
        id: STUDENTS.THREE,
        school_id: DEMO_SCHOOL_ID,
        home_stop_id: STOPS.SECOND,
        admission_number: 'DEMO-0003',
        first_name: 'Chris',
        last_name: 'Demo',
        date_of_birth: '2017-01-27',
        grade_level: 'Grade 3',
        medical_notes: 'Sample note: nut allergy (demo data).',
        is_active: true,
        ...timestamps,
      },
      {
        id: STUDENTS.FOUR,
        school_id: DEMO_SCHOOL_ID,
        home_stop_id: null,
        admission_number: 'DEMO-0004',
        first_name: 'Dana',
        last_name: 'Demo',
        grade_level: 'Grade 3',
        is_active: true,
        ...timestamps,
      },
    ],
    options,
  );

  await queryInterface.bulkInsert(
    'route_assignments',
    [
      {
        id: ASSIGNMENTS.DRIVER,
        school_id: DEMO_SCHOOL_ID,
        route_id: ROUTES.MORNING,
        bus_id: BUSES.ONE,
        user_id: USERS.DRIVER,
        role: 'DRIVER',
        effective_from: '2026-01-05',
        effective_to: null,
        is_active: true,
        ...timestamps,
      },
      {
        id: ASSIGNMENTS.CONDUCTOR,
        school_id: DEMO_SCHOOL_ID,
        route_id: ROUTES.MORNING,
        bus_id: BUSES.ONE,
        user_id: USERS.CONDUCTOR,
        role: 'CONDUCTOR',
        effective_from: '2026-01-05',
        effective_to: null,
        is_active: true,
        ...timestamps,
      },
    ],
    options,
  );

  await queryInterface.bulkInsert(
    'trips',
    [
      {
        id: TRIP,
        school_id: DEMO_SCHOOL_ID,
        route_id: ROUTES.MORNING,
        bus_id: BUSES.ONE,
        driver_id: USERS.DRIVER,
        conductor_id: USERS.CONDUCTOR,
        status: 'SCHEDULED',
        scheduled_start_at: new Date('2026-01-05T13:10:00.000Z'),
        scheduled_end_at: new Date('2026-01-05T13:55:00.000Z'),
        ...timestamps,
      },
    ],
    options,
  );
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  const scope = { school_id: DEMO_SCHOOL_ID };

  // Children first: the demo tenant's rows are removed in reverse dependency
  // order so no foreign key is ever violated.
  await queryInterface.bulkDelete('trips', scope, {});
  await queryInterface.bulkDelete('route_assignments', scope, {});
  await queryInterface.bulkDelete('students', scope, {});
  await queryInterface.bulkDelete('stops', scope, {});
  await queryInterface.bulkDelete('routes', scope, {});
  await queryInterface.bulkDelete('buses', scope, {});
  await queryInterface.bulkDelete('users', scope, {});
  await queryInterface.bulkDelete('schools', { id: DEMO_SCHOOL_ID }, {});
}
