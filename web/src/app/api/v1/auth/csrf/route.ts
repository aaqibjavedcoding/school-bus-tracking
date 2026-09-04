/**
 * App Router entry point for `/api/v1/auth/csrf`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getAuthCsrf } from '../../../../../server/api/auth';

export const GET = createRouteHandler(getAuthCsrf);
