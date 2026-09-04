import { HttpException, HttpStatus } from '../../framework';
import { SubscriptionStatus } from '@school-bus-tracking/shared-types';

/** Machine-readable error code carried in the standard error envelope. */
export const SUBSCRIPTION_LAPSED_CODE = 'SUBSCRIPTION_INACTIVE';

export const SUBSCRIPTION_LAPSED_MESSAGE =
  'Your subscription period has ended. Renew the subscription to add new records. Existing data stays available.';

export interface SubscriptionLapsedDetails {
  /** Time-aware status (never the stale stored one). */
  effective_status: SubscriptionStatus;
  /** The stored lifecycle status, for support/diagnostics. */
  stored_status: string;
}

/**
 * Raised when a school whose subscription window has lapsed tries to create a
 * new plan-limited resource.
 *
 * Uses `409 Conflict`, matching the existing plan-limit behaviour, so clients
 * that already handle "cannot create, business reason" keep working. Reads,
 * updates and deletes are untouched — an expired tenant is never locked out of
 * its own data, it just cannot grow on an unpaid plan.
 */
export class SubscriptionLapsedException extends HttpException {
  constructor(effectiveStatus: SubscriptionStatus, storedStatus: string) {
    const details: SubscriptionLapsedDetails = {
      effective_status: effectiveStatus,
      stored_status: storedStatus,
    };
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: SUBSCRIPTION_LAPSED_CODE,
        message: SUBSCRIPTION_LAPSED_MESSAGE,
        details,
      },
      HttpStatus.CONFLICT,
    );
  }
}
