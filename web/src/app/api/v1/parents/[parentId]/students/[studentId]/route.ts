/**
 * App Router entry point for `/api/v1/parents/:parentId/students/:studentId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { deleteParentsByParentIdStudentsByStudentId, patchParentsByParentIdStudentsByStudentId } from '../../../../../../../server/api/parents';

export const PATCH = createRouteHandler(patchParentsByParentIdStudentsByStudentId);
export const DELETE = createRouteHandler(deleteParentsByParentIdStudentsByStudentId);
