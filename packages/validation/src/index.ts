import { z } from 'zod';
import {
  RouteAssignmentRole,
  StudentGender,
  TripAttendanceStatus,
  TripStatus,
  TripTrackingState,
} from '@school-bus-tracking/shared-types';

/**
 * Common validation schemas (Phase 1)
 */

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
  altitude: z.number().optional(),
  accuracy: z.number().min(0).optional(),
  timestamp: z.number().int().positive(),
});

export type CoordinatesInput = z.infer<typeof coordinatesSchema>;

export const tenantIdSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9-]+$/, 'Tenant ID must be lowercase alphanumeric with hyphens');

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export const healthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.string(),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
  environment: z.string(),
});

export type HealthCheckOutput = z.infer<typeof healthCheckSchema>;

/** Reasonable minimum length for a user password. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Reusable password validation.
 *
 * Requirements are deliberately small: a non-empty string of reasonable length
 * that is not only whitespace. Stronger composition rules belong to a later
 * policy task.
 */
export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .refine((value) => value.trim().length > 0, {
    message: 'Password cannot be empty or whitespace',
  })
  .refine((value) => value === value.trim(), {
    message: 'Password must not start or end with whitespace',
  });

export type PasswordInput = z.infer<typeof passwordSchema>;

/**
 * School tenant code: lowercase alphanumeric segments joined by single
 * hyphens (e.g. `lincoln-high`). Mirrors the platform-wide unique constraint
 * on `schools.code`.
 */
export const SCHOOL_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const schoolCodeSchema = z
  .string()
  .trim()
  .min(2, 'School code must be at least 2 characters')
  .max(32, 'School code must be at most 32 characters')
  .regex(
    SCHOOL_CODE_PATTERN,
    'School code must be lowercase alphanumeric segments separated by hyphens',
  );

export const schoolNameSchema = z
  .string()
  .trim()
  .min(1, 'School name is required')
  .max(150, 'School name must be at most 150 characters');

/** Full admin display name; must contain at least first and last name. */
export const adminNameSchema = z
  .string()
  .trim()
  .min(3, 'Admin name must be at least 3 characters')
  .max(200, 'Admin name must be at most 200 characters')
  .regex(/\S+\s+\S+/, 'Admin name must include first and last name');

export const emailSchema = z.string().trim().toLowerCase().email().max(255);

/**
 * Body of `POST /api/v1/auth/login`. Login only requires a non-empty password;
 * composition rules apply when credentials are created, not when they are
 * checked.
 *
 * `school_id` identifies the tenant for school users and must be a UUID when
 * present. A platform `SUPER_ADMIN` belongs to no tenant and logs in with it
 * omitted or `null`; an empty string (empty form field) is normalized to
 * `null` before validation so a browser login form can share one schema.
 */
export const loginSchema = z
  .object({
    school_id: z.preprocess(
      (value) => (value === '' ? null : value),
      z.string().uuid('school_id must be a valid UUID').nullable().optional(),
    ),
    email: emailSchema,
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const schoolOnboardingSchema = z.object({
  school: z.object({
    name: schoolNameSchema,
    code: schoolCodeSchema,
  }),
  admin: z.object({
    name: adminNameSchema,
    email: emailSchema,
    password: passwordSchema,
  }),
});

export type SchoolOnboardingInput = z.infer<typeof schoolOnboardingSchema>;

export const studentGenderSchema = z.enum([
  StudentGender.MALE,
  StudentGender.FEMALE,
  StudentGender.OTHER,
]);

const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date_of_birth must be a valid date in YYYY-MM-DD format')
  .nullish();

/** Trimmable short text field, max 32 characters. */
const shortTextSchema = z.string().trim().max(32).nullish();

export const studentCreateSchema = z.object({
  admission_number: z
    .string()
    .trim()
    .min(1, 'admission_number is required')
    .max(64, 'admission_number must be at most 64 characters'),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  date_of_birth: dateOfBirthSchema,
  gender: studentGenderSchema.nullish(),
  grade_level: shortTextSchema,
  home_stop_id: z.string().uuid().nullish(),
  emergency_contact_name: z
    .string()
    .trim()
    .max(150, 'emergency_contact_name must be at most 150 characters')
    .nullish(),
  emergency_contact_phone: shortTextSchema,
  medical_notes: z
    .string()
    .trim()
    .max(4000, 'medical_notes must be at most 4000 characters')
    .nullish(),
  is_active: z.boolean().nullish(),
});

export type StudentCreateInput = z.infer<typeof studentCreateSchema>;

/** PATCH body — every field is optional and `null` clears the value. */
export const studentUpdateSchema = studentCreateSchema.partial();

export type StudentUpdateInput = z.infer<typeof studentUpdateSchema>;

export const studentListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
});

