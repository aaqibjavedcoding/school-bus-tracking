import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { HttpStatus } from '../framework';
import { CookieJar } from '../http/cookies';
import { callHandler } from '../http/route-testing';
import { overrideContainer } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import * as publicMarketing from './public-marketing';
import {
  MARKETING_ATTRIBUTION_COOKIE,
  type MarketingClickResult,
} from '../modules/marketing/marketing-tracking.service';
import type { MarketingTrackingService } from '../modules/marketing/marketing-tracking.service';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants';

/**
 * The public marketing endpoints as *route contracts*.
 *
 * The service spec proves the behaviour; this one proves the wiring that
 * makes the behaviour safe to expose: no authentication (a recipient has no
 * account), a strict public rate-limit policy, a redirect that carries
 * `no-store`, an attribution cookie that is HttpOnly, and no audit rows for
 * anonymous recipient actions.
 */

const TOKEN = 'a'.repeat(64);

const ENDPOINTS: Array<{ name: string; definition: EndpointDefinition<never, never> }> =
  Object.entries(publicMarketing)
    .filter(
      (entry): entry is [string, EndpointDefinition<never, never>] =>
        typeof entry[1] === 'object' && entry[1] !== null && 'handler' in entry[1],
    )
    .map(([name, definition]) => ({ name, definition }));

function stubTracking(overrides: Partial<MarketingTrackingService> = {}) {
  const calls: Array<{ method: string; token: string; query?: string }> = [];
  const tracking = {
    recordClick: async (token: string, query?: URLSearchParams): Promise<MarketingClickResult> => {
      calls.push({ method: 'click', token, query: query?.toString() });
      return {
        redirectUrl: 'https://app.zeromilesystems.test/?utm_source=campaign-email',
        attributionValue: 'f'.repeat(32),
        repeat: false,
      };
    },
    unsubscribe: async (token: string) => {
      calls.push({ method: 'unsubscribe', token });
      return {
        unsubscribed: true as const,
        already_unsubscribed: false,
        message: 'You will no longer receive marketing email from Zero Mile Systems.',
      };
    },
    ...overrides,
  };
  overrideContainer('marketingTracking', tracking as unknown as MarketingTrackingService);
  return { calls };
}

describe('public marketing route contracts', () => {
  it('exposes exactly the click and unsubscribe endpoints', () => {
    assert.deepEqual(
      ENDPOINTS.map((endpoint) => endpoint.name).sort(),
      [
        'getPublicMarketingClickByToken',
        'getPublicMarketingUnsubscribeByToken',
        'postPublicMarketingUnsubscribeByToken',
      ],
      'no open-tracking pixel and no lead endpoint in this session',
    );
  });

  it('is unauthenticated and role-free — the token is the credential', () => {
    for (const { name, definition } of ENDPOINTS) {
      assert.equal(definition.auth, false, `${name} must not require a session`);
      assert.equal(definition.roles, undefined, `${name} must not require a role`);
    }
  });

  it('applies the strict public rate-limit policy to every endpoint', () => {
    for (const { name, definition } of ENDPOINTS) {
      assert.equal(
        definition.rateLimit,
        'marketing_public',
        `${name} must be throttled for anonymous callers`,
      );
      assert.ok(
        (RATE_LIMIT_POLICIES as readonly string[]).includes('marketing_public'),
        'the policy must exist in the closed union and in rate-limit.config',
      );
    }
  });

  it('writes no audit rows for anonymous recipient actions', () => {
    for (const { name, definition } of ENDPOINTS) {
      assert.equal(
        (definition as { audit?: unknown }).audit,
        undefined,
        `${name} belongs in email_events, not audit_logs`,
      );
    }
  });
});

