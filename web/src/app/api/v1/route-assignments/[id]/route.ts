/**
 * App Router entry point for `/api/v1/route-assignments/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteRouteassignmentsById, getRouteassignmentsById, patchRouteassignmentsById } from '../../../../../server/api/assignments';

export const GET = createRouteHandler(getRouteassignmentsById);
export const PATCH = createRouteHandler(patchRouteassignmentsById);
export const DELETE = createRouteHandler(deleteRouteassignmentsById);
