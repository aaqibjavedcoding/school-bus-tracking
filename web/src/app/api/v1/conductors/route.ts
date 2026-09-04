/**
 * App Router entry point for `/api/v1/conductors`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getConductors, postConductors } from '../../../../server/api/staff';

export const GET = createRouteHandler(getConductors);
export const POST = createRouteHandler(postConductors);
