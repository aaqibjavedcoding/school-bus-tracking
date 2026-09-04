/**
 * App Router entry point for `/api/v1/buses`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getBuses, postBuses } from '../../../../server/api/buses';

export const GET = createRouteHandler(getBuses);
export const POST = createRouteHandler(postBuses);
