import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { postMarketingLeadsByIdErase } from '../../../../../../../server/api/marketing';

export const POST = createRouteHandler(postMarketingLeadsByIdErase);
