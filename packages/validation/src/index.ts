import { z } from 'zod';
import {
  ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES,
  BusDocumentType,
  DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS,
  DOCUMENT_OWNER_TYPE_VALUES,
  DocumentOwnerType,
  DocumentStatus,
  DriverDocumentType,
  EmergencyStatus,
  EmergencyType,
  PlanBillingPeriod,
  PlanFeature,
  PlanLimitResource,
  RouteAssignmentRole,
  StudentGender,
  SubscriptionStatus,
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
 * School tenant identifier accepted at login. A school user identifies the
 * tenant either by its opaque UUID or its human-friendly `code`; the union
 * accepts both so the login form can take a code a school admin already knows
 * (e.g. `lincoln-high`) without exposing the internal UUID.
 */
const loginSchoolCodePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export const loginTenantIdSchema = z.union([
  z.string().uuid('school_id must be a valid UUID'),
  z
    .string()
    .trim()
    .min(2, 'school_id must be a valid UUID or school code')
    .max(32, 'school_id must be a valid UUID or school code')
    .regex(loginSchoolCodePattern, 'school_id must be a valid UUID or school code'),
]);

/**
 * Body of `POST /api/v1/auth/login`. Login only requires a non-empty password;
 * composition rules apply when credentials are created, not when they are
 * checked.
 *
 * `school_id` identifies the tenant for school users and may be the school's
 * UUID or its tenant `code`. A platform `SUPER_ADMIN` belongs to no tenant and
 * logs in with it omitted or `null`; an empty string (empty form field) is
 * normalized to `null` before validation so a browser login form can share one
 * schema.
 */
export const loginSchema = z
  .object({
    school_id: z.preprocess(
      (value) => (value === '' ? null : value),
      loginTenantIdSchema.nullable().optional(),
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

/**
 * Task 41 — Commercial SaaS: Subscription Plan validation.
 *
 * Plans are platform-level catalog entries managed exclusively by SUPER_ADMIN.
 * Features and limits are JSON objects keyed by documented enums; unknown keys
 * are rejected by `.strict()` on each object so we never silently persist a
 * typo'd feature flag. The `unlimited` flag on limits is the canonical
 * representation of an uncapped resource (no magic large integer).
 */

/** Plan code follows the same kebab-case convention as school codes. */
export const PLAN_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const planCodeSchema = z
  .string()
  .trim()
  .min(2, 'Plan code must be at least 2 characters')
  .max(32, 'Plan code must be at most 32 characters')
  .regex(
    PLAN_CODE_PATTERN,
    'Plan code must be lowercase alphanumeric segments separated by hyphens',
  );

export const planNameSchema = z
  .string()
  .trim()
  .min(1, 'Plan name is required')
  .max(100, 'Plan name must be at most 100 characters');

export const planDescriptionSchema = z
  .string()
  .trim()
  .max(2000, 'Plan description must be at most 2000 characters')
  .nullish()
  .transform((value) => (value === undefined ? undefined : value === '' ? null : value));

/** ISO 4217 currency code (3 letters; accepts lowercase and uppercases). */
export const planCurrencySchema = z
  .string()
  .trim()
  .length(3, 'Currency must be a 3-letter ISO 4217 code')
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), 'Currency must be a 3-letter ISO 4217 code');

/** Monetary price stored as integer cents in the DB; accept decimal from clients. */
export const planPriceSchema = z
  .number({ required_error: 'price is required' })
  .finite('price must be a finite number')
  .min(0, 'price must be zero or positive')
  .multipleOf(0.01, 'price must have at most two decimal places');

/** Feature map — keys must be known `PlanFeature` values, values booleans. */
export const planFeaturesSchema = z
  .record(
    z
      .string()
      .refine(
        (value) => Object.values(PlanFeature).includes(value as PlanFeature),
        'Unknown feature key',
      ),
    z.boolean(),
  )
  .optional();

/** One limit entry — either `unlimited: true` or a non-negative integer `value`. */
export const planLimitValueSchema = z
  .object({
    unlimited: z.boolean(),
    value: z
      .number()
      .int('limit value must be an integer')
      .min(0, 'limit value must be zero or positive')
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.unlimited) {
      if (value.value !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: 'value must be null when unlimited is true',
        });
      }
    } else if (value.value === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'value is required when unlimited is false',
      });
    }
  });

