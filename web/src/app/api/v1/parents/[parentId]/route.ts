/**
 * App Router entry point for `/api/v1/parents/:parentId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteParentsById, getParentsById, patchParentsById } from '../../../../../server/api/parents';

export const GET = createRouteHandler(getParentsById);
export const PATCH = createRouteHandler(patchParentsById);
export const DELETE = createRouteHandler(deleteParentsById);
