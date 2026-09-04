/**
 * App Router entry point for `/api/v1/schools`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { postSchools } from '../../../../server/api/schools';

export const POST = createRouteHandler(postSchools);
