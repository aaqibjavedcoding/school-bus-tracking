/**
 * The signed provider email-event integration endpoint.
 *
 * ```text
 * POST /api/v1/integrations/marketing/email-events
 * ```
 *
 * A machine endpoint, authenticated by an HMAC signature over the raw
 * request bytes rather than by a session:
 *
 * - **`auth: false`** — an event source has no user account. The
 *   `MARKETING_PROVIDER_WEBHOOK_SECRET` signature *is* the credential, and
 *   without that secret configured the service closes the endpoint entirely.
 * - **`rateLimit: 'marketing_provider_events'`** — bounded even for a
 *   correctly signed caller.
 * - **Nothing is echoed.** The answer is a four-field acknowledgement; the
 *   payload, the signature and the secret never reach a response or a log.
 * - **No audit row.** This is a provider signal, not an operator action; it
 *   lands in `marketing_provider_events` (and, when it suppresses, in the
 *   suppression table the console shows).
 *
 * Honest note, repeated here because this is where someone will look: plain
 * Gmail SMTP does not call this endpoint. It is the ready, verified ingest
 * for a future event source; the working feedback path today is the manual
 * suppression console plus the delivery worker's handling of immediate SMTP
 * rejections.
 */

import { HttpStatus } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import {
  MARKETING_WEBHOOK_SIGNATURE_HEADER,
  MARKETING_WEBHOOK_TIMESTAMP_HEADER,
} from '../modules/marketing/marketing-email-events.service';

/** Reads one header as a single string (never an array, never logged). */
function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === 'string' ? value : undefined;
}

/** `POST /api/v1/integrations/marketing/email-events` */
export const postMarketingEmailEvents: EndpointDefinition = {
  auth: false,
  rateLimit: 'marketing_provider_events',
  status: HttpStatus.OK,
  handler: async ({ request }) => {
    // The raw body is what was signed; a re-serialized object is not.
    const rawBody = typeof request.rawBody === 'string' ? request.rawBody : '';
    return container()
      .marketingEmailEvents()
      .ingest({
        rawBody,
        signature: header(request.headers, MARKETING_WEBHOOK_SIGNATURE_HEADER),
        timestamp: header(request.headers, MARKETING_WEBHOOK_TIMESTAMP_HEADER),
      });
  },
};
