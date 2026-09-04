/**
 * App Router entry point for `/api/v1/conductors/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteConductorsById, getConductorsById, patchConductorsById } from '../../../../../server/api/staff';

export const GET = createRouteHandler(getConductorsById);
export const PATCH = createRouteHandler(patchConductorsById);
export const DELETE = createRouteHandler(deleteConductorsById);
