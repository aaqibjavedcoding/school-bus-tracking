/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/conductors/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import { deleteAdminSchoolsBySchoolIdManageConductorsById, getAdminSchoolsBySchoolIdManageConductorsById, patchAdminSchoolsBySchoolIdManageConductorsById } from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageConductorsById);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageConductorsById);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageConductorsById);
