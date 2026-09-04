/**
 * App Router entry point for `/api/v1/parent/children/:id/today`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { getParentChildrenByIdToday } from '../../../../../../../server/api/parent-portal';

export const GET = createRouteHandler(getParentChildrenByIdToday);
