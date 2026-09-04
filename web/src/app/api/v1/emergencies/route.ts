/**
 * App Router entry point for `/api/v1/emergencies`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getEmergencies } from '../../../../server/api/emergencies';

export const GET = createRouteHandler(getEmergencies);
