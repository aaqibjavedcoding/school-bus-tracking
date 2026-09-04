/**
 * App Router entry point for `/api/v1/buses/:busId/documents/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { deleteBusesByBusIdDocumentsById, getBusesByBusIdDocumentsById, patchBusesByBusIdDocumentsById } from '../../../../../../../server/api/documents';

export const GET = createRouteHandler(getBusesByBusIdDocumentsById);
export const PATCH = createRouteHandler(patchBusesByBusIdDocumentsById);
export const DELETE = createRouteHandler(deleteBusesByBusIdDocumentsById);
