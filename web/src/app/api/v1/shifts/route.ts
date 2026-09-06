/**
 * App Router entry point for `/api/v1/shifts`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getShifts, postShifts } from '../../../../server/api/shifts';

export const GET = createRouteHandler(getShifts);
export const POST = createRouteHandler(postShifts);
