/**
 * App Router entry point for `/api/v1/trips`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getTrips, postTrips } from '../../../../server/api/trips';

export const GET = createRouteHandler(getTrips);
export const POST = createRouteHandler(postTrips);
