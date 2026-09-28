/**
 * The **public** demo-request endpoint (Session 4).
 *
 * ```text
 * POST /api/v1/public/marketing/demo-request → generic confirmation
 * ```
 *
 * The only unauthenticated marketing endpoint that *writes personal data*,
 * so everything about it is deliberately narrow:
 *
 * - **`auth: false`, `roles` unset.** A prospective customer has no account.
 * - **`rateLimit: 'marketing_demo_request'`.** Tight per-IP window plus an
 *   identity bucket keyed on the (hashed) submitted email — see
 *   `config/rate-limit.config.ts`.
 * - **The body can never name a campaign, recipient, school or admin.**
 *   The DTO whitelists the form fields only (`forbidNonWhitelisted`), and
 *   attribution comes exclusively from the server-set opaque cookie, which
 *   is resolved — never trusted — by the tracking service.
 * - **One generic answer.** Stored lead, deduplicated replay and honeypot
 *   hit all return the same sentence; the endpoint is not an oracle for
 *   which addresses already have a lead.
 * - **No audit row.** This is an anonymous visitor action, not an operator
 *   action; the lead's own `CREATED` event is its record. Auditing it would
 *   put form PII on the audit trail.
 * - **The SMTP relay is not in the request path.** The lead is committed
 *   first; the admin notification is scheduled fire-and-forget afterwards.
 */

import { HttpStatus } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { MARKETING_ATTRIBUTION_COOKIE } from '../modules/marketing/marketing-tracking.service';
import { PublicDemoRequestDto } from '../modules/marketing/dto';

/** `POST /api/v1/public/marketing/demo-request` */
export const postPublicMarketingDemoRequest: EndpointDefinition<PublicDemoRequestDto> = {
  auth: false,
  rateLimit: 'marketing_demo_request',
  status: HttpStatus.ACCEPTED,
  bodyType: PublicDemoRequestDto,
  handler: async ({ body, request }) => {
    // The attribution cookie is HttpOnly and opaque; its value is handed to
    // the service for server-side resolution and is never logged.
    const attributionCookie = request.cookies?.[MARKETING_ATTRIBUTION_COOKIE];
    return container()
      .marketingLeads()
      .captureDemoRequest(body as never, { attributionCookie });
  },
};
