/**
 * App Router entry point for `/api/v1/students/:studentId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { deleteStudentsById, getStudentsById, patchStudentsById } from '../../../../../server/api/students';

export const GET = createRouteHandler(getStudentsById);
export const PATCH = createRouteHandler(patchStudentsById);
export const DELETE = createRouteHandler(deleteStudentsById);