export type StudentListQueryInput = z.infer<typeof studentListQuerySchema>;

/** Person account creation is intentionally strict: tenant and role fields are
 * not client-controlled and are rejected instead of silently stripped.
 * Shared by parent accounts and driver/conductor staff accounts. */
const personNameSchema = z.string().trim().min(1).max(100);
const personPhoneSchema = z.string().trim().max(32).nullish();

export const parentCreateSchema = z
  .object({
    first_name: personNameSchema,
    last_name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
    phone: personPhoneSchema,
    is_active: z.boolean().optional(),
  })
  .strict();

export type ParentCreateInput = z.infer<typeof parentCreateSchema>;

export const parentUpdateSchema = z
  .object({
    first_name: personNameSchema.optional(),
    last_name: personNameSchema.optional(),
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    phone: personPhoneSchema,
    is_active: z.boolean().optional(),
  })
  .strict();

export type ParentUpdateInput = z.infer<typeof parentUpdateSchema>;

export const parentListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
});

export type ParentListQueryInput = z.infer<typeof parentListQuerySchema>;

const guardianRelationshipSchema = z
  .string()
  .trim()
  .min(1, 'relationship is required')
  .max(50, 'relationship must be at most 50 characters');

export const parentStudentRelationshipCreateSchema = z
  .object({
    student_id: z.string().uuid(),
    relationship: guardianRelationshipSchema,
    can_pick_up: z.boolean().optional(),
    is_primary: z.boolean().optional(),
  })
  .strict();

export type ParentStudentRelationshipCreateInput = z.infer<
  typeof parentStudentRelationshipCreateSchema
>;

export const parentStudentRelationshipUpdateSchema = z
  .object({
    relationship: guardianRelationshipSchema.optional(),
    can_pick_up: z.boolean().optional(),
    is_primary: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

export type ParentStudentRelationshipUpdateInput = z.infer<
  typeof parentStudentRelationshipUpdateSchema
>;

/** Student-centred equivalent used by `POST /students/:id/guardians`. */
export const studentGuardianCreateSchema = z
  .object({
    parent_id: z.string().uuid(),
    relationship: guardianRelationshipSchema,
    can_pick_up: z.boolean().optional(),
    is_primary: z.boolean().optional(),
  })
  .strict();

export type StudentGuardianCreateInput = z.infer<typeof studentGuardianCreateSchema>;

export const studentGuardianUpdateSchema = parentStudentRelationshipUpdateSchema;
export type StudentGuardianUpdateInput = z.infer<typeof studentGuardianUpdateSchema>;

/**
 * Phase 2 — Bus, route and stop management.
 *
 * Tenant fields (`school_id`) are deliberately absent: the API derives the
 * tenant exclusively from the JWT claims and a client-supplied `school_id` is
 * rejected instead of silently stripped.
 */

/** Vehicle registration / fleet number; trimmed, up to 32 characters. */
const vehicleIdentifierSchema = z
  .string()
  .trim()
  .min(1, 'registration_number is required')
  .max(32, 'registration_number must be at most 32 characters');

const busNumberSchema = z
  .string()
  .trim()
  .max(32, 'bus_number must be at most 32 characters')
  .nullish();

export const busCreateSchema = z
  .object({
    registration_number: vehicleIdentifierSchema,
    bus_number: busNumberSchema,
    capacity: z.number().int('capacity must be an integer').min(1, 'capacity must be at least 1'),
    is_active: z.boolean().nullish(),
  })
  .strict();

export type BusCreateInput = z.infer<typeof busCreateSchema>;

/** PATCH body — every field is optional and `null` clears the value. */
export const busUpdateSchema = busCreateSchema.partial();

export type BusUpdateInput = z.infer<typeof busUpdateSchema>;

export const busListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
});

