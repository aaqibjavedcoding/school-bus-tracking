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
