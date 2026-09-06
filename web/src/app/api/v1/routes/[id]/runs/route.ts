/**
 * App Router entry point for `/api/v1/routes/:id/runs`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getRoutesByIdRuns, postRoutesByIdRuns } from '../../../../../../server/api/runs';

export const GET = createRouteHandler(getRoutesByIdRuns);
export const POST = createRouteHandler(postRoutesByIdRuns);
