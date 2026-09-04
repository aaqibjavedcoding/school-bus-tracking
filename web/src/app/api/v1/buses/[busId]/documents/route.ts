/**
 * App Router entry point for `/api/v1/buses/:busId/documents`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getBusesByBusIdDocuments, postBusesByBusIdDocuments } from '../../../../../../server/api/documents';

export const GET = createRouteHandler(getBusesByBusIdDocuments);
export const POST = createRouteHandler(postBusesByBusIdDocuments);
