/**
 * App Router entry point for `/api/v1/drivers/:driverId/pin`.
 *
 * Sets, resets or clears a crew member's mobile login PIN (Mobile-UX Phase 4).
 * SCHOOL_ADMIN only; the tenant comes from the caller's own session.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { putDriversByIdPin } from '../../../../../../server/api/staff';

export const PUT = createRouteHandler(putDriversByIdPin);
