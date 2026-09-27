/**
 * App Router entry point for `/api/v1/public/marketing/unsubscribe/:token`.
 *
 * `GET` answers a human with a confirmation page; `POST` is the RFC 8058
 * one-click branch a mailbox provider uses. Both are public and resolve the
 * recipient from the opaque token alone.
 */
import { createRouteHandlers } from '../../../../../../../server/http/route-runtime';
import {
  getPublicMarketingUnsubscribeByToken,
  postPublicMarketingUnsubscribeByToken,
} from '../../../../../../../server/api/public-marketing';

export const { GET, POST } = createRouteHandlers({
  GET: getPublicMarketingUnsubscribeByToken,
  POST: postPublicMarketingUnsubscribeByToken,
});
