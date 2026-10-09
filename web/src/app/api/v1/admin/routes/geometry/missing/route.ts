/**
 * App Router entry point for `/api/v1/admin/routes/geometry/missing`.
 *
 * The behaviour lives in the endpoint definition; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around it.
 * SUPER_ADMIN only — the platform-wide view of the route-geometry cache.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { getAdminRoutesGeometryMissing } from '../../../../../../../server/api/admin';

export const GET = createRouteHandler(getAdminRoutesGeometryMissing);
