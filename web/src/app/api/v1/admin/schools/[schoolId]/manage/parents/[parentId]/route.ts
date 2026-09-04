/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/parents/:parentId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import { deleteAdminSchoolsBySchoolIdManageParentsByParentId, getAdminSchoolsBySchoolIdManageParentsByParentId, patchAdminSchoolsBySchoolIdManageParentsByParentId } from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageParentsByParentId);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageParentsByParentId);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageParentsByParentId);
