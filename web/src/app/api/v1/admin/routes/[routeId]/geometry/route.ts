/**
 * App Router entry point for `/api/v1/admin/routes/:routeId/geometry`.
 *
 * The behaviour lives in the endpoint definition; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around it.
 * SUPER_ADMIN only — stores a road geometry for any school's route (the
 * platform backfill's write half).
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { putAdminRoutesByRouteIdGeometry } from '../../../../../../../server/api/admin';

export const PUT = createRouteHandler(putAdminRoutesByRouteIdGeometry);
