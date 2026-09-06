/**
 * App Router entry point for `/api/v1/runs/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteRunsById, getRunsById, patchRunsById } from '../../../../../server/api/runs';

export const GET = createRouteHandler(getRunsById);
export const PATCH = createRouteHandler(patchRunsById);
export const DELETE = createRouteHandler(deleteRunsById);
