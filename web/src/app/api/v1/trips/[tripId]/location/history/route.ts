/**
 * App Router entry point for `/api/v1/trips/:tripId/location/history`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { getTripsByTripIdLocationHistory } from '../../../../../../../server/api/live-tracking';

export const GET = createRouteHandler(getTripsByTripIdLocationHistory);
