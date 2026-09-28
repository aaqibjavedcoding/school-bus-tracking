/**
 * App Router entry point for `/api/v1/public/marketing/demo-request`.
 *
 * The behaviour lives in the endpoint definition; `createRouteHandler` runs
 * the shared guard chain (CSRF → rate limit → validation) and the response
 * envelope around it.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { postPublicMarketingDemoRequest } from '../../../../../../server/api/public-demo-request';

export const POST = createRouteHandler(postPublicMarketingDemoRequest);
