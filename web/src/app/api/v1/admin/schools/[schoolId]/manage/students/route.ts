/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/students`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../server/http/route-runtime';
import { getAdminSchoolsBySchoolIdManageStudents, postAdminSchoolsBySchoolIdManageStudents } from '../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageStudents);
export const POST = createRouteHandler(postAdminSchoolsBySchoolIdManageStudents);