describe('GET /public/marketing/click/:token', () => {
  it('redirects to the service-built target and never caches', async () => {
    stubTracking();
    const cookies = new CookieJar();

    const response = (await callHandler(publicMarketing.getPublicMarketingClickByToken, {
      params: { token: TOKEN },
      raw: new Request('https://app.zeromilesystems.test/api/v1/public/marketing/click/x?utm_source=news'),
      cookies,
    })) as Response;

    assert.ok(response instanceof Response, 'the handler answers with its own redirect');
    assert.equal(response.status, HttpStatus.FOUND);
    assert.equal(
      response.headers.get('Location'),
      'https://app.zeromilesystems.test/?utm_source=campaign-email',
    );
    assert.match(String(response.headers.get('Cache-Control')), /no-store/);
  });

  it('passes the incoming query through for UTM preservation', async () => {
    const { calls } = stubTracking();

    await callHandler(publicMarketing.getPublicMarketingClickByToken, {
      params: { token: TOKEN },
      raw: new Request('https://app.test/api/v1/public/marketing/click/x?utm_source=news&evil=1'),
    });

    assert.equal(calls[0].method, 'click');
    assert.equal(calls[0].token, TOKEN);
    assert.ok(calls[0].query?.includes('utm_source=news'));
  });

  it('sets an HttpOnly, SameSite=Lax first-party attribution cookie', async () => {
    stubTracking();
    const cookies = new CookieJar();

    await callHandler(publicMarketing.getPublicMarketingClickByToken, {
      params: { token: TOKEN },
      raw: new Request('https://app.test/api/v1/public/marketing/click/x'),
      cookies,
    });

    const cookie = cookies.find(MARKETING_ATTRIBUTION_COOKIE);
    assert.ok(cookie, 'attribution cookie is set');
    assert.equal(cookie?.options.httpOnly, true, 'no script needs to read it');
    assert.equal(cookie?.options.sameSite, 'lax', 'it must survive the top-level navigation');
    assert.equal(cookie?.options.secure, true, 'an https target gets a Secure cookie');
    assert.equal(cookie?.value.includes('@'), false, 'no address in a cookie');
  });

  it('propagates a rejected token as the safe 404 the service produced', async () => {
    stubTracking({
      recordClick: async () => {
        const error = Object.assign(new Error('This link is no longer valid'), {
          getStatus: () => 404,
        });
        throw error;
      },
    } as never);

    await assert.rejects(
      callHandler(publicMarketing.getPublicMarketingClickByToken, {
        params: { token: 'nope' },
        raw: new Request('https://app.test/api/v1/public/marketing/click/nope'),
      }),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 404);
        return true;
      },
    );
  });
});

describe('unsubscribe endpoints', () => {
  it('answers a human with an HTML confirmation page', async () => {
    stubTracking();

    const response = (await callHandler(publicMarketing.getPublicMarketingUnsubscribeByToken, {
      params: { token: TOKEN },
    })) as Response;

    assert.equal(response.status, HttpStatus.OK);
    assert.match(String(response.headers.get('Content-Type')), /text\/html/);
    const html = await response.text();
    assert.ok(html.includes("You're unsubscribed"));
    assert.ok(html.includes('noindex'), 'the confirmation page must not be indexed');
    assert.equal(html.includes('@'), false, 'no address is printed back');
  });

  it('answers a mail client (one-click POST) with the JSON contract', async () => {
    const { calls } = stubTracking();

    const result = (await callHandler(publicMarketing.postPublicMarketingUnsubscribeByToken, {
      params: { token: TOKEN },
    })) as { unsubscribed: boolean; already_unsubscribed: boolean; message: string };

    assert.equal(result.unsubscribed, true);
    assert.equal(result.already_unsubscribed, false);
    assert.ok(result.message.length > 0);
    assert.equal(calls[0].method, 'unsubscribe');
    assert.equal(calls[0].token, TOKEN);
  });

  it('escapes the confirmation message instead of interpolating markup', async () => {
    stubTracking({
      unsubscribe: async () => ({
        unsubscribed: true as const,
        already_unsubscribed: true,
        message: '<script>alert(1)</script>',
      }),
    } as never);

    const response = (await callHandler(publicMarketing.getPublicMarketingUnsubscribeByToken, {
      params: { token: TOKEN },
    })) as Response;
    const html = await response.text();

    assert.equal(html.includes('<script>'), false);
    assert.ok(html.includes('&lt;script&gt;'));
  });
});
