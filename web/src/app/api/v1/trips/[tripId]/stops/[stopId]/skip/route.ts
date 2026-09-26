/**
 * App Router entry point for `/api/v1/trips/:tripId/stops/:stopId/skip`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../server/http/route-runtime';
import { postTripsByTripIdStopsByStopIdSkip } from '../../../../../../../../server/api/crew-stops';

export const POST = createRouteHandler(postTripsByTripIdStopsByStopIdSkip);
