/**
 * App Router entry point for `/api/v1/marketing/campaigns`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getMarketingCampaigns, postMarketingCampaigns } from '../../../../../server/api/marketing';

export const GET = createRouteHandler(getMarketingCampaigns);
export const POST = createRouteHandler(postMarketingCampaigns);
