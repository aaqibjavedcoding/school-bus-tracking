/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/students/:studentId/guardians/:parentId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../../../server/http/route-runtime';
import { deleteAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardiansByParentId, patchAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardiansByParentId } from '../../../../../../../../../../../server/api/admin-manage';

export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardiansByParentId);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardiansByParentId);
