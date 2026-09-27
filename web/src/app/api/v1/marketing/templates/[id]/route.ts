/**
 * App Router entry point for `/api/v1/marketing/templates/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import {
  getMarketingTemplatesById,
  patchMarketingTemplatesById,
} from '../../../../../../server/api/marketing';

export const GET = createRouteHandler(getMarketingTemplatesById);
export const PATCH = createRouteHandler(patchMarketingTemplatesById);
