/**
 * Endpoint definitions for the **public** marketing surface (Session 3).
 *
 * ```text
 * GET  /api/v1/public/marketing/click/:token         → 302 to the landing page
 * GET  /api/v1/public/marketing/unsubscribe/:token   → HTML confirmation
 * POST /api/v1/public/marketing/unsubscribe/:token   → RFC 8058 one-click
 * ```
 *
 * These are the only unauthenticated marketing routes, and the only ones
 * reachable from a mail client. Everything about them is deliberately
 * minimal:
 *
 * - **`auth: false`, `roles` unset.** A recipient has no account; the opaque
 *   token is the credential.
 * - **`rateLimit: 'marketing_public'`.** Strictly capped per IP — see the
 *   policy's comment in `config/rate-limit.config.ts`.
 * - **No audit rows.** These are recipient actions, not operator actions;
 *   they belong in `email_events` (which is exactly where the service writes
 *   them). Auditing them would fill `audit_logs` with rows whose "actor" is
 *   an anonymous click, and would risk recording token material.
 * - **No JSON envelope on the click** — it answers with a redirect, so it
 *   returns its own `Response`, which the route runtime passes through.
 *
 * The `POST` variant exists because RFC 8058's `List-Unsubscribe-Post`
 * promises a one-click POST that needs no confirmation page. The CSRF guard
 * allows it: a mail client sends no `Origin`, and the rule for an
 * origin-less request is "not a browser forgery" (see `common/security/csrf`).
 */

import { HttpStatus } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import {
  MARKETING_ATTRIBUTION_COOKIE,
  MARKETING_ATTRIBUTION_COOKIE_MAX_AGE_MS,
} from '../modules/marketing/marketing-tracking.service';

/** Reads the `:token` path segment without ever logging it. */
function tokenParam(params: Record<string, string>): string {
  return typeof params['token'] === 'string' ? params['token'] : '';
}

/** The query string of the incoming request, for UTM pass-through. */
function searchParams(rawUrl: string): URLSearchParams {
  try {
    return new URL(rawUrl).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/**
 * `GET /api/v1/public/marketing/click/:token`
 *
 * Records the click and redirects to the configured landing page. The target
 * is built server-side from `APP_URL`; nothing in the request can influence
 * it beyond a bounded set of `utm_*` values, so this cannot become an open
 * redirect.
 */
export const getPublicMarketingClickByToken: EndpointDefinition = {
  auth: false,
  rateLimit: 'marketing_public',
  status: HttpStatus.FOUND,
  handler: async ({ params, raw, cookies }) => {
    const result = await container()
      .marketingTracking()
      .recordClick(tokenParam(params), searchParams(raw.url));

    // First-party attribution cookie. `httpOnly` because nothing in the
    // browser needs to read it — the server correlates a later demo request
    // with it — and `sameSite: 'lax'` so it survives the top-level
    // navigation that just happened. `secure` follows the deployment's
    // protocol so local HTTP development still works.
    cookies.cookie(MARKETING_ATTRIBUTION_COOKIE, result.attributionValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: result.redirectUrl.startsWith('https://'),
      path: '/',
      maxAge: MARKETING_ATTRIBUTION_COOKIE_MAX_AGE_MS,
    });

    return new Response(null, {
      status: HttpStatus.FOUND,
      headers: {
        Location: result.redirectUrl,
        // A cached redirect would silently stop recording clicks, and a
        // shared cache must never hold a per-recipient response.
        'Cache-Control': 'no-store, max-age=0',
        Referrer_Policy: 'no-referrer',
      },
    });
  },
};

/**
 * `GET /api/v1/public/marketing/unsubscribe/:token`
 *
 * The human-facing branch: a person clicked the footer link, so the answer is
 * a small HTML page rather than a JSON envelope. It states what happened,
 * and — importantly — that account and service email is unaffected, because
 * "unsubscribe" must not leave a school admin wondering whether they have
 * just switched off their own password-reset mail.
 */
export const getPublicMarketingUnsubscribeByToken: EndpointDefinition = {
  auth: false,
  rateLimit: 'marketing_public',
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const result = await container().marketingTracking().unsubscribe(tokenParam(params));
    return new Response(unsubscribePage(result.message), {
      status: HttpStatus.OK,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  },
};

/**
 * `POST /api/v1/public/marketing/unsubscribe/:token`
 *
 * The machine-facing branch advertised by `List-Unsubscribe-Post`. Mailbox
 * providers POST here when the reader presses their native "Unsubscribe"
 * button, and expect a success status with no interaction.
 */
export const postPublicMarketingUnsubscribeByToken: EndpointDefinition = {
  auth: false,
  rateLimit: 'marketing_public',
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    return container().marketingTracking().unsubscribe(tokenParam(params));
  },
};

/** Minimal, dependency-free confirmation page (no tracking, no assets). */
function unsubscribePage(message: string): string {
  const safe = message.replace(/[<>&]/g, (character) =>
    character === '<' ? '&lt;' : character === '>' ? '&gt;' : '&amp;',
  );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Unsubscribed</title>
  </head>
  <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:48px 24px;background:#f8fafc;color:#0f172a">
    <main style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
      <h1 style="font-size:20px;margin:0 0 12px">You're unsubscribed</h1>
      <p style="margin:0;line-height:1.6;color:#334155">${safe}</p>
    </main>
  </body>
</html>`;
}
