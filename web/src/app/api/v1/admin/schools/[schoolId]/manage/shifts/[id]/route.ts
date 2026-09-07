/**
 * App Router entry point for
 * `/api/v1/admin/schools/:schoolId/manage/shifts/:id`.
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import {
  deleteAdminSchoolsBySchoolIdManageShiftsById,
  getAdminSchoolsBySchoolIdManageShiftsById,
  patchAdminSchoolsBySchoolIdManageShiftsById,
} from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageShiftsById);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageShiftsById);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageShiftsById);