export type BusListQueryInput = z.infer<typeof busListQuerySchema>;

const routeNameSchema = z
  .string()
  .trim()
  .min(1, 'name is required')
  .max(150, 'name must be at most 150 characters');

const routeCodeSchema = z
  .string()
  .trim()
  .min(1, 'code is required')
  .max(32, 'code must be at most 32 characters');

export const routeCreateSchema = z
  .object({
    name: routeNameSchema,
    code: routeCodeSchema,
    description: z
      .string()
      .trim()
      .max(2000, 'description must be at most 2000 characters')
      .nullish(),
    is_active: z.boolean().nullish(),
  })
  .strict();

export type RouteCreateInput = z.infer<typeof routeCreateSchema>;

export const routeUpdateSchema = routeCreateSchema.partial();

export type RouteUpdateInput = z.infer<typeof routeUpdateSchema>;

export const routeListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
});

export type RouteListQueryInput = z.infer<typeof routeListQuerySchema>;

/**
 * Full ordered stop manifest of a route: every active stop exactly once.
 * The service validates set equality — unknown, duplicate or missing ids are
 * rejected there.
 */
export const routeStopsOrderSchema = z
  .object({
    stop_ids: z.array(z.string().uuid('stop_ids must contain valid UUIDs')),
  })
  .strict();

export type RouteStopsOrderInput = z.infer<typeof routeStopsOrderSchema>;

const stopNameSchema = z
  .string()
  .trim()
  .min(1, 'name is required')
  .max(150, 'name must be at most 150 characters');

/** Local wall-clock arrival time: `HH:MM` or `HH:MM:SS`. */
const arrivalTimeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    'estimated_arrival_time must be in HH:MM or HH:MM:SS format',
  )
  .nullish();

export const stopCreateSchema = z
  .object({
    route_id: z.string().uuid('route_id must be a valid UUID'),
    name: stopNameSchema,
    address: z.string().trim().max(500, 'address must be at most 500 characters').nullish(),
    latitude: z.number().min(-90, 'latitude must be between -90 and 90').max(90).nullish(),
    longitude: z.number().min(-180, 'longitude must be between -180 and 180').max(180).nullish(),
    geofence_radius_meters: z
      .number()
      .int('geofence_radius_meters must be an integer')
      .min(10, 'geofence_radius_meters must be between 10 and 2000')
      .max(2000)
      .nullish(),
    sequence_number: z
      .number()
      .int('sequence_number must be an integer')
      .min(1, 'sequence_number must be at least 1')
      .nullish(),
    estimated_arrival_time: arrivalTimeSchema,
    is_active: z.boolean().nullish(),
  })
  .strict();

export type StopCreateInput = z.infer<typeof stopCreateSchema>;

export const stopUpdateSchema = stopCreateSchema.partial();

export type StopUpdateInput = z.infer<typeof stopUpdateSchema>;

export const stopListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
  route_id: z.string().uuid('route_id must be a valid UUID').optional(),
});

export type StopListQueryInput = z.infer<typeof stopListQuerySchema>;

/**
 * Phase 3 — Driver & conductor staff management.
 *
 * Driver and conductor accounts share one body shape; the fixed role
 * (`DRIVER` / `CONDUCTOR`) and the tenant are pinned by the API endpoint and
 * the JWT claims respectively, so neither appears here. Tenant and role
 * fields are rejected (`.strict()`) rather than silently stripped.
 */
export const staffCreateSchema = z
  .object({
    first_name: personNameSchema,
    last_name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
    phone: personPhoneSchema,
    is_active: z.boolean().optional(),
  })
  .strict();

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

/** PATCH body — every field is optional and `null` clears the phone. */
export const staffUpdateSchema = z
  .object({
    first_name: personNameSchema.optional(),
    last_name: personNameSchema.optional(),
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    phone: personPhoneSchema,
    is_active: z.boolean().optional(),
  })
  .strict();

export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

/** Resource-oriented aliases used by driver/conductor screens and clients. */
export const driverCreateSchema = staffCreateSchema;
export const driverUpdateSchema = staffUpdateSchema;
export const conductorCreateSchema = staffCreateSchema;
export const conductorUpdateSchema = staffUpdateSchema;
export type DriverCreateInput = StaffCreateInput;
export type DriverUpdateInput = StaffUpdateInput;
export type ConductorCreateInput = StaffCreateInput;
export type ConductorUpdateInput = StaffUpdateInput;