/** Limits map — keys must be known `PlanLimitResource` values. */
export const planLimitsSchema = z
  .record(
    z
      .string()
      .refine(
        (value) => Object.values(PlanLimitResource).includes(value as PlanLimitResource),
        'Unknown limit resource key',
      ),
    planLimitValueSchema,
  )
  .optional();

/** Body of `POST /api/v1/admin/plans`. */
export const adminPlanCreateSchema = z
  .object({
    code: planCodeSchema,
    name: planNameSchema,
    description: planDescriptionSchema,
    price: planPriceSchema,
    currency: planCurrencySchema,
    billing_period: z.nativeEnum(PlanBillingPeriod),
    is_active: z.boolean().optional(),
    features: planFeaturesSchema,
    limits: planLimitsSchema,
  })
  .strict();

export type AdminPlanCreateInput = z.infer<typeof adminPlanCreateSchema>;

/** Body of `PATCH /api/v1/admin/plans/:id`. `code` is intentionally absent. */
export const adminPlanUpdateSchema = z
  .object({
    name: planNameSchema.optional(),
    description: planDescriptionSchema,
    price: planPriceSchema.optional(),
    currency: planCurrencySchema.optional(),
    billing_period: z.nativeEnum(PlanBillingPeriod).optional(),
    is_active: z.boolean().optional(),
    features: planFeaturesSchema,
    limits: planLimitsSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one plan field must be provided',
  });

export type AdminPlanUpdateInput = z.infer<typeof adminPlanUpdateSchema>;

/** Lifecycle filter for plan lists. */
export const adminPlanStatusSchema = z.enum(['active', 'inactive']);

export type AdminPlanStatusInput = z.infer<typeof adminPlanStatusSchema>;

/** Query string of `GET /api/v1/admin/plans`. */
export const adminPlanListQuerySchema = paginationSchema
  .extend({
    search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
    status: adminPlanStatusSchema.optional(),
    sort: z.enum(['created_at', 'name', 'code', 'price']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export type AdminPlanListQueryInput = z.infer<typeof adminPlanListQuerySchema>;

/**
 * Task 42 — School Subscription validation.
 *
 * Subscriptions attach a school (tenant) to a plan of the Task 41 catalog.
 * Only a SUPER_ADMIN reaches these payloads. The schemas cover shape and
 * cross-field date logic; existence checks (school/plan), plan activation and
 * the "one live subscription per school" rule are enforced in the service
 * layer where the database is available.
 */

/** ISO-8601 date-time accepted for every subscription date field. */
export const subscriptionDateSchema = z
  .string()
  .trim()
  .min(1, 'Date must be a valid ISO-8601 date-time')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Date must be a valid ISO-8601 date-time');

/** Nullable ISO-8601 date-time (`null` clears the field). */
export const nullableSubscriptionDateSchema = subscriptionDateSchema.nullish();

/** Any subscription status, including the projection-only `none`. */
export const subscriptionStatusSchema = z.nativeEnum(SubscriptionStatus);

/** Statuses that may actually be persisted on a subscription row. */
export const persistedSubscriptionStatusSchema = subscriptionStatusSchema.refine(
  (value) => value !== SubscriptionStatus.NONE,
  'status must be one of trialing, active, past_due, cancelled, expired',
);

/** Statuses a Super Admin may assign when creating a subscription. */
export const assignableSubscriptionStatusSchema = subscriptionStatusSchema.refine(
  (value) => ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES.includes(value as never),
  'status must be one of trialing, active, past_due',
);

/**
 * Cross-field date ordering shared by create and update:
 * - `trial_end` may not precede `trial_start`;
 * - `current_period_end` may not precede `current_period_start`.
 *
 * The "a trialing subscription must declare `trial_end`" rule is only checked
 * here for create; on PATCH the merged row is validated in the service, since
 * the existing record may already carry a trial window.
 */
function refineSubscriptionDates(
  value: {
    trial_start?: string | null;
    trial_end?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
  },
  context: z.RefinementCtx,
): void {
  const at = (raw?: string | null): number | null =>
    raw === undefined || raw === null ? null : Date.parse(raw);

  const trialStart = at(value.trial_start);
  const trialEnd = at(value.trial_end);
  if (trialStart !== null && trialEnd !== null && trialEnd < trialStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['trial_end'],
      message: 'trial_end cannot be before trial_start',
    });
  }

  const periodStart = at(value.current_period_start);
  const periodEnd = at(value.current_period_end);
  if (periodStart !== null && periodEnd !== null && periodEnd < periodStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['current_period_end'],
      message: 'current_period_end cannot be before current_period_start',
    });
  }
}

