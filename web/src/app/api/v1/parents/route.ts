/**
 * App Router entry point for `/api/v1/parents`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getParents, postParents } from '../../../../server/api/parents';

export const GET = createRouteHandler(getParents);
export const POST = createRouteHandler(postParents);
