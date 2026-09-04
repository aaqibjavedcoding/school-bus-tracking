import { randomUUID } from 'crypto';
import type { Sequelize } from 'sequelize-typescript';
import {
  BusDocumentType,
  EmergencyStatus,
  EmergencyType,
  NotificationType,
  PlanBillingPeriod,
  PlanLimitResource,
  RouteAssignmentRole,
  SubscriptionStatus,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { hashPassword } from '../../src/auth';
import {
  Bus,
  BusDocument,
  EmergencyEvent,
  Notification,
  Plan,
  Route,
  RouteAssignment,
  School,
  SchoolSubscription,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  User,
} from '../../src/database/models';

/**
 * Fixture builders for the PostgreSQL-backed suites.
 *
 * Everything is written through the real Sequelize models against the real
 * schema, so a fixture that violates a foreign key, CHECK or unique index
 * fails loudly instead of silently drifting from production behaviour.
 */

export const TEST_PASSWORD = 'Str0ng-Test-Pass!';

export interface SchoolFixture {
  school: School;
  admin: User;
  driver: User;
  conductor: User;
  parent: User;
  bus: Bus;
  route: Route;
  stop: Stop;
  student: Student;
  assignment: RouteAssignment;
  trip: Trip;
  notification: Notification;
  document: BusDocument;
  emergency: EmergencyEvent;
}

let sequence = 0;
function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}-${randomUUID().slice(0, 8)}`;
}

export async function createSchool(
  overrides: Partial<{ name: string; code: string; is_active: boolean }> = {},
): Promise<School> {
  return School.create({
    id: randomUUID(),
    name: overrides.name ?? 'Test School',
    code: overrides.code ?? unique('school'),
    subdomain: null,
    email: null,
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    timezone: 'UTC',
    latitude: null,
    longitude: null,
    is_active: overrides.is_active ?? true,
  } as never);
}

export async function createUser(
  schoolId: string | null,
  role: UserRole,
  overrides: Partial<{ email: string; is_active: boolean; password: string }> = {},
): Promise<User> {
  return User.create({
    id: randomUUID(),
    school_id: schoolId,
    role,
    first_name: 'Test',
    last_name: role,
    email: overrides.email ?? `${unique(role.toLowerCase())}@example.test`,
    password_hash: await hashPassword(overrides.password ?? TEST_PASSWORD),
    email_verified_at: null,
    phone: null,
    is_active: overrides.is_active ?? true,
  } as never);
}

export async function createBus(schoolId: string): Promise<Bus> {
  return Bus.create({
    id: randomUUID(),
    school_id: schoolId,
    registration_number: unique('REG').toUpperCase(),
    bus_number: unique('B').toUpperCase(),
    capacity: 40,
    is_active: true,
  } as never);
}

export async function createRoute(schoolId: string): Promise<Route> {
  return Route.create({
    id: randomUUID(),
    school_id: schoolId,
    name: 'Test Route',
    code: unique('rt'),
    description: null,
    is_active: true,
  } as never);
}

export async function createStop(
  schoolId: string,
  routeId: string,
  sequenceNumber = 1,
): Promise<Stop> {
  return Stop.create({
    id: randomUUID(),
    school_id: schoolId,
    route_id: routeId,
    name: 'Test Stop',
    address: null,
    latitude: 1.23,
    longitude: 4.56,
    geofence_radius_meters: 100,
    sequence_number: sequenceNumber,
    estimated_arrival_time: null,
    is_active: true,
  } as never);
}

export async function createStudent(
  schoolId: string,
  homeStopId: string | null = null,
  overrides: Partial<{ admission_number: string; is_active: boolean }> = {},
): Promise<Student> {
  return Student.create({
    id: randomUUID(),
    school_id: schoolId,
    home_stop_id: homeStopId,
    admission_number: overrides.admission_number ?? unique('adm'),
    first_name: 'Kid',
    last_name: 'Test',
    date_of_birth: null,
    gender: null,
    grade_level: 'Grade 1',
    emergency_contact_name: null,
    emergency_contact_phone: null,
    medical_notes: null,
    is_active: overrides.is_active ?? true,
  } as never);
}

export async function createAssignment(
  schoolId: string,
  routeId: string,
  busId: string,
  userId: string,
  role: RouteAssignmentRole = RouteAssignmentRole.DRIVER,
): Promise<RouteAssignment> {
  return RouteAssignment.create({
    id: randomUUID(),
    school_id: schoolId,
    route_id: routeId,
    bus_id: busId,
    user_id: userId,
    role,
    effective_from: '2026-01-01',
    effective_to: null,
    is_active: true,
  } as never);
}

export async function createTrip(
  schoolId: string,
  routeId: string,
  busId: string,
  driverId: string,
  conductorId: string | null = null,
  status: TripStatus = TripStatus.SCHEDULED,
): Promise<Trip> {
  return Trip.create({
    id: randomUUID(),
    school_id: schoolId,
    route_id: routeId,
    bus_id: busId,
    driver_id: driverId,
    conductor_id: conductorId,
    status,
    scheduled_start_at: new Date(),
    scheduled_end_at: null,
    actual_start_at: status === TripStatus.SCHEDULED ? null : new Date(),
    actual_end_at: null,
    cancelled_at: null,
    cancellation_reason: null,
  } as never);
}

export async function createGuardianLink(
  schoolId: string,
  studentId: string,
  parentId: string,
): Promise<StudentGuardian> {
  return StudentGuardian.create({
    id: randomUUID(),
    school_id: schoolId,
    student_id: studentId,
    user_id: parentId,
    relationship: 'Mother',
    can_pick_up: true,
    is_primary: true,
    is_active: true,
  } as never);
}

export async function createNotification(
  schoolId: string,
  userId: string,
  tripId: string | null = null,
  studentId: string | null = null,
): Promise<Notification> {
  return Notification.create({
    id: randomUUID(),
    school_id: schoolId,
    user_id: userId,
    type: NotificationType.TRIP_IN_PROGRESS,
    trip_id: tripId,
    student_id: studentId,
    stop_id: null,
    title: 'Trip started',
    message: 'The bus has departed.',
    payload: null,
    is_read: false,
    read_at: null,
  } as never);
}

export async function createBusDocument(schoolId: string, busId: string): Promise<BusDocument> {
  return BusDocument.create({
    id: randomUUID(),
    school_id: schoolId,
    bus_id: busId,
    document_type: BusDocumentType.INSURANCE,
    document_number: unique('doc'),
    issue_date: '2026-01-01',
    expiry_date: '2027-01-01',
    notes: null,
    file_name: null,
    file_url: null,
  } as never);
}

export async function createEmergency(
  schoolId: string,
  tripId: string | null,
  raisedBy: string,
): Promise<EmergencyEvent> {
  return EmergencyEvent.create({
    id: randomUUID(),
    school_id: schoolId,
    trip_id: tripId,
    bus_id: null,
    route_id: null,
    raised_by_user_id: raisedBy,
    raised_by_role: UserRole.DRIVER,
    type: EmergencyType.OTHER,
    status: EmergencyStatus.OPEN,
    message: 'Test SOS',
    latitude: null,
    longitude: null,
    accuracy: null,
    triggered_at: new Date(),
    acknowledged_at: null,
    acknowledged_by_user_id: null,
    resolved_at: null,
    resolved_by_user_id: null,
    resolution_note: null,
  } as never);
}

export async function createPlan(
  limits: Partial<Record<PlanLimitResource, { unlimited: boolean; value: number | null }>> = {},
): Promise<Plan> {
  return Plan.create({
    id: randomUUID(),
    code: unique('plan'),
    name: 'Test Plan',
    description: null,
    price_cents: 1000,
    currency: 'USD',
    billing_period: PlanBillingPeriod.MONTHLY,
    is_active: true,
    features: {},
    limits,
  } as never);
}

export async function createSubscription(
  schoolId: string,
  planId: string,
  overrides: Partial<{
    status: SubscriptionStatus;
    trial_start: Date | null;
    trial_end: Date | null;
    current_period_start: Date;
    current_period_end: Date | null;
    cancelled_at: Date | null;
  }> = {},
): Promise<SchoolSubscription> {
  const periodStart = overrides.current_period_start ?? new Date(Date.now() - 86_400_000);
  return SchoolSubscription.create({
    id: randomUUID(),
    school_id: schoolId,
    plan_id: planId,
    status: overrides.status ?? SubscriptionStatus.ACTIVE,
    trial_start: overrides.trial_start ?? null,
    trial_end: overrides.trial_end ?? null,
    current_period_start: periodStart,
    current_period_end:
      overrides.current_period_end === undefined
        ? new Date(Date.now() + 30 * 86_400_000)
        : overrides.current_period_end,
    cancelled_at: overrides.cancelled_at ?? null,
  } as never);
}

/** A fully populated tenant: users, fleet, route, trip, notification, docs, SOS. */
export async function createFullSchool(
  _sequelize: Sequelize,
  overrides: Partial<{ code: string; is_active: boolean }> = {},
): Promise<SchoolFixture> {
  const school = await createSchool(overrides);
  const admin = await createUser(school.id, UserRole.SCHOOL_ADMIN);
  const driver = await createUser(school.id, UserRole.DRIVER);
  const conductor = await createUser(school.id, UserRole.CONDUCTOR);
  const parent = await createUser(school.id, UserRole.PARENT);
  const bus = await createBus(school.id);
  const route = await createRoute(school.id);
  const stop = await createStop(school.id, route.id);
  const student = await createStudent(school.id, stop.id);
  await createGuardianLink(school.id, student.id, parent.id);
  const assignment = await createAssignment(school.id, route.id, bus.id, driver.id);
  const trip = await createTrip(school.id, route.id, bus.id, driver.id, conductor.id);
  const notification = await createNotification(school.id, parent.id, trip.id, student.id);
  const document = await createBusDocument(school.id, bus.id);
  const emergency = await createEmergency(school.id, trip.id, driver.id);

  return {
    school,
    admin,
    driver,
    conductor,
    parent,
    bus,
    route,
    stop,
    student,
    assignment,
    trip,
    notification,
    document,
    emergency,
  };
}
