/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/shifts`.
 */
import { createRouteHandler } from '../../../../../../../../server/http/route-runtime';
import {
  getAdminSchoolsBySchoolIdManageShifts,
  postAdminSchoolsBySchoolIdManageShifts,
} from '../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageShifts);
export const POST = createRouteHandler(postAdminSchoolsBySchoolIdManageShifts);