export const staffListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
});

export type StaffListQueryInput = z.infer<typeof staffListQuerySchema>;
/**
 * Phase 4 — Bus, route and crew assignment management.
 *
 * Assignment requests are strict and contain no school_id. The API pins the
 * tenant from JWT claims, and only DRIVER/CONDUCTOR are valid assignment roles.
 */

const assignmentDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'date must be a valid calendar date');

export const routeAssignmentCreateSchema = z
  .object({
    route_id: z.string().uuid('route_id must be a valid UUID'),
    bus_id: z.string().uuid('bus_id must be a valid UUID'),
    user_id: z.string().uuid('user_id must be a valid UUID'),
    role: z.nativeEnum(RouteAssignmentRole),
    effective_from: assignmentDateSchema,
    effective_to: assignmentDateSchema.nullish(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.effective_to && value.effective_to < value.effective_from) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effective_to'],
        message: 'effective_to must be on or after effective_from',
      });
    }
  });

export type RouteAssignmentCreateInput = z.infer<typeof routeAssignmentCreateSchema>;

export const routeAssignmentUpdateSchema = z
  .object({
    route_id: z.string().uuid('route_id must be a valid UUID').optional(),
    bus_id: z.string().uuid('bus_id must be a valid UUID').nullable().optional(),
    user_id: z.string().uuid('user_id must be a valid UUID').optional(),
    role: z.nativeEnum(RouteAssignmentRole).optional(),
    effective_from: assignmentDateSchema.optional(),
    effective_to: assignmentDateSchema.nullish(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.effective_from && value.effective_to && value.effective_to < value.effective_from) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effective_to'],
        message: 'effective_to must be on or after effective_from',
      });
    }
  });

export type RouteAssignmentUpdateInput = z.infer<typeof routeAssignmentUpdateSchema>;

const assignmentBooleanQuerySchema = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

export const routeAssignmentListQuerySchema = paginationSchema.extend({
  route_id: z.string().uuid('route_id must be a valid UUID').optional(),
  bus_id: z.string().uuid('bus_id must be a valid UUID').optional(),
  user_id: z.string().uuid('user_id must be a valid UUID').optional(),
  role: z.nativeEnum(RouteAssignmentRole).optional(),
  is_active: assignmentBooleanQuerySchema.optional(),
});

export type RouteAssignmentListQueryInput = z.infer<typeof routeAssignmentListQuerySchema>;

/** Short schema aliases for clients that call the resource `assignments`. */
export const assignmentCreateSchema = routeAssignmentCreateSchema;
export const assignmentUpdateSchema = routeAssignmentUpdateSchema;
export const assignmentListQuerySchema = routeAssignmentListQuerySchema;
export type AssignmentCreateInput = RouteAssignmentCreateInput;
export type AssignmentUpdateInput = RouteAssignmentUpdateInput;
export type AssignmentListQueryInput = RouteAssignmentListQueryInput;

/**
 * Phase 4 — Trip management.
 *
 * A trip is always dispatched from an existing active `RouteAssignment`; the
 * API derives school, route, bus, driver and conductor from it. Request
 * payloads are therefore intentionally small and `.strict()`: no tenant id,
 * no crew ids and no server-managed lifecycle timestamps.
 */

const tripDateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'date must be a valid calendar date');

const tripDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid ISO-8601 date-time');

export const tripCancellationReasonSchema = z
  .string()
  .trim()
  .min(1, 'cancellation_reason cannot be empty')
  .max(500, 'cancellation_reason must be at most 500 characters');

export const tripCreateSchema = z
  .object({
    route_assignment_id: z.string().uuid('route_assignment_id must be a valid UUID'),
    scheduled_start_at: tripDateTimeSchema,
    scheduled_end_at: tripDateTimeSchema.nullish(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.scheduled_end_at &&
      Date.parse(value.scheduled_end_at) < Date.parse(value.scheduled_start_at)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduled_end_at'],
        message: 'scheduled_end_at must be on or after scheduled_start_at',
      });
    }
  });

