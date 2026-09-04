/**
 * App Router entry point for `/api/v1/parents/:parentId/students`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getParentsByParentIdStudents, postParentsByParentIdStudents } from '../../../../../../server/api/parents';

export const GET = createRouteHandler(getParentsByParentIdStudents);
export const POST = createRouteHandler(postParentsByParentIdStudents);
