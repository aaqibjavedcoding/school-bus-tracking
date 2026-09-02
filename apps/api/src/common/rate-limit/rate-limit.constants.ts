/** DI token for the configured {@link RateLimitStore}. */
export const RATE_LIMIT_STORE = 'RATE_LIMIT_STORE';

/** Metadata key carrying the policy name declared by `@RateLimit()`. */
export const RATE_LIMIT_POLICY_KEY = 'rate_limit_policy';

/** Error code returned in the standard error envelope on a 429. */
export const RATE_LIMIT_EXCEEDED_CODE = 'RATE_LIMIT_EXCEEDED';

/** Policy names understood by the rate-limit configuration. */
export const RATE_LIMIT_POLICIES = [
  'auth_login',
  'auth_refresh',
  'auth_logout',
  'password_reset',
  'sos_create',
  'attendance_write',
  'location_read',
  'read_heavy',
  'data_import',
  'data_export',
  'report_read',
] as const;

export type RateLimitPolicyName = (typeof RATE_LIMIT_POLICIES)[number];
