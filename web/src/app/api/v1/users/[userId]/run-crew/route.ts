/**
 * App Router entry point for `/api/v1/users/:userId/run-crew`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getUsersByIdRunCrew } from '../../../../../../server/api/run-crew';

export const GET = createRouteHandler(getUsersByIdRunCrew);
