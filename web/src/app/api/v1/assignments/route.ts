/**
 * App Router entry point for `/api/v1/assignments`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getAssignments, postAssignments } from '../../../../server/api/assignments';

export const GET = createRouteHandler(getAssignments);
export const POST = createRouteHandler(postAssignments);
