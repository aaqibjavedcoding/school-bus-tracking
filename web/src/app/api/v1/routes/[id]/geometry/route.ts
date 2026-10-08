/**
 * App Router entry point for `/api/v1/routes/:id/geometry`.
 *
 * The behaviour lives in the endpoint definition; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around it.
 *
 * `GET` serves the cached road-following geometry (every school role);
 * `PUT` stores an engine-computed geometry into the cache (SCHOOL_ADMIN —
 * the write half used by the geometry backfill).
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { getRoutesByIdGeometry, putRoutesByIdGeometry } from '../../../../../../server/api/routes';

export const GET = createRouteHandler(getRoutesByIdGeometry);
export const PUT = createRouteHandler(putRoutesByIdGeometry);
