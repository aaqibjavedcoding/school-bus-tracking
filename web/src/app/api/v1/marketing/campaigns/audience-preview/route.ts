/**
 * App Router entry point for `/api/v1/marketing/campaigns/audience-preview`.
 *
 * Static segment wins over the neighbouring `[id]` route, so an explicit
 * preview path can never be parsed as a campaign id.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { postMarketingCampaignsAudiencePreview } from '../../../../../../server/api/marketing';

export const POST = createRouteHandler(postMarketingCampaignsAudiencePreview);
