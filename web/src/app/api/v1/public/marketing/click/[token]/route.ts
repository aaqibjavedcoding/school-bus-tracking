/**
 * App Router entry point for `/api/v1/public/marketing/click/:token`.
 *
 * Public and unauthenticated: the opaque per-recipient token is the whole
 * credential. The behaviour lives in the endpoint definition;
 * `createRouteHandler` runs the shared guard chain (rate limit, CSRF) around
 * it and passes the redirect `Response` through unwrapped.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { getPublicMarketingClickByToken } from '../../../../../../../server/api/public-marketing';

export const GET = createRouteHandler(getPublicMarketingClickByToken);
