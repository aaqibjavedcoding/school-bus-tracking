/**
 * App Router entry point for `/api/v1/trips/:id/status`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { patchTripsByIdStatus } from '../../../../../../server/api/trips';

export const PATCH = createRouteHandler(patchTripsByIdStatus);
