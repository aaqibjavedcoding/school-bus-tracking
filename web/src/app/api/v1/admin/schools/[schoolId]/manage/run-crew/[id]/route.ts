/**
 * App Router entry point for
 * `/api/v1/admin/schools/:schoolId/manage/run-crew/:id` — mutate one roster
 * row by id (the run a crew member belongs to is immutable).
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import {
  deleteAdminSchoolsBySchoolIdManageRuncrewById,
  getAdminSchoolsBySchoolIdManageRuncrewById,
  patchAdminSchoolsBySchoolIdManageRuncrewById,
} from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageRuncrewById);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageRuncrewById);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageRuncrewById);
