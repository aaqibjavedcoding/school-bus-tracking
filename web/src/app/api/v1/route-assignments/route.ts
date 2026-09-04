/**
 * App Router entry point for `/api/v1/route-assignments`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getRouteassignments, postRouteassignments } from '../../../../server/api/assignments';

export const GET = createRouteHandler(getRouteassignments);
export const POST = createRouteHandler(postRouteassignments);
