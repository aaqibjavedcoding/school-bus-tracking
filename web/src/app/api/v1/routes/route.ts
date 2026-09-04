/**
 * App Router entry point for `/api/v1/routes`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getRoutes, postRoutes } from '../../../../server/api/routes';

export const GET = createRouteHandler(getRoutes);
export const POST = createRouteHandler(postRoutes);
