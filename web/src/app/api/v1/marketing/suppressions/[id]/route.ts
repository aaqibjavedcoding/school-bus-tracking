import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { deleteMarketingSuppressionsById } from '../../../../../../server/api/marketing';

export const DELETE = createRouteHandler(deleteMarketingSuppressionsById);
