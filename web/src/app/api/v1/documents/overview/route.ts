/**
 * App Router entry point for `/api/v1/documents/overview`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getDocumentsOverview } from '../../../../../server/api/documents';

export const GET = createRouteHandler(getDocumentsOverview);
