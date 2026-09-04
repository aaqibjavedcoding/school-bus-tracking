/**
 * App Router entry point for `/api/v1/assignments/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteAssignmentsById, getAssignmentsById, patchAssignmentsById } from '../../../../../server/api/assignments';

export const GET = createRouteHandler(getAssignmentsById);
export const PATCH = createRouteHandler(patchAssignmentsById);
export const DELETE = createRouteHandler(deleteAssignmentsById);
