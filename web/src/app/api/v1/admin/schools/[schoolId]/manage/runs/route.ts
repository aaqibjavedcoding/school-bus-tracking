/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/runs`.
 */
import { createRouteHandler } from '../../../../../../../../server/http/route-runtime';
import {
  getAdminSchoolsBySchoolIdManageRuns,
  postAdminSchoolsBySchoolIdManageRuns,
} from '../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageRuns);
export const POST = createRouteHandler(postAdminSchoolsBySchoolIdManageRuns);
