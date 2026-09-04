/**
 * App Router entry point for `/api/v1/drivers`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getDrivers, postDrivers } from '../../../../server/api/staff';

export const GET = createRouteHandler(getDrivers);
export const POST = createRouteHandler(postDrivers);
