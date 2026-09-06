/**
 * App Router entry point for `/api/v1/runs/:id/crew`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getRunsByIdCrew, postRunsByIdCrew } from '../../../../../../server/api/run-crew';

export const GET = createRouteHandler(getRunsByIdCrew);
export const POST = createRouteHandler(postRunsByIdCrew);
