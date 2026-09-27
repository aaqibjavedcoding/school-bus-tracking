/**
 * App Router entry point for `/api/v1/marketing/templates`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getMarketingTemplates, postMarketingTemplates } from '../../../../../server/api/marketing';

export const GET = createRouteHandler(getMarketingTemplates);
export const POST = createRouteHandler(postMarketingTemplates);
