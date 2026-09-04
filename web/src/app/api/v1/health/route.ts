/**
 * App Router entry point for `/api/v1/health`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getHealth } from '../../../../server/api/health';

export const GET = createRouteHandler(getHealth);
