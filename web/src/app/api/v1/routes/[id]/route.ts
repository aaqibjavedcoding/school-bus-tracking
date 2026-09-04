/**
 * App Router entry point for `/api/v1/routes/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteRoutesById, getRoutesById, patchRoutesById } from '../../../../../server/api/routes';

export const GET = createRouteHandler(getRoutesById);
export const PATCH = createRouteHandler(patchRoutesById);
export const DELETE = createRouteHandler(deleteRoutesById);
