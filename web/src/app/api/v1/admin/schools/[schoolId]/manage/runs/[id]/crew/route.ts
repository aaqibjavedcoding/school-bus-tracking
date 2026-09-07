/**
 * App Router entry point for
 * `/api/v1/admin/schools/:schoolId/manage/runs/:id/crew` — the roster of one
 * run, and rosters a new person onto it (the tenant surface is shaped the
 * same way, so no new nested endpoints are introduced by assisted
 * management).
 */
import { createRouteHandler } from '../../../../../../../../../../server/http/route-runtime';
import {
  getAdminSchoolsBySchoolIdManageRunsByIdCrew,
  postAdminSchoolsBySchoolIdManageRunsByIdCrew,
} from '../../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageRunsByIdCrew);
export const POST = createRouteHandler(postAdminSchoolsBySchoolIdManageRunsByIdCrew);
