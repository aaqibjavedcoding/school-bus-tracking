/**
 * App Router entry point for
 * `/api/v1/integrations/marketing/email-events` — the signed, provider
 * neutral email-event webhook. The behaviour (signature, timestamp, replay
 * and body bounds) lives in the endpoint definition.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { postMarketingEmailEvents } from '../../../../../../server/api/integrations-marketing';

export const POST = createRouteHandler(postMarketingEmailEvents);
