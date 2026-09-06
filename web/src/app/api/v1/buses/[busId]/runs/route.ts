/**
 * App Router entry point for `/api/v1/buses/:busId/runs`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getBusesByIdRuns } from '../../../../../../server/api/runs';

export const GET = createRouteHandler(getBusesByIdRuns);
