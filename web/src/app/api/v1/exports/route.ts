/**
 * App Router entry point for `/api/v1/exports`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getExports } from '../../../../server/api/data-transfer-export';

export const GET = createRouteHandler(getExports);
