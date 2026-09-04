/**
 * App Router entry point for `/api/v1/stops/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteStopsById, getStopsById, patchStopsById } from '../../../../../server/api/stops';

export const GET = createRouteHandler(getStopsById);
export const PATCH = createRouteHandler(patchStopsById);
export const DELETE = createRouteHandler(deleteStopsById);
