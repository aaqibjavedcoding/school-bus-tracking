import { CanActivate, ExecutionContext, Reflector } from '../../framework';
import { ConfigService } from '../../framework';
import type { Request, Response } from 'express';
import type { RateLimitPolicyConfig } from '../../config';
import {
  RATE_LIMIT_POLICY_KEY,
  RATE_LIMIT_STORE,
  RateLimitPolicyName,
} from './rate-limit.constants';
import { RateLimitExceededException } from './rate-limit-exceeded.exception';
import {
  buildRateLimitBuckets,
  resolveClientIp,
  retryAfterSeconds,
} from './rate-limit.keys';
import type { RateLimitStore } from './rate-limit.store';

/**
 * Global guard applying the `@RateLimit('<policy>')` annotation.
 *
 * Routes without the annotation are untouched — the limiter is opt-in per
 * endpoint so ordinary school traffic (dashboards, lists a dispatcher opens
 * all day) is never throttled by accident, while the abuse-prone surfaces
 * (login, refresh, password reset, SOS, attendance, location, heavy search)
 * are explicitly protected.
 *
 * Ordering note: this guard is registered *after* the CSRF guard and runs
 * before controller execution; when a route is also protected by
 * `JwtAuthGuard`, `request.user` may already be populated, in which case the
 * bucket is keyed by user id instead of IP (fairer behind NAT/school Wi-Fi).
 */
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly store: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    if (!this.configService.get<boolean>('rateLimit.enabled', true)) {
      return true;
    }

    const policy = this.reflector.getAllAndOverride<RateLimitPolicyName | undefined>(
      RATE_LIMIT_POLICY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!policy) {
      return true;
    }

    const settings = this.configService.get<RateLimitPolicyConfig>(`rateLimit.policies.${policy}`);
    if (!settings) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: { id?: string } }>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();

    const buckets = buildRateLimitBuckets(
      {
        policy,
        ip: resolveClientIp(
          request.ip ?? request.socket?.remoteAddress,
          request.headers?.['x-forwarded-for'],
          this.configService.get<boolean>('rateLimit.trustProxy', false),
        ),
        userId: request.user?.id ?? null,
        body: request.body,
      },
      settings,
      {
        identityLimit: this.configService.get<number>('rateLimit.login.identityLimit', 8),
        identityWindowMs: this.configService.get<number>(
          'rateLimit.login.identityWindowMs',
          900_000,
        ),
      },
    );

    let tightestRemaining = Number.POSITIVE_INFINITY;
    let headerLimit = settings.limit;
    let headerReset = now + settings.windowMs;
    let exceeded: { limit: number; resetAt: number } | null = null;

    for (const bucket of buckets) {
      const hit = await this.store.hit(bucket.key, bucket.windowMs, now);
      const remaining = Math.max(0, bucket.limit - hit.count);
      if (remaining < tightestRemaining) {
        tightestRemaining = remaining;
        headerLimit = bucket.limit;
        headerReset = hit.resetAt;
      }
      if (hit.count > bucket.limit && !exceeded) {
        exceeded = { limit: bucket.limit, resetAt: hit.resetAt };
      }
    }

    const retryAfter = retryAfterSeconds(headerReset, now);
    setRateLimitHeaders(response, headerLimit, tightestRemaining, retryAfter);

    if (exceeded) {
      const wait = retryAfterSeconds(exceeded.resetAt, now);
      response?.setHeader?.('Retry-After', String(wait));
      throw new RateLimitExceededException(policy, exceeded.limit, wait);
    }

    return true;
  }
}

/** Draft-standard `RateLimit-*` informational headers. */
function setRateLimitHeaders(
  response: Response | undefined,
  limit: number,
  remaining: number,
  resetSeconds: number,
): void {
  if (!response?.setHeader) {
    return;
  }
  response.setHeader('RateLimit-Limit', String(limit));
  response.setHeader(
    'RateLimit-Remaining',
    String(Number.isFinite(remaining) ? Math.max(0, remaining) : 0),
  );
  response.setHeader('RateLimit-Reset', String(resetSeconds));
}
