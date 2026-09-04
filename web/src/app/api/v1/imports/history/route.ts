/**
 * App Router entry point for `/api/v1/imports/history`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getImportsHistory } from '../../../../../server/api/data-transfer-import';

export const GET = createRouteHandler(getImportsHistory);
