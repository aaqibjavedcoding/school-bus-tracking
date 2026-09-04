/**
 * App Router entry point for `/api/v1/trips/:tripId/eta`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getTripsByTripIdEta } from '../../../../../../server/api/eta';

export const GET = createRouteHandler(getTripsByTripIdEta);
