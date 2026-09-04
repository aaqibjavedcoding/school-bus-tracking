/**
 * App Router entry point for `/api/v1/stops`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getStops, postStops } from '../../../../server/api/stops';

export const GET = createRouteHandler(getStops);
export const POST = createRouteHandler(postStops);
