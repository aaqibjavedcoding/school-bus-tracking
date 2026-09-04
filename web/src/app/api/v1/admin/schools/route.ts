/**
 * App Router entry point for `/api/v1/admin/schools`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getAdminSchools, postAdminSchools } from '../../../../../server/api/admin';

export const GET = createRouteHandler(getAdminSchools);
export const POST = createRouteHandler(postAdminSchools);
