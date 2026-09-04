/**
 * App Router entry point for `/api/v1/trips/:tripId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteTripsById, getTripsById, patchTripsById } from '../../../../../server/api/trips';

export const GET = createRouteHandler(getTripsById);
export const PATCH = createRouteHandler(patchTripsById);
export const DELETE = createRouteHandler(deleteTripsById);
