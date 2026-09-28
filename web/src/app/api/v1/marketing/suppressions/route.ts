import { createRouteHandler } from '../../../../../server/http/route-runtime';
import {
  getMarketingSuppressions,
  postMarketingSuppressions,
} from '../../../../../server/api/marketing';

export const GET = createRouteHandler(getMarketingSuppressions);
export const POST = createRouteHandler(postMarketingSuppressions);
