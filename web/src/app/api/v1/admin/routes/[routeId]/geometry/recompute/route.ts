/**
 * App Router entry point for `/api/v1/admin/routes/:routeId/geometry/recompute`.
 *
 * The behaviour lives in the endpoint definition; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around it.
 * SUPER_ADMIN only — the platform twin of the school recompute.
 */
import { createRouteHandler } from '../../../../../../../../server/http/route-runtime';
import { postAdminRoutesByRouteIdGeometryRecompute } from '../../../../../../../../server/api/admin';

export const POST = createRouteHandler(postAdminRoutesByRouteIdGeometryRecompute);