export type TripCreateInput = z.infer<typeof tripCreateSchema>;

export const tripUpdateSchema = z
  .object({
    route_assignment_id: z.string().uuid('route_assignment_id must be a valid UUID').optional(),
    scheduled_start_at: tripDateTimeSchema.optional(),
    scheduled_end_at: tripDateTimeSchema.nullish(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.scheduled_start_at &&
      value.scheduled_end_at &&
      Date.parse(value.scheduled_end_at) < Date.parse(value.scheduled_start_at)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduled_end_at'],
        message: 'scheduled_end_at must be on or after scheduled_start_at',
      });
    }
  });

export type TripUpdateInput = z.infer<typeof tripUpdateSchema>;

export const tripStatusUpdateSchema = z
  .object({
    status: z.nativeEnum(TripStatus),
    actual_start_at: tripDateTimeSchema.nullish(),
    actual_end_at: tripDateTimeSchema.nullish(),
    cancellation_reason: tripCancellationReasonSchema.nullish(),
  })
  .strict();

export type TripStatusUpdateInput = z.infer<typeof tripStatusUpdateSchema>;

export const tripCancelSchema = z
  .object({
    cancellation_reason: tripCancellationReasonSchema.nullish(),
  })
  .strict();

export type TripCancelInput = z.infer<typeof tripCancelSchema>;

export const tripListQuerySchema = paginationSchema
  .extend({
    status: z.nativeEnum(TripStatus).optional(),
    route_id: z.string().uuid('route_id must be a valid UUID').optional(),
    bus_id: z.string().uuid('bus_id must be a valid UUID').optional(),
    driver_id: z.string().uuid('driver_id must be a valid UUID').optional(),
    conductor_id: z.string().uuid('conductor_id must be a valid UUID').optional(),
    date: tripDateOnlySchema.optional(),
    date_from: tripDateOnlySchema.optional(),
    date_to: tripDateOnlySchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.date_from && value.date_to && value.date_to < value.date_from) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date_to'],
        message: 'date_to must be on or after date_from',
      });
    }
  });

export type TripListQueryInput = z.infer<typeof tripListQuerySchema>;

/**
 * Allowed trip lifecycle transitions.
 *
 * The happy path is SCHEDULED → IN_PROGRESS → COMPLETED, with the optional
 * BOARDING step in between and CANCELLED reachable from any non-terminal
 * state. `COMPLETED` and `CANCELLED` are terminal, so they map to no targets.
 */
export const TRIP_STATUS_TRANSITIONS: Readonly<Record<TripStatus, readonly TripStatus[]>> =
  Object.freeze({
    [TripStatus.SCHEDULED]: [TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.CANCELLED],
    [TripStatus.BOARDING]: [TripStatus.IN_PROGRESS, TripStatus.CANCELLED],
    [TripStatus.IN_PROGRESS]: [TripStatus.COMPLETED, TripStatus.CANCELLED],
    [TripStatus.COMPLETED]: [],
    [TripStatus.CANCELLED]: [],
  });

/** True when `to` is a legal next state for a trip currently in `from`. */
export const isTripStatusTransitionAllowed = (from: TripStatus, to: TripStatus): boolean =>
  TRIP_STATUS_TRANSITIONS[from]?.includes(to) ?? false;

/**
 * Phase 4 — Trip student attendance (boarding / drop management).
 *
 * The board/drop payloads are intentionally empty objects: the acting user is
 * taken from the JWT subject and the event time from the server clock, so a
 * client has nothing to contribute. `.strict()` therefore rejects any attempt
 * to smuggle a tenant id, a crew id or a forged timestamp into the request.
 */

export const tripStudentBoardSchema = z.object({}).strict();

export type TripStudentBoardInput = z.infer<typeof tripStudentBoardSchema>;

export const tripStudentDropSchema = z.object({}).strict();

export type TripStudentDropInput = z.infer<typeof tripStudentDropSchema>;

export const tripStudentManifestQuerySchema = z
  .object({
    status: z.nativeEnum(TripAttendanceStatus).optional(),
    stop_id: z.string().uuid('stop_id must be a valid UUID').optional(),
  })
  .strict();

export type TripStudentManifestQueryInput = z.infer<typeof tripStudentManifestQuerySchema>;

