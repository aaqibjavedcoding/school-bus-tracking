/**
 * App Router entry point for `/api/v1/students`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getStudents, postStudents } from '../../../../server/api/students';

export const GET = createRouteHandler(getStudents);
export const POST = createRouteHandler(postStudents);
