/**
 * App Router entry point for `/api/v1/students/:studentId/guardians/:parentId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { deleteStudentsByStudentIdGuardiansByParentId, patchStudentsByStudentIdGuardiansByParentId } from '../../../../../../../server/api/parents';

export const PATCH = createRouteHandler(patchStudentsByStudentIdGuardiansByParentId);
export const DELETE = createRouteHandler(deleteStudentsByStudentIdGuardiansByParentId);