/**
 * Allowed attendance transitions.
 *
 * A student walks the manifest exactly once: PENDING → BOARDED → DROPPED.
 * There is no way back, which is what makes duplicate boarding, dropping
 * before boarding and duplicate drops detectable with a single lookup.
 */
export const TRIP_ATTENDANCE_STATUS_TRANSITIONS: Readonly<
  Record<TripAttendanceStatus, readonly TripAttendanceStatus[]>
> = Object.freeze({
  [TripAttendanceStatus.PENDING]: [TripAttendanceStatus.BOARDED],
  [TripAttendanceStatus.BOARDED]: [TripAttendanceStatus.DROPPED],
  [TripAttendanceStatus.DROPPED]: [],
});

/** True when `to` is a legal next attendance state for a student in `from`. */
export const isTripAttendanceTransitionAllowed = (
  from: TripAttendanceStatus,
  to: TripAttendanceStatus,
): boolean => TRIP_ATTENDANCE_STATUS_TRANSITIONS[from]?.includes(to) ?? false;

/**
 * Trip lifecycle states during which attendance may be recorded.
 *
 * Boarding legitimately starts before the bus departs (`SCHEDULED`), so the
 * open window spans everything that is not terminal. A `COMPLETED` or
 * `CANCELLED` run is closed: its attendance record is an audit artefact and
 * must not change any more.
 */
export const TRIP_ATTENDANCE_OPEN_TRIP_STATUSES: readonly TripStatus[] = Object.freeze([
  TripStatus.SCHEDULED,
  TripStatus.BOARDING,
  TripStatus.IN_PROGRESS,
]);

/** True when the trip is in a state that still accepts attendance changes. */
export const isTripOpenForAttendance = (status: TripStatus): boolean =>
  TRIP_ATTENDANCE_OPEN_TRIP_STATUSES.includes(status);

/**
 * Phase 5 — Live GPS tracking.
 *
 * These schemas guard the Socket.IO payload surface, which has no global
 * validation pipe: everything a client can send through the tracking
 * namespace is checked here with `.strict()`, so an unknown or forged field
 * (a `school_id`, a crew id, a server timestamp) is rejected instead of
 * silently stripped.
 */

/**
 * Horizontal accuracy bounds in metres. A fix wider than 10 km carries no
 * routing information for a school bus, so it is treated as malformed.
 */
export const GPS_ACCURACY_MAX_METERS = 10_000;

/** Ground-speed sanity bound in km/h (a school bus cannot exceed it). */
export const GPS_SPEED_MAX_KMH = 300;

/** ISO-8601 date-time that must actually parse to a real moment. */
export const gpsDateTimeSchema = z
  .string({ required_error: 'recorded_at must be a date-time string' })
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    'recorded_at must be a valid ISO-8601 date-time',
  );

/**
 * One GPS fix exactly as the crew device reports it.
 *
 * `accuracy`, `speed` and `heading` are optional device readings; `latitude`,
 * `longitude` and `recorded_at` are mandatory. All bounds are finite-number
 * checks — `NaN` and infinities are malformed, not out of range.
 */
export const gpsLocationFixSchema = z
  .object({
    latitude: z
      .number({ required_error: 'latitude must be a number' })
      .finite('latitude must be a finite number')
      .min(-90, 'latitude must be between -90 and 90')
      .max(90, 'latitude must be between -90 and 90'),
    longitude: z
      .number({ required_error: 'longitude must be a number' })
      .finite('longitude must be a finite number')
      .min(-180, 'longitude must be between -180 and 180')
      .max(180, 'longitude must be between -180 and 180'),
    accuracy: z
      .number()
      .finite('accuracy must be a finite number')
      .min(0, 'accuracy must be at least 0 metres')
      .max(GPS_ACCURACY_MAX_METERS, `accuracy must be at most ${GPS_ACCURACY_MAX_METERS} metres`)
      .optional(),
    speed: z
      .number()
      .finite('speed must be a finite number')
      .min(0, 'speed must be at least 0 km/h')
      .max(GPS_SPEED_MAX_KMH, `speed must be at most ${GPS_SPEED_MAX_KMH} km/h`)
      .optional(),
    heading: z
      .number()
      .finite('heading must be a finite number')
      .min(0, 'heading must be between 0 and 360 degrees')
      .max(360, 'heading must be between 0 and 360 degrees')
      .optional(),
    recorded_at: gpsDateTimeSchema,
  })
  .strict();

