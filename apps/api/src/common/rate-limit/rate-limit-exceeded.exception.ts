import { HttpException, HttpStatus } from '@nestjs/common';
import { RATE_LIMIT_EXCEEDED_CODE } from './rate-limit.constants';

export interface RateLimitExceededDetails {
  policy: string;
  limit: number;
  /** Seconds the client should wait before retrying. */
  retry_after_seconds: number;
}

/** Message shown to a throttled caller — actionable, never alarming. */
export function rateLimitExceededMessage(retryAfterSeconds: number): string {
  return `Too many requests. Please try again in ${retryAfterSeconds} second${
    retryAfterSeconds === 1 ? '' : 's'
  }.`;
}

/**
 * `429 Too Many Requests` in the project's standard error envelope
 * (`{ success: false, error: { code, message, details } }`), so existing
 * clients render it like any other business error.
 */
export class RateLimitExceededException extends HttpException {
  constructor(
    readonly policy: string,
    readonly limit: number,
    readonly retryAfterSeconds: number,
  ) {
    const details: RateLimitExceededDetails = {
      policy,
      limit,
      retry_after_seconds: retryAfterSeconds,
    };
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: RATE_LIMIT_EXCEEDED_CODE,
        message: rateLimitExceededMessage(retryAfterSeconds),
        details,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
