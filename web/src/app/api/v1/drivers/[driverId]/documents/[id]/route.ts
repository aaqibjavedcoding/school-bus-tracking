/**
 * App Router entry point for `/api/v1/drivers/:driverId/documents/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { deleteDriversByDriverIdDocumentsById, getDriversByDriverIdDocumentsById, patchDriversByDriverIdDocumentsById } from '../../../../../../../server/api/documents';

export const GET = createRouteHandler(getDriversByDriverIdDocumentsById);
export const PATCH = createRouteHandler(patchDriversByDriverIdDocumentsById);
export const DELETE = createRouteHandler(deleteDriversByDriverIdDocumentsById);
