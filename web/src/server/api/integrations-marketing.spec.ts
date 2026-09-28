import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HttpStatus } from '../framework';
import { callHandler } from '../http/route-testing';
import { overrideContainer } from '../container';
import * as integrations from './integrations-marketing';
import {
  MARKETING_WEBHOOK_SIGNATURE_HEADER,
  MARKETING_WEBHOOK_TIMESTAMP_HEADER,
  signMarketingProviderEvent,
  type MarketingEmailEventsService,
} from '../modules/marketing/marketing-email-events.service';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants';

/**
 * The provider email-event endpoint as a *route contract*.
 *
 * The service spec proves the verification logic; this one proves the wiring
 * that makes an unauthenticated write path safe to expose: no session, a
 * rate-limit policy that exists in the closed union, the **raw** body handed
 * to the verifier (a re-serialized object would never match the signature),
 * the signature and timestamp read from headers, and no audit row for what
 * is a machine signal rather than an operator action.
 */

const SECRET = 'provider-webhook-secret-32-chars!!';

function stubService() {
  const calls: Array<{ rawBody: string; signature?: string; timestamp?: string }> = [];
  const service = {
    async ingest(request: { rawBody: string; signature?: string; timestamp?: string }) {
      calls.push(request);
      return { accepted: true, duplicate: false, event_type: null, suppressed: false };
    },
  };
  overrideContainer('marketingEmailEvents', service as unknown as MarketingEmailEventsService);
  return { calls };
}

describe('POST /integrations/marketing/email-events — contract', () => {
  it('is unauthenticated, role-free and rate limited', () => {
    const definition = integrations.postMarketingEmailEvents;
    assert.equal(definition.auth, false, 'an event source has no user account');
    assert.equal(definition.roles, undefined);
    assert.equal(definition.rateLimit, 'marketing_provider_events');
    assert.ok(
      (RATE_LIMIT_POLICIES as readonly string[]).includes('marketing_provider_events'),
      'the policy exists in the closed union and in rate-limit.config',
    );
    assert.equal(definition.status, HttpStatus.OK);
    assert.equal((definition as { audit?: unknown }).audit, undefined);
  });

  it('declares no bodyType — the raw bytes are what was signed', () => {
    const definition = integrations.postMarketingEmailEvents as { bodyType?: unknown };
    assert.equal(
      definition.bodyType,
      undefined,
      'validating into a DTO would discard the exact bytes the HMAC covers',
    );
  });

  it('hands the raw body and both headers to the verifier, verbatim', async () => {
    const { calls } = stubService();
    const rawBody = '{"event_id":"evt-1","type":"hard_bounce","email":"p@school.test"}';
    const timestamp = '1790000000';
    const signature = signMarketingProviderEvent(SECRET, timestamp, rawBody);

    await callHandler(integrations.postMarketingEmailEvents, {
      request: {
        rawBody,
        headers: {
          [MARKETING_WEBHOOK_SIGNATURE_HEADER]: signature,
          [MARKETING_WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        },
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].rawBody, rawBody, 'byte-for-byte, not re-serialized');
    assert.equal(calls[0].signature, signature);
    assert.equal(calls[0].timestamp, timestamp);
  });

  it('passes an empty body and missing headers through as undefined (the service rejects them)', async () => {
    const { calls } = stubService();

    await callHandler(integrations.postMarketingEmailEvents, { request: { headers: {} } });

    assert.equal(calls[0].rawBody, '');
    assert.equal(calls[0].signature, undefined);
    assert.equal(calls[0].timestamp, undefined);
  });

  it('collapses a repeated header to its first value', async () => {
    const { calls } = stubService();

    await callHandler(integrations.postMarketingEmailEvents, {
      request: {
        rawBody: '{}',
        headers: {
          [MARKETING_WEBHOOK_SIGNATURE_HEADER]: ['first', 'second'],
          [MARKETING_WEBHOOK_TIMESTAMP_HEADER]: ['1790000000'],
        },
      },
    });

    assert.equal(calls[0].signature, 'first');
    assert.equal(calls[0].timestamp, '1790000000');
  });

  it('returns the acknowledgement unchanged and echoes no payload', async () => {
    stubService();

    const result = (await callHandler(integrations.postMarketingEmailEvents, {
      request: { rawBody: '{"event_id":"evt-1"}', headers: {} },
    })) as Record<string, unknown>;

    assert.deepEqual(Object.keys(result).sort(), [
      'accepted',
      'duplicate',
      'event_type',
      'suppressed',
    ]);
  });
});

describe('the App Router route file', () => {
  it('re-exports the endpoint definition through the shared runtime', () => {
    const file = path.resolve(
      __dirname,
      '..',
      '..',
      'app',
      'api',
      'v1',
      'integrations',
      'marketing',
      'email-events',
      'route.ts',
    );
    assert.ok(fs.existsSync(file), 'the route file exists at the documented path');
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /createRouteHandler/);
    assert.match(source, /postMarketingEmailEvents/);
    assert.ok(!/process\.env/.test(source), 'no secret handling in the route shim');
  });
});
