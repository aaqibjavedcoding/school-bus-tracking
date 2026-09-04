/**
 * App Router entry point for `/api/v1/admin/plans/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getAdminPlansById, patchAdminPlansById } from '../../../../../../server/api/admin';

export const GET = createRouteHandler(getAdminPlansById);
export const PATCH = createRouteHandler(patchAdminPlansById);
