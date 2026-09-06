/**
 * App Router entry point for `/api/v1/runs`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getRuns, postRuns } from '../../../../server/api/runs';

export const GET = createRouteHandler(getRuns);
export const POST = createRouteHandler(postRuns);
