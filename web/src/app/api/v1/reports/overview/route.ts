/**
 * App Router entry point for `/api/v1/reports/overview`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getReportsOverview } from '../../../../../server/api/reports';

export const GET = createRouteHandler(getReportsOverview);
