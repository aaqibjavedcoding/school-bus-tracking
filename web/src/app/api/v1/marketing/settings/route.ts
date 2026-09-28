import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getMarketingSettings, putMarketingSettings } from '../../../../../server/api/marketing';

export const GET = createRouteHandler(getMarketingSettings);
export const PUT = createRouteHandler(putMarketingSettings);
