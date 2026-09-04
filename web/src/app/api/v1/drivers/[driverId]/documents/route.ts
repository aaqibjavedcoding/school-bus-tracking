/**
 * App Router entry point for `/api/v1/drivers/:driverId/documents`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getDriversByDriverIdDocuments, postDriversByDriverIdDocuments } from '../../../../../../server/api/documents';

export const GET = createRouteHandler(getDriversByDriverIdDocuments);
export const POST = createRouteHandler(postDriversByDriverIdDocuments);
