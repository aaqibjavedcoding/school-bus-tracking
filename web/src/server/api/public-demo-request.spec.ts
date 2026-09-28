import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { HttpStatus } from '../framework';
import { callHandler } from '../http/route-testing';
import { overrideContainer } from '../container';
import { postPublicMarketingDemoRequest } from './public-demo-request';
import { MARKETING_ATTRIBUTION_COOKIE } from '../modules/marketing/marketing-tracking.service';
import type { MarketingLeadsService } from '../modules/marketing/marketing-leads.service';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants';

/**
 * The public demo-request endpoint as a *route contract*.
 *
 * The service spec proves the pipeline (honeypot, dedupe, store-first);
 * this one proves the wiring that makes it safe to expose: anonymous by
 * design, throttled by the dedicated policy, no audit rows carrying form
 * PII, and attribution taken exclusively from the server-set cookie.
 */

function stubLeads() {
  const calls: Array<{ input: unknown; context: { attributionCookie?: string } }> = [];
  const service = {
    captureDemoRequest: async (input: unknown, context: { attributionCookie?: string } = {}) => {
      calls.push({ input, context });
      return { received: true, message: 'Thanks! We will be in touch shortly.' };
    },
  };
  overrideContainer('marketingLeads', service as unknown as MarketingLeadsService);
  return { calls };
}

const BODY = {
  full_name: 'Asha Verma',
  email: 'asha@greenfield.example',
  institution_name: 'Greenfield Public School',
  consent: true,
};

describe('POST /public/marketing/demo-request — route contract', () => {
  it('is unauthenticated, role-free and answers 202', () => {
    assert.equal(postPublicMarketingDemoRequest.auth, false, 'a prospect has no account');
    assert.equal(postPublicMarketingDemoRequest.roles, undefined);
    assert.equal(postPublicMarketingDemoRequest.status, HttpStatus.ACCEPTED);
  });

  it('is throttled by the dedicated marketing_demo_request policy', () => {
    assert.equal(postPublicMarketingDemoRequest.rateLimit, 'marketing_demo_request');
    assert.ok(
      (RATE_LIMIT_POLICIES as readonly string[]).includes('marketing_demo_request'),
      'the policy must exist in the closed union and in rate-limit.config',
    );
  });

  it('writes no audit rows — the lead timeline is the record, audit logs carry no form PII', () => {
    assert.equal((postPublicMarketingDemoRequest as { audit?: unknown }).audit, undefined);
  });

  it('hands the body and the attribution cookie to the service, nothing else', async () => {
    const { calls } = stubLeads();

    const result = await callHandler(postPublicMarketingDemoRequest, {
      body: BODY as never,
      request: { cookies: { [MARKETING_ATTRIBUTION_COOKIE]: 'a'.repeat(32) } },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].input, BODY);
    assert.equal(calls[0].context.attributionCookie, 'a'.repeat(32));
    assert.deepEqual(result, { received: true, message: 'Thanks! We will be in touch shortly.' });
  });

  it('a browser without the cookie submits cleanly with no attribution', async () => {
    const { calls } = stubLeads();

    await callHandler(postPublicMarketingDemoRequest, { body: BODY as never });

    assert.equal(calls[0].context.attributionCookie, undefined);
  });

  it('never reflects the cookie value or a lead id back to the caller', async () => {
    stubLeads();

    const result = (await callHandler(postPublicMarketingDemoRequest, {
      body: BODY as never,
      request: { cookies: { [MARKETING_ATTRIBUTION_COOKIE]: 'deadbeef'.repeat(4) } },
    })) as Record<string, unknown>;

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('deadbeef'), false, 'the opaque cookie stays server-side');
    assert.deepEqual(Object.keys(result).sort(), ['message', 'received']);
  });
});
