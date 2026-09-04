/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/students/:studentId/guardians`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../../server/http/route-runtime';
import { getAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardians, postAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardians } from '../../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardians);
export const POST = createRouteHandler(postAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardians);
