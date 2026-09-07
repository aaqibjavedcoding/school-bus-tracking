/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/runs/:id`.
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import {
  deleteAdminSchoolsBySchoolIdManageRunsById,
  getAdminSchoolsBySchoolIdManageRunsById,
  patchAdminSchoolsBySchoolIdManageRunsById,
} from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageRunsById);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageRunsById);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageRunsById);
