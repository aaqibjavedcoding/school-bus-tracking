import { z } from 'zod';

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
