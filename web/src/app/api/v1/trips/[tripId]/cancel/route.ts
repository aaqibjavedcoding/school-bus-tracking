/**
 * App Router entry point for `/api/v1/trips/:tripId/cancel`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { postTripsByIdCancel } from '../../../../../../server/api/trips';

export const POST = createRouteHandler(postTripsByIdCancel);
