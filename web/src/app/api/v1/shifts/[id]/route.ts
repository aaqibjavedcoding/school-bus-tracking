/**
 * App Router entry point for `/api/v1/shifts/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteShiftsById, getShiftsById, patchShiftsById } from '../../../../../server/api/shifts';

export const GET = createRouteHandler(getShiftsById);
export const PATCH = createRouteHandler(patchShiftsById);
export const DELETE = createRouteHandler(deleteShiftsById);
