import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getCrewPhoto } from '../../../../../server/api/crew-photos';
export const GET = createRouteHandler(getCrewPhoto);
