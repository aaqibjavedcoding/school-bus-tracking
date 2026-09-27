/**
 * App Router entry point for `/api/v1/marketing/campaigns/:id/schedule`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { postMarketingCampaignsByIdSchedule } from '../../../../../../../server/api/marketing';

export const POST = createRouteHandler(postMarketingCampaignsByIdSchedule);
