/**
 * App Router entry point for `/api/v1/trips/:tripId/progress`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getTripsByTripIdProgress } from '../../../../../../server/api/eta';

export const GET = createRouteHandler(getTripsByTripIdProgress);