/** Body of `POST /api/v1/admin/schools/:schoolId/subscription`. */
export const adminSchoolSubscriptionCreateSchema = z
  .object({
    plan_id: z.string().uuid('plan_id must be a valid UUID'),
    status: assignableSubscriptionStatusSchema.optional(),
    trial_start: nullableSubscriptionDateSchema,
    trial_end: nullableSubscriptionDateSchema,
    current_period_start: nullableSubscriptionDateSchema,
    current_period_end: nullableSubscriptionDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    refineSubscriptionDates(value, context);
    if (value.status === SubscriptionStatus.TRIALING && value.trial_end == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trial_end'],
        message: 'trial_end is required for a trialing subscription',
      });
    }
  });

export type AdminSchoolSubscriptionCreateInput = z.infer<
  typeof adminSchoolSubscriptionCreateSchema
>;

/** Body of `PATCH /api/v1/admin/schools/:schoolId/subscription`. */
export const adminSchoolSubscriptionUpdateSchema = z
  .object({
    plan_id: z.string().uuid('plan_id must be a valid UUID').optional(),
    status: persistedSubscriptionStatusSchema.optional(),
    trial_start: nullableSubscriptionDateSchema,
    trial_end: nullableSubscriptionDateSchema,
    current_period_start: nullableSubscriptionDateSchema,
    current_period_end: nullableSubscriptionDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'At least one subscription field must be provided',
      });
    }
    refineSubscriptionDates(value, context);
  });

export type AdminSchoolSubscriptionUpdateInput = z.infer<
  typeof adminSchoolSubscriptionUpdateSchema
>;

/** Body of `POST /api/v1/admin/schools/:schoolId/subscription/cancel`. */
export const adminSchoolSubscriptionCancelSchema = z
  .object({
    cancelled_at: nullableSubscriptionDateSchema,
  })
  .strict();

export type AdminSchoolSubscriptionCancelInput = z.infer<
  typeof adminSchoolSubscriptionCancelSchema
>;

/**
 * Task 44 — Bus & driver compliance documents.
 *
 * The same strict, tenant-free style as every other schema in this package:
 * `.strict()` so an unknown field (a `school_id`, a forged `status`) is
 * rejected instead of silently stripped.
 *
 * Validity is *derived*, never accepted: no schema here exposes a `status`
 * field, so a client cannot mark an expired certificate as valid. The single
 * source of truth for the derivation is {@link deriveDocumentStatus}, which
 * the API service, the web console and the mobile app all call.
 */

/** Upper bound of a document reference number (RC no, policy no, licence no). */
export const DOCUMENT_NUMBER_MAX_LENGTH = 64;

/** Upper bound of the free-text notes of a document. */
export const DOCUMENT_NOTES_MAX_LENGTH = 1000;

/** Upper bound of the attached-file display name. */
export const DOCUMENT_FILE_NAME_MAX_LENGTH = 255;

/** Upper bound of the attached-file reference URL. */
export const DOCUMENT_FILE_URL_MAX_LENGTH = 512;

const optionalTextField = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value.length === 0 ? null : value))
    .nullish()
    .transform((value) => value ?? null);

