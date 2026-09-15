/**
 * App Router entry point for `/api/v1/conductors/:id/pin`.
 *
 * Sets, resets or clears a crew member's mobile login PIN (Mobile-UX Phase 4).
 * SCHOOL_ADMIN only; the tenant comes from the caller's own session.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { putConductorsByIdPin } from '../../../../../../server/api/staff';

export const PUT = createRouteHandler(putConductorsByIdPin);
