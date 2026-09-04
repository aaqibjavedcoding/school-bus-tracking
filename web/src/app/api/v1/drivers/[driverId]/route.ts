/**
 * App Router entry point for `/api/v1/drivers/:driverId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteDriversById, getDriversById, patchDriversById } from '../../../../../server/api/staff';

export const GET = createRouteHandler(getDriversById);
export const PATCH = createRouteHandler(patchDriversById);
export const DELETE = createRouteHandler(deleteDriversById);
