import { z } from 'zod';
import { StudentGender } from '@school-bus-tracking/shared-types';

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

/** Parent account creation is intentionally strict: tenant and role fields are
 * not client-controlled and are rejected instead of silently stripped. */
const personNameSchema = z.string().trim().min(1).max(100);
const parentPhoneSchema = z.string().trim().max(32).nullish();

export const parentCreateSchema = z
  .object({
    first_name: personNameSchema,
    last_name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
    phone: parentPhoneSchema,
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
    phone: parentPhoneSchema,
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
