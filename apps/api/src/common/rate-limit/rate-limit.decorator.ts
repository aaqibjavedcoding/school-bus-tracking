import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_POLICY_KEY, RateLimitPolicyName } from './rate-limit.constants';

/**
 * Declares the rate-limit policy protecting a route (or a whole controller).
 *
 * The numbers live in configuration (`RATE_LIMIT_<POLICY>_LIMIT` /
 * `_WINDOW_MS`), never in the annotation, so an operator can retune a limit
 * without a deployment of new code.
 *
 * ```ts
 * @RateLimit('auth_login')
 * @Post('login')
 * async login(...) {}
 * ```
 */
export const RateLimit = (policy: RateLimitPolicyName) =>
  SetMetadata(RATE_LIMIT_POLICY_KEY, policy);
