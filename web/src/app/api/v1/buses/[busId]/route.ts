/**
 * App Router entry point for `/api/v1/buses/:busId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteBusesById, getBusesById, patchBusesById } from '../../../../../server/api/buses';

export const GET = createRouteHandler(getBusesById);
export const PATCH = createRouteHandler(patchBusesById);
export const DELETE = createRouteHandler(deleteBusesById);