const documentNumberSchema = optionalTextField(
  DOCUMENT_NUMBER_MAX_LENGTH,
  `document_number must be at most ${DOCUMENT_NUMBER_MAX_LENGTH} characters`,
);

const documentNotesSchema = optionalTextField(
  DOCUMENT_NOTES_MAX_LENGTH,
  `notes must be at most ${DOCUMENT_NOTES_MAX_LENGTH} characters`,
);

const documentFileNameSchema = optionalTextField(
  DOCUMENT_FILE_NAME_MAX_LENGTH,
  `file_name must be at most ${DOCUMENT_FILE_NAME_MAX_LENGTH} characters`,
);

const documentFileUrlSchema = z
  .string()
  .trim()
  .max(DOCUMENT_FILE_URL_MAX_LENGTH, `file_url must be at most ${DOCUMENT_FILE_URL_MAX_LENGTH} characters`)
  // `z.string().url()` accepts any scheme (`javascript:`, `data:`, …), and a
  // client renders this value as a link — so the scheme is pinned here.
  .url('file_url must be a valid http(s) URL')
  .refine((value) => /^https?:\/\//i.test(value), 'file_url must be a valid http(s) URL')
  .nullish()
  .transform((value) => value ?? null);

/**
 * A calendar date (`YYYY-MM-DD`) or an ISO-8601 date-time.
 *
 * Certificates are issued with a plain date while an uploaded scan may carry
 * a full timestamp, so both are accepted — and both must describe a moment
 * that actually exists (`2026-02-31` is rejected even though it parses).
 */
const DOCUMENT_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const documentDateSchema = z
  .string()
  .trim()
  .min(1, 'date cannot be empty')
  .superRefine((value, context) => {
    const match = DOCUMENT_DATE_PATTERN.exec(value);
    if (!match) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a valid ISO-8601 date (YYYY-MM-DD) or date-time',
      });
      return;
    }
    const [, year, month, day, hour, minute, second] = match;
    const utc = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      hour ? Number(hour) : 0,
      minute ? Number(minute) : 0,
      second ? Number(second) : 0,
    );
    const parsed = new Date(utc);
    if (
      parsed.getUTCFullYear() !== Number(year) ||
      parsed.getUTCMonth() !== Number(month) - 1 ||
      parsed.getUTCDate() !== Number(day)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a real calendar date',
      });
    }
  });

const optionalDocumentDateSchema = documentDateSchema.nullish().transform((value) => value ?? null);

/** Shared field set of a bus/driver document, before the owner-specific type. */
const documentFieldsSchema = {
  document_number: documentNumberSchema,
  issue_date: optionalDocumentDateSchema,
  expiry_date: optionalDocumentDateSchema,
  notes: documentNotesSchema,
  file_name: documentFileNameSchema,
  file_url: documentFileUrlSchema,
};

/** Refinement shared by create and update: a document cannot expire before it
 * was issued. */
const checkDateRange = (
  value: { issue_date?: string | null; expiry_date?: string | null },
  context: z.RefinementCtx,
): void => {
  if (!value.issue_date || !value.expiry_date) {
    return;
  }
  const issue = new Date(value.issue_date).getTime();
  const expiry = new Date(value.expiry_date).getTime();
  if (Number.isFinite(issue) && Number.isFinite(expiry) && expiry < issue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiry_date'],
      message: 'expiry_date must be on or after issue_date',
    });
  }
};

export const busDocumentCreateSchema = z
  .object({
    document_type: z.nativeEnum(BusDocumentType),
    ...documentFieldsSchema,
  })
  .strict();

export type BusDocumentCreateInput = z.infer<typeof busDocumentCreateSchema>;

export const busDocumentUpdateSchema = z
  .object({
    document_type: z.nativeEnum(BusDocumentType).optional(),
    ...documentFieldsSchema,
  })
  .strict()
  .superRefine((value, context) => checkDateRange(value, context));

export type BusDocumentUpdateInput = z.infer<typeof busDocumentUpdateSchema>;

