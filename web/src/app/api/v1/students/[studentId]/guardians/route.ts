/**
 * App Router entry point for `/api/v1/students/:studentId/guardians`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getStudentsByStudentIdGuardians, postStudentsByStudentIdGuardians } from '../../../../../../server/api/parents';

export const GET = createRouteHandler(getStudentsByStudentIdGuardians);
export const POST = createRouteHandler(postStudentsByStudentIdGuardians);