export type GpsLocationFixInput = z.infer<typeof gpsLocationFixSchema>;

/**
 * Full `trip:location:update` socket payload: the fix plus the trip it
 * belongs to. The trip id is the only "which trip" input a client ever
 * supplies; ownership of everything else is derived server-side.
 */
export const tripLocationUpdateSchema = gpsLocationFixSchema
  .extend({
    trip_id: z.string().uuid('trip_id must be a valid UUID'),
  })
  .strict();

export type TripLocationUpdateInput = z.infer<typeof tripLocationUpdateSchema>;

/** `tracking:join` socket payload — one trip id and nothing else. */
export const trackingJoinSchema = z
  .object({
    trip_id: z.string().uuid('trip_id must be a valid UUID'),
  })
  .strict();

export type TrackingJoinInput = z.infer<typeof trackingJoinSchema>;

/**
 * `GET /trips/:tripId/location/history` query: an inclusive time window on
 * `recorded_at` plus a bounded page size. Unlimited history is impossible by
 * construction — `limit` is always present after parsing.
 */
export const tripLocationHistoryQuerySchema = z
  .object({
    from: gpsDateTimeSchema.optional(),
    to: gpsDateTimeSchema.optional(),
    limit: z
      .number()
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(500, 'limit must be at most 500')
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && Date.parse(value.to) < Date.parse(value.from)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must be on or after from',
      });
    }
  });

export type TripLocationHistoryQueryInput = z.infer<typeof tripLocationHistoryQuerySchema>;

/**
 * Trip states in which live GPS tracking can run.
 *
 * `SCHEDULED` is deliberately excluded: the crew has not started, so a fix
 * would be noise. `BOARDING` is the first state in which the bus position is
 * meaningful (crew at the first stop), so tracking opens with it and stays
 * open through `IN_PROGRESS`. `COMPLETED` and `CANCELLED` are terminal — the
 * last recorded location stays readable, but no new fix is ever accepted.
 */
export const TRIP_TRACKING_ACTIVE_STATUSES: readonly TripStatus[] = Object.freeze([
  TripStatus.BOARDING,
  TripStatus.IN_PROGRESS,
]);

/** True when the trip is in a state that accepts live GPS updates. */
export const isTripTrackingActive = (status: TripStatus): boolean =>
  TRIP_TRACKING_ACTIVE_STATUSES.includes(status);

/**
 * Maps a trip status to the tracking-stream state clients render:
 *
 * - `SCHEDULED`        → `unavailable` (join is allowed, no updates arrive)
 * - `BOARDING` / `IN_PROGRESS` → `active`
 * - `COMPLETED` / `CANCELLED`  → `stopped` (no joins, last fix still readable)
 */
export const getTripTrackingState = (status: TripStatus): TripTrackingState => {
  if (status === TripStatus.COMPLETED || status === TripStatus.CANCELLED) {
    return 'stopped';
  }
  if (isTripTrackingActive(status)) {
    return 'active';
  }
  return 'unavailable';
};

/**
 * Task 19 — Super Admin platform console.
 *
 * Strict Zod contracts for the `/admin/*` surface. Every request body is
 * `.strict()`: client-supplied `id`, `school_id`, `role` or lifecycle fields
 * are rejected rather than silently stripped, so a request can never forge a
 * tenant or escalate a role.
 */

/** Lifecycle filter value used by the platform school list. */
export const adminSchoolStatusSchema = z.enum(['active', 'inactive']);

export type AdminSchoolStatusInput = z.infer<typeof adminSchoolStatusSchema>;

/** Tenant subdomain: DNS-label style, mirrors `schools.subdomain`. */
export const schoolSubdomainSchema = z
  .string()
  .trim()
  .min(2, 'subdomain must be at least 2 characters')
  .max(63, 'subdomain must be at most 63 characters')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'subdomain must be lowercase alphanumeric segments separated by hyphens',
  );

/** IANA timezone string, bounded length (full validation happens via Intl). */
const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'timezone is required')
  .max(64, 'timezone must be at most 64 characters')
  .refine((value) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'timezone must be a valid IANA timezone name');

