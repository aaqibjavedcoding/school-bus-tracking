/**
 * App Router entry point for `/api/v1/admin/plans`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getAdminPlans, postAdminPlans } from '../../../../../server/api/admin';

export const GET = createRouteHandler(getAdminPlans);
export const POST = createRouteHandler(postAdminPlans);
