/**
 * App Router entry point for `/api/v1/routes/:id/geometry`.
 *
 * The behaviour lives in the endpoint definition; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around it.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getRoutesByIdGeometry } from '../../../../../../server/api/routes';

export const GET = createRouteHandler(getRoutesByIdGeometry);