const nullableText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullish()
    .transform((value) => (value === undefined ? undefined : value === '' ? null : value));

const schoolProfileShape = {
  name: schoolNameSchema,
  code: schoolCodeSchema,
  subdomain: schoolSubdomainSchema
    .nullish()
    .transform((value) => (value === undefined ? undefined : value === '' ? null : value)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(255)
    .nullish()
    .transform((value) => (value === undefined ? undefined : value === '' ? null : value)),
  phone: nullableText(32, 'phone'),
  address_line1: nullableText(255, 'address_line1'),
  address_line2: nullableText(255, 'address_line2'),
  city: nullableText(100, 'city'),
  state: nullableText(100, 'state'),
  postal_code: nullableText(20, 'postal_code'),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'country must be a 2-letter ISO country code')
    .nullish()
    .transform((value) => (!value ? (value === null ? null : undefined) : value.toUpperCase())),
  timezone: timezoneSchema.optional(),
};

/** Body of `POST /api/v1/admin/schools`. */
export const adminSchoolCreateSchema = z
  .object({
    school: z.object(schoolProfileShape).strict(),
    admin: z
      .object({
        first_name: personNameSchema,
        last_name: personNameSchema,
        email: emailSchema,
        password: passwordSchema,
        phone: personPhoneSchema,
      })
      .strict(),
  })
  .strict();

export type AdminSchoolCreateInput = z.infer<typeof adminSchoolCreateSchema>;

/** Body of `PATCH /api/v1/admin/schools/:id` — profile fields only. */
export const adminSchoolUpdateSchema = z
  .object({
    name: schoolNameSchema.optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(255)
      .nullish()
      .transform((value) => (value === undefined ? undefined : value === '' ? null : value)),
    phone: nullableText(32, 'phone'),
    address_line1: nullableText(255, 'address_line1'),
    address_line2: nullableText(255, 'address_line2'),
    city: nullableText(100, 'city'),
    state: nullableText(100, 'state'),
    postal_code: nullableText(20, 'postal_code'),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, 'country must be a 2-letter ISO country code')
      .nullish()
      .transform((value) => (!value ? (value === null ? null : undefined) : value.toUpperCase())),
    timezone: timezoneSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one school profile field must be provided',
  });

export type AdminSchoolUpdateInput = z.infer<typeof adminSchoolUpdateSchema>;

/** Query string of `GET /api/v1/admin/schools`. */
export const adminSchoolListQuerySchema = paginationSchema
  .extend({
    search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
    status: adminSchoolStatusSchema.optional(),
    sort: z.enum(['created_at', 'name', 'code']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export type AdminSchoolListQueryInput = z.infer<typeof adminSchoolListQuerySchema>;

/** Body of `POST /api/v1/admin/schools/:id/admins`. */
export const adminSchoolAdminCreateSchema = z
  .object({
    first_name: personNameSchema,
    last_name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
    phone: personPhoneSchema,
    is_active: z.boolean().optional(),
  })
  .strict();

export type AdminSchoolAdminCreateInput = z.infer<typeof adminSchoolAdminCreateSchema>;

/** Body of `PATCH /api/v1/admin/schools/:id/admins/:adminId`. */
export const adminSchoolAdminUpdateSchema = z
  .object({
    first_name: personNameSchema.optional(),
    last_name: personNameSchema.optional(),
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    phone: personPhoneSchema,
    is_active: z.boolean().optional(),
  })
  .strict();

export type AdminSchoolAdminUpdateInput = z.infer<typeof adminSchoolAdminUpdateSchema>;

/** Query string of `GET /api/v1/admin/schools/:id/admins`. */
export const adminSchoolAdminListQuerySchema = paginationSchema
  .extend({
    search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
  })
  .strict();

export type AdminSchoolAdminListQueryInput = z.infer<typeof adminSchoolAdminListQuerySchema>;

/** Body of `POST .../admins/:adminId/reset-password`. */
export const adminSchoolAdminResetPasswordSchema = z
  .object({
    password: passwordSchema,
  })
  .strict();

export type AdminSchoolAdminResetPasswordInput = z.infer<
  typeof adminSchoolAdminResetPasswordSchema
>;