export const driverDocumentCreateSchema = z
  .object({
    document_type: z.nativeEnum(DriverDocumentType),
    ...documentFieldsSchema,
  })
  .strict();

export type DriverDocumentCreateInput = z.infer<typeof driverDocumentCreateSchema>;

export const driverDocumentUpdateSchema = z
  .object({
    document_type: z.nativeEnum(DriverDocumentType).optional(),
    ...documentFieldsSchema,
  })
  .strict()
  .superRefine((value, context) => checkDateRange(value, context));

export type DriverDocumentUpdateInput = z.infer<typeof driverDocumentUpdateSchema>;

export const documentListQuerySchema = paginationSchema.extend({
  document_type: z.string().trim().min(1).max(64).optional(),
  status: z.nativeEnum(DocumentStatus).optional(),
});

export type DocumentListQueryInput = z.infer<typeof documentListQuerySchema>;

/** Bounds of the configurable "expiring soon" lead time, in days. */
export const MIN_DOCUMENT_WARNING_DAYS = 1;
export const MAX_DOCUMENT_WARNING_DAYS = 365;

export const documentRequirementInputSchema = z
  .object({
    document_type: z.string().trim().min(1, 'document_type is required').max(64),
    is_required: z.boolean(),
    expiry_warning_days: z
      .number()
      .int('expiry_warning_days must be an integer')
      .min(MIN_DOCUMENT_WARNING_DAYS, `expiry_warning_days must be at least ${MIN_DOCUMENT_WARNING_DAYS}`)
      .max(MAX_DOCUMENT_WARNING_DAYS, `expiry_warning_days must be at most ${MAX_DOCUMENT_WARNING_DAYS}`)
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict();

export type DocumentRequirementInputParsed = z.infer<typeof documentRequirementInputSchema>;

export const documentRequirementsUpdateSchema = z
  .object({
    owner_type: z.enum(DOCUMENT_OWNER_TYPE_VALUES as [DocumentOwnerType, ...DocumentOwnerType[]]),
    items: z
      .array(documentRequirementInputSchema)
      .min(1, 'items must contain at least one requirement')
      .max(64, 'items must contain at most 64 requirements'),
  })
  .strict();

export type DocumentRequirementsUpdateInput = z.infer<typeof documentRequirementsUpdateSchema>;

export const documentRequirementsListQuerySchema = z.object({
  owner_type: z.enum(DOCUMENT_OWNER_TYPE_VALUES as [DocumentOwnerType, ...DocumentOwnerType[]]),
});

export type DocumentRequirementsListQueryInput = z.infer<
  typeof documentRequirementsListQuerySchema
>;

export const documentOverviewQuerySchema = paginationSchema.extend({
  owner_type: z
    .enum(DOCUMENT_OWNER_TYPE_VALUES as [DocumentOwnerType, ...DocumentOwnerType[]])
    .optional(),
  compliance: z.enum(['compliant', 'attention']).optional(),
  search: z.string().trim().max(100, 'search must be at most 100 characters').optional(),
});

export type DocumentOverviewQueryInput = z.infer<typeof documentOverviewQuerySchema>;

/**
 * Document validity — the single derivation used by API, web and mobile.
 *
 * There is deliberately no way to pass a status in: it is computed from the
 * stored `expiry_date`, so an expired certificate can never be presented as
 * valid and an undated document (nothing to expire against) is `VALID`.
 *
 * The comparison is calendar-day based (both sides normalized to midnight
 * UTC) because certificates expire on a date, not at a time of day.
 */
export function deriveDocumentStatus(
  expiryDate: Date | string | null | undefined,
  options: { now?: Date; warningDays?: number } = {},
): DocumentStatus {
  const days = documentDaysRemaining(expiryDate, options);
  if (days === null) {
    return DocumentStatus.VALID;
  }
  const warningDays = options.warningDays ?? DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS;
  if (days < 0) {
    return DocumentStatus.EXPIRED;
  }
  return days <= warningDays ? DocumentStatus.EXPIRING_SOON : DocumentStatus.VALID;
}

/**
 * Whole calendar days from today until the document expires.
 *
 * `0` → expires today, negative → already expired, `null` → no expiry date
 * (or an unparsable one, which is treated as "no date" rather than guessed).
 */
export function documentDaysRemaining(
  expiryDate: Date | string | null | undefined,
  options: { now?: Date } = {},
): number | null {
  if (expiryDate === null || expiryDate === undefined || expiryDate === '') {
    return null;
  }
  const expiry = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  const expiryMs = expiry.getTime();
  if (!Number.isFinite(expiryMs)) {
    return null;
  }
  const now = options.now ?? new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryUtc = Date.UTC(
    expiry.getUTCFullYear(),
    expiry.getUTCMonth(),
    expiry.getUTCDate(),
  );
  return Math.round((expiryUtc - todayUtc) / 86_400_000);
}

/**
 * Task 44 — Emergency / SOS.
 *
 * The crew payload is deliberately tiny and strict: the school, the bus, the
 * route and the event time are all resolved server-side, so nothing here can
 * forge them. Coordinates are optional — an SOS must always be possible even
 * without a GPS fix — but they are never invented: either the device supplies
 * a real fix or the event is stored without one.
 */
export const EMERGENCY_MESSAGE_MAX_LENGTH = 500;

export const emergencySosSchema = z
  .object({
    trip_id: z.string().uuid('trip_id must be a valid UUID').nullish().transform((v) => v ?? null),
    type: z.nativeEnum(EmergencyType),
    message: z
      .string()
      .trim()
      .max(EMERGENCY_MESSAGE_MAX_LENGTH, `message must be at most ${EMERGENCY_MESSAGE_MAX_LENGTH} characters`)
      .transform((value) => (value.length === 0 ? null : value))
      .nullish()
      .transform((value) => value ?? null),
    latitude: z
      .number({ invalid_type_error: 'latitude must be a number' })
      .finite('latitude must be a finite number')
      .min(-90, 'latitude must be between -90 and 90')
      .max(90, 'latitude must be between -90 and 90')
      .nullish()
      .transform((value) => value ?? null),
    longitude: z
      .number({ invalid_type_error: 'longitude must be a number' })
      .finite('longitude must be a finite number')
      .min(-180, 'longitude must be between -180 and 180')
      .max(180, 'longitude must be between -180 and 180')
      .nullish()
      .transform((value) => value ?? null),
    accuracy: z
      .number({ invalid_type_error: 'accuracy must be a number' })
      .finite('accuracy must be a finite number')
      .min(0, 'accuracy must be at least 0')
      .max(GPS_ACCURACY_MAX_METERS, `accuracy must be at most ${GPS_ACCURACY_MAX_METERS} metres`)
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict()
  .superRefine((value, context) => {
    // A half coordinate pair carries no position at all — reject it instead
    // of storing a point that would render at 0,0.
    if ((value.latitude === null) !== (value.longitude === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latitude'],
        message: 'latitude and longitude must be supplied together',
      });
    }
  });

export type EmergencySosInput = z.infer<typeof emergencySosSchema>;

export const emergencyStatusUpdateSchema = z
  .object({
    status: z.nativeEnum(EmergencyStatus),
    note: z
      .string()
      .trim()
      .max(EMERGENCY_MESSAGE_MAX_LENGTH, `note must be at most ${EMERGENCY_MESSAGE_MAX_LENGTH} characters`)
      .transform((value) => (value.length === 0 ? null : value))
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict();

export type EmergencyStatusUpdateInput = z.infer<typeof emergencyStatusUpdateSchema>;

export const emergencyListQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(EmergencyStatus).optional(),
  type: z.nativeEnum(EmergencyType).optional(),
  trip_id: z.string().uuid('trip_id must be a valid UUID').optional(),
  bus_id: z.string().uuid('bus_id must be a valid UUID').optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_from must be in YYYY-MM-DD format').optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_to must be in YYYY-MM-DD format').optional(),
});

export type EmergencyListQueryInput = z.infer<typeof emergencyListQuerySchema>;
