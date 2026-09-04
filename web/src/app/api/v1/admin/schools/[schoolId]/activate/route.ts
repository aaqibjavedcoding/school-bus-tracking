/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/activate`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { postAdminSchoolsByIdActivate } from '../../../../../../../server/api/admin';

export const POST = createRouteHandler(postAdminSchoolsByIdActivate);
