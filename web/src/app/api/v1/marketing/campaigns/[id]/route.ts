/**
 * App Router entry point for `/api/v1/marketing/campaigns/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import {
  getMarketingCampaignsById,
  patchMarketingCampaignsById,
} from '../../../../../../server/api/marketing';

export const GET = createRouteHandler(getMarketingCampaignsById);
export const PATCH = createRouteHandler(patchMarketingCampaignsById);
